// The CPU step and the GPU step from one start, compared on how the swarm
// behaves (ADR-0053): run by hand when the rules change, through
// compare-steps.mjs, never in CI. Each step runs a few seeds, so the CPU's
// own spread from run to run says how close the GPU has to come.
//
// For each count and seed, both steps start from the same spawn, under the
// swarm's own default tuning:
// - settled: 20 s round a still light, then, over 2 s, the rats inside the
//   flame where it reaches least, the front's mean radius (the rats within
//   the light's hard radius and three gaps), and the gaits' shares;
// - overtaken: a light walking at 4 m/s for 2 s, then still: the seconds
//   until no rat is inside the flame;
// - brought round: a light walking at 2 m/s with the dark 5 m off it, for
//   3 s: the rats brought round a second;
// - placed lights: 20 s round a still light at half strength and two lights
//   placed in the mass round it, then, over 2 s, the rats inside a placed
//   light where it reaches least, and the rats pressed up to them (within
//   their reach and three gaps).
import { WebGPURenderer, type StorageBufferAttribute } from 'three/webgpu'
import { GpuCull } from '../src/gpucull'
import { GpuSwarm } from '../src/gpuswarm'
import { FLICKER, IDLE, RUN, Swarm, WALK, defaultTuning, hardRadius, leastRadius, walkLight, type Dark, type FixedLight, type Light } from '../src/swarm'
import { STEP } from '../src/swarm-remote'

/** One run's measures. */
interface Measures {
  inside: number
  front: number
  run: number
  walk: number
  idle: number
  runOut: number
  broughtASecond: number
  insidePlaced: number
  atPlaced: number
}

/** What a run needs of either step: step once, under a light and maybe a dark; then where the rats are, their gaits, which were moved. */
interface Stepper {
  arena: number
  /** Free what the step holds on the GPU. */
  dispose(): void
  step(light: Light, dark?: Dark, lights?: FixedLight[]): void
  read(): Promise<{ x: Float32Array; z: Float32Array; gait: Uint8Array; moved: Uint8Array }>
}

const params = new URLSearchParams(location.search)
const COUNTS = (params.get('counts') ?? '2000,16384').split(',').map(Number)
const SEEDS = (params.get('seeds') ?? '1,2,3,4').split(',').map(Number)
const tuning = defaultTuning()
const log = (line: string) => {
  document.body.append(Object.assign(document.createElement('div'), { textContent: line }))
  console.log(line)
}

const renderer = new WebGPURenderer()
await renderer.init()

function cpuStepper(count: number, seed: number): Stepper {
  const swarm = new Swarm(count, seed)
  swarm.reset(count)
  return {
    get arena() {
      return swarm.arena
    },
    step: (light, dark, lights) => void swarm.step(STEP, light, tuning, dark, lights),
    read: async () => ({ x: swarm.x, z: swarm.z, gait: swarm.gait, moved: swarm.moved }),
    dispose() {},
  }
}

function gpuStepper(count: number, seed: number): Stepper {
  const cull = new GpuCull(count, 3, 1)
  const clock = { ms: 0 }
  const swarm = new GpuSwarm(cull, renderer, count, seed, count, 1, () => clock.ms)
  // The step's own buffers, which nothing on the page reads.
  const open = swarm as unknown as { latest: number; motion: StorageBufferAttribute[] }
  return {
    get arena() {
      return swarm.arena
    },
    dispose() {
      swarm.dispose(renderer)
      cull.dispose(renderer)
    },
    step(light, dark, lights) {
      // A step's time, so the clock owes exactly one.
      clock.ms += STEP * 1000
      swarm.send(count, light, tuning, false, dark, lights)
    },
    async read() {
      const k = open.latest
      const state = new Float32Array(await renderer.getArrayBufferAsync(cull.states[k]!))
      const motion = new Float32Array(await renderer.getArrayBufferAsync(open.motion[k]!))
      const x = new Float32Array(count)
      const z = new Float32Array(count)
      const gait = new Uint8Array(count)
      const moved = new Uint8Array(count)
      for (let i = 0; i < count; i++) {
        x[i] = state[i * 8]!
        z[i] = state[i * 8 + 2]!
        moved[i] = state[i * 8 + 6]! > 0.5 ? 1 : 0
        gait[i] = motion[i * 12 + 9]!
      }
      return { x, z, gait, moved }
    },
  }
}

/** The rats within `radius` of the light, and the mean distance of those. */
function near(x: Float32Array, z: Float32Array, count: number, light: Light, radius: number) {
  let n = 0
  let sum = 0
  for (let i = 0; i < count; i++) {
    const d = Math.hypot(x[i]! - light.x, z[i]! - light.z)
    if (d <= radius) {
      n++
      sum += d
    }
  }
  return { n, mean: n > 0 ? sum / n : 0 }
}

async function measure(make: () => Stepper, count: number): Promise<Measures> {
  // Settled round a still light.
  let s = make()
  const light: Light = { x: 0, z: 0, strength: 1, on: true }
  for (let t = 0; t < 20 * 60; t++) s.step(light)
  let inside = 0
  let front = 0
  const gaits = [0, 0, 0]
  const samples = 8
  for (let k = 0; k < samples; k++) {
    for (let t = 0; t < 15; t++) s.step(light)
    const { x, z, gait } = await s.read()
    inside += near(x, z, count, light, leastRadius(light, tuning)).n / samples
    front += near(x, z, count, light, hardRadius(light, tuning) + 3 * tuning.gap).mean / samples
    for (let i = 0; i < count; i++) gaits[gait[i]!]! += 1 / (count * samples)
  }

  // Overtaken by a light faster than any rat, then left to run out of it.
  for (let t = 0; t < 2 * 60; t++) {
    walkLight(s.arena, light, { x: 8, z: 0 }, STEP, 4)
    s.step(light)
  }
  let runOut = Number.NaN
  for (let t = 0; t < 6 * 60; t++) {
    s.step(light)
    const { x, z } = await s.read()
    if (near(x, z, count, light, leastRadius(light, tuning)).n === 0) {
      runOut = (t + 1) / 60
      break
    }
  }

  // Brought round: settled anew, then a walking light with the dark round it.
  s.dispose()
  s = make()
  light.x = light.z = 0
  for (let t = 0; t < 20 * 60; t++) s.step(light)
  let brought = 0
  const seconds = 3
  for (let t = 0; t < seconds * 60; t++) {
    walkLight(s.arena, light, { x: 20, z: 0 }, STEP, 2)
    s.step(light, { x: light.x, z: light.z, radius: 5 })
    const { moved } = await s.read()
    for (let i = 0; i < count; i++) brought += moved[i]!
  }

  // Placed lights: settled anew round a smaller torch and two lights in the mass round it.
  s.dispose()
  s = make()
  const torch: Light = { x: 0, z: 0, strength: 0.5, on: true }
  const placed: FixedLight[] = [
    { x: 3.2, z: 0, reach: 1, on: true },
    { x: -2.2, z: 2.2, reach: 0.8, on: true },
  ]
  for (let t = 0; t < 20 * 60; t++) s.step(torch, undefined, placed)
  let insidePlaced = 0
  let atPlaced = 0
  for (let k = 0; k < samples; k++) {
    for (let t = 0; t < 15; t++) s.step(torch, undefined, placed)
    const { x, z } = await s.read()
    for (const l of placed) {
      const at: Light = { x: l.x, z: l.z, strength: 1, on: true }
      insidePlaced += near(x, z, count, at, l.reach * (1 - FLICKER)).n / samples
      atPlaced += near(x, z, count, at, l.reach + 3 * tuning.gap).n / samples
    }
  }
  s.dispose()
  return { inside, front, run: gaits[RUN]!, walk: gaits[WALK]!, idle: gaits[IDLE]!, runOut, broughtASecond: brought / seconds, insidePlaced, atPlaced }
}

const results: Record<string, unknown> = {}
const fmt = (v: number) => (Number.isNaN(v) ? 'NaN' : v.toFixed(3))
for (const count of COUNTS) {
  for (const [kind, make] of [
    ['cpu', cpuStepper],
    ['gpu', gpuStepper],
  ] as const) {
    const runs: Measures[] = []
    for (const seed of SEEDS) {
      const m = await measure(() => make(count, seed), count)
      runs.push(m)
      log(`${count} ${kind} seed ${seed}: ${Object.entries(m).map(([k, v]) => `${k} ${fmt(v)}`).join(', ')}`)
    }
    results[`${count} ${kind}`] = runs
  }
  // Each measure: the CPU's spread, the GPU's, and whether the GPU's runs fall within the CPU's.
  const cpu = results[`${count} cpu`] as Measures[]
  const gpu = results[`${count} gpu`] as Measures[]
  for (const key of Object.keys(cpu[0]!) as (keyof Measures)[]) {
    const range = (runs: Measures[]) => [Math.min(...runs.map((r) => r[key])), Math.max(...runs.map((r) => r[key]))]
    const [cLo, cHi] = range(cpu)
    const [gLo, gHi] = range(gpu)
    log(`${count} ${key}: cpu ${fmt(cLo!)}-${fmt(cHi!)}, gpu ${fmt(gLo!)}-${fmt(gHi!)}`)
  }
}
;(window as unknown as { done: unknown }).done = results
