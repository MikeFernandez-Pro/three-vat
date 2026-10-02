import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AnimationMixer, LoopOnce, LoopPingPong, Matrix4, Vector3 } from 'three'
import type { AnimationClip, BufferAttribute, Group, Material, Mesh, Object3D, SkinnedMesh } from 'three'
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

// ---------------------------------------------------------- the rig encoding

// What a rig can express, as the rig bake's own suite lists it: skinned parts,
// rigid ones (a slot each), static morphs folded into the rest pose, shared
// slots, mirrors and material arrays.
// A fixture marked `folded` folds a static morph into the rig's rest, which the
// vertex encoding's delta reference does not carry, so its rest is not the
// vertex bake's and it is left out of the preview.
const RIG_FIXTURES: [string, () => { root: Object3D; clip: AnimationClip }, 'folded'?][] = [
  ['a skinned mesh', makeSkinnedFixture],
  ['a multi-bone rig', makeMultiBoneFixture],
  ['a skinned mesh under a placed parent', makePlacedSkinnedFixture],
  ['a uniformly scaled bone', () => makeBoneScaleFixture([2, 2, 2])],
  ['a full spin', makeFullSpinFixture],
  ['a rigid, node-animated subtree', makeRigidSubtreeFixture],
  ['a skinned mesh with a static morph', makeSkinnedMorphFixture, 'folded'],
  ['a rigid part with two static absolute morphs', makeAbsoluteMorphNormalFixture, 'folded'],
  ['two meshes sharing a rig', () => makeSharedRigFixture()],
  [
    'two meshes on one rig and two bind matrices',
    () => makeSharedRigFixture({ visorBind: new Matrix4().makeTranslation(0, 1, 0) }),
  ],
  ['a rigid part mirrored across one axis', () => makeScaledPartFixture({ scale: [-1, 1, 1] })],
  ['a rigid part mirrored through its origin', () => makeScaledPartFixture({ scale: [-2, -2, -2] })],
  ['a mesh with a material array', () => makeMultiMaterialFixture()],
  ['a non-indexed mesh with a material array', () => makeMultiMaterialFixture({ indexed: false })],
  ['a skinned mesh with a material array', () => makeMultiMaterialFixture({ skinned: true })],
]

/** The rig fixtures whose rest geometry is the vertex bake's. */
const PREVIEW_FIXTURES = RIG_FIXTURES.filter(([, , folded]) => folded === undefined)

const bakeRig = (root: Object3D, clips: BakeInput[], options: BakeOptions = {}) =>
  bakeVAT(root, clips, { encoding: 'rig', fps: 10, ...options })

/**
 * A rig-encoded file, opened by a plain `GLTFLoader` and skinned by three's own
 * `applyBoneTransform` through the preview skin, lands on the rest geometry of
 * a vertex-encoded bake of the same asset, to the four decimals three's own
 * skinning is held to in the integration suite. Every `stride`-th vertex.
 */
async function expectPreviewAtRest(bytes: Uint8Array, rest: VAT, stride = 1) {
  const gltf = await new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer, '')
  gltf.scene.updateMatrixWorld(true)
  const meshes: SkinnedMesh[] = []
  gltf.scene.traverse((o) => void ((o as SkinnedMesh).isSkinnedMesh && meshes.push(o as SkinnedMesh)))
  expect(meshes).toHaveLength(rest.geometry.groups.length)
  const expected = rest.geometry.attributes.position!
  const got = new Vector3()
  for (const mesh of meshes) {
    const position = mesh.geometry.attributes.position!
    expect(position.count).toBe(expected.count)
    for (let v = 0; v < position.count; v += stride) {
      got.fromBufferAttribute(position, v)
      mesh.applyBoneTransform(v, got).applyMatrix4(mesh.matrixWorld)
      expect(got.x, `vertex ${v}`).toBeCloseTo(expected.getX(v), 4)
      expect(got.y, `vertex ${v}`).toBeCloseTo(expected.getY(v), 4)
      expect(got.z, `vertex ${v}`).toBeCloseTo(expected.getZ(v), 4)
    }
  }
}

describe('a rig-encoded baked file loads as the VAT bakeVAT returned', () => {
  it.each(RIG_FIXTURES)('%s', async (_name, make) => {
    const { root, clip } = make()
    const vat = bakeRig(root, [clip])
    expectSameVAT(await roundTrip(vat), vat, { materials: 'value' })
  })

  it('with every clip default, a negative speed among them', async () => {
    const { root, clip } = makeSkinnedFixture()
    const mixer = new AnimationMixer(root)
    const once = mixer.clipAction(clip)
    once.loop = LoopOnce
    once.timeScale = -2
    const vat = bakeRig(root, [once])
    expect(vat.clips[0]!.speed).toBe(-2)
    expectSameVAT(await roundTrip(vat), vat, { materials: 'value' })
  })

  it('compiles on both decode paths, sampling the rig texture it loaded', async () => {
    const { root, clip } = makeMultiMaterialFixture({ skinned: true })
    const loaded = await roundTrip(bakeRig(root, [clip]))
    if (loaded.encoding !== 'rig') throw new Error('a rig-encoded file')

    const webgl = createWebGLMesh(loaded, makeFixtureCrowd())
    expect(webgl.mesh.geometry).toBe(loaded.geometry)
    for (const material of webgl.mesh.material as Material[]) {
      const shader = compileVATMaterial(material)
      expect(shader.uniforms['uVatRigTex']?.value).toBe(loaded.rigTexture)
      expect(shader.vertexShader).toContain('uVatRigTex')
    }

    const tsl = createTSLMesh(loaded, makeFixtureCrowd())
    expect(tsl.mesh.geometry).toBe(loaded.geometry)
    const sampled = nodesIn(vatDecode(loaded, { playback: tsl.playback }).position).map((n) => n.value)
    expect(sampled).toContain(loaded.rigTexture)
  })
})

describe('a default bake round-trips under whichever encoding it chose', () => {
  it('the rig, where the asset allows it', async () => {
    const { root, clip } = makeMultiBoneFixture()
    const vat = bakeVAT(root, [clip], { fps: 10 })
    expect(vat.encoding).toBe('rig')
    expectSameVAT(await roundTrip(vat), vat, { materials: 'value' })
  })

  it('the vertex encoding, where it fell back, keeping its fallback', async () => {
    const { root, clip } = makeMorphFixture()
    const vat = bakeVAT(root, [clip], { fps: 10 })
    expect(vat.encoding === 'delta' && vat.fallback).toMatch(/morph/)
    expectSameVAT(await roundTrip(vat), vat, { materials: 'value' })
  })
})

describe('a rig-encoded baked file previews at rest in any viewer, through its skin', () => {
  it.each(PREVIEW_FIXTURES)('%s', async (_name, make) => {
    const { root, clip } = make()
    const vat = bakeRig(root, [clip])
    await expectPreviewAtRest(await writeBakedFile(vat), bake(root, [clip]))
  })

  it('which loadVAT ignores: a skin disagreeing with the slots changes nothing a crowd reads', async () => {
    const { root, clip } = makeMultiBoneFixture()
    const vat = bakeRig(root, [clip])
    const glb = splitGLB(await writeBakedFile(vat))
    const joint = glb.json.nodes[glb.json.skins[0].joints[0]]
    joint.translation = [5, 6, 7]
    expectSameVAT(await load(glb.join()), vat, { materials: 'value' })
  })

  it('refuses a rig-encoded VAT that no longer knows its rest slots, naming bakeVAT', async () => {
    const { root, clip } = makeSkinnedFixture()
    const loaded = await roundTrip(bakeRig(root, [clip]))
    await expect(writeBakedFile(loaded)).rejects.toThrow(/rest.*bakeVAT/s)
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
    expect(extension.version).toBe(3)
    // Version 2, the one before the frame bounds (#152): the file every bake
    // before them wrote, which has none to load.
    extension.version = 2
    await expect(load(glb.join())).rejects.toThrow(/format version 2.*reads version 3.*bake it again/s)
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

  it('a rig-encoded file whose skin weights were quantized after the bake, naming an optimizer', async () => {
    const { root, clip } = makeMultiBoneFixture()
    const glb = splitGLB(await writeBakedFile(bakeVAT(root, [clip], { encoding: 'rig', fps: 10 })))
    const accessor = glb.json.accessors[glb.json.meshes[0].primitives[0].attributes.WEIGHTS_0]
    accessor.componentType = 5121
    accessor.normalized = true
    await expect(load(glb.join())).rejects.toThrow(/skin weights.*optimi[sz]er/s)
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
const SOLDIER = 'test-assets/Soldier.glb'

/** A copy of `material` carrying none of its textures. */
function untextured(material: Material): Material {
  const copy = material.clone()
  for (const [key, value] of Object.entries(copy)) {
    if ((value as { isTexture?: boolean } | null)?.isTexture) (copy as unknown as Record<string, unknown>)[key] = null
  }
  return copy
}

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

  it('loads as the rig-encoded VAT bakeVAT returned, and previews at rest', async () => {
    const gltf = await loadAsset(ROBOT)
    const clips = gltf.animations.filter((c) => ['Idle', 'Walking'].includes(c.name))
    const vat = bakeRig(gltf.scene, clips, { fps: 30 })
    const bytes = await writeBakedFile(vat)
    expectSameVAT(await load(bytes), vat, { materials: 'value' })
    await expectPreviewAtRest(bytes, bake(gltf.scene, clips, { fps: 5 }), 7)
  }, 120_000)
})

describe.skipIf(assetMissing(SOLDIER))('Soldier, through a baked file', () => {
  it('loads as the rig-encoded VAT bakeVAT returned, and previews at rest', async () => {
    const gltf = await loadAsset(SOLDIER)
    const vat = bakeRig(gltf.scene, gltf.animations, { fps: 30 })
    // Its textures are the materials ticket's (#115); the rig is what is held here.
    vat.materials = vat.materials.map(untextured)
    const bytes = await writeBakedFile(vat)
    expectSameVAT(await load(bytes), vat, { materials: 'value' })
    await expectPreviewAtRest(bytes, bake(gltf.scene, gltf.animations.slice(0, 1), { fps: 5 }), 7)
  }, 120_000)
})
