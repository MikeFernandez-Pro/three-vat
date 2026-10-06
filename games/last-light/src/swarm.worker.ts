// The swarm's thread (see swarm-remote.ts): owns the Swarm, steps it STEP at
// a time on its own clock, and posts where every rat is after each step. A
// gap longer than a quarter second, the tab put away, is dropped rather than
// caught up.
import { Swarm, type Dark, type Light, type Tuning } from './swarm'
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
let tuning: Tuning | undefined
let dark: Dark | undefined
let paused = false
let time = 0
/** Buffer sets not in the page's hands. */
const free: Recycle[] = []
let last = 0
let behind = 0

scope.onmessage = ({ data }) => {
  if (data.type === 'start') {
    swarm = new Swarm(data.capacity, data.seed)
    swarm.reset(data.count)
    count = data.count
    for (let i = 0; i < BUFFER_SETS; i++) {
      free.push({ type: 'recycle', x: new Float32Array(data.capacity), z: new Float32Array(data.capacity), heading: new Float32Array(data.capacity), gait: new Uint8Array(data.capacity) })
    }
    last = performance.now()
    tick()
  } else if (data.type === 'input') {
    count = data.count
    light = data.light
    tuning = data.tuning
    dark = data.dark
    paused = data.paused
  } else {
    free.push(data)
  }
}

/** Step as many times as the clock owes, then come back when the next step is due. Paused, the clock owes nothing. */
function tick(): void {
  const now = performance.now()
  behind = paused ? 0 : Math.min(CATCH_UP, behind + (now - last) / 1000)
  last = now
  while (behind >= STEP) {
    step()
    behind -= STEP
  }
  setTimeout(tick, Math.max(0, (STEP - behind) * 1000))
}

function step(): void {
  if (swarm === undefined || tuning === undefined) return
  if (count !== swarm.count) swarm.setCount(count)
  const report = swarm.step(STEP, light, tuning, dark)
  time += STEP
  // The page holds every set: it will read the next step instead.
  const set = free.pop()
  if (set === undefined) return
  const n = swarm.count
  set.x.set(swarm.x.subarray(0, n))
  set.z.set(swarm.z.subarray(0, n))
  set.heading.set(swarm.heading.subarray(0, n))
  set.gait.set(swarm.gait.subarray(0, n))
  const { x, z, heading, gait } = set
  scope.postMessage(
    { type: 'state', time, count: n, arena: swarm.arena, x, z, heading, gait, ms: report.ms, inside: report.inside },
    [x.buffer, z.buffer, heading.buffer, gait.buffer],
  )
}
