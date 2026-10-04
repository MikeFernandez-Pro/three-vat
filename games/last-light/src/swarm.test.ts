// The swarm, through its own calls only: set a situation up, step it at a fixed
// time step from a fixed seed, and read where the rats are and what the step
// reported. Nothing here reaches into the grid or the goal arithmetic.
import { describe, expect, it } from 'vitest'
import { defaultTuning, hardRadius, Swarm, type Light, type StepReport, type Tuning } from './swarm'

const DT = 1 / 60
const SEED = 7

const lightAt = (x = 0, z = 0): Light => ({ x, z, strength: 1, on: true })

/** Step `seconds` of swarm time, handing every report to `each`. */
function run(swarm: Swarm, seconds: number, light: Light, tuning: Tuning, each?: (report: StepReport) => void): StepReport {
  let report!: StepReport
  for (let t = 0; t < seconds; t += DT) {
    report = swarm.step(DT, light, tuning)
    each?.(report)
  }
  return report
}

const distanceTo = (swarm: Swarm, i: number, light: Light) => Math.hypot(swarm.x[i] - light.x, swarm.z[i] - light.z)

function settled(count: number, tuning = defaultTuning()) {
  const swarm = new Swarm(count, SEED)
  swarm.reset(count)
  const light = lightAt()
  run(swarm, 20, light, tuning)
  return { swarm, light, tuning }
}

describe('a still light', () => {
  it('lets no rat inside once the swarm settles, and holds most of them in the band', () => {
    const { swarm, light, tuning } = settled(300)
    const report = run(swarm, 1, light, tuning)
    expect(report.inside).toBe(0)

    const inner = hardRadius(light, tuning)
    let inBand = 0
    for (let i = 0; i < swarm.count; i++) {
      const d = distanceTo(swarm, i, light)
      expect(d).toBeGreaterThanOrEqual(inner)
      if (d <= inner + tuning.band) inBand++
    }
    expect(inBand / swarm.count).toBeGreaterThan(0.5)
  })

  it('draws a rat that starts far away nearer to it', () => {
    const swarm = new Swarm(200, SEED)
    swarm.reset(200)
    const light = lightAt()
    const tuning = defaultTuning()
    const far: [number, number][] = []
    for (let i = 0; i < swarm.count; i++) {
      const d = distanceTo(swarm, i, light)
      if (d > hardRadius(light, tuning) + tuning.band + 4) far.push([i, d])
    }
    expect(far.length).toBeGreaterThan(10)

    run(swarm, 4, light, tuning)
    for (const [i, d] of far) expect(distanceTo(swarm, i, light)).toBeLessThan(d)
  })
})

describe('a walking light', () => {
  it('pushes the carpet ahead of it, and catches no rat', () => {
    const { swarm, light, tuning } = settled(2000)
    const target = { x: 8, z: 3 }
    let caught = 0
    for (let t = 0; t < 8; t += DT) {
      swarm.walkLight(light, target, DT)
      caught = Math.max(caught, swarm.step(DT, light, tuning).inside)
    }
    expect(Math.hypot(light.x - target.x, light.z - target.z)).toBeLessThan(1e-3)
    expect(caught).toBe(0)
  })

  it('stays inside the arena, wherever it is sent', () => {
    const swarm = new Swarm(100, SEED)
    swarm.reset(100)
    const light = lightAt()
    for (let t = 0; t < 30; t += DT) swarm.walkLight(light, { x: 100, z: -100 }, DT)
    expect(Math.hypot(light.x, light.z)).toBeLessThan(swarm.arena)
  })

  it('walks at walking pace', () => {
    const swarm = new Swarm(100, SEED)
    swarm.reset(100)
    const light = lightAt()
    swarm.walkLight(light, { x: 5, z: 0 }, 1)
    expect(light.x).toBeCloseTo(1.6, 6)
  })
})

describe('the light relit over the swarm', () => {
  it('leaves rats inside it, and they are all out within a few seconds', () => {
    const { swarm, light, tuning } = settled(2000)
    light.on = false
    run(swarm, 6, light, tuning)

    light.on = true
    const first = swarm.step(DT, light, tuning)
    expect(first.inside).toBeGreaterThan(0)

    const last = run(swarm, 5, light, tuning)
    expect(last.inside).toBe(0)
  })
})

describe('the light out', () => {
  it('lets the rats close to within the band of the holder', () => {
    const { swarm, light, tuning } = settled(2000)
    const near = () => {
      let n = 0
      for (let i = 0; i < swarm.count; i++) if (distanceTo(swarm, i, light) <= tuning.band) n++
      return n
    }
    expect(near()).toBe(0)

    light.on = false
    run(swarm, 6, light, tuning)
    expect(near()).toBeGreaterThan(50)
  })
})

describe('the arena', () => {
  it('lets no rat leave it, through a long walk and the light going out', () => {
    const swarm = new Swarm(2000, SEED)
    swarm.reset(2000)
    const light = lightAt()
    const tuning = defaultTuning()
    let farthest = 0
    for (let t = 0; t < 40; t += DT) {
      if (t > 30) light.on = false
      swarm.walkLight(light, swarm.loopPoint(t), DT)
      swarm.step(DT, light, tuning)
      for (let i = 0; i < swarm.count; i++) farthest = Math.max(farthest, Math.hypot(swarm.x[i], swarm.z[i]))
    }
    expect(farthest).toBeLessThanOrEqual(swarm.arena + 1e-4)
  })

  it('is sized to the count', () => {
    const swarm = new Swarm(16384, SEED)
    swarm.reset(2000)
    expect(swarm.arena).toBeCloseTo(15.1, 1)
    swarm.setCount(16384)
    expect(swarm.arena).toBeCloseTo(30.1, 1)
  })
})

describe('the count', () => {
  it('grows at the arena edge and leaves every rat already there where it was', () => {
    const swarm = new Swarm(2000, SEED)
    swarm.reset(1000)
    run(swarm, 2, lightAt(), defaultTuning())
    const x = swarm.x.slice(0, 1000)
    const z = swarm.z.slice(0, 1000)

    swarm.setCount(2000)
    expect(swarm.count).toBe(2000)
    expect(swarm.x.slice(0, 1000)).toEqual(x)
    expect(swarm.z.slice(0, 1000)).toEqual(z)
    for (let i = 1000; i < 2000; i++) {
      expect(Math.hypot(swarm.x[i], swarm.z[i])).toBeGreaterThan(swarm.arena * 0.85)
    }
  })

  it('keeps each rat in its place between the slowest and fastest speed', () => {
    const swarm = new Swarm(1000, SEED)
    swarm.reset(1000)
    const tuning = defaultTuning()
    const places = Array.from({ length: 500 }, (_, i) => swarm.place(i))
    expect(Math.min(...places)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...places)).toBeLessThanOrEqual(1)

    swarm.setCount(300)
    swarm.setCount(1000)
    run(swarm, 1, lightAt(), tuning)
    const faster = { ...tuning, minSpeed: 2, maxSpeed: 3.5 }
    for (let i = 0; i < 300; i++) {
      expect(swarm.place(i)).toBe(places[i])
      expect(swarm.speedOf(i, tuning)).toBeCloseTo(tuning.minSpeed + (tuning.maxSpeed - tuning.minSpeed) * places[i], 6)
      expect(swarm.speedOf(i, faster)).toBeCloseTo(2 + 1.5 * places[i], 6)
    }
  })
})

describe('a rat', () => {
  it('moves at its own running speed each step, give or take the push at the edge', () => {
    const { swarm, light, tuning } = settled(2000)
    const walked = { x: 4, z: 0 }
    let rats = 0
    let atSpeed = 0
    for (let t = 0; t < 2; t += DT) {
      const x = swarm.x.slice()
      const z = swarm.z.slice()
      swarm.walkLight(light, walked, DT)
      swarm.step(DT, light, tuning)
      for (let i = 0; i < swarm.count; i++) {
        const moved = Math.hypot(swarm.x[i] - x[i], swarm.z[i] - z[i])
        const own = swarm.speedOf(i, tuning) * DT
        rats++
        if (Math.abs(moved - own) < 1e-4) atSpeed++
        // A push at the light's edge moves a rat by no more than the light walked.
        expect(moved).toBeLessThan(2 * own + 1.6 * DT + 1e-3)
      }
    }
    expect(atSpeed / rats).toBeGreaterThan(0.95)
  })
})
