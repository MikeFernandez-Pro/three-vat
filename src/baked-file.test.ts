import { readFileSync } from 'node:fs'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import type { AnimationClip, Group } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { bakeVAT } from './bake.js'
import type { BakedFileExtension, BakedLayer } from './baked-file.js'
import { assetMissing, installNodeFileGlobals, makeMultiBoneFixture } from './test-utils.js'
import type { VAT } from './types.js'
import { writeBakedFile } from './write-vat.js'

// How a baked file stores its layers (ADR-0034, ADR-0042): the one place the
// extension is read in a test, because what is held here is the bytes on disk,
// which the round trip through `loadVAT` cannot see. That the stored layers
// come back as the bake's texels is load-vat.test.ts's.

installNodeFileGlobals()

/** A GLB's extension, and the bytes of each buffer view of its binary chunk. */
function storedOf(glb: Uint8Array) {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength)
  const jsonLength = view.getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength))) as {
    extensions: { THREEVAT_vat: BakedFileExtension }
    bufferViews: { byteOffset?: number; byteLength: number }[]
  }
  const bin = glb.subarray(20 + jsonLength + 8)
  const bytes = ({ bufferView }: BakedLayer) => {
    const { byteOffset = 0, byteLength } = json.bufferViews[bufferView]!
    return bin.slice(byteOffset, byteOffset + byteLength)
  }
  return { extension: json.extensions.THREEVAT_vat, bytes }
}

/** A texture's texels as the bytes they are in memory. */
const texelBytes = (data: ArrayBufferView) => new Uint8Array(data.buffer, data.byteOffset, data.byteLength)

const brotli = (bytes: Uint8Array) =>
  brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).byteLength
const gzip = (bytes: Uint8Array) => gzipSync(bytes).byteLength

const ROBOT = 'examples/public/RobotExpressive.glb'

describe.skipIf(assetMissing(ROBOT))("a vertex-encoded file's position layer", () => {
  it('is stored transformed, and compresses smaller under brotli and gzip than its texels as they are', async () => {
    const gltf = (await new GLTFLoader().parseAsync(new Uint8Array(readFileSync(ROBOT)).buffer, '')) as {
      scene: Group
      animations: AnimationClip[]
    }
    const clips = gltf.animations.filter((c) => ['Idle', 'Walking'].includes(c.name))
    const vat = bakeVAT(gltf.scene, clips, { encoding: 'delta', fps: 30 }) as Extract<VAT, { encoding: 'delta' }>
    const { extension, bytes } = storedOf(await writeBakedFile(vat))
    expect(extension.encoding).toBe('delta')
    if (extension.encoding !== 'delta') return

    const stored = bytes(extension.layers.position)
    const raw = texelBytes(vat.positionTexture.image.data as Uint16Array)
    expect(stored.byteLength).toBe(raw.byteLength)
    // Measurably, not by a hair: the ticket's measure on Michelle halves it.
    expect(brotli(stored)).toBeLessThan(brotli(raw) * 0.8)
    expect(gzip(stored)).toBeLessThan(gzip(raw) * 0.8)
  }, 120_000)
})

describe("the layers stored as they are", () => {
  it("a rig-encoded file's rig texture, texel for texel", async () => {
    const { root, clip } = makeMultiBoneFixture()
    const vat = bakeVAT(root, [clip], { encoding: 'rig', fps: 10 }) as Extract<VAT, { encoding: 'rig' }>
    const { extension, bytes } = storedOf(await writeBakedFile(vat))
    expect(extension.encoding).toBe('rig')
    if (extension.encoding !== 'rig') return
    expect(bytes(extension.layers.rig)).toEqual(texelBytes(vat.rigTexture.image.data as Float32Array))
  })

  it("a vertex-encoded file's normal layer, texel for texel", async () => {
    const { root, clip } = makeMultiBoneFixture()
    const vat = bakeVAT(root, [clip], { encoding: 'delta', fps: 10 }) as Extract<VAT, { encoding: 'delta' }>
    const { extension, bytes } = storedOf(await writeBakedFile(vat))
    if (extension.encoding !== 'delta') throw new Error('not vertex-encoded')
    const normal = texelBytes(vat.normalTexture!.image.data as Uint8Array)
    // The view is padded to four bytes; the texels are the front of it.
    expect(bytes(extension.layers.normal!).subarray(0, normal.byteLength)).toEqual(normal)
  })
})
