// The swarm, through its own calls only: set a situation up, step it at a fixed
// time step from a fixed seed, and read where the rats are, their gaits and
// real speeds, and what the steps reported. A test may stand rats where it
// wants them; nothing here reaches into the grid, the bodies or a rat's nerve.
// The thresholds have headroom, so the steering can be retuned without
// rewriting them.
import { describe, expect, it } from 'vitest'
import { defaultTuning, hardRadius, IDLE, leastRadius, mostRadius, RUN, Swarm, type Light, type StepReport, type Tuning } from './swarm'

const DT = 1 / 60
const SEED = 7

const lightAt = (x = 0, z = 0): Light => ({ x, z, strength: 1, on: true })

/**
 * How far outside the light's hard radius the front reaches: the boldest rat
 * holds at the edge, the most timid twice the gap off it, and a flinch carries
 * a rat a little further.
 */
const front = (light: Light, tuning: Tuning) => hardRadius(light, tuning) + 3 * tuning.gap

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
    // Stepped whether or not anyone reads the report.
    const report = swarm.step(DT, light, tuning)
    each?.(report)
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
      if (d > front(light, tuning) + 4) far.push([i, d])
    }
    expect(far.length).toBeGreaterThan(10)

    run(swarm, 4, light, tuning)
    for (const [i, d] of far) expect(distanceTo(swarm, i, light)).toBeLessThan(d)
  })
})

describe('a still light', () => {
  it('ends up with no rat inside it, and most of a small swarm pressed up to its front', () => {
    const { swarm, light, tuning } = settled(300)
    const report = run(swarm, 1, light, tuning)
    expect(report.inside).toBe(0)
    // The flame flickers inside the hard radius by angle; a rat within its least reach is inside it at any angle.
    expect(within(swarm, light, leastRadius(light, tuning))).toBe(0)
    expect(within(swarm, light, front(light, tuning)) / swarm.count).toBeGreaterThan(0.5)
  })

  it('has the front mill round it both ways at once', () => {
    const { swarm, light, tuning } = settled(4000)
    const inner = hardRadius(light, tuning)
    const outer = front(light, tuning)
    const x = swarm.x.slice()
    const z = swarm.z.slice()
    run(swarm, 0.25, light, tuning)
    let one = 0
    let other = 0
    for (let i = 0; i < swarm.count; i++) {
      const d = distanceTo(swarm, i, light)
      if (d < inner || d > outer) continue
      // The part of its move round the light: positive one way, negative the other.
      const ox = (swarm.x[i] - light.x) / d
      const oz = (swarm.z[i] - light.z) / d
      const around = (swarm.x[i] - x[i]) * -oz + (swarm.z[i] - z[i]) * ox
      if (around > 0.05) one++
      else if (around < -0.05) other++
    }
    expect(one + other).toBeGreaterThan(200)
    expect(Math.min(one, other) / (one + other)).toBeGreaterThan(0.25)
  })

  it('has rats at its front flinch back, and come again', () => {
    const { swarm, light, tuning } = settled(4000)
    const outer = front(light, tuning)
    const was = Array.from({ length: swarm.count }, (_, i) => distanceTo(swarm, i, light))
    const atFront = was.map((d, i) => (d < outer ? i : -1)).filter((i) => i >= 0)
    expect(atFront.length).toBeGreaterThan(500)

    // Within a second, a good few of them have given back a stride or more: some 4-6% of the front over
    // seeds, as the mass behind gives little.
    run(swarm, 1, light, tuning)
    const flinched = atFront.filter((i) => distanceTo(swarm, i, light) > was[i] + 0.3)
    expect(flinched.length).toBeGreaterThan(atFront.length * 0.03)

    // And a few seconds on, most of those are back at the front.
    run(swarm, 4, light, tuning)
    const back = flinched.filter((i) => distanceTo(swarm, i, light) < outer)
    expect(back.length / flinched.length).toBeGreaterThan(0.6)
  })

  it('has the rats behind a packed front wait, seething at a walk and never running', () => {
    const { swarm, light, tuning } = settled(4000)
    const outer = front(light, tuning)
    let behind = 0
    let slow = 0
    for (let i = 0; i < swarm.count; i++) {
      if (distanceTo(swarm, i, light) < outer) continue
      behind++
      if (swarm.realSpeed[i] < 0.75) slow++
    }
    expect(behind).toBeGreaterThan(1000)
    expect(slow / behind).toBeGreaterThan(0.6)
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

  it('catches fewer rats when they read its walk ahead', () => {
    /** The most rats caught at once as the light walks into a settled mass, reading `lookAhead` seconds of its walk. */
    const mostCaught = (lookAhead: number) => {
      const { swarm, light, tuning } = settled(4000)
      tuning.lookAhead = lookAhead
      let caught = 0
      walk(swarm, 5, light, tuning, { x: 8, z: 3 }, undefined, (report) => (caught = Math.max(caught, report.inside)))
      return caught
    }
    const blind = mostCaught(0)
    expect(blind).toBeGreaterThan(0)
    expect(mostCaught(0.8)).toBeLessThan(blind * 0.7)
  })

  it('has the mass follow it when it walks off', () => {
    const { swarm, light, tuning } = settled(2000)
    walk(swarm, 6, light, tuning, { x: 7, z: 0 })
    expect(light.x).toBeCloseTo(7, 3)
    run(swarm, 14, light, tuning)
    const near = within(swarm, light, front(light, tuning) + 3)
    expect(near / swarm.count).toBeGreaterThan(0.9)
    // The flame flickers inside the hard radius by angle; a rat within its least reach is inside it at any angle.
    expect(within(swarm, light, leastRadius(light, tuning))).toBe(0)
  })

  it('has rats arriving at the packed side of its front go round to the empty side', () => {
    const { swarm, light, tuning } = settled(2000)
    // The light runs off along +x, out of the mass: the mass comes on from -x,
    // and the front's +x side is empty until rats go round to it.
    walk(swarm, 2.5, light, tuning, { x: 10, z: 0 }, 4)
    expect(light.x).toBeCloseTo(10, 3)
    const outer = front(light, tuning)
    /** The rats at the front on its empty side. */
    const farAtFront = () => {
      let far = 0
      for (let i = 0; i < swarm.count; i++) {
        if (distanceTo(swarm, i, light) <= outer && swarm.x[i] > light.x) far++
      }
      return far
    }
    expect(farAtFront()).toBeLessThan(10)
    run(swarm, 20, light, tuning)
    const all = within(swarm, light, outer)
    expect(all).toBeGreaterThan(500)
    expect(farAtFront() / all).toBeGreaterThan(0.1)
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

describe('the dark, given', () => {
  /** The fog round the light, as the page reports it: nothing past this far from the light is seen. */
  const SEEN = 5

  /**
   * Walk the light toward `target` for `seconds`, the dark `radius` off it,
   * and hand `each` every rat that moved further in a step than its legs and
   * a shove take it, from where to where.
   */
  function walkInTheDark(
    swarm: Swarm,
    seconds: number,
    light: Light,
    tuning: Tuning,
    target: { x: number; z: number },
    speed: number | undefined,
    radius: number,
    each: (i: number, from: { x: number; z: number }, to: { x: number; z: number }) => void,
  ): void {
    for (let t = 0; t < seconds; t += DT) {
      const x = swarm.x.slice()
      const z = swarm.z.slice()
      swarm.walkLight(light, target, DT, speed)
      swarm.step(DT, light, tuning, { x: light.x, z: light.z, radius })
      moved(swarm, tuning, x, z, each)
    }
  }

  /** Hand `each` every rat further from where it was, (x, z), than its legs and a shove take it in a step. */
  function moved(
    swarm: Swarm,
    tuning: Tuning,
    x: Float32Array,
    z: Float32Array,
    each: (i: number, from: { x: number; z: number }, to: { x: number; z: number }) => void,
  ): void {
    for (let i = 0; i < swarm.count; i++) {
      const to = { x: swarm.x[i], z: swarm.z[i] }
      if (Math.hypot(to.x - x[i], to.z - z[i]) > swarm.speedOf(i, tuning) * 1.25 * DT + tuning.ratRadius) each(i, { x: x[i], z: z[i] }, to)
    }
  }

  it('has a walking light bring rats left behind in it round ahead, never where they are seen', () => {
    const { swarm, light, tuning } = settled(2000)
    let brought = 0
    walkInTheDark(swarm, 4, light, tuning, { x: 10, z: 0 }, 4, SEEN, (_, from, to) => {
      brought++
      // It walks along +x: taken from behind, set down ahead, both out of sight.
      expect(Math.hypot(from.x - light.x, from.z - light.z)).toBeGreaterThan(SEEN - 0.1)
      expect(Math.hypot(to.x - light.x, to.z - light.z)).toBeGreaterThan(SEEN - 0.1)
      expect(from.x).toBeLessThan(light.x)
      expect(to.x).toBeGreaterThan(light.x)
    })
    expect(brought).toBeGreaterThan(100)
  })

  it('marks the rats it brought round, that step and no longer', () => {
    const { swarm, light, tuning } = settled(2000)
    const marked = () => {
      const set = new Set<number>()
      for (let i = 0; i < swarm.count; i++) if (swarm.moved[i]) set.add(i)
      return set
    }
    let brought = 0
    for (let t = 0; t < 4; t += DT) {
      const x = swarm.x.slice()
      const z = swarm.z.slice()
      swarm.walkLight(light, { x: 10, z: 0 }, DT, 4)
      swarm.step(DT, light, tuning, { x: light.x, z: light.z, radius: SEEN })
      // Exactly the rats that moved further than their legs take them, and never one that ran.
      const seen = new Set<number>()
      moved(swarm, tuning, x, z, (i) => seen.add(i))
      expect(marked()).toEqual(seen)
      brought += seen.size
    }
    expect(brought).toBeGreaterThan(100)
    // The light held still, the marks are gone.
    swarm.step(DT, light, tuning, { x: light.x, z: light.z, radius: SEEN })
    expect(marked().size).toBe(0)
  })

  it('has a walking light keep the crowd round it that it would otherwise leave behind', () => {
    /** Rats in sight once the light has run off along +x, faster than they run. */
    const inSight = (dark: boolean) => {
      const { swarm, light, tuning } = settled(2000)
      for (let t = 0; t < 2.5; t += DT) {
        swarm.walkLight(light, { x: 10, z: 0 }, DT, 4)
        swarm.step(DT, light, tuning, dark ? { x: light.x, z: light.z, radius: SEEN } : undefined)
      }
      return within(swarm, light, SEEN)
    }
    expect(inSight(true)).toBeGreaterThan(inSight(false) * 4)
  })

  it('has a still light bring nobody round', () => {
    const { swarm, light, tuning } = settled(2000)
    let brought = 0
    walkInTheDark(swarm, 3, light, tuning, { x: 0, z: 0 }, undefined, SEEN, () => brought++)
    expect(brought).toBe(0)
  })

  it('sets no rat down inside the flame when the dark is tighter than the flame reaches', () => {
    const { swarm, light, tuning } = settled(2000)
    // The dark closes in well inside the flame's reach, as a tight fog has it: anywhere out of sight behind the light may be inside the flame ahead.
    const tight = hardRadius(light, tuning) - 0.5
    let brought = 0
    walkInTheDark(swarm, 4, light, tuning, { x: 10, z: 0 }, 4, tight, (_, __, to) => {
      brought++
      expect(Math.hypot(to.x - light.x, to.z - light.z)).toBeGreaterThan(mostRadius(light, tuning) + tuning.gap)
    })
    expect(brought).toBeGreaterThan(100)
  })

  it('brings nobody round once the light has halted, before its smoothed walk has', () => {
    const { swarm, light, tuning } = settled(2000)
    walkInTheDark(swarm, 2, light, tuning, { x: 10, z: 0 }, 4, SEEN, () => {})
    let brought = 0
    walkInTheDark(swarm, 1, light, tuning, { x: light.x, z: light.z }, 4, SEEN, () => brought++)
    expect(brought).toBe(0)
  })

  it('brings nobody round with the light out', () => {
    const { swarm, light, tuning } = settled(2000)
    light.on = false
    let brought = 0
    walkInTheDark(swarm, 3, light, tuning, { x: 10, z: 0 }, 4, SEEN, () => brought++)
    expect(brought).toBe(0)
  })

  it('brings as many round when handed the light every other step as every step', () => {
    /** Rats brought round over a 4 m/s walk of 4 s, the swarm handed where the light is only every `every` steps, as a slow page would. */
    const brought = (every: number) => {
      const { swarm, light, tuning } = settled(2000)
      const handed = { ...light }
      let n = 0
      for (let step = 0; step * DT < 4; step++) {
        const x = swarm.x.slice()
        const z = swarm.z.slice()
        swarm.walkLight(light, { x: 10, z: 0 }, DT, 4)
        if (step % every === 0) Object.assign(handed, light)
        swarm.step(DT, handed, tuning, { x: handed.x, z: handed.z, radius: SEEN })
        moved(swarm, tuning, x, z, () => n++)
      }
      return n
    }
    const everyStep = brought(1)
    expect(everyStep).toBeGreaterThan(100)
    expect(brought(2)).toBeGreaterThan(everyStep * 0.8)
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
  it('shrinks, and the swarm closes in to its new edge', () => {
    const { swarm, light, tuning } = settled(2000)
    const full = hardRadius(light, tuning)
    expect(within(swarm, light, full)).toBe(0)

    light.strength = 0.5
    let caught = 0
    run(swarm, 6, light, tuning, (report) => (caught = Math.max(caught, report.inside)))
    const dimmed = hardRadius(light, tuning)
    expect(dimmed).toBeCloseTo(full / 2, 6)
    // Nothing is caught by a light that shrank, and the front follows its edge in.
    expect(caught).toBe(0)
    expect(within(swarm, light, dimmed)).toBe(0)
    expect(within(swarm, light, front(light, tuning))).toBeGreaterThan(swarm.count * 0.15)
  })
})

describe('the light out', () => {
  it('lets the rats close on the holder', () => {
    const { swarm, light, tuning } = settled(2000)
    expect(within(swarm, light, 1)).toBe(0)

    light.on = false
    run(swarm, 6, light, tuning)
    expect(within(swarm, light, 1)).toBeGreaterThan(50)
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
  it('twice the size keeps its neighbours further off', () => {
    /** The spacing once rats `size` times the usual have settled. */
    const settledSpacing = (size: number) => {
      const usual = defaultTuning()
      return spacing(settled(600, { ...usual, ratRadius: usual.ratRadius * size }).swarm)
    }
    expect(settledSpacing(2)).toBeGreaterThan(settledSpacing(1) * 1.5)
  })
})

describe('the pile', () => {
  /** How many rats ride more than a fifth of a rat's height, split at the front (within two gaps of the light's edge) and the mass behind it. */
  const riding = (swarm: Swarm, light: Light, tuning: Tuning) => {
    const edge = hardRadius(light, tuning)
    const some = 0.2 * 1.2 * tuning.ratRadius * Math.max(tuning.pile, 1)
    let front = 0
    let behind = 0
    let behindAll = 0
    for (let i = 0; i < swarm.count; i++) {
      const off = distanceTo(swarm, i, light) - edge
      if (off < 2 * tuning.gap) {
        if (swarm.y[i] > some) front++
      } else {
        behindAll++
        if (swarm.y[i] > some) behind++
      }
    }
    return { front, behind, behindAll }
  }

  it('has rats behind a packed front ride up on the backs ahead of them, and the front keep to the ground', () => {
    // A mass deep enough to reach past the ramp: at 4,000 rats it stands some three metres deep.
    const { swarm, light, tuning } = settled(4000)
    const { front, behind, behindAll } = riding(swarm, light, tuning)
    expect(front).toBe(0)
    expect(behind).toBeGreaterThan(behindAll * 0.1)
  })

  it('is flat with the pile at nothing', () => {
    const { swarm, light, tuning } = settled(2000, { ...defaultTuning(), pile: 0 })
    const { front, behind } = riding(swarm, light, tuning)
    expect(front + behind).toBe(0)
    for (let i = 0; i < swarm.count; i++) expect(swarm.y[i]).toBe(0)
  })
})

describe('the step', () => {
  /** A swarm of `count` whose first rats stand where `at` says, the rest where the reset put them. */
  function placed(count: number, at: [number, number][], seed = SEED) {
    const swarm = new Swarm(count, seed)
    swarm.reset(count)
    at.forEach(([x, z], i) => {
      swarm.x[i] = x
      swarm.z[i] = z
    })
    return swarm
  }

  it('reads every neighbour as the last step left it: two rats meeting head on are mirror images', () => {
    // The light out over the holder between them, one speed and no writhing: nothing but the bodies tells them apart.
    const swarm = placed(2, [
      [-1, 0],
      [1, 0],
    ])
    const light = { ...lightAt(), on: false }
    const tuning = { ...defaultTuning(), agitation: 0, minSpeed: 1.6, maxSpeed: 1.6 }
    swarm.fear = false
    let met = false
    // A second: they meet and press, and stop short of passing the holder, where each draws its own side.
    for (let t = 0; t < 1; t += DT) {
      swarm.step(DT, light, tuning)
      const gap = swarm.x[1] - swarm.x[0]
      if (gap < 2 * tuning.ratRadius) met = true
      expect(swarm.x[0]).toBe(-swarm.x[1])
    }
    expect(met).toBe(true)
  })

  it('draws each rat its own chances: a rat added far off changes nothing for the others', () => {
    const pair: [number, number][] = [
      [-1, 0.3],
      [1, -0.2],
    ]
    const light = { ...lightAt(), on: false }
    const tuning = defaultTuning()
    const alone = placed(2, pair)
    const joined = placed(3, [...pair, [0, -6]])
    for (let t = 0; t < 0.5; t += DT) {
      alone.step(DT, light, tuning)
      joined.step(DT, light, tuning)
    }
    expect(Math.hypot(joined.x[2], joined.z[2])).toBeGreaterThan(4)
    for (let i = 0; i < 2; i++) {
      expect(joined.x[i]).toBe(alone.x[i])
      expect(joined.z[i]).toBe(alone.z[i])
    }
  })

  it('is the same run for the same seed, and another for another', () => {
    const after = (seed: number) => {
      const swarm = new Swarm(500, seed)
      swarm.reset(500)
      const light = lightAt()
      walk(swarm, 2, light, defaultTuning(), { x: 4, z: 1 })
      return Array.from(swarm.x.slice(0, 500))
    }
    expect(after(SEED)).toEqual(after(SEED))
    expect(after(SEED + 1)).not.toEqual(after(SEED))
  })
})

describe('the tuning, changed on a running swarm', () => {
  /** The distance from the light to its `share`-th closest rat. */
  const nearestShare = (swarm: Swarm, light: Light, share: number) => {
    const d = Array.from({ length: swarm.count }, (_, i) => distanceTo(swarm, i, light)).sort((a, b) => a - b)
    return d[Math.floor(d.length * share)]
  }

  it('moves the front out from the light when the rats keep further off', () => {
    const { swarm, light, tuning } = settled(1000)
    const near = nearestShare(swarm, light, 0.05)

    tuning.gap += 0.6
    run(swarm, 4, light, tuning)
    expect(nearestShare(swarm, light, 0.05)).toBeGreaterThan(near + 0.25)
  })

  it('keeps bigger rats further apart, without a reset', () => {
    const { swarm, light, tuning } = settled(600)
    const before = spacing(swarm)

    tuning.ratRadius *= 2
    run(swarm, 6, light, tuning)
    expect(spacing(swarm)).toBeGreaterThan(before * 1.5)
  })
})
