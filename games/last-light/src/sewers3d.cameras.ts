// PROTOTYPE: camera rigs for the sewers in 3D (2026-10-13), to try one
// against another on `sewers-3d.html`, switched with C or the panel: the
// attached camera the page settled on (sewers3d.camera.ts), and the five it
// was chosen over, brought back to compare. Each places the camera every frame
// from the child as he stands, and says how the keys are read: `tank`, A and
// D turning him, W and S walking him the way he faces; or `camera`, the keys
// walking him up, down and across the screen, the way the camera looks.
//
// Yaw: 0 looks north; the way it looks on the ground is (sin yaw, -cos yaw),
// its right (cos yaw, sin yaw). x east, z south.
//
// The ones that ride near him keep out of the stone: rays cast from his
// shoulders back to where the camera wants to be bring it in at once short
// of the nearest wall or door, and it goes back out at its `back` rate.
//
// Every lerp is a rate, per s, in the rig's tunings: the higher, the
// tighter; 0, none, the camera where it is asked at once. `follow` eases
// where it follows him to, `turn` its turning, `back` its way back out from
// a wall; the fixed cameras' `track` eases their look, `move` their glide
// from one place to the next, 0 a cut.
import { MathUtils, PerspectiveCamera, Raycaster, Vector3, type Object3D } from 'three'
import type { Point } from './sewers'
import type { Bounds } from './swarm'
import { AttachedCamera, framing, limitPitch, limitYaw, offset, type Framing, type Pointer, type Subject as Placed } from './sewers3d.camera'

export type { Framing, Pointer }

/** The child as the camera reads him: where he stands (y his feet), the way his body faces, whether the keys move him. */
export interface Subject extends Placed {
  moving: boolean
}

/** A rig's tunings, as the panel shows them: each a number with its range, or a switch. */
export type Tunings = Record<string, number | boolean>
export type Ranges = Record<string, [number, number, number]>

export interface CameraRig {
  readonly name: string
  readonly controls: 'tank' | 'camera'
  /** What its mouse and its own keys do, for the page's key line. */
  readonly help: string
  readonly tunings: Tunings
  readonly ranges: Ranges
  /** Where its view sits on him and how far it may turn, the panel's framing for it. */
  readonly framing: Framing
  /** The framing it heeds, for the panel; all of it if none said. */
  readonly framed?: readonly (keyof Framing)[]
  /** Whether it wants the pointer locked to the page while it is on. */
  readonly locksPointer?: boolean
  /** Starting again, or switched to: settle round him at once. */
  snap(subject: Subject): void
  /** The yaw the keys are read by, `camera` controls: `moving` says whether a key is held. */
  inputYaw(moving: boolean): number
  /** A key of its own: true if it took it. */
  key?(code: string): boolean
  update(dt: number, subject: Subject, pointer: Pointer, camera: PerspectiveCamera): void
  /** What it is doing, for the page's readout. */
  readonly status?: string
}

/** How far a lerp at `rate` per s goes in `dt`: all the way at a rate of 0, none asked. */
const ease = (rate: number, dt: number) => (rate <= 0 ? 1 : 1 - Math.exp(-rate * dt))
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const yawOf = (dir: Vector3) => Math.atan2(dir.x, -dir.z)

/** The stone the camera keeps out of: rays against it. */
export class Stone {
  private readonly ray = new Raycaster()
  private readonly from = new Vector3()
  private readonly side = new Vector3()
  /** How near the stone the camera may come, m. */
  margin = 0.25

  constructor(private readonly blockers: Object3D[]) {}

  /** How far from `pivot` along the unit `dir` the camera may stand, up to `want`: five rays, a cross as wide as the near plane. */
  free(pivot: Vector3, dir: Vector3, want: number): number {
    this.side.set(-dir.z, 0, dir.x).normalize()
    let free = want
    this.ray.far = want + this.margin
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      this.from.copy(pivot).addScaledVector(this.side, dx * 0.18)
      this.from.y += dy * 0.12
      this.ray.set(this.from, dir)
      const hit = this.ray.intersectObjects(this.blockers, false)[0]
      if (hit) free = Math.min(free, hit.distance - this.margin)
    }
    return Math.max(0.3, free)
  }

  /** Whether nothing stands between `a` and `b`. */
  sees(a: Vector3, b: Vector3): boolean {
    const d = b.clone().sub(a)
    const l = d.length()
    this.ray.set(a, d.divideScalar(l))
    this.ray.far = l - 0.2
    return this.ray.intersectObjects(this.blockers, false).length === 0
  }
}

/** What every rig that rides behind him shares: a pivot eased after him, a boom brought in short of the stone. */
abstract class Boom {
  readonly pivot = new Vector3()
  readonly framing = framing()
  protected readonly wanted = new Vector3()
  protected readonly back = new Vector3()
  protected yaw = 0
  protected pitch = 0.3
  protected distance = 3
  near = 3

  constructor(protected readonly stone: Stone) {}

  /** Place the camera `want` m back from the pivot at the rig's yaw and pitch, or as near as the stone lets it, back out at `back` per s, looking at `look`. */
  protected place(dt: number, want: number, back: number, camera: PerspectiveCamera, look = this.pivot): void {
    const s = Math.sin(this.yaw)
    const c = Math.cos(this.yaw)
    this.back.set(-s * Math.cos(this.pitch), Math.sin(this.pitch), c * Math.cos(this.pitch))
    const free = this.stone.free(this.pivot, this.back, want)
    this.distance = free < this.distance ? free : this.distance + (free - this.distance) * ease(back, dt)
    camera.position.copy(this.pivot).addScaledVector(this.back, this.distance)
    camera.lookAt(look)
    offset(camera, this.framing)
    this.near = this.distance
  }
}

/** 1. Fixed behind him, the page's own (sewers3d.camera.ts): tank keys, the camera turning as he turns, never kept out of the stone. */
export class Attached implements CameraRig {
  readonly name = 'attached (tank)'
  readonly controls = 'tank' as const
  readonly help = 'A / D turn him and the camera, W / S walk · drag tilt · right-drag move · wheel distance'
  private readonly camera = new AttachedCamera()
  readonly tunings = this.camera.tunings
  readonly ranges: Ranges = this.camera.ranges
  readonly framing = this.camera.framing

  snap(): void {
    this.camera.snap()
  }

  inputYaw(): number {
    return 0
  }

  update(dt: number, subject: Subject, pointer: Pointer, camera: PerspectiveCamera): void {
    this.camera.update(subject, pointer, camera, dt)
  }
}

/** 2. Over the shoulder, the mouse looking round: a modern action game's, the keys the way the camera looks. */
export class Shoulder extends Boom implements CameraRig {
  readonly name = 'over the shoulder (mouse look)'
  readonly controls = 'camera' as const
  readonly locksPointer = true
  readonly help = 'click to lock the mouse, mouse looks round, Esc frees it · WASD the way the camera looks · wheel distance'
  readonly tunings = { distance: 2.4, shoulder: 0.45, height: 1.3, follow: 14, turn: 0, back: 3, sensitivity: 1, lookAhead: 0 }
  readonly ranges: Ranges = { distance: [1, 8, 0.1], shoulder: [-1, 1, 0.05], height: [0.5, 2.5, 0.05], follow: [0, 40, 0.5], turn: [0, 40, 0.5], back: [0, 20, 0.5], sensitivity: [0.2, 3, 0.05], lookAhead: [0, 3, 0.1] }
  /** Where the mouse has turned it; the camera turns after at `turn`. */
  private aimYaw = 0
  private aimPitch = 0.2
  private readonly head = new Vector3()
  private readonly across = new Vector3()
  private readonly ahead = new Vector3()

  snap(subject: Subject): void {
    this.yaw = this.aimYaw = subject.yaw
    this.pitch = this.aimPitch = 0.2
    this.head.set(subject.x, subject.y + this.tunings.height, subject.z)
    this.pivot.copy(this.head)
    this.distance = this.tunings.distance
  }

  inputYaw(): number {
    return this.yaw
  }

  update(dt: number, subject: Subject, pointer: Pointer, camera: PerspectiveCamera): void {
    const t = this.tunings
    this.aimYaw = limitYaw(this.aimYaw + pointer.dx * 0.0025 * t.sensitivity, subject.yaw, this.framing)
    this.aimPitch = limitPitch(MathUtils.clamp(this.aimPitch + pointer.dy * 0.0025 * t.sensitivity, -0.5, 1.2), this.framing)
    this.yaw += (this.aimYaw - this.yaw) * ease(t.turn, dt)
    this.pitch += (this.aimPitch - this.pitch) * ease(t.turn, dt)
    t.distance = MathUtils.clamp(t.distance * Math.exp(pointer.wheel * 0.001), 1, 8)
    this.wanted.set(subject.x, subject.y + t.height, subject.z)
    this.head.lerp(this.wanted, ease(t.follow, dt))
    // The shoulder: the pivot moved off to his right, as far as the stone lets it.
    this.across.set(Math.cos(this.yaw), 0, Math.sin(this.yaw)).multiplyScalar(Math.sign(t.shoulder) || 1)
    const off = Math.abs(t.shoulder) > 0 ? Math.min(Math.abs(t.shoulder), this.stone.free(this.head, this.across, Math.abs(t.shoulder))) : 0
    this.pivot.copy(this.head).addScaledVector(this.across, off)
    this.ahead.set(Math.sin(this.yaw), 0, -Math.cos(this.yaw)).multiplyScalar(t.lookAhead).add(this.pivot)
    this.place(dt, t.distance, t.back, camera, this.ahead)
  }
}

/**
 * 3. Lazy follow: the camera trails him and turns by itself behind the way he
 * walks, slowly, never while he walks at it; dragging turns it by hand, and
 * it waits a moment after. A Plague Tale's or an Uncharted's walking camera.
 */
export class Lazy extends Boom implements CameraRig {
  readonly name = 'lazy follow (turns behind him)'
  readonly controls = 'camera' as const
  readonly help = 'WASD the way the camera looks · it turns behind him by itself · drag turn / tilt · wheel distance'
  readonly tunings = { distance: 4.2, pitch: 0.5, height: 1, follow: 5, turn: 10, steer: 1.2, wait: 1.5, back: 3 }
  readonly ranges: Ranges = { distance: [1.5, 14, 0.1], pitch: [-0.1, 1.4, 0.01], height: [0.3, 2.5, 0.05], follow: [0, 30, 0.5], turn: [0, 40, 0.5], steer: [0, 6, 0.1], wait: [0, 5, 0.1], back: [0, 20, 0.5] }
  private handled = 99
  /** Where the hand and the steering have turned it; the camera turns after at `turn`. */
  private aim = 0

  snap(subject: Subject): void {
    this.yaw = this.aim = subject.yaw
    this.pitch = this.tunings.pitch
    this.pivot.set(subject.x, subject.y + this.tunings.height, subject.z)
    this.distance = this.tunings.distance
  }

  inputYaw(): number {
    return this.yaw
  }

  update(dt: number, subject: Subject, pointer: Pointer, camera: PerspectiveCamera): void {
    const t = this.tunings
    if (pointer.dx !== 0 || pointer.dy !== 0) this.handled = 0
    else this.handled += dt
    this.aim += pointer.dx * 0.006
    t.pitch = limitPitch(MathUtils.clamp(t.pitch + pointer.dy * 0.004, -0.1, 1.4), this.framing)
    t.distance = MathUtils.clamp(t.distance * Math.exp(pointer.wheel * 0.001), 1.5, 14)
    // Behind the way he walks, by as much as he walks across the camera's look; never round when he comes at it.
    if (subject.moving && this.handled > t.wait) {
      const turn = wrap(subject.yaw - this.aim)
      if (Math.abs(turn) < 2.2) this.aim += turn * ease(t.steer, dt) * Math.min(1, Math.abs(Math.sin(turn)) * 2 + 0.3)
    }
    this.aim = limitYaw(this.aim, subject.yaw, this.framing)
    this.yaw += (this.aim - this.yaw) * ease(t.turn, dt)
    this.wanted.set(subject.x, subject.y + t.height, subject.z)
    this.pivot.lerp(this.wanted, ease(t.follow, dt))
    this.pitch += (t.pitch - this.pitch) * ease(t.turn, dt)
    this.place(dt, t.distance, t.back, camera)
  }
}

/** 4. High over him at a fixed angle, the keys the screen's: Q and E turn the view a quarter round. */
export class TopDown implements CameraRig {
  readonly name = 'top-down 3/4 (fixed angle)'
  readonly controls = 'camera' as const
  readonly help = 'WASD up, down, across the screen · Q / E turn the view a quarter · drag tilt · wheel distance'
  readonly tunings = { distance: 9, pitch: 1, follow: 6, turn: 8, fov: 40 }
  readonly ranges: Ranges = { distance: [3, 30, 0.1], pitch: [0.4, 1.5, 0.01], follow: [0, 30, 0.5], turn: [0, 40, 0.5], fov: [20, 70, 1] }
  readonly framing = framing()
  /** Its turn is the screen's, Q and E, never his. */
  readonly framed = ['right', 'up', 'minPolar', 'maxPolar'] as const
  private readonly pivot = new Vector3()
  private readonly wanted = new Vector3()
  private yaw = 0
  private aim = 0
  near = 9

  snap(subject: Subject): void {
    this.pivot.set(subject.x, subject.y + 0.6, subject.z)
    this.yaw = this.aim
  }

  inputYaw(): number {
    return this.aim
  }

  key(code: string): boolean {
    if (code === 'KeyQ') this.aim -= Math.PI / 2
    else if (code === 'KeyE') this.aim += Math.PI / 2
    else return false
    return true
  }

  update(dt: number, subject: Subject, pointer: Pointer, camera: PerspectiveCamera): void {
    const t = this.tunings
    t.pitch = limitPitch(MathUtils.clamp(t.pitch + pointer.dy * 0.004, 0.4, 1.5), this.framing)
    t.distance = MathUtils.clamp(t.distance * Math.exp(pointer.wheel * 0.001), 3, 30)
    this.yaw += (this.aim - this.yaw) * ease(t.turn, dt)
    this.wanted.set(subject.x, subject.y + 0.6, subject.z)
    this.pivot.lerp(this.wanted, ease(t.follow, dt))
    const s = Math.sin(this.yaw)
    const c = Math.cos(this.yaw)
    camera.position.set(this.pivot.x - s * Math.cos(t.pitch) * t.distance, this.pivot.y + Math.sin(t.pitch) * t.distance, this.pivot.z + c * Math.cos(t.pitch) * t.distance)
    camera.lookAt(this.pivot)
    offset(camera, this.framing)
    if (camera.fov !== t.fov) {
      camera.fov = t.fov
      camera.updateProjectionMatrix()
    }
    this.near = t.distance
  }
}

/**
 * 5. Fixed cameras, as the old survival games: a camera high on the stone
 * looking at him from where it hangs, cut to another when it loses sight of
 * him or he walks too far. The places are laid every few metres over the
 * floor, under the wall tops; a cut keeps the one that sees him from behind
 * or aside, at about `ideal` m. The keys keep the way the last camera read
 * them until let go, so a cut never turns him round.
 */
export class Fixed implements CameraRig {
  readonly name = 'fixed cameras (old survival)'
  readonly controls = 'camera' as const
  readonly help = 'WASD the way the camera looks, kept through a cut until let go · cuts by themselves'
  readonly tunings = { ideal: 6, furthest: 11, height: 3.1, track: 6, move: 0, fov: 55 }
  readonly ranges: Ranges = { ideal: [2, 12, 0.5], furthest: [4, 20, 0.5], height: [1.5, 3.4, 0.05], track: [0, 30, 0.5], move: [0, 20, 0.5], fov: [30, 80, 1] }
  readonly framing = framing()
  /** It hangs where it hangs and looks at him: only moved off him. */
  readonly framed = ['right', 'up'] as const
  /** Where the camera stands now: at its place, or gliding there at `move`. */
  private readonly standing = new Vector3()
  private placed = false
  private at = -1
  private readonly look = new Vector3()
  private readonly chest = new Vector3()
  private readonly spot = new Vector3()
  private readonly dir = new Vector3()
  private held = 0
  private checked = 0
  near = 6

  constructor(
    private readonly stone: Stone,
    /** Where cameras may hang, on the floor's plan. */
    private readonly places: Point[],
  ) {}

  snap(subject: Subject): void {
    this.at = -1
    this.placed = false
    this.look.set(subject.x, subject.y + 0.8, subject.z)
  }

  inputYaw(moving: boolean): number {
    return moving ? this.held : this.yawNow
  }

  private yawNow = 0

  update(dt: number, subject: Subject, _pointer: Pointer, camera: PerspectiveCamera): void {
    const t = this.tunings
    this.chest.set(subject.x, subject.y + 0.8, subject.z)
    this.checked -= dt
    if (this.checked <= 0 || this.at < 0) {
      this.checked = 0.15
      const p = this.at >= 0 ? this.places[this.at]! : undefined
      const keep = p && Math.hypot(p.x - subject.x, p.z - subject.z) <= t.furthest && this.stone.sees(this.spot.set(p.x, t.height, p.z), this.chest)
      if (!keep) {
        let best = -1
        let score = Infinity
        const fx = Math.sin(subject.yaw)
        const fz = -Math.cos(subject.yaw)
        this.places.forEach((q, k) => {
          const dx = q.x - subject.x
          const dz = q.z - subject.z
          const d = Math.hypot(dx, dz)
          if (d < 2 || d > t.furthest) return
          // Ahead of him counts against it: the camera should see where he goes, from behind or aside.
          const s = Math.abs(d - t.ideal) + Math.max(0, (dx * fx + dz * fz) / d) * 4
          if (s >= score) return
          if (!this.stone.sees(this.spot.set(q.x, t.height, q.z), this.chest)) return
          best = k
          score = s
        })
        if (best >= 0 && best !== this.at) {
          this.at = best
          // A cut, with no glide: the camera looks at him at once.
          if (t.move <= 0) this.look.copy(this.chest)
        }
      }
    }
    const p = this.at >= 0 ? this.places[this.at]! : { x: subject.x, z: subject.z + 4 }
    this.spot.set(p.x, t.height, p.z)
    if (!this.placed) {
      this.standing.copy(this.spot)
      this.placed = true
    }
    this.standing.lerp(this.spot, ease(t.move, dt))
    camera.position.copy(this.standing)
    this.look.lerp(this.chest, ease(t.track, dt))
    camera.lookAt(this.look)
    offset(camera, this.framing)
    if (camera.fov !== t.fov) {
      camera.fov = t.fov
      camera.updateProjectionMatrix()
    }
    camera.getWorldDirection(this.dir)
    this.yawNow = yawOf(this.dir)
    if (!subject.moving) this.held = this.yawNow
    this.near = camera.position.distanceTo(this.chest)
  }
}

/**
 * How the camera under the vault frames a part of the run: inside `area`, it
 * looks `yaw` (0 north, east a quarter turn; none, behind the way he walks),
 * tilted down `pitch`, from `distance` m, blended in across `soft` m inside
 * the area's edge. Radians and metres.
 */
export interface CameraHint {
  name: string
  area: Bounds
  yaw?: number
  pitch: number
  distance: number
  soft?: number
}

/**
 * The sewers' framings, part by part, on sewers.ts's plan as it stood
 * (2026-10-13): low and along the way where the way leads on, high where
 * something must be read, from above at the ladder.
 */
export const SEWER_HINTS: CameraHint[] = [
  { name: 'collector', area: { minX: -2.5, maxX: 2.5, minZ: -3, maxZ: 16.5 }, yaw: 0, pitch: 0.5, distance: 4 },
  { name: 'hub', area: { minX: -8, maxX: 8, minZ: -19.2, maxZ: -3.2 }, yaw: 0, pitch: 0.8, distance: 6, soft: 3 },
  { name: 'gas branch', area: { minX: -34.05, maxX: -8, minZ: -12.8, maxZ: -9.6 }, pitch: 1, distance: 4 },
  { name: 'chandelier gallery', area: { minX: 8, maxX: 39.7, minZ: -13.2, maxZ: -9.2 }, yaw: Math.PI / 2, pitch: 0.45, distance: 5 },
  { name: 'canal', area: { minX: -2.25, maxX: 2.25, minZ: -43.75, maxZ: -19.4 }, yaw: 0, pitch: 0.45, distance: 4 },
  { name: 'cistern', area: { minX: -2.5, maxX: 11.5, minZ: -57.75, maxZ: -43.75 }, pitch: 0.8, distance: 6, soft: 2 },
  { name: 'rush', area: { minX: 2.4, maxX: 6, minZ: -69.5, maxZ: -57.75 }, yaw: 0, pitch: 0.5, distance: 4 },
  { name: 'ladder', area: { minX: 2.4, maxX: 6, minZ: -72, maxZ: -69.5 }, yaw: 0, pitch: 1.35, distance: 2.5, soft: 0.6 },
]

/**
 * 6. Under the vault, framed by the level: a follow camera that never leaves
 * the ways, the walls keeping it in, each part of the run
 * giving it its own framing (SEWER_HINTS): low along the
 * collector, wide over the hub, high over the gas, along the chandeliers,
 * from above at the ladder. Where a part says no
 * yaw, it turns behind the way he walks, as the lazy camera. Dragging turns
 * and tilts it by hand for a while; the wheel brings every framing in or out.
 */
export class Vault extends Boom implements CameraRig {
  readonly name = 'under the vault (framed per area)'
  readonly controls = 'camera' as const
  readonly help = 'WASD the way the camera looks · each part of the run framed by the level · drag turn / tilt for a while · wheel nearer / further'
  readonly tunings = { distance: 4, pitch: 0.5, height: 1, follow: 6, turn: 2.5, frame: 1.5, steer: 1.2, wait: 2, back: 3, hints: true }
  readonly ranges: Ranges = {
    distance: [1.5, 12, 0.1],
    pitch: [-0.1, 1.5, 0.01],
    height: [0.3, 2.5, 0.05],
    follow: [0, 30, 0.5],
    turn: [0, 30, 0.5],
    frame: [0, 20, 0.5],
    steer: [0, 6, 0.1],
    wait: [0, 6, 0.1],
    back: [0, 20, 0.5],
  }
  /** The part of the run framing it now, and how much. */
  status = ''
  private aim = 0
  private handled = 99
  private zoom = 1
  private tilt = 0
  private want = 4

  constructor(
    stone: Stone,
    private readonly hints: CameraHint[],
  ) {
    super(stone)
  }

  snap(subject: Subject): void {
    const { hint, w } = this.area(subject)
    this.aim = this.yaw = hint?.yaw !== undefined && w > 0.5 ? hint.yaw : subject.yaw
    this.pitch = this.tunings.pitch + (hint ? (hint.pitch - this.tunings.pitch) * w : 0)
    this.want = this.distance = this.tunings.distance + (hint ? (hint.distance - this.tunings.distance) * w : 0)
    this.pivot.set(subject.x, subject.y + this.tunings.height, subject.z)
    this.handled = 99
    this.tilt = 0
  }

  inputYaw(): number {
    return this.yaw
  }

  /** The part of the run framing him most where he stands, and how much, 0 to 1 across its soft edge. */
  private area(subject: Subject): { hint: CameraHint | undefined; w: number } {
    let hint: CameraHint | undefined
    let w = 0
    if (!this.tunings.hints) return { hint, w }
    for (const h of this.hints) {
      const a = h.area
      const edge = Math.min(subject.x - a.minX, a.maxX - subject.x, subject.z - a.minZ, a.maxZ - subject.z)
      const soft = h.soft ?? 1.5
      const v = edge <= 0 ? 0 : edge >= soft ? 1 : MathUtils.smoothstep(edge, 0, soft)
      if (v > w) {
        w = v
        hint = h
      }
    }
    return { hint, w }
  }

  update(dt: number, subject: Subject, pointer: Pointer, camera: PerspectiveCamera): void {
    const t = this.tunings
    if (pointer.dx !== 0 || pointer.dy !== 0) this.handled = 0
    else this.handled += dt
    this.aim += pointer.dx * 0.006
    this.tilt = MathUtils.clamp(this.tilt + pointer.dy * 0.004, -0.8, 0.8)
    // The hand's tilt wears off once it lets go.
    if (this.handled > t.wait) this.tilt *= 1 - ease(t.turn, dt)
    this.zoom = MathUtils.clamp(this.zoom * Math.exp(pointer.wheel * 0.001), 0.3, 3)

    const { hint, w } = this.area(subject)
    this.status = hint && w > 0 ? `${hint.name} ${(w * 100).toFixed(0)}%` : 'free'
    const pitch = t.pitch + (hint ? (hint.pitch - t.pitch) * w : 0)
    const distance = t.distance + (hint ? (hint.distance - t.distance) * w : 0)
    this.pitch += (limitPitch(MathUtils.clamp(pitch + this.tilt, -0.1, 1.5), this.framing) - this.pitch) * ease(t.frame, dt)
    this.want += (distance * this.zoom - this.want) * ease(t.frame, dt)

    // Its yaw: the part's, as much as he is in it; else behind the way he walks; the hand first, for a while.
    if (this.handled > t.wait) {
      if (hint?.yaw !== undefined && w > 0) this.aim += wrap(hint.yaw - this.aim) * ease(t.frame, dt) * w
      else if (subject.moving) {
        const turn = wrap(subject.yaw - this.aim)
        if (Math.abs(turn) < 2.2) this.aim += turn * ease(t.steer, dt) * Math.min(1, Math.abs(Math.sin(turn)) * 2 + 0.3)
      }
    }
    this.aim = limitYaw(this.aim, subject.yaw, this.framing)
    this.yaw += wrap(this.aim - this.yaw) * ease(t.turn, dt)

    this.wanted.set(subject.x, subject.y + t.height, subject.z)
    this.pivot.lerp(this.wanted, ease(t.follow, dt))
    this.place(dt, this.want, t.back, camera)
  }
}
