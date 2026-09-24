import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AnimationClip,
  AnimationMixer,
  Bone,
  BufferAttribute,
  BufferGeometry,
  Float16BufferAttribute,
  LoopOnce,
  LoopPingPong,
  Mesh,
  MeshStandardMaterial,
  NumberKeyframeTrack,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from 'three'
import type { DataTexture, Group, Material, Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { bakeVAT } from './bake.js'
import type { BakeInput, BakeOptions } from './bake.js'
import {
  assetMissing,
  makeHalfFloatOverflowFixture,
  makeMorphFixture,
  makeMultiBoneFixture,
  makeShippedWithoutNormalsFixture,
  makePlacedSkinnedFixture,
  makeRigidSubtreeFixture,
  makeSharedRigFixture,
  makeSkinnedFixture,
  makeSkinnedMorphFixture,
  makeTangentFixture,
} from './test-utils.js'
import type { VAT } from './types.js'
import { flatFacts } from './flat-materials.js'
import { bakeVATInWorker, serveVATBakes } from './worker.js'
import type { VATBakeWorker } from './worker.js'

// A real message channel stands in for the worker: the request and the VAT
// cross it by structured clone, with the same transfers a Web Worker makes, so
// anything the wire format failed to carry fails here too.
const open: (() => void)[] = []

function channel(): VATBakeWorker {
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

afterEach(() => {
  while (open.length > 0) open.pop()!()
})

function expectSameTexture(actual: DataTexture | null, expected: DataTexture | null) {
  if (expected === null) return expect(actual).toBeNull()
  expect(actual).not.toBeNull()
  const a = actual!
  expect(a.image.data).toEqual(expected.image.data)
  expect(a.image.data!.constructor).toBe(expected.image.data!.constructor)
  for (const key of ['format', 'type', 'minFilter', 'magFilter', 'generateMipmaps', 'unpackAlignment', 'flipY'] as const) {
    expect(a[key], key).toBe(expected[key])
  }
  expect([a.image.width, a.image.height]).toEqual([expected.image.width, expected.image.height])
}

/**
 * The worker's VAT is the one `bakeVAT` returns: every texel, every attribute,
 * the same materials. A material a flat merge made is built on each side, so it
 * is compared by what it is rather than by identity.
 */
function expectSameVAT(actual: VAT, expected: VAT) {
  expect(actual.encoding).toBe(expected.encoding)
  if (actual.encoding === 'delta' && expected.encoding === 'delta') {
    expectSameTexture(actual.positionTexture, expected.positionTexture)
    expectSameTexture(actual.normalTexture, expected.normalTexture)
  } else if (actual.encoding === 'rig' && expected.encoding === 'rig') {
    expectSameTexture(actual.rigTexture, expected.rigTexture)
    expect(actual.slotCount).toBe(expected.slotCount)
  }

  const [a, e] = [actual.geometry, expected.geometry]
  expect(Object.keys(a.attributes).sort()).toEqual(Object.keys(e.attributes).sort())
  for (const [name, attribute] of Object.entries(e.attributes)) {
    const got = a.attributes[name] as BufferAttribute
    expect(got.array, name).toEqual((attribute as BufferAttribute).array)
    expect(got.itemSize, name).toBe(attribute.itemSize)
    expect(got.normalized, name).toBe(attribute.normalized)
  }
  expect(a.index?.array).toEqual(e.index?.array)
  expect(a.groups).toEqual(e.groups)
  expect(a.boundingBox).toEqual(e.boundingBox)
  expect(a.boundingSphere).toEqual(e.boundingSphere)

  expect(actual.materials).toHaveLength(expected.materials.length)
  actual.materials.forEach((m, i) => {
    const e = expected.materials[i]!
    if ((e as MeshStandardMaterial).vertexColors && !(m === e)) {
      expect(m.constructor).toBe(e.constructor)
      expect(m.name).toBe(e.name)
      expect(flatFacts(m)).toBeNull() // reads vertex colours now, as the page's does
      const strip = (x: Material) => ({ ...(x.toJSON() as object), uuid: undefined })
      expect(strip(m)).toEqual(strip(e))
    } else {
      expect(m).toBe(e)
    }
  })
  expect(actual.clips).toEqual(expected.clips)
  expect(actual.bounds).toEqual(expected.bounds)
  expect(actual.vertexCount).toBe(expected.vertexCount)
  expect(actual.totalFrames).toBe(expected.totalFrames)
}

/**
 * Bake through the worker first, then on this thread, from the one subtree:
 * the worker bake only reads the scene, so the direct bake after it starts
 * from the same rest pose, and the materials can be compared by identity.
 */
async function bakeBoth(root: Object3D, animations: BakeInput[], options: BakeOptions = {}) {
  const viaWorker = await bakeVATInWorker(channel(), root, animations, { encoding: 'delta', ...options })
  const direct = bakeVAT(root, animations, { encoding: 'delta', ...options })
  return { viaWorker, direct }
}

describe('bakeVATInWorker bakes what bakeVAT bakes', () => {
  const fixtures: [string, () => { root: Object3D; clip: AnimationClip }][] = [
    ['a skinned mesh', makeSkinnedFixture],
    ['a morph-target mesh', makeMorphFixture],
    ['a rigid, node-animated subtree', makeRigidSubtreeFixture],
    ['a multi-bone rig', makeMultiBoneFixture],
    ['a skinned mesh with morphs', makeSkinnedMorphFixture],
    ['a skinned mesh under a placed parent', makePlacedSkinnedFixture],
    ['a subtree with tangents', () => makeTangentFixture()],
    ['two meshes sharing a rig', () => makeSharedRigFixture()],
    // What a copy of the subtree can lose without a word (#79): a node's
    // pivot, which GLTFLoader sets and updateMatrix folds in; a half-float
    // attribute, whose raw bits are not its values; and a mesh with no
    // geometry, which the bake on this thread skips.
    [
      'a pivoted node, turned at rest',
      () => {
        const fixture = makeRigidSubtreeFixture()
        const pivot = fixture.root.getObjectByName('pivot')!
        pivot.pivot = new Vector3(0.5, 0, 0)
        pivot.quaternion.copy(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.3))
        return fixture
      },
    ],
    [
      'a half-float position',
      () => {
        const fixture = makeRigidSubtreeFixture()
        fixture.arm.geometry.setAttribute('position', new Float16BufferAttribute([0.5, 0.25, 2], 3))
        return fixture
      },
    ],
    [
      'a mesh with no geometry',
      () => {
        const fixture = makeRigidSubtreeFixture()
        const empty = new Mesh()
        ;(empty as unknown as { geometry: null }).geometry = null
        fixture.root.add(empty)
        return fixture
      },
    ],
  ]

  it.each(fixtures)('under the vertex encoding: %s', async (_name, make) => {
    const { root, clip } = make()
    const { viaWorker, direct } = await bakeBoth(root, [clip], { fps: 10 })
    expectSameVAT(viaWorker, direct)
  })

  it.each(fixtures)('without the normal texture: %s', async (_name, make) => {
    const { root, clip } = make()
    const { viaWorker, direct } = await bakeBoth(root, [clip], { fps: 10, bakeNormals: false })
    expectSameVAT(viaWorker, direct)
  })

  const rigFixtures = fixtures.filter(([name]) => !name.includes('morph'))
  it.each(rigFixtures)('under the rig encoding: %s', async (_name, make) => {
    const { root, clip } = make()
    const { viaWorker, direct } = await bakeBoth(root, [clip], { fps: 10, encoding: 'rig' })
    expectSameVAT(viaWorker, direct)
  })

  it.each(['delta', 'rig'] as const)('derives the rest normals of an asset shipped without normals as the bake on this thread does: %s', async (encoding) => {
    const { root, clip } = makeShippedWithoutNormalsFixture()
    // The bake on this thread first, the other way round from bakeBoth, which
    // only a bake that leaves the caller's geometry alone can afford.
    const direct = bakeVAT(root, [clip], { fps: 10, encoding })
    const viaWorker = await bakeVATInWorker(channel(), root, [clip], { fps: 10, encoding })
    expectSameVAT(viaWorker, direct)
  })

  it('chooses the default encoding as the bake on this thread does, rig or fallback (ADR-0027)', async () => {
    for (const [make, chosen] of [
      [makeSkinnedFixture, 'rig'],
      [makeMorphFixture, 'delta'],
    ] as const) {
      const { root, clip } = make()
      const viaWorker = await bakeVATInWorker(channel(), root, [clip], { fps: 10 })
      const direct = bakeVAT(root, [clip], { fps: 10 })
      expect(viaWorker.encoding).toBe(chosen)
      expectSameVAT(viaWorker, direct)
    }
  })

  it.each(['delta', 'rig'] as const)('merges flat materials as the page does, from facts the page read (%s)', async (encoding) => {
    const { root, clip, arm, body } = makeRigidSubtreeFixture()
    ;(arm.material as MeshStandardMaterial).color.setRGB(1, 0, 0)
    ;(body.material as MeshStandardMaterial).color.setRGB(0, 0, 1)
    const { viaWorker, direct } = await bakeBoth(root, [clip], { fps: 10, encoding, mergeFlatMaterials: true })
    expect(direct.materials).toHaveLength(1)
    expectSameVAT(viaWorker, direct)
  })

  it('carries a configured action, so the clip keeps the playback it was given', async () => {
    const { root, clip } = makeSkinnedFixture()
    const mixer = new AnimationMixer(root)
    const once = mixer.clipAction(clip)
    once.loop = LoopOnce
    once.timeScale = 2
    const pingPong = mixer.clipAction(clip.clone())
    pingPong.loop = LoopPingPong
    pingPong.repetitions = 3

    const { viaWorker, direct } = await bakeBoth(root, [once, pingPong], { fps: 10 })
    expectSameVAT(viaWorker, direct)
    expect(viaWorker.clips.map((c) => [c.speed, c.repetitions])).toEqual([
      [2, 1],
      [1, 3],
    ])
  })

  it('keeps two actions of one clip apart, as the bake on this thread does', async () => {
    const { root, clip } = makeSkinnedFixture()
    const once = new AnimationMixer(root).clipAction(clip)
    once.loop = LoopOnce
    const twice = new AnimationMixer(root).clipAction(clip)
    twice.repetitions = 2

    const { viaWorker, direct } = await bakeBoth(root, [once, twice], { fps: 10 })
    expectSameVAT(viaWorker, direct)
    expect(viaWorker.clips.map((c) => c.repetitions)).toEqual([1, 2])
  })

  it('carries a glTF cubic-spline track, which only GLTFLoader knows how to interpolate', async () => {
    const gltf = await parseGLTF(cubicSplineGLB())
    const [clip] = gltf.animations as AnimationClip[]
    const factory = (clip!.tracks[0] as unknown as { createInterpolant: { isInterpolantFactoryMethodGLTFCubicSpline?: boolean } })
      .createInterpolant
    expect(factory.isInterpolantFactoryMethodGLTFCubicSpline).toBe(true)

    const { viaWorker, direct } = await bakeBoth(gltf.scene, [clip!], { fps: 8 })
    expectSameVAT(viaWorker, direct)
  })

  it('serves several bakes on one worker, each answered by its own', async () => {
    const worker = channel()
    const a = makeSkinnedFixture()
    const b = makeRigidSubtreeFixture()
    const [va, vb] = await Promise.all([
      bakeVATInWorker(worker, a.root, [a.clip], { encoding: 'delta', fps: 10 }),
      bakeVATInWorker(worker, b.root, [b.clip], { fps: 10, encoding: 'rig' }),
    ])
    expectSameVAT(va, bakeVAT(a.root, [a.clip], { encoding: 'delta', fps: 10 }))
    expectSameVAT(vb, bakeVAT(b.root, [b.clip], { fps: 10, encoding: 'rig' }))
  })
})

describe('bakeVATInWorker leaves the caller alone', () => {
  it('copies the subtree rather than moving it, and does not give a geometry normals', async () => {
    const { root, arm, body, clip } = makeRigidSubtreeFixture()
    // An asset that ships without normals: the copy must not carry derived ones
    // back.
    arm.geometry.deleteAttribute('normal')
    body.geometry.deleteAttribute('normal')
    const before = (arm.geometry.attributes.position as BufferAttribute).array.slice()

    await bakeVATInWorker(channel(), root, [clip], { encoding: 'delta', fps: 10 })

    expect(arm.geometry.attributes.normal).toBeUndefined()
    expect(body.geometry.attributes.normal).toBeUndefined()
    // Still readable: a transfer would have detached it to length zero.
    expect((arm.geometry.attributes.position as BufferAttribute).array).toEqual(before)
    expect(clip.tracks.every((t) => t.times.length > 0 && t.values.length > 0)).toBe(true)
  })
})

describe('bakeVATInWorker refuses what bakeVAT refuses, with its words', () => {
  it('rejects with the message bakeVAT throws', async () => {
    const { root, clip } = makeHalfFloatOverflowFixture()
    const rejected = await bakeVATInWorker(channel(), root, [clip], { encoding: 'delta', fps: 30 }).catch((e: Error) => e)
    expect(rejected).toBeInstanceOf(Error)
    expect(() => bakeVAT(root, [clip], { encoding: 'delta', fps: 30 })).toThrow((rejected as Error).message)
  })

  it('rejects an action bakeVAT would refuse', async () => {
    const { root, clip } = makeSkinnedFixture()
    const action = new AnimationMixer(root).clipAction(clip)
    action.weight = 0.5
    await expect(bakeVATInWorker(channel(), root, [action], { encoding: 'delta', fps: 10 })).rejects.toThrow(/weight/)
  })

  it('refuses, before sending, a bone outside the subtree', async () => {
    const bone = new Bone()
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0]), 3))
    geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array([0, 0, 0, 0]), 4))
    geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array([1, 0, 0, 0]), 4))
    const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial())
    mesh.bind(new Skeleton([bone]))
    const clip = new AnimationClip('still', 1, [new NumberKeyframeTrack('.position[x]', [0, 1], [0, 0])])

    await expect(bakeVATInWorker(channel(), mesh, [clip], { encoding: 'delta' })).rejects.toThrow(/outside the subtree/)
  })

  it('refuses, before sending, a track with an interpolant it cannot carry', async () => {
    const { root, clip } = makeRigidSubtreeFixture()
    ;(clip.tracks[0] as unknown as { createInterpolant: unknown }).createInterpolant = () => null
    await expect(bakeVATInWorker(channel(), root, [clip], { encoding: 'delta' })).rejects.toThrow(/custom interpolant/)
  })

  it('rejects, naming serveVATBakes, when the worker itself fails', async () => {
    const listeners = new Map<string, (event: never) => void>()
    const broken: VATBakeWorker = {
      postMessage: () => listeners.get('error')!({ message: 'Failed to fetch' } as never),
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type) => listeners.delete(type),
    }
    const { root, clip } = makeSkinnedFixture()
    await expect(bakeVATInWorker(broken, root, [clip], { encoding: 'delta' })).rejects.toThrow(/Failed to fetch.*serveVATBakes/)
    expect(listeners.size).toBe(0)
  })
})

describe('serveVATBakes', () => {
  it('leaves a message that is not a bake alone, and stops when told', async () => {
    const { port1, port2 } = new MessageChannel()
    const replies: unknown[] = []
    port1.addEventListener('message', (e) => replies.push(e.data))
    const stop = serveVATBakes(port2)
    port1.start()
    port2.start()
    open.push(() => {
      port1.close()
      port2.close()
    })

    port1.postMessage({ type: 'something else' })
    await new Promise((r) => setTimeout(r, 20))
    expect(replies).toEqual([])

    stop()
    const { root, clip } = makeSkinnedFixture()
    void bakeVATInWorker(port1, root, [clip], { encoding: 'delta' })
    await new Promise((r) => setTimeout(r, 20))
    expect(replies).toEqual([])
  })
})

// ------------------------------------------------------------------ real assets

const ROBOT = 'examples/public/RobotExpressive.glb'
const SOLDIER = 'test-assets/Soldier.glb'

async function parseGLTF(data: ArrayBuffer | string): Promise<{ scene: Group; animations: AnimationClip[] }> {
  // As in bake.integration.test.ts: GLTFLoader reads `self.URL`, and the image
  // loads it then attempts have no chance in Node — materials come back
  // map-less, which a bake does not mind.
  ;(globalThis as { self?: unknown }).self = globalThis
  return await new Promise((res, rej) => new GLTFLoader().parse(data, '', res as never, rej))
}

async function loadGLTF(path: string) {
  const buf = readFileSync(path)
  return parseGLTF(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
}

describe.skipIf(assetMissing(ROBOT))('RobotExpressive, baked in a worker', () => {
  it.each(['delta', 'rig'] as const)('matches the bake on this thread under the %s encoding', async (encoding) => {
    const gltf = await loadGLTF(ROBOT)
    const clips = gltf.animations.filter((c) => ['Idle', 'Walking', 'Running'].includes(c.name))
    const { viaWorker, direct } = await bakeBoth(gltf.scene, clips, { fps: 30, encoding })
    expectSameVAT(viaWorker, direct)
    expect(viaWorker.materials.every((m: Material) => m.type === 'MeshStandardMaterial')).toBe(true)

    // Its three flat colours, merged on either side into the one material.
    const merged = await bakeBoth(gltf.scene, clips, { fps: 30, encoding, mergeFlatMaterials: true })
    expect(merged.direct.materials).toHaveLength(1)
    expectSameVAT(merged.viaWorker, merged.direct)
  }, 120_000)
})

describe.skipIf(assetMissing(SOLDIER))('Soldier, baked in a worker', () => {
  // Soldier interleaves its skinning attributes, which the wire format carries
  // as they are rather than de-interleaving them.
  it.each(['delta', 'rig'] as const)('matches the bake on this thread under the %s encoding', async (encoding) => {
    const gltf = await loadGLTF(SOLDIER)
    const clips = gltf.animations.filter((c) => c.name !== 'TPose')
    const { viaWorker, direct } = await bakeBoth(gltf.scene, clips, { fps: 30, encoding })
    expectSameVAT(viaWorker, direct)
  }, 120_000)
})

// ------------------------------------------------------------------ fixtures

/**
 * A one-triangle GLB whose node slides under a CUBICSPLINE translation track:
 * the one interpolation GLTFLoader implements itself rather than through
 * three, and so the one a worker has to be taught. Binary, so the buffer is
 * the file's own chunk and nothing is fetched.
 */
function cubicSplineGLB(): ArrayBuffer {
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0]
  const times = [0, 1]
  // Per key: in-tangent, value, out-tangent.
  const outputs = [0, 0, 0, 0, 0, 0, 3, 0, 0, 3, 0, 0, 1, 2, 0, 0, 0, 0]
  const bin = new Uint8Array(new Float32Array([...positions, ...times, ...outputs]).buffer)
  const json = JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'tri', mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 8 },
      { buffer: 0, byteOffset: 44, byteLength: 72 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
      { bufferView: 2, componentType: 5126, count: 6, type: 'VEC3' },
    ],
    animations: [
      {
        name: 'slide',
        samplers: [{ input: 1, output: 2, interpolation: 'CUBICSPLINE' }],
        channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }],
      },
    ],
  })
  // Chunks are four-byte aligned: JSON pads with spaces, BIN with zeros.
  const text = new TextEncoder().encode(json.padEnd(Math.ceil(json.length / 4) * 4, ' '))
  const total = 12 + 8 + text.byteLength + 8 + bin.byteLength
  const glb = new ArrayBuffer(total)
  const view = new DataView(glb)
  view.setUint32(0, 0x46546c67, true) // 'glTF'
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, text.byteLength, true)
  view.setUint32(16, 0x4e4f534a, true) // 'JSON'
  new Uint8Array(glb, 20, text.byteLength).set(text)
  view.setUint32(20 + text.byteLength, bin.byteLength, true)
  view.setUint32(24 + text.byteLength, 0x004e4942, true) // 'BIN'
  new Uint8Array(glb, 28 + text.byteLength).set(bin)
  return glb
}
