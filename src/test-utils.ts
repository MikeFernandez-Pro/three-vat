import { existsSync } from 'node:fs'
import { env as processEnv } from 'node:process'
import {
  AnimationClip,
  Bone,
  Box3,
  DataTexture,
  MeshStandardMaterial,
  Sphere,
  Group,
  Object3D,
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  NumberKeyframeTrack,
  Quaternion,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from 'three'
import type { VATInstance } from './instance-playback.js'
import type { BakedVAT, VATClip } from './types.js'

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
 * `pnpm fetch:test-assets` would report green having never baked the real
 * character. So under CI a missing asset is an error, not a skip.
 */
export function assetMissing(
  path: string,
  env: Record<string, string | undefined> = processEnv,
): boolean {
  if (existsSync(path)) return false
  if (env.CI) {
    throw new Error(
      `${path} is missing, and CI is set. Run \`pnpm fetch:test-assets\` before the suite ` +
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
 */
export function makeBakedVATFixture(): BakedVAT {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(18), 3))
  geometry.addGroup(0, 3, 0)
  geometry.addGroup(3, 3, 1)

  const bounds = new Box3(new Vector3(-2, 0, -2), new Vector3(2, 3, 2))
  geometry.boundingBox = bounds.clone()
  geometry.boundingSphere = bounds.getBoundingSphere(new Sphere())

  const texture = () => new DataTexture(new Float32Array(4), 1, 1)
  return {
    positionTexture: texture(),
    normalTexture: texture(),
    clips: [FIXTURE_CLIPS.walk, FIXTURE_CLIPS.run],
    bounds,
    vertexCount: 6,
    totalFrames: 18,
    encoding: 'delta',
    geometry,
    materials: [new MeshStandardMaterial({ name: 'body' }), new MeshStandardMaterial({ name: 'visor' })],
  }
}

/**
 * A crowd whose instances differ in clip, phase and rate — the point of
 * instancing, and the case a decode path renders wrong by reading any of the
 * three per material instead of per instance.
 */
export function makeFixtureCrowd(): VATInstance[] {
  return [
    { clip: FIXTURE_CLIPS.walk, timeOffset: 1.5, speed: 2 },
    { clip: FIXTURE_CLIPS.run, timeOffset: 0.25, speed: 0.5 },
  ]
}
