// The scripted camera shots (#185), blended in over the orbit and handed back
// to it. While the child crosses the pine the camera rises high and wide,
// behind him as the manor sees him and off to the side his roots are: it
// starts looking down into the ravine full of rats under him, and tilts up as
// he goes, so that by the far end it looks out over him to the manor's lit
// door. At the end, once he reaches the door, it stands on the lawn and looks
// at the door, to see him go in and the door shut.
//
// A shot never moves the orbit: the page works the orbit out as it always
// does and draws through a pose blended between the two, so once a shot has
// gone out the camera is the orbit exactly where the player left it. Nothing
// here draws: poses are plain points, the page hands them to its camera.
import { standingAt } from './heights'
import type { Point, Woods } from './woods'

/** A point in the world. */
export interface Vec3 {
  x: number
  y: number
  z: number
}

/** Where a camera stands, and the point it looks at. */
export interface Pose {
  position: Vec3
  target: Vec3
}

/** The pine shot: how far behind the child it stands, away from the manor, m; how high over him; and how far back along the pine, toward its roots. */
const BACK = 7
const HIGH = 5.5
const TRAIL = 1.5
/** How far from the pine's middle, toward the camera, the ravine's floor it looks down at lies, m: where the rats wait under it. */
const RAVINE_LOOK = 2.5
/** The end shot: how far in front of the door it stands, out over the lawn, m; how high; and how far east. */
const OUT = 10
const UP = 3.2
const ASIDE = 1.2
/** How high the door's middle is over its threshold, m. */
const DOOR_MIDDLE = 1.1

/** 0 to 1 and back, eased at both ends. */
const ease = (t: number) => {
  const c = Math.min(1, Math.max(0, t))
  return c * c * (3 - 2 * c)
}
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v.x, v.y, v.z) || 1
  return { x: v.x / l, y: v.y / l, z: v.z / l }
}
const toward = (from: Vec3, to: Vec3) => unit({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z })

/** The middle of the manor's door, where the child goes in. */
function doorOf(map: Woods): Vec3 {
  const exit = map.level.exit!
  return { x: exit.x, y: standingAt(map, exit.x, exit.z) + DOOR_MIDDLE, z: map.front.maxZ }
}

/** How far along the pine `p` is: 0 at its roots, 1 at its crown, past them off its ends. */
export function pineShare(map: Woods, p: Point): number {
  const { from, to } = map.pine
  const dx = to.x - from.x
  const dz = to.z - from.z
  return ((p.x - from.x) * dx + (p.z - from.z) * dz) / (dx * dx + dz * dz)
}

/**
 * The pine shot with the child `share` of the way along the pine, held at
 * its ends, his chest `y` m up: high over the ravine, behind him as the manor
 * sees him, framing him with the ravine's rats below at the start and with the
 * manor's door at the end.
 */
export function pineShot(map: Woods, share: number, y: number): Pose {
  const { from, to } = map.pine
  const s = Math.min(1, Math.max(0, share))
  const child = { x: from.x + (to.x - from.x) * s, y, z: from.z + (to.z - from.z) * s }
  const door = doorOf(map)
  const away = toward({ ...door, y: 0 }, { ...child, y: 0 })
  const along = toward({ ...from, y: 0 }, { ...to, y: 0 })
  const position = { x: child.x + away.x * BACK - along.x * TRAIL, y: y + HIGH, z: child.z + away.z * BACK - along.z * TRAIL }
  const below = { x: (from.x + to.x) / 2 + away.x * RAVINE_LOOK, y: -map.ravineFloor, z: (from.z + to.z) / 2 + away.z * RAVINE_LOOK }
  // Half way between the child and the ravine's rats to start, and between him and the door at the end.
  const toChild = toward(position, child)
  const near = unit(addTo(toChild, toward(position, below)))
  const far = unit(addTo(toChild, toward(position, door)))
  const k = ease(s)
  const look = unit({ x: near.x + (far.x - near.x) * k, y: near.y + (far.y - near.y) * k, z: near.z + (far.z - near.z) * k })
  const reach = Math.hypot(child.x - position.x, child.y - position.y, child.z - position.z)
  return { position, target: { x: position.x + look.x * reach, y: position.y + look.y * reach, z: position.z + look.z * reach } }
}

/** The end shot: on the lawn in front of the door, a little east and over the steps, looking at its middle. */
export function endShot(map: Woods): Pose {
  const door = doorOf(map)
  return { position: { x: door.x + ASIDE, y: door.y - DOOR_MIDDLE + UP, z: door.z + OUT }, target: door }
}

const addTo = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })

/** How far in a shot is, 0 the orbit to 1 the shot: it comes in over `seconds` while on, and goes out as long once off. */
export class ShotBlend {
  weight = 0

  constructor(private readonly seconds: number) {}

  /** `dt` s on, the shot on or off: the weight moved toward it. */
  update(dt: number, on: boolean): number {
    this.weight = Math.min(1, Math.max(0, this.weight + ((on ? 1 : -1) * dt) / this.seconds))
    return this.weight
  }

  /** The weight eased at both ends: what a pose is blended by, so the camera starts and stops gently. */
  get eased(): number {
    return ease(this.weight)
  }
}

/** `out` set `weight` of the way from `orbit` to `shot`: the orbit at 0, the shot at 1. */
export function blendPoses(orbit: Pose, shot: Pose, weight: number, out: Pose): Pose {
  for (const key of ['position', 'target'] as const) {
    const a = orbit[key]
    const b = shot[key]
    out[key].x = weight === 1 ? b.x : a.x + (b.x - a.x) * weight
    out[key].y = weight === 1 ? b.y : a.y + (b.y - a.y) * weight
    out[key].z = weight === 1 ? b.z : a.z + (b.z - a.z) * weight
  }
  return out
}
