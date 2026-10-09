// The swarm, run in a worker: the page keeps the frame, the worker keeps the
// step. The worker owns the `Swarm` and steps it STEP at a time on its own
// clock, whatever the frame rate, and posts where every rat is after each
// step, in buffers it gets back once the page is done with them. The page
// stands the rats a step behind the latest post, between the two it has, so
// a key pressed reaches the rats a step late and their motion stays smooth.
//
// The page sends what the step reads, every frame: the count, the torch, the
// lights the level places, the tuning and what it cannot see. Nothing else crosses: the light's walk is the page's, worked out
// from the arena's radius alone. And only when they change, the level's walls
// as they stand, a gate opened or shut, and the rats to be placed again.
import { arenaFor, type Dark, type FixedLight, type Ground, type Light, type Tuning } from './swarm'
import type { Pair } from './gpucull'
import type { Wall } from './walls'

/** The fixed time step, in seconds: the rate the tests pin the swarm's behaviours at. */
export const STEP = 1 / 60
/** Buffer sets in flight: two the page holds, one the worker fills, one spare for a slow frame. */
export const BUFFER_SETS = 4

/** Where every rat is after a step, in buffers the page sends back as a `Recycle`. */
export interface State {
  type: 'state'
  /** Swarm time at the end of the step, s. */
  time: number
  count: number
  arena: number
  x: Float32Array
  z: Float32Array
  /** How high each rat rides on the pile, m, and its pitch, radians nose up. */
  y: Float32Array
  pitch: Float32Array
  heading: Float32Array
  /** What each rat's feet play, RUN, WALK or IDLE, read from how fast it really moves. */
  gait: Uint8Array
  /** Where each rat sits between the slowest and fastest speed, 0 to 1. */
  place: Float32Array
  /** Which rats were moved rather than ran since the state before, 1 or 0: brought round in the dark. The page places them, and never slides them across the screen. */
  moved: Uint8Array
  /** The step's own time, ms, the rats it found inside a light, the rats it found at the holder, and at each light's edge, in the lights' order. */
  ms: number
  inside: number
  reached: number
  atLights: number[]
}
export interface Start {
  type: 'start'
  capacity: number
  seed: number
  count: number
  /** How much wider than the count asks the arena is. */
  arenaScale: number
  /** The level's walls, the box rats start in, and the lights they start out of. */
  ground: Ground
}
export interface Input {
  type: 'input'
  count: number
  light: Light
  /** The lights the level places, beside the torch. */
  lights: FixedLight[]
  tuning: Tuning
  /** What the page cannot see, where a walking light brings rats left behind round ahead of it; none, and none are. */
  dark?: Dark
  /** Paused: the worker steps nothing, and owes no time for it when the pause ends. */
  paused: boolean
}
export interface Recycle {
  type: 'recycle'
  x: Float32Array
  z: Float32Array
  y: Float32Array
  pitch: Float32Array
  heading: Float32Array
  gait: Uint8Array
  place: Float32Array
  moved: Uint8Array
}
/** The level's walls as they now stand, a gate opened or shut. */
export interface SetWalls {
  type: 'walls'
  walls: Wall[]
}
/** Every rat placed again, out of `lights`: the run caught, or set down at a checkpoint. Each is marked moved in the next state. */
export interface Restart {
  type: 'restart'
  lights: FixedLight[]
}
export type ToWorker = Start | Input | Recycle | SetWalls | Restart

/** The worker's end of the wire, as the page holds it: a `Worker`, or a stand-in under test that posts the states itself. */
export interface SwarmPort {
  postMessage(message: ToWorker, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent<State>) => void) | null
}

/** The swarm's own thread, started. */
function spawnWorker(): Worker {
  return new Worker(new URL('./swarm.worker.ts', import.meta.url), { type: 'module' })
}

const TAU = Math.PI * 2
/** How a rat is to be turned when it is next in sight: as it is, between the sampled states, or as the latest has it. */
const TURNED = 0
const BETWEEN = 1
const LATEST = 2

/** The page's end: where the rats are this frame, and what the step reads. */
export class RemoteSwarm {
  /** Rats alive, and the arena's radius, as of the latest state. */
  count: number
  arena: number
  /** Where every rat is this frame, the first `count` of each: read by `sample`. */
  readonly x: Float32Array
  readonly z: Float32Array
  /** How high each rat rides on the pile this frame, m. */
  readonly y: Float32Array
  /** Its pitch, radians nose up, and its heading: as of the frame it was last in sight, by `orient`. */
  readonly pitch: Float32Array
  readonly heading: Float32Array
  /** What each rat's feet play, as of the latest state it was placed from. */
  readonly gait: Uint8Array
  /** Where each rat sits between the slowest and fastest speed, as of the latest state it was placed from. */
  readonly place: Float32Array
  /** The latest step's own time, ms, the rats it found inside a light, the rats it found at the holder, and at each light's edge, in the lights' order. */
  ms = 0
  inside = 0
  reached = 0
  atLights: readonly number[] = []
  /** Swarm time as of the latest state, s. The drawing leans the lights' flames at it, as the step does. */
  get time(): number {
    return this.cur?.time ?? 0
  }
  /** Whether the places have been read from a state at all: before that, the arrays are zeros and place nothing. */
  get ready(): boolean {
    return this.version > 0
  }
  /** Counts up each time the places are written: a frame that finds it unchanged has nothing new to draw. */
  version = 0
  /** How far apart the states come in, s: a step while the worker keeps up, longer while its steps overrun. */
  get pace(): number {
    return Math.max(STEP, this.gap / 1000)
  }
  /** Counts up as each state comes in from the worker, a step apart: how often the rats really move. */
  steps = 0

  private readonly worker: SwarmPort
  /** Each rat's own beat, the last it was placed on, for the staggered hold. */
  private readonly placedOn: Int32Array
  /** How each rat is to be turned when next in sight, TURNED, BETWEEN or LATEST. */
  private readonly unturned: Uint8Array
  private prev: State | undefined
  private cur: State | undefined
  /** When `cur` arrived, by `performance.now()`. */
  private arrived = 0
  /**
   * How far apart the states come in, ms, smoothed: a step's worth while the
   * worker keeps up, longer when its steps overrun. The rats cross from one
   * state to the next over this, so an overrun swarm moves in slow motion
   * rather than standing still between states and jumping.
   */
  private gap = STEP * 1000
  /** The two states the last sample stood the rats between, how far between, and how many both have. */
  private sampledPrev: State | undefined
  private sampledCur: State | undefined
  private alpha = 1
  private both = 0
  /** Whether the last sample held each rat on a beat of its own: then no one pair says where the rats are. */
  private staggered = false

  constructor(capacity: number, seed: number, count: number, arenaScale = 1, ground: Ground = { walls: [] }, worker: SwarmPort = spawnWorker()) {
    this.count = count
    this.arena = arenaFor(count, arenaScale, ground.bounds)
    this.x = new Float32Array(capacity)
    this.z = new Float32Array(capacity)
    this.y = new Float32Array(capacity)
    this.pitch = new Float32Array(capacity)
    this.heading = new Float32Array(capacity)
    this.gait = new Uint8Array(capacity)
    this.place = new Float32Array(capacity)
    this.unturned = new Uint8Array(capacity)
    this.placedOn = new Int32Array(capacity).fill(-1)
    this.worker = worker
    this.worker.onmessage = (event: MessageEvent<State>) => this.receive(event.data)
    this.post({ type: 'start', capacity, seed, count, arenaScale, ground })
  }

  /** What the next steps read: sent every frame, so the panel's edits need no wiring of their own. */
  send(count: number, light: Light, tuning: Tuning, paused: boolean, dark?: Dark, lights: readonly FixedLight[] = []): void {
    const input: Input = {
      type: 'input',
      count,
      light: { x: light.x, z: light.z, strength: light.strength, on: light.on },
      lights: lights.map(({ x, z, reach, on }) => ({ x, z, reach, on })),
      tuning: { ...tuning },
      paused,
    }
    if (dark !== undefined) input.dark = { ...dark }
    this.post(input)
  }

  /** The level's walls as they now stand, a gate opened or shut: the worker's next step reads them. */
  setWalls(walls: readonly Wall[]): void {
    this.post({ type: 'walls', walls: walls.map(({ from, to }) => ({ from: { ...from }, to: { ...to } })) })
  }

  /** Every rat placed again, out of `lights`: the lights as they stand and the torch where the holder starts again. The counts at the holder and the lights start again from none. */
  restart(lights: readonly FixedLight[]): void {
    this.post({ type: 'restart', lights: lights.map(({ x, z, reach, on }) => ({ x, z, reach, on })) })
    this.reached = 0
    this.atLights = []
  }


  /**
   * Stand every rat where it is at `now` (by `performance.now()`): a step
   * behind the latest state, between it and the one before. A rat the earlier
   * state had not yet spawned, or that the worker moved rather than ran,
   * takes the latest state's place. Only where it stands: which way it faces
   * waits for `orient`, asked of the rats in sight.
   */
  sample(now: number): void {
    const { cur, prev } = this
    if (cur === undefined) return
    this.version++
    this.staggered = false
    const n = cur.count
    this.gait.set(cur.gait.subarray(0, n))
    this.place.set(cur.place.subarray(0, n))
    this.facing(prev, cur, now)
    const { alpha, both } = this
    for (let i = 0; i < n; i++) {
      if (i >= both || cur.moved[i]) this.placeFrom(cur, i)
      else this.standBetween(prev!, cur, i, alpha)
    }
  }

  /** Hold every rat where it is at `now` until the next hold: the stop motion's beat. The pair sampled is held with it. */
  hold(now: number): void {
    this.sample(now)
  }

  /**
   * The staggered hold: every rat keeps its place until its own beat turns,
   * `fps` a second from `clock` with a phase of its own, so the mass does not
   * snap all at once. A rat whose beat turned is placed as `sample` would
   * place it now.
   */
  sampleStaggered(now: number, clock: number, fps: number): void {
    const { cur, prev } = this
    if (cur === undefined) return
    this.version++
    this.staggered = true
    const n = cur.count
    this.facing(prev, cur, now)
    const { alpha, both } = this
    for (let i = 0; i < n; i++) {
      // The golden ratio spreads the phases evenly over any run of indices.
      const beat = Math.floor(clock * fps + ((i * 0.6180339887) % 1))
      if (beat === this.placedOn[i]) continue
      this.placedOn[i] = beat
      this.gait[i] = cur.gait[i]
      this.place[i] = cur.place[i]
      if (i >= both || cur.moved[i]) this.placeFrom(cur, i)
      else this.standBetween(prev!, cur, i, alpha)
    }
  }

  /** Stand rat `i` where `cur` has it, to be turned as `cur` has it: a rat moved rather than run, or not yet in the state before. */
  private placeFrom(cur: State, i: number): void {
    this.x[i] = cur.x[i]!
    this.z[i] = cur.z[i]!
    this.y[i] = cur.y[i]!
    this.unturned[i] = LATEST
  }

  /** Stand rat `i` `alpha` of the way from `prev` to `cur`, to be turned as far between them. */
  private standBetween(prev: State, cur: State, i: number, alpha: number): void {
    this.x[i] = prev.x[i]! + (cur.x[i]! - prev.x[i]!) * alpha
    this.z[i] = prev.z[i]! + (cur.z[i]! - prev.z[i]!) * alpha
    this.y[i] = prev.y[i]! + (cur.y[i]! - prev.y[i]!) * alpha
    this.unturned[i] = BETWEEN
  }

  /**
   * Turn rat `i` the way it faces where the last sample stood it, if it has
   * not been since. A state come in since may have taken the earlier one
   * back to the worker, and then the rat faces as the latest has it: a
   * sixtieth of a second's turn, on a rat that has just come into sight.
   */
  orient(i: number): void {
    const how = this.unturned[i]
    if (how === TURNED) return
    this.unturned[i] = TURNED
    const from = this.sampledCur
    if (from === undefined) return
    if (how === LATEST || from !== this.cur || this.sampledPrev === undefined) {
      const latest = this.cur!
      if (i >= latest.count) return
      this.pitch[i] = latest.pitch[i]
      this.heading[i] = latest.heading[i]
      return
    }
    const prev = this.sampledPrev
    const alpha = this.alpha
    this.pitch[i] = prev.pitch[i] + (from.pitch[i] - prev.pitch[i]) * alpha
    let turn = from.heading[i] - prev.heading[i]
    turn -= TAU * Math.round(turn / TAU)
    this.heading[i] = prev.heading[i] + turn * alpha
  }

  /**
   * The two states the last sample stood every rat between, and how: what the
   * GPU blends for itself. None before the first sample, and none after a
   * staggered one, whose rats each hold a place of their own.
   */
  pair(): Pair | undefined {
    const cur = this.sampledCur
    if (cur === undefined || this.staggered) return undefined
    return { prev: this.sampledPrev, cur, alpha: this.alpha, both: this.both }
  }

  /** How far between the two states the rats stand at `now`, and which rats can stand between them at all. */
  private facing(prev: State | undefined, cur: State, now: number): void {
    this.sampledCur = cur
    this.sampledPrev = prev
    if (prev === undefined || cur.time <= prev.time) {
      this.alpha = 1
      this.both = 0
      return
    }
    const t = cur.time - STEP + STEP * Math.min(1, (now - this.arrived) / Math.max(STEP * 1000, this.gap))
    this.alpha = Math.min(1, Math.max(0, (t - prev.time) / (cur.time - prev.time)))
    this.both = Math.min(cur.count, prev.count)
  }

  private receive(state: State): void {
    if (this.prev !== undefined) {
      const { x, z, y, pitch, heading, gait, place, moved } = this.prev
      this.worker.postMessage({ type: 'recycle', x, z, y, pitch, heading, gait, place, moved } satisfies Recycle, [
        x.buffer,
        z.buffer,
        y.buffer,
        pitch.buffer,
        heading.buffer,
        gait.buffer,
        place.buffer,
        moved.buffer,
      ])
    }
    this.prev = this.cur
    this.cur = state
    // A gap over four steps is a pause or a tab put away, not the worker's pace.
    const now = performance.now()
    const gap = Math.min(now - this.arrived, 4 * STEP * 1000)
    this.gap += (gap - this.gap) * 0.1
    this.arrived = now
    this.count = state.count
    this.arena = state.arena
    this.ms = state.ms
    this.inside = state.inside
    this.reached = state.reached
    this.atLights = state.atLights
    this.steps++
  }

  private post(message: ToWorker): void {
    this.worker.postMessage(message)
  }
}
