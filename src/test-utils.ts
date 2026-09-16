import {
  AnimationClip,
  Bone,
  Group,
  Object3D,
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  NumberKeyframeTrack,
  Quaternion,
  QuaternionKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from 'three'

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
