// PROTOTYPE: the sewers' 3D camera (2026-10-13), `sewers-3d.html`: fixed
// behind the child, turning as he turns, the keys a tank's. Chosen over five
// others tried the same day (over the shoulder, lazy follow, top-down, fixed
// cameras, framed per area under the vault).
//
// Yaw: 0 looks north; the way it looks on the ground is (sin yaw, -cos yaw),
// its right (cos yaw, sin yaw). x east, z south.
//
// Placed by the panel: how far back, how high, how far down it looks, off
// his shoulder and aimed ahead of him, its field of view. Two lags ease it
// after him, each a time constant, 0 rigid: where it stands, and how it turns
// as he turns. Nothing moves it out of the stone; the page dithers away
// whatever stands between it and him.
import { MathUtils, PerspectiveCamera, Vector3 } from 'three'

/** The child as the camera reads him: where he stands, y his feet, and the way his body faces. */
export interface Subject {
  x: number
  y: number
  z: number
  yaw: number
}

/** This frame's mouse: what the left button dragged, px, which tilts it; what the right dragged, px, which moves it; the wheel's turns. */
export interface Pointer {
  dx: number
  dy: number
  panX: number
  panY: number
  wheel: number
}

/**
 * Where any camera's view sits on him and how far it may turn, its own in the
 * panel: the view moved along its own right and up, m, him off centre the
 * other way; and, as OrbitControls' azimuth and polar ranges, degrees, the
 * way round him it may turn, 0 behind him, below 0 to his left, and its polar
 * angle over him, 0 straight down on him, 90 level, past 90 from under.
 */
export interface Framing {
  right: number
  up: number
  minAzimuth: number
  maxAzimuth: number
  minPolar: number
  maxPolar: number
}

export const framing = (): Framing => ({ right: 0, up: 0, minAzimuth: -180, maxAzimuth: 180, minPolar: 0, maxPolar: 180 })
export const FRAMING_RANGES: Record<keyof Framing, [number, number, number]> = {
  right: [-3, 3, 0.05],
  up: [-3, 3, 0.05],
  minAzimuth: [-180, 180, 1],
  maxAzimuth: [-180, 180, 1],
  minPolar: [0, 180, 1],
  maxPolar: [0, 180, 1],
}

/** `yaw` kept within the framing's azimuth range round `from`, the way he faces: his right is the way yaw grows. */
export function limitYaw(yaw: number, from: number, f: Framing): number {
  let off = yaw - from
  off -= Math.PI * 2 * Math.round(off / (Math.PI * 2))
  const min = MathUtils.degToRad(Math.min(f.minAzimuth, f.maxAzimuth))
  const max = MathUtils.degToRad(Math.max(f.minAzimuth, f.maxAzimuth))
  return off < min ? from + min : off > max ? from + max : yaw
}

/** A tilt, rad, looking down above 0, kept within the framing's polar range: the polar angle is a quarter turn less the tilt. */
export const limitPitch = (pitch: number, f: Framing): number => {
  const a = MathUtils.degToRad(90 - f.minPolar)
  const b = MathUtils.degToRad(90 - f.maxPolar)
  return MathUtils.clamp(pitch, Math.min(a, b), Math.max(a, b))
}

/** The placed camera moved along its own right and up: what it looks at moves with it. */
export function offset(camera: PerspectiveCamera, f: Framing): void {
  camera.translateX(f.right)
  camera.translateY(f.up)
}

export class AttachedCamera {
  readonly framing = framing()
  /**
   * How far back, m; how far down it looks, rad; the pivot's height over his
   * feet, m; how far to his right it stands, m, left below 0; how far ahead of
   * him it aims, m; its vertical field of view, degrees; and its two lags, s:
   * where it stands easing after him, and its turn after his.
   */
  readonly tunings = { distance: 3, pitch: 0.32, height: 1.15, side: 0, ahead: 0, fov: 50, follow: 0, turn: 0 }
  readonly ranges: Record<keyof AttachedCamera['tunings'], [number, number, number]> = {
    distance: [1.2, 12, 0.1],
    pitch: [-0.1, 1.3, 0.01],
    height: [0.2, 4, 0.05],
    side: [-4, 4, 0.05],
    ahead: [-2, 4, 0.05],
    fov: [25, 90, 1],
    follow: [0, 1, 0.01],
    turn: [0, 1.5, 0.01],
  }

  /** Where it follows and the way it faces, eased after him; NaN, at him at once. */
  private readonly followed = new Vector3(Number.NaN)
  private yaw = Number.NaN
  private readonly pivot = new Vector3()
  private readonly aim = new Vector3()
  private readonly back = new Vector3()

  /** Put it on him at once, the next frame, its lags skipped: after a restart. */
  snap(): void {
    this.followed.x = Number.NaN
    this.yaw = Number.NaN
  }

  update(subject: Subject, pointer: Pointer, camera: PerspectiveCamera, dt: number): void {
    const t = this.tunings
    t.pitch = limitPitch(MathUtils.clamp(t.pitch + pointer.dy * 0.004, -0.1, 1.3), this.framing)
    t.distance = MathUtils.clamp(t.distance * Math.exp(pointer.wheel * 0.001), 1.2, 12)
    // Moved with the right button: the pivot off his shoulder and up or down, the further back the faster, so what
    // is under the mouse stays roughly under it; the panel's own values, so a place found can be copied.
    const perPixel = (t.distance * 2 * Math.tan(MathUtils.degToRad(t.fov) / 2)) / Math.max(1, innerHeight)
    t.side = MathUtils.clamp(t.side - pointer.panX * perPixel, ...this.ranges.side.slice(0, 2) as [number, number])
    t.height = MathUtils.clamp(t.height + pointer.panY * perPixel, ...this.ranges.height.slice(0, 2) as [number, number])
    // The same share of the gap a second whatever the frame rate.
    const ease = (lag: number) => (lag > 0 ? 1 - Math.exp(-dt / lag) : 1)
    if (Number.isNaN(this.followed.x)) {
      this.followed.set(subject.x, subject.y, subject.z)
      this.yaw = subject.yaw
    } else {
      this.followed.lerp(this.pivot.set(subject.x, subject.y, subject.z), ease(t.follow))
      let turn = subject.yaw - this.yaw
      turn -= Math.PI * 2 * Math.round(turn / (Math.PI * 2))
      this.yaw = limitYaw(this.yaw + turn * ease(t.turn), subject.yaw, this.framing)
    }
    const s = Math.sin(this.yaw)
    const c = Math.cos(this.yaw)
    this.pivot.copy(this.followed).setY(this.followed.y + t.height)
    // Off his shoulder along its right, and aimed ahead along the way it looks.
    this.pivot.x += c * t.side
    this.pivot.z += s * t.side
    this.aim.set(this.pivot.x + s * t.ahead, this.pivot.y, this.pivot.z - c * t.ahead)
    this.back.set(-s * Math.cos(t.pitch), Math.sin(t.pitch), c * Math.cos(t.pitch))
    camera.position.copy(this.pivot).addScaledVector(this.back, t.distance)
    if (camera.fov !== t.fov) {
      camera.fov = t.fov
      camera.updateProjectionMatrix()
    }
    camera.lookAt(this.aim)
    offset(camera, this.framing)
  }
}
