import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AnimationMixer, LoopOnce, LoopPingPong, Matrix4 } from 'three'
import type { AnimationClip, BufferAttribute, Group, Material, Mesh, Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { bakeVAT } from './bake.js'
import type { BakeInput, BakeOptions } from './bake.js'
import {
  assetMissing,
  compileVATMaterial,
  expectSameVAT,
  installNodeFileGlobals,
  loadVATBytes as load,
  makeAbsoluteMorphFixture,
  makeAbsoluteMorphNormalFixture,
  makeBoneScaleFixture,
  makeFixtureCrowd,
  makeFullSpinFixture,
  makeManyVertexFixture,
  makeMorphFixture,
  makeMorphNormalFixture,
  makeMorphNormalSkinnedFixture,
  makeMultiBoneFixture,
  makeMultiMaterialFixture,
  makeNormalOnlyMorphFixture,
  makePlacedSkinnedFixture,
  makeRigidSubtreeFixture,
  makeScaledPartFixture,
  makeSharedRigFixture,
  makeShippedWithoutNormalsFixture,
  makeSkinnedFixture,
  makeSkinnedMorphFixture,
  makeTangentFixture,
  nodesIn,
} from './test-utils.js'
import { createVATMesh as createTSLMesh, vatDecode } from './tsl.js'
import type { VAT } from './types.js'
import { createVATMesh as createWebGLMesh } from './webgl.js'
import { writeBakedFile } from './write-vat.js'

// The baked file (ADR-0034, #113), held at the one seam a page reaches:
// written, then read back through `loadVAT`, it is the VAT `bakeVAT` returned.
// The extension's fields are the writer's and the loader's private agreement,
// and the round trip is the test of it: nothing here reads them. What the
// refusals patch is glTF's own structure, which any tool rewriting a file sees.

installNodeFileGlobals()

const roundTrip = async (vat: VAT) => load(await writeBakedFile(vat))

function bake(root: Object3D, clips: BakeInput[], options: BakeOptions = {}): VAT {
  return bakeVAT(root, clips, { encoding: 'delta', fps: 10, ...options })
}

const FIXTURES: [string, () => { root: Object3D; clip: AnimationClip }][] = [
  ['a skinned mesh', makeSkinnedFixture],
  ['a morph-target mesh', makeMorphFixture],
  ['a rigid, node-animated subtree', makeRigidSubtreeFixture],
  ['a multi-bone rig', makeMultiBoneFixture],
  ['a skinned mesh with morphs', makeSkinnedMorphFixture],
  ['a skinned mesh under a placed parent', makePlacedSkinnedFixture],
  ['a mesh shipped without normals', makeShippedWithoutNormalsFixture],
  ['a subtree with tangents', () => makeTangentFixture()],
  ['two meshes sharing a rig', () => makeSharedRigFixture()],
  ['a mesh with a material array', () => makeMultiMaterialFixture()],
  ['a non-indexed mesh with a material array', () => makeMultiMaterialFixture({ indexed: false })],
  ['a skinned mesh with a material array', () => makeMultiMaterialFixture({ skinned: true })],
  ['a scaled part', () => makeScaledPartFixture({ scale: [2, 0.5, 3] })],
  ['an absolute morph', makeAbsoluteMorphFixture],
  ['a scaled bone', () => makeBoneScaleFixture([1, 2, 1])],
  ['a morph that moves normals', makeMorphNormalFixture],
  ['an absolute morph that moves normals', makeAbsoluteMorphNormalFixture],
  ['a skinned morph that moves normals', makeMorphNormalSkinnedFixture],
  ['a morph of normals only', makeNormalOnlyMorphFixture],
  ['a full spin', makeFullSpinFixture],
]

describe('a vertex-encoded baked file loads as the VAT bakeVAT returned', () => {
  it.each(FIXTURES)('%s', async (_name, make) => {
    const { root, clip } = make()
    const vat = bake(root, [clip])
    expectSameVAT(await roundTrip(vat), vat, { materials: 'value' })
  })

  it.each(FIXTURES)('without the normal texture: %s', async (_name, make) => {
    const { root, clip } = make()
    const vat = bake(root, [clip], { bakeNormals: false })
    expectSameVAT(await roundTrip(vat), vat, { materials: 'value' })
  })

  it('with a frame spanning rows', async () => {
    const { root, clip } = makeManyVertexFixture()
    // Seven vertices under a ceiling of four: two rows a frame, two frames.
    const vat = bake(root, [clip], { fps: 2, maxTextureSize: 4 })
    expect(vat.encoding === 'delta' && vat.rowsPerFrame).toBe(2)
    expectSameVAT(await roundTrip(vat), vat, { materials: 'value' })
  })

  it('with every clip default, a negative speed among them', async () => {
    const { root, clip } = makeRigidSubtreeFixture()
    const mixer = new AnimationMixer(root)
    const once = mixer.clipAction(clip)
    once.loop = LoopOnce
    once.timeScale = -1.5
    const second = clip.clone()
    second.name = 'back and forth'
    const pingpong = mixer.clipAction(second)
    pingpong.loop = LoopPingPong
    pingpong.repetitions = 3
    pingpong.timeScale = 0.25
    const vat = bake(root, [once, pingpong])
    expect(vat.clips.map((c) => c.speed)).toEqual([-1.5, 0.25])
    expectSameVAT(await roundTrip(vat), vat, { materials: 'value' })
  })

  it('on a fallen-back bake, whose fallback survives', async () => {
    const { root, clip } = makeMorphFixture()
    const vat = bakeVAT(root, [clip], { fps: 10 })
    expect(vat.encoding === 'delta' && vat.fallback).toMatch(/morph/)
    expectSameVAT(await roundTrip(vat), vat, { materials: 'value' })
  })

  it('opens in a plain GLTFLoader, without the plugin, at its rest pose', async () => {
    const { root, clip } = makeMultiMaterialFixture()
    const vat = bake(root, [clip])
    const bytes = await writeBakedFile(vat)
    const gltf = await new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer, '')
    const meshes: Mesh[] = []
    gltf.scene.traverse((o) => void ((o as Mesh).isMesh && meshes.push(o as Mesh)))
    expect(meshes).toHaveLength(vat.geometry.groups.length)
    for (const mesh of meshes) {
      expect((mesh.geometry.attributes.position as BufferAttribute).array).toEqual(vat.geometry.attributes.position!.array)
      mesh.updateWorldMatrix(true, false)
      expect(mesh.matrixWorld.equals(new Matrix4())).toBe(true)
    }
  })

  it('compiles on both decode paths, sampling the textures it loaded', async () => {
    const { root, clip } = makeMultiMaterialFixture()
    const loaded = await roundTrip(bake(root, [clip]))
    if (loaded.encoding !== 'delta') throw new Error('a vertex-encoded file')

    const webgl = createWebGLMesh(loaded, makeFixtureCrowd())
    expect(webgl.mesh.geometry).toBe(loaded.geometry)
    for (const material of webgl.mesh.material as Material[]) {
      const shader = compileVATMaterial(material)
      expect(shader.uniforms['uVatPosTex']?.value).toBe(loaded.positionTexture)
      expect(shader.uniforms['uVatNrmTex']?.value).toBe(loaded.normalTexture)
      expect(shader.vertexShader).toContain('uVatPosTex')
    }

    const tsl = createTSLMesh(loaded, makeFixtureCrowd())
    expect(tsl.mesh.geometry).toBe(loaded.geometry)
    const sampled = nodesIn(vatDecode(loaded, { playback: tsl.playback }).position).map((n) => n.value)
    expect(sampled).toContain(loaded.positionTexture)
  })
})

// ------------------------------------------------------------------ refusals

/** A GLB's JSON and binary chunks, and a way to write them back as one. */
function splitGLB(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const jsonLength = view.getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as Record<string, any>
  const bin = bytes.slice(20 + jsonLength + 8)
  const join = () => {
    let text = JSON.stringify(json)
    while (text.length % 4 !== 0) text += ' '
    const jsonBytes = new TextEncoder().encode(text)
    const out = new Uint8Array(12 + 8 + jsonBytes.length + 8 + bin.length)
    const o = new DataView(out.buffer)
    o.setUint32(0, 0x46546c67, true)
    o.setUint32(4, 2, true)
    o.setUint32(8, out.length, true)
    o.setUint32(12, jsonBytes.length, true)
    o.setUint32(16, 0x4e4f534a, true)
    out.set(jsonBytes, 20)
    o.setUint32(20 + jsonBytes.length, bin.length, true)
    o.setUint32(24 + jsonBytes.length, 0x004e4942, true)
    out.set(bin, 28 + jsonBytes.length)
    return out
  }
  return { json, bin, join }
}

describe('loadVAT refuses', () => {
  const written = async () => {
    const { root, clip } = makeMultiMaterialFixture()
    return writeBakedFile(bake(root, [clip]))
  }

  it('a file of another format version, naming both and asking for a re-bake', async () => {
    const glb = splitGLB(await written())
    const extension = glb.json.extensions.THREEVAT_vat
    expect(extension.version).toBe(1)
    extension.version = 7
    await expect(load(glb.join())).rejects.toThrow(/format version 7.*reads version 1.*bake it again/s)
  })

  it('a file whose vertices were reordered after the bake, naming an optimizer', async () => {
    const glb = splitGLB(await written())
    const primitive = glb.json.meshes[0].primitives[0]
    const accessor = glb.json.accessors[primitive.attributes.POSITION]
    const view = glb.json.bufferViews[accessor.bufferView]
    const at = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
    // Vertices 0 and 1 trade places, as a vertex-cache reorder would move them.
    const first = glb.bin.slice(at, at + 12)
    glb.bin.copyWithin(at, at + 12, at + 24)
    glb.bin.set(first, at + 12)
    await expect(load(glb.join())).rejects.toThrow(/optimi[sz]er.*(reorder|weld|simplif)/s)
  })

  it('a glTF that is not a baked file', async () => {
    const glb = splitGLB(await written())
    delete glb.json.extensions
    glb.json.extensionsUsed = glb.json.extensionsUsed.filter((name: string) => name !== 'THREEVAT_vat')
    if (glb.json.extensionsUsed.length === 0) delete glb.json.extensionsUsed
    await expect(load(glb.join())).rejects.toThrow(/not a baked file/)
  })

  it('never by declaring the extension required, which would close the file to every viewer', async () => {
    const { json } = splitGLB(await written())
    expect(json.extensionsUsed).toContain('THREEVAT_vat')
    expect(json.extensionsRequired ?? []).not.toContain('THREEVAT_vat')
  })
})

// --------------------------------------------------------------- real assets

const ROBOT = 'examples/public/RobotExpressive.glb'

async function loadAsset(path: string): Promise<{ scene: Group; animations: AnimationClip[] }> {
  const buf = readFileSync(path)
  return new GLTFLoader().parseAsync(new Uint8Array(buf).buffer, '')
}

describe.skipIf(assetMissing(ROBOT))('RobotExpressive, through a baked file', () => {
  it('loads as the vertex-encoded VAT bakeVAT returned, with and without normals', async () => {
    const gltf = await loadAsset(ROBOT)
    const clips = gltf.animations.filter((c) => ['Idle', 'Walking'].includes(c.name))
    for (const bakeNormals of [true, false]) {
      const vat = bake(gltf.scene, clips, { fps: 30, bakeNormals })
      expectSameVAT(await roundTrip(vat), vat, { materials: 'value' })
    }
  }, 120_000)
})

