// The touch controls' rules, with no DOM: Brawl Stars's scheme, chosen on the
// game's own page against four others (#132). A thumb down on the left half
// is a move stick wherever it lands; a thumb down on the right half, tapped,
// throws once at the nearest skeleton in reach, and dragged, aims by hand and
// throws for as long as it is held. Fed contacts, it answers each frame with
// the plain input the keyboard and the mouse give (input.ts), so the
// simulation never learns there is a phone. The listeners and the drawing are
// touch-input.ts's.
//
// The camera looks down the arena from +z, so screen right is +x and screen
// down is +z: a stick's screen offset is the move as it stands.
import { AIM_HEIGHT, type Point, type SimulationInput, type Skeleton } from './simulation/simulation'

// The prototype's numbers, played in phone emulation: a start to tune from.
/** Pixels: a stick's offset clamps here. */
export const STICK_RADIUS = 60
/** Of the radius: under it, a stick is at rest. */
const DEAD_ZONE = 0.2
/** Units: how far a tap looks for a skeleton. */
const AUTO_RANGE = 14
/** Milliseconds: a throw thumb up this soon, never dragged past the dead zone, was a tap. */
const TAP_TIME = 250
/** Units: how far from Santa a drag's aim point is put. Only its direction counts. */
const DRAG_REACH = 10

export type ContactPhase = 'down' | 'move' | 'up' | 'cancel'

/** One pointer, as a pointer event reports it: its id, where it is on screen, and when, in milliseconds. */
export interface Contact {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly time: number
}

export interface Viewport {
  readonly width: number
  readonly height: number
}

/** What the controls need of the run: where Santa stands, and the horde. The simulation is one. */
export interface TouchRun {
  readonly santa: { readonly position: { readonly x: number; readonly z: number } }
  readonly skeletons: readonly Pick<Skeleton, 'state' | 'position'>[]
}

/** A thumb down, as it is drawn: where it landed, and how far it is pushed from there, clamped. */
export interface Stick {
  readonly id: number
  readonly origin: { readonly x: number; readonly y: number }
  readonly offset: { readonly x: number; readonly y: number }
}

interface Held {
  id: number
  origin: { x: number; y: number }
  offset: { x: number; y: number }
  downAt: number
  /** Whether it was ever pushed past the dead zone: a tap never is. */
  dragged: boolean
}

export class TouchSticks {
  private moving: Held | null = null
  private throwing: Held | null = null
  /** A tap since the last sample, not yet thrown. */
  private tapped = false
  /** A drag past the dead zone since the last sample: a flick between two frames still throws. */
  private flicked: { x: number; y: number } | null = null

  constructor(
    private readonly run: TouchRun,
    private viewport: Viewport,
  ) {}

  resize(viewport: Viewport): void {
    this.viewport = viewport
  }

  /** The sticks down, for drawing. */
  get down(): { move: Stick | null; throw: Stick | null } {
    return { move: this.moving, throw: this.throwing }
  }

  touch(phase: ContactPhase, contact: Contact): void {
    if (phase === 'down') {
      // Which hand it is, is decided once, here; a third thumb is ignored.
      if (contact.x < this.viewport.width / 2) this.moving ??= held(contact)
      else this.throwing ??= held(contact)
      return
    }
    const stick = [this.moving, this.throwing].find((stick) => stick?.id === contact.id)
    if (!stick) return
    if (phase === 'cancel') return this.release(stick)
    // A lift is where the thumb last was: a swipe the page reports only as it lifts still throws.
    push(stick, contact)
    if (stick === this.throwing && pastDeadZone(stick.offset)) this.flicked = { ...stick.offset }
    if (phase === 'move') return
    if (stick === this.throwing && !stick.dragged && contact.time - stick.downAt < TAP_TIME) this.tapped = true
    this.release(stick)
  }

  /** The page lost focus: every thumb is let go, and nothing pending is thrown. */
  letGo(): void {
    this.moving = this.throwing = this.flicked = null
    this.tapped = false
  }

  /** This frame's input. */
  sample(): SimulationInput {
    const move = { x: 0, z: 0 }
    if (this.moving && pastDeadZone(this.moving.offset)) {
      move.x = this.moving.offset.x / STICK_RADIUS
      move.z = this.moving.offset.y / STICK_RADIUS
    }

    let aim: Point | null = null
    const drag = this.throwing && pastDeadZone(this.throwing.offset) ? this.throwing.offset : this.flicked
    if (drag) {
      const { x, z } = this.run.santa.position
      const length = Math.hypot(drag.x, drag.y)
      aim = { x: x + (drag.x / length) * DRAG_REACH, y: AIM_HEIGHT, z: z + (drag.y / length) * DRAG_REACH }
    } else if (this.tapped) {
      aim = this.nearest()
    }
    this.tapped = false
    this.flicked = null
    // A tap in the throw's cooldown is lost, as a click then is: the simulation's cadence decides.
    return { move, aim, fire: aim !== null }
  }

  private release(stick: Held): void {
    if (stick === this.moving) this.moving = null
    else this.throwing = null
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

function held({ id, x, y, time }: Contact): Held {
  return { id, origin: { x, y }, offset: { x: 0, y: 0 }, downAt: time, dragged: false }
}

/** Follow the thumb to `contact`, clamped to the stick's rim. */
function push(stick: Held, contact: Contact): void {
  const x = contact.x - stick.origin.x
  const y = contact.y - stick.origin.y
  const scale = Math.min(1, STICK_RADIUS / (Math.hypot(x, y) || 1))
  stick.offset = { x: x * scale, y: y * scale }
  if (pastDeadZone(stick.offset)) stick.dragged = true
}

const pastDeadZone = ({ x, y }: { x: number; y: number }) => Math.hypot(x, y) > DEAD_ZONE * STICK_RADIUS
