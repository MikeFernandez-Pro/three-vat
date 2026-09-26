import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LoadingManager, MeshBasicMaterial, MeshPhysicalMaterial, Texture } from 'three'
import type { AnimationClip, Loader, Material, Mesh, MeshPhongMaterial, MeshStandardMaterial, Object3D } from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { bakeVAT } from './bake.js'
import type { BakeOptions } from './bake.js'
import { EXIT_OK, runCommand } from './cli.js'
import type { CommandIO } from './cli.js'
import { assetMissing, expectSameVAT, installNodeFileGlobals, loadVATBytes, makeMultiMaterialFixture } from './test-utils.js'
import { writeBakedFile } from './write-vat.js'

// A baked file carries its materials (ADR-0034, #115), held where a pipeline
// meets a page: the command's `--out` bytes, read back through `loadVAT`. What
// is checked inside the file is glTF's own structure, the images a viewer
// would show, never the extension the writer and loader agree on.

installNodeFileGlobals()

const SOLDIER = 'test-assets/Soldier.glb'

/**
 * The command over one asset at `/work/<name>`, plus any other files, writing
 * `/work/out.vat.glb` unless `report` says to only report; its report and the
 * bytes written.
 */
async function write(
  asset: string | Uint8Array,
  name: string,
  flags: string[],
  { files: others = {}, report = false }: { files?: Record<string, Uint8Array>; report?: boolean } = {},
) {
  const body = typeof asset === 'string' ? new Uint8Array(readFileSync(asset)) : asset
  const files = new Map<string, Uint8Array>([[`/work/${name}`, body], ...Object.entries(others)])
  const out: string[] = []
  const err: string[] = []
  const io: CommandIO = {
    cwd: '/work',
    readFile(path) {
      const body = files.get(path)
      if (body === undefined) throw new Error(`ENOENT: no such file, open '${path}'`)
      return body
    },
    exists: (path) => files.has(path),
    writeFile: (path, bytes) => void files.set(path, bytes),
    stdout: (text) => void out.push(text),
    stderr: (text) => void err.push(text),
    now: () => 0,
  }
  const code = await runCommand(['bake', name, ...flags, ...(report ? [] : ['--out', 'out.vat.glb'])], io)
  return { code, stdout: out.join(''), stderr: err.join(''), bytes: files.get('/work/out.vat.glb') }
}

/**
 * A `GLTFLoader` that decodes no image, as Node cannot: every texture an empty
 * one, sampler and slot as the file gives them. The same reading the command
 * makes of its source, so the two sides of a comparison are read alike.
 */
function imagelessLoader(): GLTFLoader {
  return new GLTFLoader().register((parser: GLTFParser) => {
    ;(parser as unknown as { loadImageSource: () => Promise<Texture> }).loadImageSource = () =>
      Promise.resolve(new Texture())
    return { name: 'test:no-images' }
  })
}

async function bakeDirect(asset: string, clipNames: string[], options: BakeOptions) {
  const gltf = (await imagelessLoader().parseAsync(new Uint8Array(readFileSync(asset)).buffer, '')) as {
    scene: Object3D
    animations: AnimationClip[]
  }
  return bakeVAT(gltf.scene, gltf.animations.filter((c) => clipNames.includes(c.name)), options)
}

/** A GLB's JSON chunk. */
function jsonOf(glb: Uint8Array): unknown {
  const jsonLength = new DataView(glb.buffer, glb.byteOffset, glb.byteLength).getUint32(12, true)
  return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)))
}

/** Every image a GLB holds in its binary chunk, as its bytes. */
function imagesOf(glb: Uint8Array): Uint8Array[] {
  const jsonLength = new DataView(glb.buffer, glb.byteOffset, glb.byteLength).getUint32(12, true)
  const json = jsonOf(glb) as {
    images?: { bufferView?: number }[]
    bufferViews: { byteOffset?: number; byteLength: number }[]
  }
  const bin = glb.subarray(20 + jsonLength + 8)
  return (json.images ?? []).map(({ bufferView }) => {
    const { byteOffset = 0, byteLength } = json.bufferViews[bufferView!]!
    return bin.slice(byteOffset, byteOffset + byteLength)
  })
}

/**
 * The same images, byte for byte, in whatever order the file lists them.
 * Reported by length and first difference: a diff of a megabyte never finishes.
 */
function expectSameImages(actual: Uint8Array[], expected: Uint8Array[]) {
  const bySize = (images: Uint8Array[]) => [...images].sort((a, b) => a.byteLength - b.byteLength)
  const [a, e] = [bySize(actual), bySize(expected)]
  expect(a.map((image) => image.byteLength)).toEqual(e.map((image) => image.byteLength))
  a.forEach((image, i) => expect(image.findIndex((byte, at) => byte !== e[i]![at]), `image ${i}`).toBe(-1))
}

describe.skipIf(assetMissing(SOLDIER))('a textured glTF through a baked file: Soldier', () => {
  it.each(['rig', 'delta'] as const)('loads as the VAT bakeVAT returned, and carries every image byte for byte: %s', async (encoding) => {
    const { code, stderr, bytes } = await write(SOLDIER, 'Soldier.glb', ['--encoding', encoding, '--clips', 'Idle', '--fps', '5'])
    expect(stderr).toBe('')
    expect(code).toBe(EXIT_OK)

    const direct = await bakeDirect(SOLDIER, ['Idle'], { encoding, fps: 5 })
    expect(direct.encoding).toBe(encoding)
    const loaded = await loadVATBytes(bytes!, { loader: imagelessLoader() })
    expectSameVAT(loaded, direct, { materials: 'value' })

    const source = imagesOf(new Uint8Array(readFileSync(SOLDIER)))
    expect(source).toHaveLength(2)
    expectSameImages(imagesOf(bytes!), source)
  }, 60_000)
})

const ROBOT = 'examples/public/RobotExpressive.glb'

describe.skipIf(assetMissing(ROBOT))('a flat-merged bake through a baked file: RobotExpressive', () => {
  it('loads with its merged material and the vertex colours it reads', async () => {
    const flags = ['--encoding', 'delta', '--clips', 'Idle', '--fps', '5', '--merge-flat-materials']
    const { code, stderr, bytes } = await write(ROBOT, 'robot.glb', flags)
    expect(stderr).toBe('')
    expect(code).toBe(EXIT_OK)

    const direct = await bakeDirect(ROBOT, ['Idle'], { encoding: 'delta', fps: 5, mergeFlatMaterials: true })
    const loaded = await loadVATBytes(bytes!)
    expect(loaded.materials).toHaveLength(1)
    expect((loaded.materials[0] as MeshStandardMaterial).vertexColors).toBe(true)
    expect(loaded.geometry.attributes.color).toBeDefined()
    expectSameVAT(loaded, direct, { materials: 'value' })
  }, 60_000)
})

const SAMBA = 'test-assets/Samba Dancing.fbx'

describe.skipIf(assetMissing(SAMBA))('an FBX through a baked file: Samba Dancing', () => {
  it('writes its Phong materials as PBR, names what each lost, and loads', async () => {
    const { code, stdout, stderr, bytes } = await write(SAMBA, 'samba.fbx', ['--encoding', 'delta', '--fps', '5'])
    expect(stderr).toBe('')
    expect(code).toBe(EXIT_OK)
    const report = stdout.split('\n')
    const at = report.indexOf('materials: 2')
    expect(report.slice(at, at + 3)).toEqual([
      'materials: 2',
      '  Alpha_Body_MAT: MeshPhongMaterial written as MeshStandardMaterial, losing specular and shininess',
      '  Alpha_Joints_MAT: MeshPhongMaterial written as MeshStandardMaterial, losing specular and shininess',
    ])

    const loaded = await loadVATBytes(bytes!)
    expect(loaded.encoding).toBe('delta')
    expect(loaded.materials.map((m) => [m.type, m.name])).toEqual([
      ['MeshStandardMaterial', 'Alpha_Body_MAT'],
      ['MeshStandardMaterial', 'Alpha_Joints_MAT'],
    ])
    // What the conversion keeps: each material's colour, as the Phong one held it.
    const manager = new LoadingManager()
    manager.addHandler(/./, { setPath: () => manager, load: () => new Texture() } as unknown as Loader)
    const phong: Material[] = []
    new FBXLoader(manager)
      .parse(new Uint8Array(readFileSync(SAMBA)).buffer, '')
      .traverse((o) => void ((o as Mesh).isMesh && phong.push((o as Mesh).material as Material)))
    loaded.materials.forEach((m, i) => {
      const [got, want] = [(m as MeshStandardMaterial).color, (phong[i] as MeshPhongMaterial).color]
      for (const c of ['r', 'g', 'b'] as const) expect(got[c]).toBeCloseTo(want[c], 6)
    })
  }, 60_000)

  it('names no conversion in report mode, which writes nothing', async () => {
    const { code, stdout, bytes } = await write(SAMBA, 'samba.fbx', ['--encoding', 'delta', '--fps', '5'], { report: true })
    expect(code).toBe(EXIT_OK)
    expect(stdout).not.toMatch(/written as/)
    expect(bytes).toBeUndefined()
  }, 60_000)
})

describe("loadVAT's materials option", () => {
  const written = async () => {
    const { root, clip } = makeMultiMaterialFixture()
    const vat = bakeVAT(root, [clip], { encoding: 'delta', fps: 10 })
    expect(vat.materials).toHaveLength(2)
    return writeBakedFile(vat)
  }

  it("replaces the file's materials wholesale, in materialIndex order", async () => {
    const mine = [new MeshBasicMaterial({ name: 'first' }), new MeshBasicMaterial({ name: 'second' })]
    const loaded = await loadVATBytes(await written(), { materials: mine })
    expect(loaded.materials).toHaveLength(2)
    expect(loaded.materials[0]).toBe(mine[0])
    expect(loaded.materials[1]).toBe(mine[1])
  })

  it('refuses an array of the wrong length, by name', async () => {
    const bytes = await written()
    await expect(loadVATBytes(bytes, { materials: [new MeshBasicMaterial()] })).rejects.toThrow(
      /`materials` holds 1 material.*2 materials, one for each materialIndex/,
    )
  })
})

describe('a texture a baked file cannot carry is refused, by name', () => {
  const baked = (dress: (material: MeshPhysicalMaterial) => void) => {
    const { root, clip } = makeMultiMaterialFixture()
    const vat = bakeVAT(root, [clip], { encoding: 'delta', fps: 10 })
    const material = new MeshPhysicalMaterial({ name: 'dressed' })
    dress(material)
    vat.materials[0] = material
    return vat
  }

  it('one whose image bytes were never read from a glTF source', async () => {
    const vat = baked((m) => (m.map = new Texture()))
    await expect(writeBakedFile(vat)).rejects.toThrow(/material "dressed" carries a texture \(map\) whose image was not read/)
  })

  it('one in a slot glTF core does not have', async () => {
    const texture = new Texture()
    const vat = baked((m) => (m.clearcoatMap = texture))
    const images = new Map([[texture.source, { extensions: {}, required: [], source: { bytes: new Uint8Array(4), mimeType: 'image/png' } }]])
    await expect(writeBakedFile(vat, { images })).rejects.toThrow(/material "dressed" carries a texture in clearcoatMap.*it carries map, normalMap/)
  })
})

const FACECAP = 'test-assets/facecap.glb'

describe.skipIf(assetMissing(FACECAP))('KTX2 textures through a baked file: facecap', () => {
  it('stay KTX2, their images byte for byte, through the extension the source reads them by', async () => {
    const flags = ['--clips', 'Key|Take 001|BaseLayer', '--fps', '5']
    const { code, stderr, bytes } = await write(FACECAP, 'facecap.glb', flags)
    expect(stderr).toBe('')
    expect(code).toBe(EXIT_OK)
    const source = imagesOf(new Uint8Array(readFileSync(FACECAP)))
    expect(source.length).toBeGreaterThan(0)
    expectSameImages(imagesOf(bytes!), source)
    const json = jsonOf(bytes!) as { textures: { extensions?: Record<string, unknown> }[]; extensionsRequired?: string[] }
    expect(json.textures.every((t) => t.extensions?.KHR_texture_basisu !== undefined)).toBe(true)
    expect(json.extensionsRequired).toContain('KHR_texture_basisu')
  }, 60_000)
})

describe.skipIf(assetMissing(SOLDIER))('a .gltf whose images live beside it and inside it', () => {
  /**
   * Soldier as a `.gltf`: its buffer in a file beside it, its first image
   * embedded as a `data:` URI that names no `mimeType` field, its second in a
   * file of its own. The two ways a `.gltf` holds an image besides a buffer view.
   */
  function soldierAsGLTF() {
    const glb = new Uint8Array(readFileSync(SOLDIER))
    const json = jsonOf(glb) as {
      buffers: { uri?: string; byteLength: number }[]
      images: { uri?: string; bufferView?: number; mimeType?: string }[]
    }
    const [embedded, beside] = imagesOf(glb)
    const types = json.images.map((image) => image.mimeType!)
    const bin = glb.subarray(20 + new DataView(glb.buffer).getUint32(12, true) + 8)
    json.buffers = [{ uri: 'soldier.bin', byteLength: bin.byteLength }]
    let binary = ''
    for (let i = 0; i < embedded!.length; i += 0x8000) binary += String.fromCharCode(...embedded!.subarray(i, i + 0x8000))
    json.images[0] = { uri: `data:${types[0]};base64,${btoa(binary)}` }
    json.images[1] = { uri: `skin.${types[1] === 'image/png' ? 'png' : 'jpg'}` }
    return {
      gltf: new TextEncoder().encode(JSON.stringify(json)),
      bin: new Uint8Array(bin),
      skin: [`/work/${json.images[1].uri}`, beside!] as const,
      images: [embedded!, beside!],
    }
  }

  const flags = ['--encoding', 'delta', '--clips', 'Idle', '--fps', '5']

  it('reports without reading an image, even one that is missing', async () => {
    const { gltf, bin } = soldierAsGLTF()
    const { code, stderr } = await write(gltf, 'soldier.gltf', flags, { files: { '/work/soldier.bin': bin }, report: true })
    expect(stderr).toBe('')
    expect(code).toBe(EXIT_OK)
  })

  it('writes both, byte for byte', async () => {
    const { gltf, bin, skin, images } = soldierAsGLTF()
    const files = { '/work/soldier.bin': bin, [skin[0]]: skin[1] }
    const { code, stderr, bytes } = await write(gltf, 'soldier.gltf', flags, { files })
    expect(stderr).toBe('')
    expect(code).toBe(EXIT_OK)
    expectSameImages(imagesOf(bytes!), images)
  }, 60_000)
})
