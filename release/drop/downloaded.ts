// The drop check's judge of a download (#116): the baked file a drop page
// saved, read back through `loadVAT` in Node, against `bakeVAT` of the same
// asset here. Loaded by check.mjs through its vite server, so the library is
// the source in this tree, through its public specifier.
//
// Node decodes no image, so both sides load the glTF without them: a baked
// file's images are the source's bytes (ADR-0034), compared here as bytes.
import { Texture } from 'three'
import type { AnimationClip, BufferAttribute, DataTexture, Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { bakeVAT, loadVAT } from 'three-vat'
import type { BakeOptions, VAT } from 'three-vat'

function imagelessLoader(): GLTFLoader {
  return new GLTFLoader().register((parser: GLTFParser) => {
    ;(parser as unknown as { loadImageSource: () => Promise<Texture> }).loadImageSource = () =>
      Promise.resolve(new Texture())
    return { name: 'drop-check:no-images' }
  })
}

/** What a page and Node both need to load a file from bytes: `self`, as GLTFLoader reads it. */
function installGlobals() {
  const scope = globalThis as { self?: unknown; ProgressEvent?: unknown }
  scope.self ??= globalThis
  scope.ProgressEvent ??= class extends Event {}
}

/** Every image a GLB's binary chunk holds, as bytes, smallest first. */
function imagesOf(glb: Uint8Array): Uint8Array[] {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength)
  const jsonLength = view.getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength))) as {
    images?: { bufferView?: number }[]
    bufferViews: { byteOffset?: number; byteLength: number }[]
  }
  const bin = glb.subarray(20 + jsonLength + 8)
  return (json.images ?? [])
    .filter((image) => image.bufferView !== undefined)
    .map(({ bufferView }) => {
      const { byteOffset = 0, byteLength } = json.bufferViews[bufferView!]!
      return bin.slice(byteOffset, byteOffset + byteLength)
    })
    .sort((a, b) => a.byteLength - b.byteLength)
}

const same = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a.length === b.length && Array.prototype.every.call(a, (x: number, i: number) => Object.is(x, b[i]))

/** Where `loaded` and `baked` differ, by name; empty where the file is the bake. */
function differences(loaded: VAT, baked: VAT): string[] {
  const out: string[] = []
  const expect = (what: string, ok: boolean) => void (ok || out.push(what))
  expect(`encoding ${loaded.encoding} for ${baked.encoding}`, loaded.encoding === baked.encoding)
  expect('vertexCount', loaded.vertexCount === baked.vertexCount)
  expect('totalFrames', loaded.totalFrames === baked.totalFrames)
  expect('clips', JSON.stringify(loaded.clips) === JSON.stringify(baked.clips))
  expect('bounds', loaded.bounds.equals(baked.bounds))
  expect('materials', loaded.materials.length === baked.materials.length)
  expect('groups', JSON.stringify(loaded.geometry.groups) === JSON.stringify(baked.geometry.groups))
  expect('index', same(loaded.geometry.index?.array ?? [], baked.geometry.index?.array ?? []))
  for (const [name, attribute] of Object.entries(baked.geometry.attributes)) {
    const got = loaded.geometry.attributes[name] as BufferAttribute | undefined
    expect(`attribute ${name}`, got !== undefined && same(got.array, (attribute as BufferAttribute).array))
  }
  const texels = (texture: DataTexture | null | undefined) => (texture?.image.data ?? []) as ArrayLike<number>
  if (loaded.encoding === 'rig' && baked.encoding === 'rig') {
    expect('slotCount', loaded.slotCount === baked.slotCount)
    expect('rig texels', same(texels(loaded.rigTexture), texels(baked.rigTexture)))
  } else if (loaded.encoding === 'delta' && baked.encoding === 'delta') {
    expect('position texels', same(texels(loaded.positionTexture), texels(baked.positionTexture)))
    expect('normal texels', same(texels(loaded.normalTexture), texels(baked.normalTexture)))
    expect('fallback', loaded.fallback === baked.fallback)
  }
  return out
}

/**
 * How the page's downloaded `file` differs from `bakeVAT` of the `.glb` in
 * `asset`, over the named clips and with the page's options: every VAT field
 * a crowd reads, and every image byte for byte. Empty where it does not.
 */
export async function downloadDiffers(
  file: Uint8Array,
  asset: Uint8Array,
  clipNames: string[],
  options: BakeOptions,
): Promise<string[]> {
  installGlobals()
  const url = URL.createObjectURL(new Blob([new Uint8Array(file)]))
  let loaded: VAT
  try {
    loaded = await loadVAT(url, { loader: imagelessLoader() })
  } finally {
    URL.revokeObjectURL(url)
  }
  const gltf = (await imagelessLoader().parseAsync(new Uint8Array(asset).buffer, '')) as {
    scene: Object3D
    animations: AnimationClip[]
  }
  const clips = gltf.animations.filter((clip) => clipNames.includes(clip.name))
  const out = differences(loaded, bakeVAT(gltf.scene, clips, options))
  const [a, b] = [imagesOf(file), imagesOf(asset)]
  if (!(a.length === b.length && a.every((image, i) => same(image, b[i]!)))) out.push('images')
  return out
}
