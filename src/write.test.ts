import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Texture } from 'three'
import type { AnimationClip, Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { bakeVAT } from './bake.js'
import { assetMissing, expectSameVAT, installNodeFileGlobals, loadVATBytes } from './test-utils.js'
import { bakeVATInWorker, serveVATBakes } from './worker.js'
import { dataURI } from './write-materials.js'
import { readSourceImages, writeBakedFile } from './write.js'

// The writer as a page reaches it (#116): `three-vat/write`, over a VAT a
// worker baked from a glTF the page loaded, with the images read out of that
// same load. What the drop pages' download does, held here in Node.

installNodeFileGlobals()

const SOLDIER = 'test-assets/Soldier.glb'

/** A loader that decodes no image, as Node cannot; the page's decodes them, which the writer never reads. */
function imagelessLoader(): GLTFLoader {
  return new GLTFLoader().register((parser: GLTFParser) => {
    ;(parser as unknown as { loadImageSource: () => Promise<Texture> }).loadImageSource = () =>
      Promise.resolve(new Texture())
    return { name: 'test:no-images' }
  })
}

type Loaded = { scene: Object3D; animations: AnimationClip[]; parser: GLTFParser }

const parse = async (bytes: Uint8Array, path = '') =>
  (await imagelessLoader().parseAsync(new Uint8Array(bytes).buffer, path)) as Loaded

/** A GLB's JSON chunk and binary chunk. */
function chunksOf(glb: Uint8Array) {
  const jsonLength = new DataView(glb.buffer, glb.byteOffset, glb.byteLength).getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength))) as {
    buffers: { uri?: string; byteLength: number }[]
    bufferViews: { byteOffset?: number; byteLength: number }[]
    images?: { uri?: string; bufferView?: number; mimeType?: string }[]
  }
  return { json, bin: glb.subarray(20 + jsonLength + 8) }
}

/** Every image a GLB holds in its binary chunk, smallest first. */
function imagesOf(glb: Uint8Array): Uint8Array[] {
  const { json, bin } = chunksOf(glb)
  return (json.images ?? [])
    .map(({ bufferView }) => {
      const { byteOffset = 0, byteLength } = json.bufferViews[bufferView!]!
      return bin.slice(byteOffset, byteOffset + byteLength)
    })
    .sort((a, b) => a.byteLength - b.byteLength)
}

/** Byte for byte, reported by length and first difference: a diff of a megabyte never finishes. */
function expectSameImages(actual: Uint8Array[], expected: Uint8Array[]) {
  expect(actual.map((image) => image.byteLength)).toEqual(expected.map((image) => image.byteLength))
  actual.forEach((image, i) => expect(image.findIndex((byte, at) => byte !== expected[i]![at]), `image ${i}`).toBe(-1))
}

const open: (() => void)[] = []
afterEach(() => {
  while (open.length > 0) open.pop()!()
  vi.unstubAllGlobals()
})

function worker() {
  const { port1, port2 } = new MessageChannel()
  const stop = serveVATBakes(port2)
  port1.start()
  port2.start()
  open.push(() => {
    stop()
    port1.close()
    port2.close()
  })
  return port1
}

describe.skipIf(assetMissing(SOLDIER))("a worker bake of a page's glTF, downloaded: Soldier", () => {
  it.each(['rig', 'delta'] as const)(
    'loads as the VAT the bake returned, every image byte for byte: %s',
    async (encoding) => {
      const glb = new Uint8Array(readFileSync(SOLDIER))
      const gltf = await parse(glb)
      const clips = gltf.animations.filter((clip) => clip.name === 'Idle')
      const vat = await bakeVATInWorker(worker(), gltf.scene, clips, { encoding, fps: 5 })

      const file = await writeBakedFile(vat, { images: await readSourceImages(gltf.parser) })

      const loaded = await loadVATBytes(file, { loader: imagelessLoader() })
      expectSameVAT(loaded, bakeVAT(gltf.scene, clips, { encoding, fps: 5 }), { materials: 'value' })
      expectSameImages(imagesOf(file), imagesOf(glb))
    },
    60_000,
  )
})

describe('a data: URI, decoded where it stands', () => {
  it('base64 or percent-encoded, and no other URI', () => {
    expect([...new Uint8Array(dataURI('data:image/png;base64,AAH/')!)]).toEqual([0, 1, 255])
    expect([...new Uint8Array(dataURI('data:image/png,%00%01%FFa')!)]).toEqual([0, 1, 255, 97])
    expect(dataURI('textures/a.png')).toBeUndefined()
  })
})

describe.skipIf(assetMissing(SOLDIER))('readSourceImages, over a .gltf', () => {
  /**
   * Soldier as a `.gltf`: its buffer in a file beside it, one image embedded as
   * a `data:` URI and one in a file of its own. `files` is what sits beside it.
   */
  function soldierAsGLTF() {
    const glb = new Uint8Array(readFileSync(SOLDIER))
    const { json, bin } = chunksOf(glb)
    const [small, large] = imagesOf(glb)
    const types = json.images!.map((image) => image.mimeType!)
    json.buffers = [{ uri: 'soldier.bin', byteLength: bin.byteLength }]
    const embeddedIndex = json.images!.findIndex(({ bufferView }) => json.bufferViews[bufferView!]!.byteLength === small!.byteLength)
    const besideIndex = 1 - embeddedIndex
    let binary = ''
    for (let i = 0; i < small!.length; i += 0x8000) binary += String.fromCharCode(...small!.subarray(i, i + 0x8000))
    json.images![embeddedIndex] = { uri: `data:${types[embeddedIndex]};base64,${btoa(binary)}` }
    json.images![besideIndex] = { uri: 'textures/skin%20map.png', mimeType: types[besideIndex] }
    const files = new Map<string, Uint8Array>([
      ['soldier.bin', new Uint8Array(bin)],
      ['textures/skin%20map.png', large!],
    ])
    const loader = imagelessLoader()
    loader.manager.setURLModifier((url) => {
      const bytes = files.get(url)
      return bytes ? URL.createObjectURL(new Blob([new Uint8Array(bytes)])) : url
    })
    const load = async () =>
      (await loader.parseAsync(new TextEncoder().encode(JSON.stringify(json)).buffer, '')) as Loaded
    return { load, files, images: [small!, large!] }
  }

  it('reads a file beside it through the reader it is given, which may answer later, and an embedded one itself', async () => {
    const { load, files, images } = soldierAsGLTF()
    const gltf = await load()
    const asked: string[] = []
    const read = async (uri: string) => {
      asked.push(uri)
      await new Promise((resolve) => setTimeout(resolve, 1))
      return new Uint8Array(files.get(uri)!).buffer
    }
    const vat = bakeVAT(gltf.scene, [], { encoding: 'delta' })
    const file = await writeBakedFile(vat, { images: await readSourceImages(gltf.parser, read) })
    expect(asked).toEqual(['textures/skin%20map.png'])
    expectSameImages(imagesOf(file), images)
  }, 60_000)

  it('fetches a file beside it by default, where the loader found the glTF', async () => {
    const { load, files, images } = soldierAsGLTF()
    const gltf = await load()
    ;(gltf.parser as unknown as { options: { path: string } }).options.path = 'https://example.com/assets/'
    const fetched: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url)
      return new Response(new Uint8Array(files.get('textures/skin%20map.png')!))
    })
    const vat = bakeVAT(gltf.scene, [], { encoding: 'delta' })
    const file = await writeBakedFile(vat, { images: await readSourceImages(gltf.parser) })
    expect(fetched).toEqual(['https://example.com/assets/textures/skin%20map.png'])
    expectSameImages(imagesOf(file), images)
  }, 60_000)

  it('names the image a failed fetch was for', async () => {
    const { load } = soldierAsGLTF()
    const gltf = await load()
    vi.stubGlobal('fetch', async () => new Response('', { status: 404, statusText: 'Not Found' }))
    await expect(readSourceImages(gltf.parser)).rejects.toThrow(/textures\/skin%20map\.png.*404/)
  })
})
