import {
  AnimationClip,
  Bone,
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
