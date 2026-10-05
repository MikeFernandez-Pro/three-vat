// The swarm, run in a worker: the page keeps the frame, the worker keeps the
// step. The worker owns the `Swarm` and steps it STEP at a time on its own
// clock, whatever the frame rate, and posts where every rat is after each
// step, in buffers it gets back once the page is done with them. The page
// stands the rats a step behind the latest post, between the two it has, so
// a key pressed reaches the rats a step late and their motion stays smooth.
//
// The page sends what the step reads, every frame: the count, the light and
// the tuning. Nothing else crosses: the light's walk is the page's, worked out
// from the arena's radius alone.
import { arenaRadiusFor, type Light, type Tuning } from './swarm'

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
  heading: Float32Array
  /** The step's own time, ms, and the rats it found inside the light. */
  ms: number
  inside: number
}
export interface Start {
  type: 'start'
  capacity: number
  seed: number
  count: number
}
export interface Input {
  type: 'input'
  count: number
  light: Light
  tuning: Tuning
  /** Paused: the worker steps nothing, and owes no time for it when the pause ends. */
  paused: boolean
}
export interface Recycle {
  type: 'recycle'
  x: Float32Array
  z: Float32Array
  heading: Float32Array
}
export type ToWorker = Start | Input | Recycle

const TAU = Math.PI * 2

/** The page's end: where the rats are this frame, and what the step reads. */
export class RemoteSwarm {
  /** Rats alive, and the arena's radius, as of the latest state. */
  count: number
  arena: number
  /** Where every rat is this frame, the first `count` of each: read by `sample`. */
  readonly x: Float32Array
  readonly z: Float32Array
  readonly heading: Float32Array
  /** How fast every rat really moves this frame, m/s, from the two states it stands between; 0 with one state. */
  readonly vx: Float32Array
  readonly vz: Float32Array
  /** The latest step's own time, ms, and the rats it found inside the light. */
  ms = 0
  inside = 0
  /** Whether the places have been read from a state at all: before that, the arrays are zeros and place nothing. */
  get ready(): boolean {
    return this.version > 0
  }
  /** Counts up each time the places are written: a frame that finds it unchanged has nothing new to draw. */
  version = 0

  private readonly worker: Worker
  /** Each rat's own beat, the last it was placed on, for the staggered hold. */
  private readonly placedOn: Int32Array
  private prev: State | undefined
  private cur: State | undefined
  /** When `cur` arrived, by `performance.now()`. */
  private arrived = 0

  constructor(capacity: number, seed: number, count: number) {
    this.count = count
    this.arena = arenaRadiusFor(count)
    this.x = new Float32Array(capacity)
    this.z = new Float32Array(capacity)
    this.heading = new Float32Array(capacity)
    this.vx = new Float32Array(capacity)
    this.vz = new Float32Array(capacity)
    this.placedOn = new Int32Array(capacity).fill(-1)
    this.worker = new Worker(new URL('./swarm.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (event: MessageEvent<State>) => this.receive(event.data)
    this.post({ type: 'start', capacity, seed, count })
  }

  /** What the next steps read: sent every frame, so the panel's edits need no wiring of their own. */
  send(count: number, light: Light, tuning: Tuning, paused: boolean): void {
    this.post({ type: 'input', count, light: { x: light.x, z: light.z, strength: light.strength, on: light.on }, tuning: { ...tuning }, paused })
  }

  /**
   * Stand every rat where it is at `now` (by `performance.now()`): a step
   * behind the latest state, between it and the one before. A rat the earlier
   * state had not yet spawned takes the latest state's place.
   */
  sample(now: number): void {
    const { cur, prev } = this
    if (cur === undefined) return
    this.version++
    const n = cur.count
    if (prev === undefined || cur.time <= prev.time) {
      this.x.set(cur.x.subarray(0, n))
      this.z.set(cur.z.subarray(0, n))
      this.heading.set(cur.heading.subarray(0, n))
      this.vx.fill(0, 0, n)
      this.vz.fill(0, 0, n)
      return
    }
    const t = cur.time - STEP + Math.min(STEP, (now - this.arrived) / 1000)
    const alpha = Math.min(1, Math.max(0, (t - prev.time) / (cur.time - prev.time)))
    const perSecond = 1 / (cur.time - prev.time)
    const both = Math.min(n, prev.count)
    for (let i = 0; i < both; i++) {
      this.x[i] = prev.x[i] + (cur.x[i] - prev.x[i]) * alpha
      this.z[i] = prev.z[i] + (cur.z[i] - prev.z[i]) * alpha
      this.vx[i] = (cur.x[i] - prev.x[i]) * perSecond
      this.vz[i] = (cur.z[i] - prev.z[i]) * perSecond
      let turn = cur.heading[i] - prev.heading[i]
      turn -= TAU * Math.round(turn / TAU)
      this.heading[i] = prev.heading[i] + turn * alpha
    }
    for (let i = both; i < n; i++) {
      this.x[i] = cur.x[i]
      this.z[i] = cur.z[i]
      this.heading[i] = cur.heading[i]
      this.vx[i] = this.vz[i] = 0
    }
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
    const n = cur.count
    const whole = prev !== undefined && cur.time > prev.time
    let alpha = 1
    if (whole) {
      const t = cur.time - STEP + Math.min(STEP, (now - this.arrived) / 1000)
      alpha = Math.min(1, Math.max(0, (t - prev.time) / (cur.time - prev.time)))
    }
    const both = whole ? Math.min(n, prev.count) : 0
    const perSecond = whole ? 1 / (cur.time - prev.time) : 0
    for (let i = 0; i < n; i++) {
      // The golden ratio spreads the phases evenly over any run of indices.
      const beat = Math.floor(clock * fps + ((i * 0.6180339887) % 1))
      if (beat === this.placedOn[i]) continue
      this.placedOn[i] = beat
      if (prev !== undefined && i < both) {
        this.x[i] = prev.x[i] + (cur.x[i] - prev.x[i]) * alpha
        this.z[i] = prev.z[i] + (cur.z[i] - prev.z[i]) * alpha
        this.vx[i] = (cur.x[i] - prev.x[i]) * perSecond
        this.vz[i] = (cur.z[i] - prev.z[i]) * perSecond
        let turn = cur.heading[i] - prev.heading[i]
        turn -= TAU * Math.round(turn / TAU)
        this.heading[i] = prev.heading[i] + turn * alpha
      } else {
        this.x[i] = cur.x[i]
        this.z[i] = cur.z[i]
        this.heading[i] = cur.heading[i]
        this.vx[i] = this.vz[i] = 0
      }
    }
  }

  private receive(state: State): void {
    if (this.prev !== undefined) {
      const { x, z, heading } = this.prev
      this.worker.postMessage({ type: 'recycle', x, z, heading } satisfies Recycle, [x.buffer, z.buffer, heading.buffer])
    }
    this.prev = this.cur
    this.cur = state
    this.arrived = performance.now()
    this.count = state.count
    this.arena = state.arena
    this.ms = state.ms
    this.inside = state.inside
  }

  private post(message: ToWorker): void {
    this.worker.postMessage(message)
  }
}
