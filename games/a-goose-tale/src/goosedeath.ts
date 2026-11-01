// The goose's death, made here, not in his file: bitten, he rears up, his legs give under him, he drops onto his
// breast and rolls over onto his side, his neck laid along the ground; and there the rats tug at him, each tug
// jolting his body, his head lifting and falling back, his wing and his legs kicking. Keyed from his rest, his idle's
// first frame, each part turned about his own axes as he stands, and set down at every key so his lowest point is
// on the ground, as low as his feet are standing.
import { AnimationClip, Matrix3, Matrix4, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack, type KeyframeTrack, type Object3D, type SkinnedMesh } from 'three/webgpu'

/** A pose, each angle in degrees about his own axes as he stands, all 0 standing. */
interface Pose {
  /** His whole body, legs and all, from his feet: forward onto his breast, over onto his left side, turned to his left. */
  pitch: number
  roll: number
  yaw: number
  /** His breast and all above it, from his back: forward. */
  chest: number
  /** Each of his neck's seven joints: forward, and over to his left. */
  neck: number
  neckRoll: number
  /** His head: forward, and over to his left. */
  head: number
  headRoll: number
  /** Both thighs swung forward, both shins back, both feet forward. */
  thigh: number
  shin: number
  foot: number
  /** His wings out from his sides: the left, which he falls onto, and the right, uppermost. */
  leftWing: number
  rightWing: number
}

/** How a part eases into a key from the one before: a fall gathers pace into it, a lift slows into it. */
type Ease = 'in' | 'out' | 'both'

const STANDING: Pose = { pitch: 0, roll: 0, yaw: 0, chest: 0, neck: 0, neckRoll: 0, head: 0, headRoll: 0, thigh: 0, shin: 0, foot: 0, leftWing: 0, rightWing: 0 }

/** His fall, key by key, s into it: each key what changes from the one before. */
const KEYS: readonly { at: number; ease: Ease; pose: Partial<Pose> }[] = [
  { at: 0, ease: 'both', pose: {} },
  // Bitten: he rears up, his head thrown back, his wings flung half open.
  { at: 0.22, ease: 'out', pose: { chest: -16, neck: -4, head: -18, leftWing: 30, rightWing: 30 } },
  // He sags forward out of it, his knees giving.
  { at: 0.5, ease: 'both', pose: { chest: 10, neck: 4, head: 8, thigh: 18, shin: -30, foot: 10, leftWing: 18, rightWing: 22 } },
  // His legs buckle, his breast dropping, tipping over to his left.
  { at: 0.82, ease: 'in', pose: { roll: 8, chest: 18, neck: 7, head: 12, thigh: 55, shin: -95, foot: 40, leftWing: 14, rightWing: 24 } },
  // Down on his breast, hard, his neck flung forward.
  { at: 1.02, ease: 'in', pose: { pitch: 6, roll: 16, chest: 4, neck: 6, neckRoll: 2, head: 4, thigh: 88, shin: -165, foot: 80 } },
  // His head bounces up off the ground.
  { at: 1.18, ease: 'out', pose: { roll: 24, neck: 6, head: 6 } },
  // He rolls over onto his side, his neck laid along the ground, his upper wing fallen open, his legs still folded.
  { at: 1.5, ease: 'both', pose: { pitch: 4, roll: 74, yaw: 8, chest: 0, neck: 5, neckRoll: 5, head: 10, headRoll: 12, thigh: 80, shin: -150, foot: 60, leftWing: 0, rightWing: 34 } },
  // His legs kick out stiff.
  { at: 1.72, ease: 'out', pose: { thigh: 30, shin: -20, foot: 10 } },
  // Still.
  { at: 2.05, ease: 'out', pose: { roll: 80, neckRoll: 6, rightWing: 26 } },
]

/** The rats tugging at him as he lies: when, s into his fall, how hard, 0 to 1, and which way his body is jerked round. */
export const DEATH_TUGS: readonly { at: number; hard: number; turn: 1 | -1 }[] = [
  { at: 2.15, hard: 1, turn: 1 },
  { at: 2.5, hard: 0.6, turn: -1 },
  { at: 2.72, hard: 0.85, turn: 1 },
  { at: 3.15, hard: 0.5, turn: -1 },
  { at: 3.6, hard: 0.35, turn: 1 },
]
/** When he lies still on his side, s into his fall: the dark may close from here. */
export const DEATH_DOWN = 2.05
/** How long his fall is, s, held on its last frame after. */
const DEATH_ENDS = 4.2
/** How many keys a second his fall is given. */
const RATE = 60
/**
 * A tug at its height: how far it jerks his body round and over, his neck up, his wing and his thighs out, degrees;
 * and how far it drags him back along his length, in his file's units, for good (he stands 0.43 of them).
 */
const TUG = { yaw: 7, roll: -6, neckRoll: -4, rightWing: 30, thigh: 22, drag: 0.012 }
/** How long a tug takes to its height, s; how fast it dies away after, s; and how long its back-and-forth swing is, s. */
const TUG_RISE = 0.05
const TUG_DIES = 0.14
const TUG_SWING = 0.24
/** How far he slides over to his left as he rolls, of where his roll would carry him from his feet: he rolls nearly in place. */
const DRIFT = 0.35
/** Every this many vertices of his skin is read for his lowest point. */
const GROUND_EVERY = 3

/** His own axes as he stands, in his file's space: he faces -z, his left -x. */
const FORWARD = new Vector3(-1, 0, 0)
const OVER_LEFT = new Vector3(0, 0, 1)
const TURN_LEFT = new Vector3(0, 1, 0)
const SWING = new Vector3(1, 0, 0)
const BONES = {
  body: 'master_bone',
  chest: 'bone_spine_1',
  neck: ['bone_neck_1', 'bone_neck_2', 'bone_neck_3', 'bone_neck_4', 'bone_neck_5', 'bone_neck_6', 'bone_neck_7'],
  head: 'bone_head_1',
  thighs: ['bone_leg_L1', 'bone_leg_R1'],
  shins: ['bone_leg_L2', 'bone_leg_R2'],
  feet: ['bone_leg_L3', 'bone_leg_R3'],
  leftWing: 'bone_wing_L1',
  rightWing: 'bone_wing_R1',
  /** The bone his drift is read at: his middle. */
  middle: 'bone_spine_2',
}

const smooth = (x: number) => x * x * (3 - 2 * x)
const eased = (x: number, ease: Ease) => (ease === 'in' ? x * x : ease === 'out' ? 1 - (1 - x) * (1 - x) : smooth(x))

/** His pose without the tugs at `t` s, each part eased from key to key. */
function keyed(t: number): Pose {
  let from = { ...STANDING }
  for (let k = 0; k < KEYS.length; k++) {
    const key = KEYS[k]!
    const to = { ...from, ...key.pose }
    if (t <= key.at) {
      const was = KEYS[k - 1]
      if (!was) return to
      const x = eased((t - was.at) / (key.at - was.at), key.ease)
      return Object.fromEntries(Object.keys(to).map((part) => [part, from[part as keyof Pose] + (to[part as keyof Pose] - from[part as keyof Pose]) * x])) as unknown as Pose
    }
    from = to
  }
  return from
}

/** A tug `since` s after it came, 0 before: up to 1 in TUG_RISE, swinging back past 0 and dying away. */
function tugAt(since: number): number {
  if (since < 0) return 0
  if (since < TUG_RISE) return smooth(since / TUG_RISE)
  const after = since - TUG_RISE
  return Math.exp(-after / TUG_DIES) * Math.cos((Math.PI * after) / TUG_SWING)
}

/**
 * His death, as a clip of every track `rest` has, `rest` held as it is at its start where the death moves nothing.
 * `model` is his file's scene, `skins` the skins drawn on his rig, read for where his lowest point is; his bones are
 * posed to read it, as anything playing his clips poses them again.
 */
export function gooseDeath(model: Object3D, skins: readonly SkinnedMesh[], rest: AnimationClip): AnimationClip {
  // three's own sampler for a track, read out of its shared buffer; typed on no track in @types/three.
  const sampled = (track: KeyframeTrack, t: number): number[] =>
    Array.from((track as unknown as { createInterpolant(): { evaluate(t: number): ArrayLike<number> } }).createInterpolant().evaluate(t))
  const bone = (name: string) => {
    const found = model.getObjectByName(name)
    if (!found) throw new Error(`the goose has no ${name}`)
    return found
  }
  // His rest, every track at its start.
  const still = rest.tracks.map((track) => {
    const [name, property] = track.name.split('.') as [string, 'quaternion' | 'position' | 'scale']
    const at = sampled(track, 0)
    const target = model.getObjectByName(name)
    target?.[property].fromArray(at)
    return { track, at }
  })
  model.updateMatrixWorld(true)
  const intoModel = new Matrix4().copy(model.matrixWorld).invert()
  const modelTurn = model.getWorldQuaternion(new Quaternion()).invert()

  /** A bone his fall turns: its rest, and how it turns about one of his axes as he stands, in its own frame. */
  const driven = new Map<Object3D, { rest: Quaternion; frame: Quaternion }>()
  const drive = (name: string) => {
    const b = bone(name)
    if (!driven.has(b)) driven.set(b, { rest: b.quaternion.clone(), frame: b.getWorldQuaternion(new Quaternion()).premultiply(modelTurn) })
    return b
  }
  const body = drive(BONES.body)
  const chest = drive(BONES.chest)
  const neck = BONES.neck.map(drive)
  const head = drive(BONES.head)
  const thighs = BONES.thighs.map(drive)
  const shins = BONES.shins.map(drive)
  const feet = BONES.feet.map(drive)
  const leftWing = drive(BONES.leftWing)
  const rightWing = drive(BONES.rightWing)
  const middle = bone(BONES.middle)
  const bodyAt = body.position.clone()
  // His model space's moves, in his body's parent's: what his body's position is in.
  const intoParent = new Matrix3().setFromMatrix4(new Matrix4().copy(body.parent!.matrixWorld).invert().multiply(model.matrixWorld))

  // Each turn about one of his axes, as he stands, done in a bone's own frame, after its rest.
  const turn = new Quaternion()
  const about = new Quaternion()
  const local = new Vector3()
  const pose = (b: Object3D, ...turns: [Vector3, number][]) => {
    const { rest: at, frame } = driven.get(b)!
    turn.identity()
    for (const [axis, degrees] of turns) turn.multiply(about.setFromAxisAngle(local.copy(axis).applyQuaternion(frame.clone().invert()), (degrees * Math.PI) / 180))
    b.quaternion.copy(at).multiply(turn)
  }

  // His skins' lowest point, every GROUND_EVERY vertices, in his model space.
  const vertex = new Vector3()
  const toModel = new Matrix4()
  const lowest = () => {
    model.updateMatrixWorld(true)
    let low = Infinity
    for (const skin of skins) {
      const positions = skin.geometry.getAttribute('position')
      toModel.multiplyMatrices(intoModel, skin.matrixWorld)
      for (let i = 0; i < positions.count; i += GROUND_EVERY) {
        skin.applyBoneTransform(i, vertex.fromBufferAttribute(positions, i)).applyMatrix4(toModel)
        if (vertex.y < low) low = vertex.y
      }
    }
    return low
  }
  const middleAt = () => middle.getWorldPosition(new Vector3()).applyMatrix4(intoModel)
  const ground = lowest()
  const standing = middleAt()

  const times: number[] = []
  const turns = new Map<Object3D, number[]>([...driven.keys()].map((b) => [b, []]))
  const moves: number[] = []
  const move = new Vector3()
  for (let k = 0; k <= Math.round(DEATH_ENDS * RATE); k++) {
    const t = k / RATE
    const p = keyed(t)
    // The tugs on him so far: each jerking him and dying away, and dragging him on along the ground, for good.
    let dragged = 0
    for (const tug of DEATH_TUGS) {
      const at = tugAt(t - tug.at) * tug.hard
      p.yaw += TUG.yaw * tug.turn * at
      p.roll += TUG.roll * at
      p.neckRoll += (TUG.neckRoll * at) / BONES.neck.length
      p.rightWing += TUG.rightWing * at
      p.thigh += TUG.thigh * at
      dragged += t > tug.at ? TUG.drag * tug.hard * tug.turn * smooth(Math.min(1, (t - tug.at) / (TUG_RISE * 2))) : 0
    }
    body.position.copy(bodyAt)
    pose(body, [TURN_LEFT, p.yaw], [FORWARD, p.pitch], [OVER_LEFT, p.roll])
    pose(chest, [FORWARD, p.chest])
    for (const joint of neck) pose(joint, [FORWARD, p.neck], [OVER_LEFT, p.neckRoll])
    pose(head, [FORWARD, p.head], [OVER_LEFT, p.headRoll])
    for (const b of thighs) pose(b, [SWING, p.thigh])
    for (const b of shins) pose(b, [SWING, p.shin])
    for (const b of feet) pose(b, [SWING, p.foot])
    pose(leftWing, [OVER_LEFT, -p.leftWing])
    pose(rightWing, [OVER_LEFT, p.rightWing])
    // Set down so his lowest point is where it was standing, and pulled back under where his middle stood but for
    // DRIFT of how far his roll carried it; dragged along his length by the tugs.
    model.updateMatrixWorld(true)
    const slid = middleAt().sub(standing)
    move.set(-slid.x * (1 - DRIFT), ground - lowest(), -slid.z * (1 - DRIFT) + dragged)
    body.position.copy(bodyAt).add(move.applyMatrix3(intoParent))
    times.push(t)
    for (const [b, values] of turns) values.push(...b.quaternion.toArray())
    moves.push(...body.position.toArray())
  }

  const tracks: KeyframeTrack[] = still.map(({ track, at }) => {
    const [name, property] = track.name.split('.') as [string, string]
    const b = model.getObjectByName(name)
    if (b === body && property === 'position') return new VectorKeyframeTrack(track.name, times, moves)
    if (b && property === 'quaternion' && turns.has(b)) return new QuaternionKeyframeTrack(track.name, times, turns.get(b)!)
    const held = track.clone()
    held.times = new Float32Array([0])
    held.values = new Float32Array(at)
    return held
  })
  for (const [b, values] of turns) if (!tracks.some((track) => track.name === `${b.name}.quaternion`)) tracks.push(new QuaternionKeyframeTrack(`${b.name}.quaternion`, times, values))
  if (!tracks.some((track) => track.name === `${body.name}.position`)) tracks.push(new VectorKeyframeTrack(`${body.name}.position`, times, moves))
  return new AnimationClip('death', DEATH_ENDS, tracks)
}
