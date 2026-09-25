import { existsSync } from 'node:fs'
import { env as processEnv } from 'node:process'
import {
  AnimationClip,
  BatchedMesh,
  Bone,
  Box3,
  DataTexture,
  DataUtils,
  HalfFloatType,
  MeshStandardMaterial,
  Sphere,
  Group,
  Object3D,
  BufferAttribute,
  BufferGeometry,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  MeshBasicMaterial,
  NumberKeyframeTrack,
  Matrix4,
  Quaternion,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Vector3,
  Vector4,
  Material,
} from 'three'
import type { IUniform, WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three'
import { expect } from 'vitest'
import { EndMode, LIBRARY_PLAYBACK_DEFAULTS, LoopMode, PACK_TEXELS } from './instance-playback.js'
import type { VATInstance } from './instance-playback.js'
import type { DeltaVAT, RigVAT, VAT, VATClip } from './types.js'
import { decodeOctahedral } from './octahedral.js'
import { makeVATNormalTexture, makeVATTexture } from './vat-texture.js'
import { RIG_TEXELS, RIG_TEXELS_PER_SLOT } from './rig-texture.js'

/**
 * A minimal skinned fixture for baker tests: one vertex at (1, 0, 0), fully
 * weighted to a single bone at the origin, with a clip that spins the bone 90°
 * about +Z over one second. At frame 0 the vertex sits at the bind pose (zero
 * delta); across the clip it sweeps toward (0, 1, 0).
 */
export function makeSkinnedFixture(): { root: SkinnedMesh; mesh: SkinnedMesh; clip: AnimationClip } {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([1, 0, 0]), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1]), 3))
  geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array([0, 0, 0, 0]), 4))
  geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array([1, 0, 0, 0]), 4))

  const bone = new Bone()
  bone.name = 'root'
  const skeleton = new Skeleton([bone])

  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial())
  mesh.add(bone)
  mesh.bind(skeleton)

  const q0 = new Quaternion().toArray()
  const q1 = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2).toArray()
  const track = new QuaternionKeyframeTrack('root.quaternion', [0, 1], [...q0, ...q1])
  const clip = new AnimationClip('spin', 1, [track])

  return { root: mesh, mesh, clip }
}

/**
 * A minimal morph-target fixture (no skeleton), mirroring the three.js birds:
 * one vertex at the origin with a single relative position target of (1, 0, 0),
 * and a clip that ramps its influence 0 → 1 over one second. At frame 0 the
 * influence is 0 (zero delta); by the end the vertex has morphed to ~(1, 0, 0).
 */
export function makeMorphFixture(): { root: Mesh; mesh: Mesh; clip: AnimationClip } {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0]), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1]), 3))
  geometry.morphAttributes.position = [new BufferAttribute(new Float32Array([1, 0, 0]), 3)]
  geometry.morphTargetsRelative = true

  // The Mesh constructor calls updateMorphTargets(), creating morphTargetInfluences.
  const mesh = new Mesh(geometry, new MeshBasicMaterial())
  mesh.name = 'bird'

  const track = new NumberKeyframeTrack('bird.morphTargetInfluences[0]', [0, 1], [0, 1])
  const clip = new AnimationClip('flap', 1, [track])

  return { root: mesh, mesh, clip }
}

/**
 * A rigid, node-animated subtree — the `RobotExpressive` shape in miniature,
 * and the case the single-mesh baker could not see at all.
 *
 * Two one-vertex meshes with *different* materials: `arm` hangs off an animated
 * pivot and sweeps from (1, 0, 0) to (0, 1, 0) as the pivot turns 90° about +Z;
 * `body` sits at the origin and never moves. Neither mesh is skinned and
 * neither has morph targets, so every bit of motion lives in `matrixWorld`.
 */
export function makeRigidSubtreeFixture(): {
  root: Group
  arm: Mesh
  body: Mesh
  clip: AnimationClip
} {
  const point = () => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0]), 3))
    g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1]), 3))
    return g
  }

  const root = new Group()
  root.name = 'root'

  const pivot = new Object3D()
  pivot.name = 'pivot'
  root.add(pivot)

  // Distinct material instances, so the merge must emit two groups.
  const arm = new Mesh(point(), new MeshBasicMaterial())
  arm.name = 'arm'
  arm.position.set(1, 0, 0)
  pivot.add(arm)

  const body = new Mesh(point(), new MeshBasicMaterial())
  body.name = 'body'
  root.add(body)

  const q0 = new Quaternion().toArray()
  const q1 = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2).toArray()
  const track = new QuaternionKeyframeTrack('pivot.quaternion', [0, 1], [...q0, ...q1])
  const clip = new AnimationClip('swing', 1, [track])

  return { root, arm, body, clip }
}

/**
 * One rigid part off the origin, a vertex at (1, 2, 3) facing +Z, on a pivot
 * that swings 90° about +Z — scaled by `scale` at rest, and by `scaleTrack`'s
 * keys over the clip when one is given. A mirrored scale is the case a matrix
 * decomposition gets wrong without a sign, and a zero one the case it cannot
 * decompose at all: both are what the rig encoding must still place (#79).
 */
export function makeScaledPartFixture({
  scale = [1, 1, 1],
  scaleTrack,
}: { scale?: [number, number, number]; scaleTrack?: number[] } = {}): { root: Group; mesh: Mesh; clip: AnimationClip } {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([1, 2, 3]), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1]), 3))

  const root = new Group()
  root.name = 'root'
  const pivot = new Object3D()
  pivot.name = 'pivot'
  root.add(pivot)
  const mesh = new Mesh(geometry, new MeshBasicMaterial())
  mesh.name = 'part'
  mesh.position.set(0.5, 0, 0)
  mesh.scale.fromArray(scale)
  pivot.add(mesh)

  const q0 = new Quaternion().toArray()
  const q1 = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2).toArray()
  const tracks = [new QuaternionKeyframeTrack('pivot.quaternion', [0, 1], [...q0, ...q1])]
  if (scaleTrack) {
    const keys = scaleTrack.length / 3
    const times = Array.from({ length: keys }, (_, i) => i / (keys - 1))
    tracks.push(new VectorKeyframeTrack('part.scale', times, scaleTrack))
  }
  return { root, mesh, clip: new AnimationClip('swing', 1, tracks) }
}

/**
 * An asset that ships without normals, as the three.js birds do: one indexed
 * quad on a pivot that swings 90° about +Z, and no `normal` attribute.
 *
 * Unlike the point fixtures, its faces have a normal to derive — the quad lies
 * in a plane tilted to `normalize(0, -1, 1)`, wound so that is its front.
 */
export function makeShippedWithoutNormalsFixture(): { root: Group; mesh: Mesh; clip: AnimationClip } {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 1, 1]), 3))
  geometry.setIndex([0, 1, 2, 0, 2, 3])

  const root = new Group()
  const pivot = new Object3D()
  pivot.name = 'pivot'
  root.add(pivot)
  const mesh = new Mesh(geometry, new MeshBasicMaterial())
  pivot.add(mesh)

  const q0 = new Quaternion().toArray()
  const q1 = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2).toArray()
  const clip = new AnimationClip('swing', 1, [new QuaternionKeyframeTrack('pivot.quaternion', [0, 1], [...q0, ...q1])])

  return { root, mesh, clip }
}

/**
 * A fixture with more vertices than a small ceiling holds in one row: seven
 * points strung along +x, each with its own normal, on a pivot that swings a
 * quarter turn about +z over one second — so every vertex has a delta of its
 * own, and a texel read from the wrong column or the wrong row is caught.
 *
 * Seven, because it divides by nothing a test would pick as a ceiling: at a
 * `maxTextureSize` of 4 a frame takes two rows of four, and the eighth texel of
 * each frame is the padding the layout leaves (ADR-0030).
 */
export function makeManyVertexFixture(): { root: Group; mesh: Mesh; clip: AnimationClip } {
  const count = 7
  const position = new Float32Array(count * 3)
  const normal = new Float32Array(count * 3)
  for (let v = 0; v < count; v++) {
    position.set([v + 1, v * 0.25, -v * 0.5], v * 3)
    normal.set(new Vector3(v, 1, count - v).normalize().toArray(), v * 3)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(position, 3))
  geometry.setAttribute('normal', new BufferAttribute(normal, 3))

  const root = new Group()
  const pivot = new Object3D()
  pivot.name = 'pivot'
  root.add(pivot)
  const mesh = new Mesh(geometry, new MeshStandardMaterial())
  pivot.add(mesh)

  const q0 = new Quaternion().toArray()
  const q1 = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2).toArray()
  const clip = new AnimationClip('swing', 1, [new QuaternionKeyframeTrack('pivot.quaternion', [0, 1], [...q0, ...q1])])

  return { root, mesh, clip }
}

/**
 * A fixture whose deltas run past what a half-float can hold: one point mesh
 * on a pivot that travels 100 000 units along +x over one second.
 *
 * The asset the position layer's range check exists for (#73) — a character
 * authored in millimetres crossing a hundred metres, which is a scene anyone
 * could build and the one thing half-float's 65 504 ceiling refuses. Precision
 * needs no such fixture: its error is relative, so it is the same fraction of
 * the delta at every scale this or any other asset reaches.
 *
 * The travel is linear from zero, so the bake gets some way in before it
 * refuses — the check has to be reached per delta and not guessed from the
 * clip's first frame.
 */
export function makeHalfFloatOverflowFixture(): { root: Group; clip: AnimationClip } {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0]), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1]), 3))

  const root = new Group()
  root.name = 'root'
  const pivot = new Object3D()
  pivot.name = 'pivot'
  root.add(pivot)
  const point = new Mesh(geometry, new MeshBasicMaterial())
  point.name = 'point'
  pivot.add(point)

  const track = new VectorKeyframeTrack('pivot.position', [0, 1], [0, 0, 0, 100000, 0, 0])
  return { root, clip: new AnimationClip('flung', 1, [track]) }
}

/**
 * A morph fixture whose targets are *absolute* rather than relative, with two
 * of them active at once. glTF morph targets are always relative, so this is
 * the path three's `morphtarget_vertex` guards with `morphTargetsRelative` —
 * each target contributes `w * (target - base)`, always measured from the base
 * vertex, never from the partially-morphed one.
 *
 * Base vertex sits at the origin; targets A = (2, 0, 0) and B = (0, 2, 0) both
 * ramp to influence 0.5, so the vertex ends at (1, 1, 0).
 */
export function makeAbsoluteMorphFixture(): { root: Mesh; mesh: Mesh; clip: AnimationClip } {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0]), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1]), 3))
  geometry.morphAttributes.position = [
    new BufferAttribute(new Float32Array([2, 0, 0]), 3),
    new BufferAttribute(new Float32Array([0, 2, 0]), 3),
  ]
  geometry.morphTargetsRelative = false

  const mesh = new Mesh(geometry, new MeshBasicMaterial())
  mesh.name = 'blend'

  const clip = new AnimationClip('blend', 1, [
    new NumberKeyframeTrack('blend.morphTargetInfluences[0]', [0, 1], [0, 0.5]),
    new NumberKeyframeTrack('blend.morphTargetInfluences[1]', [0, 1], [0, 0.5]),
  ])

  return { root: mesh, mesh, clip }
}

/**
 * A four-weight bone blend — the case every real skinned character exercises
 * and the one-bone fixture never touches.
 *
 * One vertex at (1, 0, 0) with normal (0, 0, 1), influenced by four bones at
 * weights 0.4 / 0.3 / 0.2 / 0.1. Every bone binds at the origin with an
 * identity matrix, so each bone's `boneInverse` is identity and its posed
 * `matrixWorld` *is* its skin matrix. The clip holds a constant pose, so every
 * baked frame carries the same hand-computable result:
 *
 * - `b0` identity      → (1, 0, 0), n (0, 0, 1)
 * - `b1` rotate +90° Y → (0, 0, -1), n (1, 0, 0)
 * - `b2` translate +3Y → (1, 3, 0), n (0, 0, 1)
 * - `b3` rotate 180° Z → (-1, 0, 0), n (0, 0, 1)
 *
 * Blended: position (0.5, 0.6, -0.3), normal normalize(0.3, 0, 0.7). Both are
 * sensitive to dropping a weight: taking only the heaviest bone would give
 * (1, 0, 0) and (0, 0, 1) instead.
 */
export function makeMultiBoneFixture(): {
  root: SkinnedMesh
  mesh: SkinnedMesh
  clip: AnimationClip
  /** Hand-computed posed position of the single vertex, in root space. */
  expectedPosition: Vector3
  /** Hand-computed posed normal of the single vertex, in root space. */
  expectedNormal: Vector3
} {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([1, 0, 0]), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1]), 3))
  geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array([0, 1, 2, 3]), 4))
  geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array([0.4, 0.3, 0.2, 0.1]), 4))

  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial())
  mesh.name = 'blendMesh'

  const bones = [0, 1, 2, 3].map((i) => {
    const bone = new Bone()
    bone.name = `b${i}`
    mesh.add(bone)
    return bone
  })
  mesh.updateMatrixWorld(true)
  mesh.bind(new Skeleton(bones))

  const qY90 = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2).toArray()
  const qZ180 = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI).toArray()
  const clip = new AnimationClip('blend', 1, [
    new QuaternionKeyframeTrack('b1.quaternion', [0, 1], [...qY90, ...qY90]),
    new VectorKeyframeTrack('b2.position', [0, 1], [0, 3, 0, 0, 3, 0]),
    new QuaternionKeyframeTrack('b3.quaternion', [0, 1], [...qZ180, ...qZ180]),
  ])

  return {
    root: mesh,
    mesh,
    clip,
    expectedPosition: new Vector3(0.5, 0.6, -0.3),
    expectedNormal: new Vector3(0.3, 0, 0.7).normalize(),
  }
}

/**
 * One mesh carrying *both* deformation sources at once — the case the ADRs name
 * explicitly and no fixture covered.
 *
 * Base vertex (1, 0, 0) with normal (0, 0, 1); a single relative morph target
 * displacing +1 along Z at a constant influence of 1; one bone, weight 1,
 * holding a constant +90° rotation about Y. Morph applies first, as in three:
 * (1, 0, 0) + (0, 0, 1) = (1, 0, 1), then the bone maps (x, y, z) → (z, y, -x),
 * landing the vertex at (1, 0, -1) with normal (1, 0, 0).
 *
 * Skipping either stage is visible: morph-only gives (1, 0, 1), skin-only
 * (0, 0, -1).
 */
export function makeSkinnedMorphFixture(): {
  root: SkinnedMesh
  mesh: SkinnedMesh
  clip: AnimationClip
  expectedPosition: Vector3
  expectedNormal: Vector3
} {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([1, 0, 0]), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1]), 3))
  geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array([0, 0, 0, 0]), 4))
  geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array([1, 0, 0, 0]), 4))
  geometry.morphAttributes.position = [new BufferAttribute(new Float32Array([0, 0, 1]), 3)]
  geometry.morphTargetsRelative = true

  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial())
  mesh.name = 'flapper'

  const bone = new Bone()
  bone.name = 'arm'
  mesh.add(bone)
  mesh.updateMatrixWorld(true)
  mesh.bind(new Skeleton([bone]))

  const qY90 = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2).toArray()
  const clip = new AnimationClip('flapAndSwing', 1, [
    new QuaternionKeyframeTrack('arm.quaternion', [0, 1], [...qY90, ...qY90]),
    new NumberKeyframeTrack('flapper.morphTargetInfluences[0]', [0, 1], [1, 1]),
  ])

  return {
    root: mesh,
    mesh,
    clip,
    expectedPosition: new Vector3(1, 0, -1),
    expectedNormal: new Vector3(1, 0, 0),
  }
}

/**
 * A single bone held at a constant `scale`, weight 1, so the bake reduces to
 * "what does this scale do to one vertex and its normal".
 *
 * The vertex sits at (1, 0, 0) with normal normalize(1, 1, 0) — deliberately
 * off-axis, because an axis-aligned normal survives even a wrong transform.
 *
 * The rig carries a second bone, `decor`, that no vertex is weighted to —
 * every real rig has some. Scaling that one instead (`scaledBone: 'decor'`)
 * is how a test pins down that the baker only complains about bones whose
 * scale can actually reach a normal.
 */
export function makeBoneScaleFixture(
  scale: [number, number, number],
  scaledBone: 'stretch' | 'decor' = 'stretch',
): {
  root: SkinnedMesh
  mesh: SkinnedMesh
  clip: AnimationClip
} {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([1, 0, 0]), 3))
  geometry.setAttribute(
    'normal',
    new BufferAttribute(new Float32Array([Math.SQRT1_2, Math.SQRT1_2, 0]), 3),
  )
  geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array([0, 0, 0, 0]), 4))
  geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array([1, 0, 0, 0]), 4))

  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial())
  mesh.name = 'scaled'

  const bones = ['stretch', 'decor'].map((name) => {
    const bone = new Bone()
    bone.name = name
    mesh.add(bone)
    return bone
  })
  mesh.updateMatrixWorld(true)
  mesh.bind(new Skeleton(bones))

  const clip = new AnimationClip('stretch', 1, [
    new VectorKeyframeTrack(`${scaledBone}.scale`, [0, 1], [...scale, ...scale]),
  ])

  return { root: mesh, mesh, clip }
}

/**
 * Gate for the real-asset tests: `describe.skipIf(assetMissing(path))`.
 *
 * Skipping is right on a fresh clone — the suite must not depend on a 2 MB
 * binary nobody fetched. It is wrong in CI, where a workflow that dropped
 * `node scripts/fetch-test-assets.mjs` would report green having never baked
 * the real character. So under CI a missing asset is an error, not a skip.
 */
export function assetMissing(
  path: string,
  env: Record<string, string | undefined> = processEnv,
): boolean {
  if (existsSync(path)) return false
  if (env.CI) {
    throw new Error(
      `${path} is missing, and CI is set. Run \`node scripts/fetch-test-assets.mjs\` before the suite ` +
        `— see docs/test-assets.md. (Off CI this asset is skipped, not required.)`,
    )
  }
  return true
}

/** A clip band in the fixture VAT's stacked rows. */
const makeClip = (name: string, startFrame: number, frames: number, fps = 30): VATClip => ({
  name,
  startFrame,
  frames,
  fps,
  duration: frames / fps,
  maxDelta: 0.5,
  // Library defaults, as a bake with no configured action records them —
  // read from core, never restated, so a fixture cannot disagree with a bake.
  ...LIBRARY_PLAYBACK_DEFAULTS,
})

/** The fixture's clip table: two bands, so a crowd can mix clips. */
const FIXTURE_CLIPS = {
  walk: makeClip('walk', 0, 10),
  run: makeClip('run', 10, 8, 24),
}

/**
 * A baked VAT standing in for `bakeVAT`'s output, for tests of what happens
 * *after* a bake — the two decode paths, which only ever read it.
 *
 * Shaped like the normal case rather than the easy one: two material groups
 * (a merged subtree is the unit of a bake — ADR-0008) and an all-frames
 * bounding volume on the geometry, which is what stops a deformed crowd
 * culling mid-animation and so has to survive being cloned.
 *
 * `bakeNormals: false` mirrors the bake option of that name: no normal texture, and
 * flat-shaded materials, because that is the pairing the option is *for* — a
 * fixture that shipped smooth-shaded materials with no normal texture would be
 * the refused case, not the supported one.
 *
 * `rowsPerFrame` is a bake whose frames span that many rows (ADR-0030) — six
 * vertices at two rows a frame are rows of three. Only the number changes: the
 * decode reads the layout off the VAT, never off the fixture's 1×1 textures.
 */
export function makeVATFixture({
  bakeNormals = true,
  rowsPerFrame = 1,
}: { bakeNormals?: boolean; rowsPerFrame?: number } = {}): DeltaVAT {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(18), 3))
  geometry.addGroup(0, 3, 0)
  geometry.addGroup(3, 3, 1)

  const bounds = new Box3(new Vector3(-2, 0, -2), new Vector3(2, 3, 2))
  geometry.boundingBox = bounds.clone()
  geometry.boundingSphere = bounds.getBoundingSphere(new Sphere())

  // Each layer in the format the baker produces, not a stand-in pair of
  // identical float textures: a decode test that binds an RGBA float normal
  // layer — or an RGBA float position layer (#73) — is not exercising the
  // texture the shader will be handed (#29).
  const texture = () => makeVATTexture(new Uint16Array(4), 1, 1, HalfFloatType)
  const normalTexture = () => makeVATNormalTexture(new Uint8Array(2), 1, 1)
  const material = (name: string) => new MeshStandardMaterial({ name, flatShading: !bakeNormals })
  return {
    positionTexture: texture(),
    normalTexture: bakeNormals ? normalTexture() : null,
    clips: [FIXTURE_CLIPS.walk, FIXTURE_CLIPS.run],
    bounds,
    vertexCount: 6,
    totalFrames: 18,
    rowsPerFrame,
    encoding: 'delta',
    fallback: null,
    geometry,
    materials: [material('body'), material('visor')],
  }
}

/**
 * A `BatchedMesh` carrying the fixture VAT: one geometry, N instances, which is
 * the only shape a VAT crowd can take on this carrier (`assertVATCarrier`).
 *
 * Built here rather than in each test file because it is the second carrier's
 * whole setup, and a test that got the geometry count or the vertex budget
 * wrong would be refused for a reason that has nothing to do with what it is
 * asking.
 */
export function makeBatchedCarrier(vat: VAT, instances = 2): BatchedMesh {
  const batch = new BatchedMesh(instances, vat.vertexCount, vat.vertexCount * 2, vat.materials[0])
  const geometryId = batch.addGeometry(vat.geometry)
  for (let i = 0; i < instances; i++) batch.addInstance(geometryId)
  return batch
}

/**
 * A crowd whose instances differ in clip, phase, rate *and playback policy* —
 * the point of instancing, and the case a decode path renders wrong by reading
 * any of them per material instead of per instance. The phases are start times
 * in the *past*, which is how a crowd desyncs now that `timeOffset` is gone.
 *
 * The second instance is a rewinding one-shot rather than a second looper, so
 * that anything comparing the two decode paths compares a crowd in which the
 * loop, repetition and end fields actually differ between instances.
 */
export function makeFixtureCrowd(): VATInstance[] {
  return [
    { clip: FIXTURE_CLIPS.walk, startTime: -1.5, speed: 2 },
    {
      clip: FIXTURE_CLIPS.run,
      startTime: -0.25,
      speed: 0.5,
      loopMode: LoopMode.Once,
      endMode: EndMode.Rewind,
    },
  ]
}

/**
 * A morph fixture whose *normals* morph too — the case the baker used to drop
 * on the floor, baking the rest normal under a fully morphed position.
 *
 * Base vertex at the origin with normal (0, 0, 1); one relative target
 * displacing the vertex +1 along X and the normal +1 along X, held at influence
 * 1. Morphed normal is therefore (1, 0, 1), which the bake stores normalised as
 * (√½, 0, √½) — visibly apart from the unmorphed (0, 0, 1).
 */
export function makeMorphNormalFixture(): {
  root: Mesh
  mesh: Mesh
  clip: AnimationClip
  expectedPosition: Vector3
  expectedNormal: Vector3
} {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0]), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1]), 3))
  geometry.morphAttributes.position = [new BufferAttribute(new Float32Array([1, 0, 0]), 3)]
  geometry.morphAttributes.normal = [new BufferAttribute(new Float32Array([1, 0, 0]), 3)]
  geometry.morphTargetsRelative = true

  const mesh = new Mesh(geometry, new MeshBasicMaterial())
  mesh.name = 'wing'

  const clip = new AnimationClip('flap', 1, [
    new NumberKeyframeTrack('wing.morphTargetInfluences[0]', [0, 1], [1, 1]),
  ])

  return {
    root: mesh,
    mesh,
    clip,
    expectedPosition: new Vector3(1, 0, 0),
    expectedNormal: new Vector3(Math.SQRT1_2, 0, Math.SQRT1_2),
  }
}

/**
 * The absolute-target counterpart of {@link makeMorphNormalFixture}: two
 * targets at influence 0.5, so each normal target must contribute
 * `w * (target - base)` exactly as the position path does.
 *
 * Base normal (0, 0, 1) with absolute targets (1, 0, 0) and (0, 1, 0) lands at
 * (0.5, 0.5, 0) → normalised (√½, √½, 0). Treating the targets as relative
 * instead would leave the Z component in place, at (0.5, 0.5, 1).
 */
export function makeAbsoluteMorphNormalFixture(): {
  root: Mesh
  mesh: Mesh
  clip: AnimationClip
  expectedPosition: Vector3
  expectedNormal: Vector3
} {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0]), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1]), 3))
  geometry.morphAttributes.position = [
    new BufferAttribute(new Float32Array([2, 0, 0]), 3),
    new BufferAttribute(new Float32Array([0, 2, 0]), 3),
  ]
  geometry.morphAttributes.normal = [
    new BufferAttribute(new Float32Array([1, 0, 0]), 3),
    new BufferAttribute(new Float32Array([0, 1, 0]), 3),
  ]
  geometry.morphTargetsRelative = false

  const mesh = new Mesh(geometry, new MeshBasicMaterial())
  mesh.name = 'blendNormals'

  const clip = new AnimationClip('blend', 1, [
    new NumberKeyframeTrack('blendNormals.morphTargetInfluences[0]', [0, 1], [0.5, 0.5]),
    new NumberKeyframeTrack('blendNormals.morphTargetInfluences[1]', [0, 1], [0.5, 0.5]),
  ])

  return {
    root: mesh,
    mesh,
    clip,
    expectedPosition: new Vector3(1, 1, 0),
    expectedNormal: new Vector3(Math.SQRT1_2, Math.SQRT1_2, 0),
  }
}

/**
 * All three stages a normal passes through, each one a different rotation, so
 * only the order morph → skin matrix → part matrix produces the expected
 * vector. This is the composition the fix is actually risking.
 *
 * A skinned mesh sits under a group turned 90° about +Z (the part matrix).
 * Base vertex (1, 0, 0) with normal (0, 0, 1); a relative target displacing
 * both +1 along Z and the normal +1 along X, at influence 1; one bone, weight
 * 1, holding 90° about +Y.
 *
 * - morph:  position (1, 0, 1), normal (1, 0, 1) → (√½, 0, √½)
 * - bone:   (x, y, z) → (z, y, -x) ⇒ position (1, 0, -1), normal (√½, 0, -√½)
 * - part:   (x, y, z) → (-y, x, z) ⇒ position (0, 1, -1), normal (0, √½, -√½)
 *
 * Every wrong order is visible: dropping the normal morph gives (0, 1, 0),
 * morphing after the bone gives (0, 1, 0) as well, and skipping the part matrix
 * leaves (√½, 0, -√½).
 */
export function makeMorphNormalSkinnedFixture(): {
  root: Group
  mesh: SkinnedMesh
  clip: AnimationClip
  expectedPosition: Vector3
  expectedNormal: Vector3
} {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([1, 0, 0]), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1]), 3))
  geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array([0, 0, 0, 0]), 4))
  geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array([1, 0, 0, 0]), 4))
  geometry.morphAttributes.position = [new BufferAttribute(new Float32Array([0, 0, 1]), 3)]
  geometry.morphAttributes.normal = [new BufferAttribute(new Float32Array([1, 0, 0]), 3)]
  geometry.morphTargetsRelative = true

  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial())
  mesh.name = 'flapper'

  const root = new Group()
  root.name = 'rig'
  const carrier = new Object3D()
  carrier.name = 'carrier'
  carrier.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
  root.add(carrier)
  carrier.add(mesh)

  const bone = new Bone()
  bone.name = 'arm'
  mesh.add(bone)
  root.updateMatrixWorld(true)
  mesh.bind(new Skeleton([bone]))

  const qY90 = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2).toArray()
  const clip = new AnimationClip('flapAndSwing', 1, [
    new QuaternionKeyframeTrack('arm.quaternion', [0, 1], [...qY90, ...qY90]),
    new NumberKeyframeTrack('flapper.morphTargetInfluences[0]', [0, 1], [1, 1]),
  ])

  return {
    root,
    mesh,
    clip,
    expectedPosition: new Vector3(0, 1, -1),
    expectedNormal: new Vector3(0, Math.SQRT1_2, -Math.SQRT1_2),
  }
}

/**
 * The other half of the asymmetry the baker's morph loop allows: a target that
 * morphs the *normal* and not the position. glTF does not emit these, but
 * `morphAttributes` is two independent arrays and nothing forbids it — and it
 * is the one arm of the per-target branch the position-only fixtures cannot
 * reach.
 *
 * Base vertex at the origin, normal (0, 0, 1), one relative normal target of
 * (1, 0, 0) at influence 1: the vertex never moves, the normal lands at
 * (√½, 0, √½). `Mesh.updateMorphTargets` sizes the influence list from the
 * first declared morph attribute, which here is `normal`.
 */
export function makeNormalOnlyMorphFixture(): {
  root: Mesh
  mesh: Mesh
  clip: AnimationClip
  expectedPosition: Vector3
  expectedNormal: Vector3
} {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0]), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1]), 3))
  geometry.morphAttributes.normal = [new BufferAttribute(new Float32Array([1, 0, 0]), 3)]
  geometry.morphTargetsRelative = true

  const mesh = new Mesh(geometry, new MeshBasicMaterial())
  mesh.name = 'shading'

  const clip = new AnimationClip('shade', 1, [
    new NumberKeyframeTrack('shading.morphTargetInfluences[0]', [0, 1], [1, 1]),
  ])

  return {
    root: mesh,
    mesh,
    clip,
    expectedPosition: new Vector3(0, 0, 0),
    expectedNormal: new Vector3(Math.SQRT1_2, 0, Math.SQRT1_2),
  }
}

// ---------------------------------------------------- inspecting a decode path

/**
 * Run a patched material's `onBeforeCompile` against a stand-in for three's
 * shader object, so the uniforms and injections a real compile would see can be
 * asserted headlessly — which is the only way CI, with no GPU, can read the
 * GLSL the WebGL path actually ships.
 */
export function compileVATMaterial(material: Material): {
  uniforms: Record<string, IUniform>
  vertexShader: string
  fragmentShader: string
} {
  const shader = {
    uniforms: {} as Record<string, IUniform>,
    vertexShader: `void main() {
#include <beginnormal_vertex>
#include <begin_vertex>
}`,
    fragmentShader: '',
  }
  if (material.onBeforeCompile === Material.prototype.onBeforeCompile) {
    throw new Error(`${material.type} is not VAT-patched`)
  }
  material.onBeforeCompile(shader as unknown as WebGLProgramParametersWithUniforms, null as unknown as WebGLRenderer)
  return shader
}

/**
 * A TSL node, seen through the fields the structural tests read off it. A `Fn`
 * body does not traverse, so asserting against the graph is the only TSL
 * coverage CI can run — and these are the handles it has.
 */
export interface InspectedNode {
  type?: string
  scope?: string
  /** A `PropertyNode`'s shader-side name — how a TSL varying identifies itself. */
  name?: string
  value?: unknown
  op?: string
  components?: string
  method?: string
  aNode?: InspectedNode
  bNode?: InspectedNode
  node?: InspectedNode
  /** A `ConditionalNode` — what `.select()` builds — as its condition and two branches. */
  condNode?: InspectedNode
  ifNode?: InspectedNode
  elseNode?: InspectedNode
  /** A `JoinNode`'s declared type: `'mat4'` for a matrix built from four columns. */
  nodeType?: string
  /** A `ConvertNode`'s target type: `'mat3'` for the upper 3×3 of a skin matrix. */
  convertTo?: string
  /** Set on the `VarNode` TSL wraps every chained result in — see {@link unwrap}. */
  intent?: boolean
  /** `ivec2( x, y )`, as a var-intent wrapper around the join of the two. */
  uvNode?: { node?: { nodes?: InspectedNode[] } }
  getAttributeName?: () => string
}

/**
 * Every node reachable from one, flattened. Takes anything that traverses —
 * a real TSL `Node`, or one of the narrowed shapes above reached through
 * `aNode` / `bNode`, which are the same objects seen through fewer fields.
 */
export function nodesIn(node: unknown): InspectedNode[] {
  // Each node once. three's own `traverse` walks the graph as a tree, and a
  // decode is a DAG whose shared terms — the rows, the pack texels, a slot
  // matrix read by position and normal alike — are reached along many paths;
  // the rig decode's twenty-four fetches made that walk take seconds a test.
  const seen = new Set<InspectedNode>()
  const visit = (n: unknown) => {
    if (n === null || n === undefined || seen.has(n as InspectedNode)) return
    seen.add(n as InspectedNode)
    for (const child of (n as { getChildren: () => unknown[] }).getChildren()) visit(child)
  }
  visit(node)
  return [...seen]
}

/**
 * The node behind TSL's fluent wrapping. Every chained result — `a.mul(b)`,
 * `dot(a, b)`, `mat4(…)`, `mat3(m)` — comes back as a `VarNode` marked
 * `intent`, holding the real node in `.node`; a `SplitNode` from `.x` or a
 * `ConstNode` from a number does not. A test asking what an operand *is* asks
 * through here, and a graph shape without the wrapper reads the same.
 */
export const unwrap = (node: InspectedNode | undefined): InspectedNode | undefined =>
  node?.type === 'VarNode' && node.intent === true ? unwrap(node.node) : node

/**
 * Whether a node fetches the given texel column of a playback texture — the
 * clip, playback, crossfade or outgoing `vec4` of this instance's row
 * (`PACK_TEXELS`).
 *
 * Read off the fetch's own x coordinate rather than off the texture it names,
 * because the column *is* the field: all three come from one texture, and a
 * decode reading the outgoing texel where it means the clip one is exactly the
 * mistake the pack makes silent.
 */
export const isPackTexel = (node: InspectedNode | undefined, texel: number) => {
  if (node?.type !== 'TextureNode') return false
  const x = node.uvNode?.node?.nodes?.[0]?.node
  return x?.type === 'ConstNode' && x.value === texel
}

/**
 * One component of a packed texel — the clip texel's `w`, say. The pack means
 * every term of a decode is a swizzle rather than a field of its own, and a
 * test that only looked for the fetch would pass while the decode read the
 * wrong component of it.
 */
export const isComponent = (node: InspectedNode | undefined, texel: number, component: string) =>
  node?.type === 'SplitNode' && node.components === component && isPackTexel(node.node, texel)

/** Every column of the pack, which is what tells a pack fetch from a VAT one. */
const PACK_COLUMNS = Object.values(PACK_TEXELS)

/**
 * The row coordinate every pack fetch in a decode is keyed by — the `y` of the
 * `ivec2( field, instance )` each `textureLoad` is given, flattened.
 *
 * The whole of what the carrier changes on the TSL path is this one node, so it
 * is worth reaching rather than inferring from the presence of a node
 * elsewhere in the graph.
 */
export const packRowsIn = (node: unknown): InspectedNode[][] =>
  // Deduplicated, because `traverse` walks a DAG as a tree: the pack's fetches
  // are shared by every term that reads them, so each turns up many times and
  // the count would say nothing.
  [...new Set(nodesIn(node).filter((n) => PACK_COLUMNS.some((texel) => isPackTexel(n, texel))))].map((n) =>
    nodesIn(n.uvNode?.node?.nodes?.[1]),
  )

/**
 * {@link makeRigidSubtreeFixture}, dressed for the merge's `tangent` handling:
 * one shared material so both parts land in a single group in traversal order
 * (arm, then body), a `tangent` of (1, 0, 0, -1) on each, and a 90° rest
 * rotation on `arm` — so the merge must turn arm's direction to (0, 1, 0),
 * leave body's alone, and carry the handedness `w` through untouched.
 *
 * `bodyTangent` reaches the all-or-nothing rule: `false` drops body's tangent
 * entirely, `'interleaved'` gives it one the merge cannot read. Either way the
 * merged attribute must not appear.
 */
export function makeTangentFixture({
  bodyTangent = true,
}: { bodyTangent?: boolean | 'interleaved' } = {}): {
  root: Group
  arm: Mesh
  body: Mesh
  clip: AnimationClip
} {
  const fixture = makeRigidSubtreeFixture()
  const { arm, body } = fixture

  // One material across both parts, so the merge emits a single group and the
  // vertex order is simply the traversal order.
  body.material = arm.material

  // A rest rotation of its own, so the merge has a tangent to actually rotate.
  arm.rotation.z = Math.PI / 2

  const vec4 = () => new BufferAttribute(new Float32Array([1, 0, 0, -1]), 4)
  arm.geometry.setAttribute('tangent', vec4())
  if (bodyTangent === 'interleaved') {
    // Four components, the right count — and still not something the merge can
    // read vertex by vertex.
    const buffer = new InterleavedBuffer(new Float32Array([1, 0, 0, -1]), 4)
    body.geometry.setAttribute('tangent', new InterleavedBufferAttribute(buffer, 4, 0))
  } else if (bodyTangent) {
    body.geometry.setAttribute('tangent', vec4())
  }

  return fixture
}

/**
 * A skinned part that is *placed* — the case a rig row has to carry and a
 * one-bone fixture at the origin never exercises.
 *
 * A two-vertex `SkinnedMesh` under a carrier turned 90° about +Y and lifted to
 * y = 2 (the part matrix), with two bones bound off the origin so neither
 * `boneInverse` is the identity: `upper` at (0, 0.5, 0) and `lower` at
 * (1, 0, 0). Vertex 0 at (1, 0, 0) is weighted wholly to `upper`; vertex 1 at
 * (2, 0, 0) is split evenly between the two. The clip turns `upper` 90° about
 * +Z and lifts `lower` by one unit over a second, so every frame blends a
 * rotation with a translation through both bind matrices and the part matrix.
 *
 * No hand-computed expectation, on purpose: the vertex bake is the oracle the
 * rig bake is compared against (spec #48), and this fixture exists to give
 * that comparison a rig with every term of the slot chain non-trivial.
 */
export function makePlacedSkinnedFixture(): { root: Group; mesh: SkinnedMesh; clip: AnimationClip } {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([1, 0, 0, 2, 0, 0]), 3))
  geometry.setAttribute(
    'normal',
    new BufferAttribute(new Float32Array([0, 0, 1, Math.SQRT1_2, Math.SQRT1_2, 0]), 3),
  )
  geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array([0, 0, 0, 0, 0, 1, 0, 0]), 4))
  geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array([1, 0, 0, 0, 0.5, 0.5, 0, 0]), 4))

  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial())
  mesh.name = 'limb'

  const root = new Group()
  root.name = 'rig'
  const carrier = new Object3D()
  carrier.name = 'carrier'
  carrier.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
  carrier.position.set(0, 2, 0)
  root.add(carrier)
  carrier.add(mesh)

  const upper = new Bone()
  upper.name = 'upper'
  upper.position.set(0, 0.5, 0)
  const lower = new Bone()
  lower.name = 'lower'
  lower.position.set(1, 0, 0)
  mesh.add(upper, lower)
  root.updateMatrixWorld(true)
  mesh.bind(new Skeleton([upper, lower]))

  const q0 = new Quaternion().toArray()
  const q1 = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2).toArray()
  const clip = new AnimationClip('reach', 1, [
    new QuaternionKeyframeTrack('upper.quaternion', [0, 1], [...q0, ...q1]),
    new VectorKeyframeTrack('lower.position', [0, 1], [1, 0, 0, 1, 1, 0]),
  ])

  return { root, mesh, clip }
}

/**
 * Two skinned parts on *one* skeleton — Soldier's body and visor in miniature,
 * and the case the rig encoding's slot sharing exists for (ADR-0018).
 *
 * Two one-vertex `SkinnedMesh`es, `body` at (1, 0, 0) and `visor` at (2, 0, 0),
 * both children of the root and both weighted wholly to the single bone
 * `spine`, which turns 90° about +Z over a second. Both bind at the identity
 * by default, so they share a skeleton *and* a bind matrix and a rig bake
 * gives them one set of slots. `visorBind` binds the visor with a different
 * bind matrix instead — a translation, the two parts then read the same bone
 * through different bind spaces — so the same rig has to hand out two sets.
 *
 * Distinct materials, so the merge keeps them as two groups and the vertex
 * order is `body` then `visor`.
 */
export function makeSharedRigFixture({
  visorBind,
  visorSkeleton,
}: {
  visorBind?: Matrix4
  /**
   * Give the visor its *own* `Skeleton` object over the same bone — the shape
   * a glTF loader hands back when two meshes list the same joints in two
   * skins (Soldier's visor, RobotExpressive's hands). The bone inverse is the
   * one `bind()` computes unless overridden — an override binds the visor to
   * the bone through a different bind space, which is a different slot.
   */
  visorSkeleton?: { boneInverse?: Matrix4 }
} = {}): {
  root: Group
  body: SkinnedMesh
  visor: SkinnedMesh
  clip: AnimationClip
} {
  const point = (x: number) => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array([x, 0, 0]), 3))
    g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1]), 3))
    g.setAttribute('skinIndex', new BufferAttribute(new Uint16Array([0, 0, 0, 0]), 4))
    g.setAttribute('skinWeight', new BufferAttribute(new Float32Array([1, 0, 0, 0]), 4))
    return g
  }

  const root = new Group()
  root.name = 'soldier'
  const spine = new Bone()
  spine.name = 'spine'
  root.add(spine)

  const body = new SkinnedMesh(point(1), new MeshBasicMaterial())
  body.name = 'body'
  const visor = new SkinnedMesh(point(2), new MeshBasicMaterial())
  visor.name = 'visor'
  root.add(body, visor)
  root.updateMatrixWorld(true)

  const skeleton = new Skeleton([spine])
  body.bind(skeleton)
  const visorRig = visorSkeleton ? new Skeleton([spine]) : skeleton
  if (visorBind) visor.bind(visorRig, visorBind)
  else visor.bind(visorRig)
  // After the bind: `bind()` without a bind matrix recomputes the inverses.
  if (visorSkeleton?.boneInverse) visorRig.boneInverses[0]!.copy(visorSkeleton.boneInverse)

  const q0 = new Quaternion().toArray()
  const q1 = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2).toArray()
  const clip = new AnimationClip('turn', 1, [
    new QuaternionKeyframeTrack('spine.quaternion', [0, 1], [...q0, ...q1]),
  ])

  return { root, body, visor, clip }
}

/**
 * {@link makeSkinnedFixture}'s bone turned a full circle rather than a quarter,
 * through keys every 90° so the mixer takes the long way round instead of
 * slerping the short one. A quaternion read off a matrix always comes back with
 * `w >= 0`, which flips its sign as the angle crosses 180° — the discontinuity
 * a rig bake has to smooth away before a shader blends two rows.
 */
export function makeFullSpinFixture(): { root: SkinnedMesh; mesh: SkinnedMesh; clip: AnimationClip } {
  const { root, mesh } = makeSkinnedFixture()
  const angles = [0, 0.5, 1, 1.5, 2].map((k) => k * Math.PI)
  const values = angles.flatMap((a) => new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), a).toArray())
  const track = new QuaternionKeyframeTrack('root.quaternion', [0, 0.25, 0.5, 0.75, 1], values)
  return { root, mesh, clip: new AnimationClip('fullSpin', 1, [track]) }
}

/**
 * A rig-encoded VAT standing in for `bakeVAT(…, { encoding: 'rig' })`'s
 * output, for tests of what happens *after* a bake — the decode paths, which
 * only ever read it.
 *
 * The same shape as {@link makeVATFixture} — two material groups, the same
 * two-clip table and the same all-frames bounds — so a test can hold the two
 * encodings side by side and every difference between them is the encoding.
 * What differs: one rig texture two texels per slot wide in place of the two
 * vertex layers, `skinIndex` and `skinWeight` kept on the geometry, and
 * smooth-shaded lit materials, because a rig VAT shades from its skin matrix
 * and needs no normal texture to pair with (ADR-0018).
 */
export function makeRigVATFixture(): RigVAT {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(18), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(18), 3))
  geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(24), 4))
  geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array(24), 4))
  geometry.addGroup(0, 3, 0)
  geometry.addGroup(3, 3, 1)

  const bounds = new Box3(new Vector3(-2, 0, -2), new Vector3(2, 3, 2))
  geometry.boundingBox = bounds.clone()
  geometry.boundingSphere = bounds.getBoundingSphere(new Sphere())

  const slotCount = 3
  const totalFrames = 18
  const width = slotCount * 2
  const material = (name: string) => new MeshStandardMaterial({ name })
  return {
    encoding: 'rig',
    rigTexture: new DataTexture(new Float32Array(width * totalFrames * 4), width, totalFrames),
    slotCount,
    clips: [FIXTURE_CLIPS.walk, FIXTURE_CLIPS.run],
    bounds,
    vertexCount: 6,
    totalFrames,
    geometry,
    materials: [material('body'), material('visor')],
  }
}

// ------------------------------------------------- decoding a bake on the CPU

/**
 * The vertex encoding's own decode, as the shader does it: the merged rest
 * position plus the baked delta of vertex `v` at frame `row`. Tests assert on
 * this, never on texels.
 */
export function decodeDeltaPosition(vat: DeltaVAT, row: number, v = 0): Vector3 {
  const data = deltaTexels(vat)
  const o = deltaTexel(vat, row, v) * 4
  const rest = vat.geometry.attributes.position!
  return new Vector3(rest.getX(v) + data[o]!, rest.getY(v) + data[o + 1]!, rest.getZ(v) + data[o + 2]!)
}

/**
 * Which texel of a vertex-encoded layer holds vertex `v` at frame `row`, as the
 * shader addresses it: column `v mod width`, and the frame's first texture row
 * plus `floor(v / width)` (ADR-0030). Spelled out from the texture's own width
 * and the VAT's `rowsPerFrame` rather than from the library's helper, so a
 * layout the bake and the decode agreed on wrongly is still caught here.
 *
 * One row a frame — every bake whose vertices fit the ceiling — is `row *
 * vertexCount + v`, the offset every test walked before frames could span rows.
 */
export function deltaTexel(vat: DeltaVAT, row: number, v: number): number {
  const width = vat.positionTexture.image.width
  const y = row * vat.rowsPerFrame + Math.floor(v / width)
  return y * width + (v % width)
}

/**
 * The position layer's whole buffer as the sampler hands it to the shader:
 * floats. The store has been `Uint16Array` half-floats since #73 — a test that
 * read it raw would be asserting bit patterns — and a half-float sampler does
 * the widening on the GPU for free, so this is what the decode actually sees.
 *
 * Decoded whole rather than texel by texel because every caller walks it by
 * {@link deltaTexel}'s offset, times four, and the layer of a fixture bake is
 * a few hundred numbers.
 */
export function deltaTexels(vat: DeltaVAT): Float32Array {
  const stored = vat.positionTexture.image.data as Uint16Array
  const data = new Float32Array(stored.length)
  for (let i = 0; i < stored.length; i++) data[i] = DataUtils.fromHalfFloat(stored[i]!)
  return data
}

/**
 * The position layer's tolerance, **relative** — because that is the unit its
 * error has, exactly as the normal layer's is an angle ({@link NORMAL_DEGREES},
 * #29).
 *
 * Half-float is floating point, so what it loses is a fraction of the delta it
 * holds and never a distance. The bound is the format's own step — 2^-10,
 * between neighbouring mantissas, because three's `toHalfFloat` truncates
 * rather than rounds. What the real assets actually reach is inside it, as it
 * must be: 0.061% worst case (#73) — 3.91 mm on RobotExpressive's 6.38 m
 * `Dance` throw, 3 microns on a 5 mm finger twitch, and exactly zero at the
 * rest pose, where the delta is zero. A tolerance in millimetres would be asserting the
 * asset's scale rather than the format's error.
 */
export const DELTA_RELATIVE = 2 ** -10

/**
 * The floor under {@link expectDeltaClose}, in the units the bake is in: what
 * the float math *behind* the delta costs, which the store's relative error
 * shrinks below at small deltas but never removes. The five decimals the float
 * position layer was held to, kept.
 */
export const DELTA_FLOOR = 0.5e-5

/**
 * Assert a decoded position lands where it should: within
 * {@link DELTA_RELATIVE} of each component of the delta it was reconstructed
 * from, plus {@link DELTA_FLOOR}.
 *
 * Per component, because each is half-floated on its own — so a vertex that
 * barely moves is still held tight while the limb thrown across the scene is
 * allowed the fraction the format costs. `floor` is widened by the handful of
 * callers comparing against something that is *not* this bake — a rig bake, an
 * interpolated frame — where the bake's own error is not the largest term.
 */
export function expectDeltaClose(
  vat: DeltaVAT,
  row: number,
  v: number,
  expected: Vector3,
  floor = DELTA_FLOOR,
): void {
  const actual = decodeDeltaPosition(vat, row, v)
  const rest = vat.geometry.attributes.position!
  const restAt = new Vector3(rest.getX(v), rest.getY(v), rest.getZ(v))
  for (const axis of ['x', 'y', 'z'] as const) {
    const tolerance = floor + DELTA_RELATIVE * Math.abs(expected[axis] - restAt[axis])
    expect(
      Math.abs(actual[axis] - expected[axis]),
      `${axis} of vertex ${v} at row ${row}: ${actual[axis]} against ${expected[axis]}, tolerance ${tolerance}`,
    ).toBeLessThanOrEqual(tolerance)
  }
}

/**
 * Normals are stored absolute under the vertex encoding, so a texel read *is*
 * the decoded normal — once it is unpacked, which since #29 it has to be: two
 * unsigned bytes, octahedral, through the library's own decode rather than a
 * second copy of the arithmetic.
 */
export function decodeDeltaNormal(vat: DeltaVAT, row: number, v = 0): Vector3 {
  const data = vat.normalTexture!.image.data as Uint8Array
  const o = deltaTexel(vat, row, v) * 2
  return decodeOctahedral(data[o]!, data[o + 1]!, new Vector3())
}

/**
 * The normal layer's tolerance, in **degrees** — stated per format, because it
 * is the format that sets it and not the bake (#29).
 *
 * A normal is a direction, so what the encoding costs is an angle: octahedral
 * at eight bits a channel quantises the sphere to ~0.95° worst case, measured
 * over both real assets and pinned in `octahedral.test.ts`. Asserting a
 * component to five decimals — the tolerance the float bake was held to —
 * would be asserting the float bake, which is no longer what is stored.
 */
export const NORMAL_DEGREES = 1

/**
 * Assert a decoded normal points where it should: unit length, and within
 * {@link NORMAL_DEGREES} of the expected direction.
 *
 * Expected values in these tests are hand-computed exact directions, so this
 * measures the whole error the encoding introduces and nothing else.
 */
export function expectNormalClose(actual: Vector3, expected: Vector3): void {
  expect(actual.length()).toBeCloseTo(1, 5)
  const dot = Math.max(-1, Math.min(1, actual.dot(expected) / (expected.length() || 1)))
  const degrees = (Math.acos(dot) * 180) / Math.PI
  expect(degrees, `normal ${actual.toArray()} is ${degrees.toFixed(3)}° from ${expected.toArray()}`)
    .toBeLessThanOrEqual(NORMAL_DEGREES)
}

/** One slot's two texels at one row: its rotation, and its placement — translation and scale. */
export function slotTexels(vat: RigVAT, row: number, slot: number): { q: Vector4; ts: Vector4 } {
  const data = vat.rigTexture.image.data as Float32Array
  const width = vat.rigTexture.image.width
  const o = (row * width + slot * RIG_TEXELS_PER_SLOT) * 4
  const texel = (i: number) => new Vector4().fromArray(data, o + i * 4)
  return { q: texel(RIG_TEXELS.rotation), ts: texel(RIG_TEXELS.placement) }
}

/**
 * The rig encoding decoded as the shader decodes it, on the CPU: for every slot
 * vertex `v` is weighted to, its two texels at `row0` and `row1`, blended as the
 * GLSL blends them — the second row flipped onto the first's hemisphere, a
 * normalised lerp of the quaternions, a lerp of translation and scale —
 * composed with `Matrix4.compose`, weight-summed by `skinWeight`, and applied
 * to the part-local rest position and normal, and to the tangent's direction
 * when the geometry carries one (its handedness `w` is not returned).
 *
 * `row1 === row0` at `t = 0` is a single row read, which is what a frame-exact
 * comparison asks for.
 */
export function skinFromRig(
  vat: RigVAT,
  v: number,
  row0: number,
  row1 = row0,
  t = 0,
): { position: Vector3; normal: Vector3; tangent: Vector3 | null } {
  const skinIndex = vat.geometry.attributes.skinIndex!
  const skinWeight = vat.geometry.attributes.skinWeight!
  const skin = new Matrix4()
  skin.elements.fill(0)
  for (let i = 0; i < 4; i++) {
    const w = skinWeight.getComponent(v, i)
    if (w === 0) continue
    const a = slotTexels(vat, row0, skinIndex.getComponent(v, i))
    const b = slotTexels(vat, row1, skinIndex.getComponent(v, i))
    if (a.q.dot(b.q) < 0) b.q.negate()
    const q = a.q.lerp(b.q, t).normalize()
    const ts = a.ts.lerp(b.ts, t)
    const m = new Matrix4().compose(
      new Vector3(ts.x, ts.y, ts.z),
      new Quaternion(q.x, q.y, q.z, q.w),
      new Vector3(ts.w, ts.w, ts.w),
    ).elements
    for (let e = 0; e < 16; e++) skin.elements[e]! += m[e]! * w
  }
  return {
    position: new Vector3().fromBufferAttribute(vat.geometry.attributes.position!, v).applyMatrix4(skin),
    normal: new Vector3().fromBufferAttribute(vat.geometry.attributes.normal!, v).transformDirection(skin),
    tangent: vat.geometry.attributes.tangent
      ? new Vector3().fromBufferAttribute(vat.geometry.attributes.tangent, v).transformDirection(skin)
      : null,
  }
}
