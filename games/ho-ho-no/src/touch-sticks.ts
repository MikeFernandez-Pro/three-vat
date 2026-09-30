// The touch controls' rules, with no DOM: one move stick wherever the thumb
// lands, and Santa throws by himself, at the cadence the desktop's held
// button gives, at the nearest skeleton in reach (the prototype's scheme B,
// as Vampire Survivors plays). Fed contacts, it answers each frame with the
// plain input the keyboard and the mouse give (input.ts), so the simulation
// never learns there is a phone. The listeners and the drawing are
// touch-input.ts's.
//
// The camera looks down the arena from +z, so screen right is +x and screen
// down is +z: the stick's screen offset is the move as it stands.
import { AIM_HEIGHT, type Point, type SimulationInput, type Skeleton } from './simulation/simulation'

// The prototype's numbers, played in phone emulation: a start to tune from.
/** Pixels: the stick's offset clamps here. */
export const STICK_RADIUS = 60
/** Of the radius: under it, the stick is at rest. */
const DEAD_ZONE = 0.2
/** Units: how far Santa looks for a skeleton to throw at. */
const AUTO_RANGE = 14
/**
 * How many times faster than the original's ramp the horde spawns under these
 * controls: Santa aims himself, and at the keyboard and mouse's pace a run
 * barely ends.
 */
export const SPAWN_PACE = 1.5

export type ContactPhase = 'down' | 'move' | 'up' | 'cancel'

/** A point on the screen, in CSS pixels. */
export interface ScreenPoint {
  readonly x: number
  readonly y: number
}

/** One pointer, as a pointer event reports it: its id, and where it is. */
export interface Contact extends ScreenPoint {
  readonly id: number
}

/** What the controls need of the run: where Santa stands, and the horde. The simulation is one. */
export interface TouchRun {
  readonly santa: { readonly position: { readonly x: number; readonly z: number } }
  readonly skeletons: readonly Pick<Skeleton, 'state' | 'position'>[]
}

/** The thumb down, as it is drawn: where it landed, and how far it is pushed from there, clamped. */
export interface Stick {
  readonly id: number
  readonly origin: ScreenPoint
  readonly offset: ScreenPoint
}

export class TouchSticks {
  private held: Stick | null = null

  constructor(private readonly run: TouchRun) {}

  /** The stick down, for drawing. */
  get stick(): Stick | null {
    return this.held
  }

  touch(phase: ContactPhase, contact: Contact): void {
    if (phase === 'down') {
      // The first thumb down is the stick until it lifts; a second is ignored.
      this.held ??= { id: contact.id, origin: { x: contact.x, y: contact.y }, offset: { x: 0, y: 0 } }
      return
    }
    if (this.held?.id !== contact.id) return
    if (phase === 'move') this.held = { ...this.held, offset: clamped(this.held.origin, contact) }
    else this.held = null
  }

  /** The page lost focus: the thumb is let go. */
  letGo(): void {
    this.held = null
  }

  /** This frame's input. */
  sample(): SimulationInput {
    const move = { x: 0, z: 0 }
    if (this.held && pastDeadZone(this.held.offset)) {
      move.x = this.held.offset.x / STICK_RADIUS
      move.z = this.held.offset.y / STICK_RADIUS
    }
    const target = this.nearest()
    if (target) return { move, aim: target, fire: true }
    // Nothing to throw at: he faces the way he walks, or where he last faced.
    const { x, z } = this.run.santa.position
    const walking = move.x !== 0 || move.z !== 0
    return { move, aim: walking ? { x: x + move.x, y: AIM_HEIGHT, z: z + move.z } : null, fire: false }
  }

  /** The nearest skeleton rising or walking within reach, on the aim plane, or null. */
  private nearest(): Point | null {
    const santa = this.run.santa.position
    let best = AUTO_RANGE
    let aim: Point | null = null
    for (const { state, position } of this.run.skeletons) {
      if (state !== 'rising' && state !== 'walking') continue
      const distance = Math.hypot(position.x - santa.x, position.z - santa.z)
      if (distance < best) {
        best = distance
        aim = { x: position.x, y: AIM_HEIGHT, z: position.z }
      }
    }
    return aim
  }
}

/** The thumb at `at`, from `origin`, clamped to the stick's rim. */
function clamped(origin: ScreenPoint, at: ScreenPoint): ScreenPoint {
  const x = at.x - origin.x
  const y = at.y - origin.y
  const scale = Math.min(1, STICK_RADIUS / (Math.hypot(x, y) || 1))
  return { x: x * scale, y: y * scale }
}

const pastDeadZone = ({ x, y }: ScreenPoint) => Math.hypot(x, y) > DEAD_ZONE * STICK_RADIUS
