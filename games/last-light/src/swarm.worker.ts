// The swarm's thread (see swarm-remote.ts): owns the Swarm, steps it STEP at
// a time on its own clock, and posts where every rat is after each step. A
// gap longer than a quarter second, the tab put away, is dropped rather than
// caught up.
import { Swarm, type Dark, type FixedLight, type Light, type Tuning } from './swarm'
import { BUFFER_SETS, STEP, type Recycle, type State, type ToWorker } from './swarm-remote'

/** The worker's global, typed for what it is used for here: the DOM lib types `self` as a window. */
const scope = self as unknown as {
  postMessage(message: State, transfer: Transferable[]): void
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null
}

/** The longest gap stepped through, s: past it the swarm skips ahead. */
const CATCH_UP = 0.25

let swarm: Swarm | undefined
let count = 0
let light: Light = { x: 0, z: 0, strength: 0, on: false }
let lights: FixedLight[] = []
let tuning: Tuning | undefined
let dark: Dark | undefined
let paused = false
let time = 0
/** Buffer sets not in the page's hands. */
const free: Recycle[] = []
/** Which rats a step moved since the last state went out: a step stepped while the page holds every set still has its moves reported. */
let movedSince = new Uint8Array(0)
let last = 0
let behind = 0

scope.onmessage = ({ data }) => {
  if (data.type === 'start') {
    swarm = new Swarm(data.capacity, data.seed, data.arenaScale, data.ground)
    swarm.reset(data.count)
    count = data.count
    movedSince = new Uint8Array(data.capacity)
    for (let i = 0; i < BUFFER_SETS; i++) {
      const floats = () => new Float32Array(data.capacity)
      free.push({
        type: 'recycle',
        x: floats(),
        z: floats(),
        y: floats(),
        pitch: floats(),
        heading: floats(),
        gait: new Uint8Array(data.capacity),
        place: floats(),
        moved: new Uint8Array(data.capacity),
      })
    }
    last = performance.now()
    tick()
  } else if (data.type === 'input') {
    count = data.count
    light = data.light
    lights = data.lights
    tuning = data.tuning
    dark = data.dark
    paused = data.paused
  } else if (data.type === 'walls') {
    swarm?.setWalls(data.walls)
  } else if (data.type === 'restart') {
    if (swarm === undefined) return
    if (count !== swarm.count) swarm.setCount(count)
    swarm.restart(data.lights)
    // Placed, never slid across the level to where they now stand.
    movedSince.fill(1, 0, swarm.count)
  } else {
    free.push(data)
  }
}

/**
 * Step once if the clock owes a step, then come back: at once while it still
 * owes one, else when the next is due. Paused, the clock owes nothing. One
 * step a turn, so the page's buffers come back between steps: a step longer
 * than STEP slows the swarm, every step still posted, where a run of them in
 * one turn ran out of buffers and posted four in a quarter second.
 */
function tick(): void {
  const now = performance.now()
  behind = paused ? 0 : Math.min(CATCH_UP, behind + (now - last) / 1000)
  last = now
  if (behind >= STEP) {
    step()
    behind -= STEP
  }
  setTimeout(tick, behind >= STEP ? 0 : (STEP - behind) * 1000)
}

function step(): void {
  if (swarm === undefined || tuning === undefined) return
  if (count !== swarm.count) swarm.setCount(count)
  const report = swarm.step(STEP, light, tuning, dark, lights)
  time += STEP
  const n = swarm.count
  for (let i = 0; i < n; i++) movedSince[i] |= swarm.moved[i]!
  // The page holds every set: it will read the next step instead, and the moves with it.
  const set = free.pop()
  if (set === undefined) return
  set.x.set(swarm.x.subarray(0, n))
  set.z.set(swarm.z.subarray(0, n))
  set.y.set(swarm.y.subarray(0, n))
  set.pitch.set(swarm.pitch.subarray(0, n))
  set.heading.set(swarm.heading.subarray(0, n))
  set.gait.set(swarm.gait.subarray(0, n))
  set.place.set(swarm.places.subarray(0, n))
  set.moved.set(movedSince.subarray(0, n))
  movedSince.fill(0)
  const { x, z, y, pitch, heading, gait, place, moved } = set
  scope.postMessage(
    { type: 'state', time, count: n, arena: swarm.arena, x, z, y, pitch, heading, gait, place, moved, ms: report.ms, inside: report.inside, reached: report.reached, atLights: report.atLights },
    [x.buffer, z.buffer, y.buffer, pitch.buffer, heading.buffer, gait.buffer, place.buffer, moved.buffer],
  )
}
