// The swarm, through its own calls only: set a situation up, step it at a fixed
// time step from a fixed seed, and read where the rats are, their gaits and
// real speeds, and what the steps reported. Nothing here reaches into the route
// map, the grid or the bodies; the thresholds have headroom, so the steering
// can be retuned without rewriting them.
import { describe, expect, it } from 'vitest'
import { defaultTuning, hardRadius, IDLE, RUN, Swarm, type Light, type StepReport, type Tuning } from './swarm'

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

/** Walk the light toward `target` at `speed` for `seconds`, stepping the swarm, handing every report to `each`. */
function walk(
  swarm: Swarm,
  seconds: number,
  light: Light,
  tuning: Tuning,
  target: { x: number; z: number },
  speed?: number,
  each?: (report: StepReport) => void,
): void {
  for (let t = 0; t < seconds; t += DT) {
    swarm.walkLight(light, target, DT, speed)
    each?.(swarm.step(DT, light, tuning))
  }
}

const distanceTo = (swarm: Swarm, i: number, light: Light) => Math.hypot(swarm.x[i] - light.x, swarm.z[i] - light.z)

/** How many rats are within `radius` of the light. */
function within(swarm: Swarm, light: Light, radius: number): number {
  let n = 0
  for (let i = 0; i < swarm.count; i++) if (distanceTo(swarm, i, light) <= radius) n++
  return n
}

/** The mean distance from each rat to its nearest neighbour. */
function spacing(swarm: Swarm): number {
  let sum = 0
  for (let i = 0; i < swarm.count; i++) {
    let nearest = Infinity
    for (let j = 0; j < swarm.count; j++) {
      if (j !== i) nearest = Math.min(nearest, Math.hypot(swarm.x[i] - swarm.x[j], swarm.z[i] - swarm.z[j]))
    }
    sum += nearest
  }
  return sum / swarm.count
}

function settled(count: number, tuning = defaultTuning()) {
  const swarm = new Swarm(count, SEED)
  swarm.reset(count)
  const light = lightAt()
  run(swarm, 20, light, tuning)
  return { swarm, light, tuning }
}

/**
 * Watches every rat in windows of `window` seconds: a rat that showed Idle on
 * every step of a window yet moved further than `slide` metres across it slid
 * in its Idle pose. Call `step` after each step; `worst` is the most seen.
 */
function idleWatch(swarm: Swarm, window = 1, slide = 0.25) {
  const x = swarm.x.slice()
  const z = swarm.z.slice()
  const idleAll = new Uint8Array(swarm.capacity).fill(1)
  let elapsed = 0
  let worst = 0
  return {
    step() {
      for (let i = 0; i < swarm.count; i++) if (swarm.gait[i] !== IDLE) idleAll[i] = 0
      elapsed += DT
      if (elapsed < window - 1e-9) return
      let sliding = 0
      for (let i = 0; i < swarm.count; i++) {
        if (idleAll[i] && Math.hypot(swarm.x[i] - x[i], swarm.z[i] - z[i]) > slide) sliding++
      }
      worst = Math.max(worst, sliding)
      x.set(swarm.x)
      z.set(swarm.z)
      idleAll.fill(1)
      elapsed = 0
    },
    get worst() {
      return worst
    },
  }
}

describe('a fresh swarm', () => {
  it('has nearly every rat running for the light', () => {
    const swarm = new Swarm(4000, SEED)
    swarm.reset(4000)
    const light = lightAt()
    const tuning = defaultTuning()
    run(swarm, 1.5, light, tuning)
    let running = 0
    for (let i = 0; i < swarm.count; i++) if (swarm.gait[i] === RUN) running++
    expect(running / swarm.count).toBeGreaterThan(0.85)
  })

  it('draws a rat that starts far away nearer to the light', () => {
    const swarm = new Swarm(200, SEED)
    swarm.reset(200)
    const light = lightAt()
    const tuning = defaultTuning()
    const far: [number, number][] = []
    for (let i = 0; i < swarm.count; i++) {
      const d = distanceTo(swarm, i, light)
      if (d > hardRadius(light, tuning) + tuning.gap + tuning.band + 4) far.push([i, d])
    }
    expect(far.length).toBeGreaterThan(10)

    run(swarm, 4, light, tuning)
    for (const [i, d] of far) expect(distanceTo(swarm, i, light)).toBeLessThan(d)
  })
})

describe('a still light', () => {
  it('ends up with no rat inside it, and most of a small swarm in the ring', () => {
    const { swarm, light, tuning } = settled(300)
    const report = run(swarm, 1, light, tuning)
    expect(report.inside).toBe(0)
    const inner = hardRadius(light, tuning)
    expect(within(swarm, light, inner)).toBe(0)
    expect(within(swarm, light, inner + tuning.gap + tuning.band) / swarm.count).toBeGreaterThan(0.5)
  })

  it('has the settled ring turn one way', () => {
    const { swarm, light, tuning } = settled(4000)
    const inner = hardRadius(light, tuning)
    const ringIn = inner + tuning.gap
    const ringOut = ringIn + tuning.band
    const x = swarm.x.slice()
    const z = swarm.z.slice()
    run(swarm, 0.25, light, tuning)
    let one = 0
    let other = 0
    for (let i = 0; i < swarm.count; i++) {
      const d = distanceTo(swarm, i, light)
      if (d < ringIn || d > ringOut) continue
      // The part of its move round the light: positive one way, negative the other.
      const ox = (swarm.x[i] - light.x) / d
      const oz = (swarm.z[i] - light.z) / d
      const around = (swarm.x[i] - x[i]) * -oz + (swarm.z[i] - z[i]) * ox
      if (around > 0.05) one++
      else if (around < -0.05) other++
    }
    expect(one + other).toBeGreaterThan(300)
    expect(Math.max(one, other) / (one + other)).toBeGreaterThan(0.9)
  })

  it('has the rats behind a ring packed all round stand and wait', () => {
    const { swarm, light, tuning } = settled(4000)
    const ringOut = hardRadius(light, tuning) + tuning.gap + tuning.band
    let behind = 0
    let standing = 0
    for (let i = 0; i < swarm.count; i++) {
      if (distanceTo(swarm, i, light) < ringOut + 1) continue
      behind++
      if (swarm.realSpeed[i] < 0.6) standing++
    }
    expect(behind).toBeGreaterThan(1000)
    expect(standing / behind).toBeGreaterThan(0.6)
  })
})

describe('the gait', () => {
  it('never shows Idle on a rat that moves: settling, under a walking light, and under a fast one', () => {
    const swarm = new Swarm(2000, SEED)
    swarm.reset(2000)
    const light = lightAt()
    const tuning = defaultTuning()
    const watch = idleWatch(swarm)
    run(swarm, 15, light, tuning, () => watch.step())
    walk(swarm, 5, light, tuning, { x: 6, z: 2 }, undefined, () => watch.step())
    walk(swarm, 4, light, tuning, { x: -6, z: -2 }, 4, () => watch.step())
    run(swarm, 3, light, tuning, () => watch.step())
    expect(watch.worst).toBe(0)
  })

  it('reads a real speed no faster than a little over the rat runs', () => {
    const { swarm, light, tuning } = settled(1000)
    run(swarm, 1, light, tuning)
    for (let i = 0; i < swarm.count; i++) {
      expect(swarm.realSpeed[i]).toBeGreaterThanOrEqual(0)
      expect(swarm.realSpeed[i]).toBeLessThan(swarm.speedOf(i, tuning) * 1.5)
    }
  })
})

describe('a walking light', () => {
  it('never sets a rat on its edge: it overtakes the rats it cannot part, and moves none', () => {
    const { swarm, light, tuning } = settled(4000)
    const target = { x: 8, z: 3 }
    let caught = 0
    for (let t = 0; t < 5; t += DT) {
      const x = swarm.x.slice()
      const z = swarm.z.slice()
      swarm.walkLight(light, target, DT)
      caught = Math.max(caught, swarm.step(DT, light, tuning).inside)
      for (let i = 0; i < swarm.count; i++) {
        // A rat goes no further in a step than its own legs and a shove off a
        // neighbour take it.
        const moved = Math.hypot(swarm.x[i] - x[i], swarm.z[i] - z[i])
        expect(moved).toBeLessThan(swarm.speedOf(i, tuning) * 1.25 * DT + tuning.ratRadius)
      }
    }
    // Walking into the mass, it is over some rats before they get out of its way.
    expect(caught).toBeGreaterThan(0)
  })

  it('has the mass follow it when it walks off', () => {
    const { swarm, light, tuning } = settled(2000)
    walk(swarm, 6, light, tuning, { x: 7, z: 0 })
    expect(light.x).toBeCloseTo(7, 3)
    run(swarm, 14, light, tuning)
    const near = within(swarm, light, hardRadius(light, tuning) + tuning.gap + tuning.band + 3)
    expect(near / swarm.count).toBeGreaterThan(0.9)
    expect(within(swarm, light, hardRadius(light, tuning))).toBe(0)
  })

  it('has rats arriving at the packed side of its ring go round to the empty side', () => {
    const { swarm, light, tuning } = settled(2000)
    // The light walks off along +x: the mass comes on from -x, and the ring's
    // +x side is empty until rats go round to it.
    walk(swarm, 6, light, tuning, { x: 7, z: 0 })
    const ringOut = hardRadius(light, tuning) + tuning.gap + tuning.band
    /** The share of the rats waiting behind the ring that wait on its empty side. */
    const farShare = () => {
      let far = 0
      let all = 0
      for (let i = 0; i < swarm.count; i++) {
        const d = distanceTo(swarm, i, light)
        if (d < ringOut || d > ringOut + 3) continue
        all++
        if (swarm.x[i] > light.x) far++
      }
      expect(all).toBeGreaterThan(300)
      return far / all
    }
    expect(farShare()).toBeLessThan(0.15)
    run(swarm, 14, light, tuning)
    expect(farShare()).toBeGreaterThan(0.25)
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

describe('a light faster than any rat', () => {
  it('overtakes them, and they are all out of it within a few seconds after it stops', () => {
    const { swarm, light, tuning } = settled(2000)
    let caught = 0
    walk(swarm, 2, light, tuning, { x: 8, z: 0 }, 4, (report) => (caught = Math.max(caught, report.inside)))
    expect(caught).toBeGreaterThan(10)
    const last = run(swarm, 4, light, tuning)
    expect(last.inside).toBe(0)
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

describe('the light dimmed', () => {
  it('shrinks the ring, and the swarm closes in to its new edge', () => {
    const { swarm, light, tuning } = settled(2000)
    const full = hardRadius(light, tuning)
    expect(within(swarm, light, full)).toBe(0)

    light.strength = 0.5
    let caught = 0
    run(swarm, 6, light, tuning, (report) => (caught = Math.max(caught, report.inside)))
    const dimmed = hardRadius(light, tuning)
    expect(dimmed).toBeCloseTo(full / 2, 6)
    // Nothing is caught by a light that shrank, and the ring follows its edge in.
    expect(caught).toBe(0)
    expect(within(swarm, light, dimmed)).toBe(0)
    expect(within(swarm, light, dimmed + tuning.gap + tuning.band)).toBeGreaterThan(swarm.count * 0.15)
  })
})

describe('the light out', () => {
  it('lets the rats close to within the ring of the holder', () => {
    const { swarm, light, tuning } = settled(2000)
    expect(within(swarm, light, tuning.band)).toBe(0)

    light.on = false
    run(swarm, 6, light, tuning)
    expect(within(swarm, light, tuning.band)).toBeGreaterThan(50)
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
    // And the swarm steps on, the newcomers with it, every one of them somewhere.
    run(swarm, 1, lightAt(), defaultTuning())
    for (let i = 0; i < 2000; i++) expect(Number.isFinite(swarm.x[i]) && Number.isFinite(swarm.z[i])).toBe(true)
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
  it('twice the size, in a ring as many rats deep, keeps its neighbours further off', () => {
    /** The spacing once rats `size` times the usual have settled. */
    const settledSpacing = (size: number) => {
      const usual = defaultTuning()
      return spacing(settled(600, { ...usual, ratRadius: usual.ratRadius * size, band: usual.band * size }).swarm)
    }
    expect(settledSpacing(2)).toBeGreaterThan(settledSpacing(1) * 1.5)
  })
})

describe('the tuning, changed on a running swarm', () => {
  /** The distance from the light to its `share`-th closest rat. */
  const nearestShare = (swarm: Swarm, light: Light, share: number) => {
    const d = Array.from({ length: swarm.count }, (_, i) => distanceTo(swarm, i, light)).sort((a, b) => a - b)
    return d[Math.floor(d.length * share)]
  }

  it('moves the ring out from the light when it keeps further off', () => {
    const { swarm, light, tuning } = settled(1000)
    const near = nearestShare(swarm, light, 0.05)

    tuning.gap += 0.6
    run(swarm, 4, light, tuning)
    expect(nearestShare(swarm, light, 0.05)).toBeGreaterThan(near + 0.4)
  })

  it('keeps bigger rats further apart, without a reset', () => {
    const { swarm, light, tuning } = settled(600)
    const before = spacing(swarm)

    tuning.ratRadius *= 2
    tuning.band *= 2
    run(swarm, 6, light, tuning)
    expect(spacing(swarm)).toBeGreaterThan(before * 1.5)
  })
})
