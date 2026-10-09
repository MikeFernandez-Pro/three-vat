// The run, through its own calls only: a small level written here, stepped by
// input at a fixed time step, and read for what a player would see: where
// the holder stands, whether the torch burns and how far it reaches, and
// whether the player was caught.
import { describe, expect, it } from 'vitest'
import { Run, defaultRunTuning, type Level, type RunInput } from './run'
import { HOLDER_RADIUS, WALL_THICKNESS } from './walls'

const DT = 1 / 60
const ARENA = 30

/** A brazier ten metres east of the start, and a lit window ten metres west. */
const level = (): Level => ({
  start: { x: 0, z: 0 },
  lights: [
    { x: 10, z: 0, reach: 1.5, flame: true, on: true },
    { x: -10, z: 0, reach: 2, flame: false, on: true },
  ],
  walls: [],
  wind: [],
  bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 },
})

/** A frame of input: nothing held, no rat at the holder or at any light. */
const still = (extra: Partial<RunInput> = {}): RunInput => ({ dt: DT, toward: null, speed: 2, arena: ARENA, interact: false, reached: 0, atLights: [], ...extra })

/** Step `seconds` of the run under the same input. */
function play(run: Run, seconds: number, input: RunInput = still()): void {
  for (let t = 0; t < seconds - 1e-9; t += input.dt) run.step(input)
}

/** Walk the holder to (x, z) and stand there. */
function walkTo(run: Run, x: number, z: number): void {
  for (let i = 0; i < 100_000 && Math.hypot(run.holder.x - x, run.holder.z - z) > 1e-6; i++) run.step(still({ toward: { x, z } }))
}

describe('the torch', () => {
  it('starts full, lit and at its full reach, held at the start', () => {
    const run = new Run(level(), defaultRunTuning())
    expect(run.fuel).toBe(1)
    expect(run.torch).toEqual({ x: 0, z: 0, reach: defaultRunTuning().torchReach, lit: true })
  })

  it('burns its fuel at the set rate', () => {
    const tuning = { ...defaultRunTuning(), burnRate: 0.05 }
    const run = new Run(level(), tuning)
    play(run, 4)
    expect(run.fuel).toBeCloseTo(0.8, 6)
    tuning.burnRate = 0.1
    play(run, 2)
    expect(run.fuel).toBeCloseTo(0.6, 6)
  })

  it('goes out at empty, and stays out', () => {
    const tuning = { ...defaultRunTuning(), burnRate: 0.25 }
    const run = new Run(level(), tuning)
    play(run, 3.9)
    expect(run.torch.lit).toBe(true)
    play(run, 0.2)
    expect(run.fuel).toBe(0)
    expect(run.torch.lit).toBe(false)
    expect(run.torch.reach).toBe(0)
    play(run, 5)
    expect(run.fuel).toBe(0)
    expect(run.torch.lit).toBe(false)
  })

  it('reaches its full length for most of the fuel, and shrinks to nothing over the last part', () => {
    const tuning = { ...defaultRunTuning(), burnRate: 0.1, fade: 0.25 }
    const full = tuning.torchReach
    const run = new Run(level(), tuning)
    const reachAt: number[] = []
    // A reading every half second: fuel 1, 0.95, ... 0.
    for (let i = 0; i <= 20; i++) {
      reachAt.push(run.torch.reach)
      play(run, 0.5)
    }
    // Full down to a quarter of the fuel.
    for (let i = 0; i <= 15; i++) expect(reachAt[i]).toBeCloseTo(full, 6)
    // Then less at every reading, to nothing.
    for (let i = 16; i <= 20; i++) expect(reachAt[i]).toBeLessThan(reachAt[i - 1] - 1e-6)
    expect(reachAt[18]).toBeCloseTo(full * 0.4, 6)
    expect(reachAt[20]).toBe(0)
  })

  it('reaches as far as the tuning says, live', () => {
    const tuning = defaultRunTuning()
    const run = new Run(level(), tuning)
    tuning.torchReach = 2.5
    run.step(still())
    expect(run.torch.reach).toBeCloseTo(2.5, 6)
  })
})

describe('the holder', () => {
  it('walks toward where it is sent at the speed asked, and the torch goes with it', () => {
    const run = new Run(level(), defaultRunTuning())
    play(run, 1, still({ toward: { x: 0, z: -10 }, speed: 2 }))
    expect(run.holder.x).toBeCloseTo(0, 6)
    expect(run.holder.z).toBeCloseTo(-2, 6)
    expect(run.torch.x).toBe(run.holder.x)
    expect(run.torch.z).toBe(run.holder.z)
  })

  it('stays a metre inside the arena', () => {
    const run = new Run(level(), defaultRunTuning())
    play(run, 10, still({ toward: { x: 0, z: -100 }, speed: 5, arena: 12 }))
    expect(Math.hypot(run.holder.x, run.holder.z)).toBeCloseTo(11, 6)
  })

  it('is stopped by a wall in its way, however fast it is sent, and walks round it', () => {
    // A wall two metres east, four long, across the way to a brazier.
    const lv = { ...level(), walls: [{ from: { x: 2, z: -2 }, to: { x: 2, z: 2 } }] }
    const run = new Run(lv, defaultRunTuning())
    let east = -Infinity
    for (let t = 0; t < 5; t += DT) {
      run.step(still({ toward: { x: 10, z: 0 }, speed: 12 }))
      east = Math.max(east, run.holder.x)
    }
    // Its body's half-width off the wall's face, and no further.
    expect(east).toBeLessThanOrEqual(2 - WALL_THICKNESS / 2 - HOLDER_RADIUS + 1e-6)
    walkTo(run, 0, 3)
    walkTo(run, 10, 3)
    expect(run.holder.x).toBeCloseTo(10, 6)
    expect(run.holder.z).toBeCloseTo(3, 6)
  })
})

describe('refuelling', () => {
  it('fills the torch when it is dipped into a flame', () => {
    const tuning = { ...defaultRunTuning(), burnRate: 0.05 }
    const run = new Run(level(), tuning)
    walkTo(run, 10 - tuning.dip * 2, 0)
    expect(run.fuel).toBeLessThan(0.9)
    walkTo(run, 10 - tuning.dip * 0.5, 0)
    expect(run.fuel).toBe(1)
  })

  it('refills a torch that has gone out', () => {
    const tuning = { ...defaultRunTuning(), burnRate: 1 }
    const run = new Run(level(), tuning)
    play(run, 2)
    expect(run.torch.lit).toBe(false)
    walkTo(run, 10, 0)
    expect(run.fuel).toBe(1)
    expect(run.torch.lit).toBe(true)
  })

  it("comes from no window's light, however deep in it the holder stands", () => {
    const tuning = { ...defaultRunTuning(), burnRate: 0.05 }
    const run = new Run(level(), tuning)
    walkTo(run, -10, 0)
    const fuel = run.fuel
    play(run, 2)
    expect(run.fuel).toBeCloseTo(fuel - 0.1, 6)
  })

  it('needs the flame lit', () => {
    const tuning = { ...defaultRunTuning(), burnRate: 0.05 }
    const lv = level()
    lv.lights[0]!.on = false
    const run = new Run(lv, tuning)
    walkTo(run, 10, 0)
    expect(run.fuel).toBeLessThan(0.9)
  })
})

describe('the lights', () => {
  it('are handed on as they stand: where each is, its reach, and lit', () => {
    const lv = level()
    const run = new Run(lv, defaultRunTuning())
    expect(run.lights()).toEqual([
      { x: 10, z: 0, reach: 1.5, on: true },
      { x: -10, z: 0, reach: 2, on: true },
    ])
    // The level's reach, edited live as the panel does, and a light put out.
    lv.lights[0]!.reach = 3
    lv.lights[1]!.on = false
    expect(run.lights()).toEqual([
      { x: 10, z: 0, reach: 3, on: true },
      { x: -10, z: 0, reach: 2, on: false },
    ])
  })
})

/**
 * The level with a wind zone to the north, from z -4 to -12, and in it a
 * fragile flame and an ordinary one; a fragile flame to the south, out of the
 * wind. The lights after the level's two: 2 the fragile flame in the wind, 3
 * the ordinary one beside it, 4 the fragile one out of it.
 */
const windy = (): Level => {
  const lv = level()
  lv.wind.push({ minX: -6, maxX: 6, minZ: -12, maxZ: -4 })
  lv.lights.push(
    { x: -3, z: -8, reach: 1, flame: true, on: true, fragile: true },
    { x: 3, z: -8, reach: 1, flame: true, on: true },
    { x: 0, z: 8, reach: 1, flame: true, on: true, fragile: true },
  )
  return lv
}

/** Gusts every six seconds, two long: calm to 4 s, a gust to 6 s, calm to 10 s, a gust to 12 s. */
const gusty = () => ({ ...defaultRunTuning(), burnRate: 0.01, windDrain: 0.04, gustDrain: 0.1, gustEvery: 6, gustLength: 2 })

describe('the wind', () => {
  it('drains the torch faster inside a wind zone than outside it, and faster still in a gust', () => {
    const run = new Run(windy(), gusty())
    // Outside it, the steady rate alone.
    play(run, 1)
    expect(run.fuel).toBeCloseTo(1 - 0.01, 6)
    // Inside it, the wind's on top, through the calm its gusts start with: four seconds from the holder coming in.
    run.holder.z = -6
    let was = run.fuel
    play(run, 3)
    expect(run.fuel).toBeCloseTo(was - 3 * (0.01 + 0.04), 6)
    // In the gust, from four seconds in to six, the gust's on top of that.
    play(run, 1.5)
    was = run.fuel
    play(run, 1)
    expect(run.fuel).toBeCloseTo(was - (0.01 + 0.04 + 0.1), 6)
    // Out of it, in the gust's own time, the steady rate alone.
    run.holder.z = 0
    was = run.fuel
    play(run, 0.4)
    expect(run.gusting(0)).toBe(true)
    expect(run.fuel).toBeCloseTo(was - 0.4 * 0.01, 6)
  })

  it('gusts on the set timing, from the holder first coming into the zone, and the timing is read live', () => {
    const tuning = gusty()
    const run = new Run(windy(), tuning)
    // Nobody has come yet: no gust, however long.
    play(run, 10)
    expect(run.gusting(0)).toBe(false)
    run.holder.z = -6
    const gusting: boolean[] = []
    // A reading every half second, between the steps; the holder leaves after the first gust, and the gusts keep time.
    for (let t = 0; t < 24; t++) {
      if (t === 14) run.holder.z = 0
      play(run, 0.5)
      gusting.push(run.gusting(0))
    }
    // After 0.5 s, 1 s, ... : a gust from 4 s to 6 s and from 10 s to 12 s.
    const at = (s: number) => gusting[s * 2 - 1]
    expect([1, 2, 3, 3.5].map(at)).toEqual([false, false, false, false])
    expect([4.5, 5, 5.5].map(at)).toEqual([true, true, true])
    expect([6.5, 8, 9.5].map(at)).toEqual([false, false, false])
    expect([10.5, 11.5].map(at)).toEqual([true, true])
    // At 12.5 s, half a second into a calm: a gust 5.8 s long blows from 0.2 s into each cycle, at once.
    tuning.gustLength = 5.8
    play(run, 0.5)
    expect(run.gusting(0)).toBe(true)
  })

  it('puts out a fragile flame in its zone with a gust, and leaves the ordinary flame beside it and a fragile flame out of the wind lit', () => {
    const run = new Run(windy(), gusty())
    run.holder.z = -6
    play(run, 3.9)
    expect(run.lights().map((l) => l.on)).toEqual([true, true, true, true, true])
    play(run, 0.2)
    expect(run.lights().map((l) => l.on)).toEqual([true, true, false, true, true])
  })

  it('waits for the holder again once the player is caught and the run starts again', () => {
    const run = new Run(windy(), { ...gusty(), burnRate: 0.2 })
    run.holder.z = -6
    play(run, 4.5)
    expect(run.gusting(0)).toBe(true)
    run.step(still({ reached: 100 }))
    expect(run.caught).toBe(1)
    play(run, 10)
    expect(run.gusting(0)).toBe(false)
  })

  it('starts the time of every zone the holder comes into, where two overlap', () => {
    // A second zone over the first's east half, reaching on east past it; the fragile flame out of the wind moved into its far end.
    const lv = windy()
    lv.wind.push({ minX: 0, maxX: 12, minZ: -12, maxZ: -4 })
    lv.lights[4] = { x: 10, z: -8, reach: 1, flame: true, on: true, fragile: true }
    const run = new Run(lv, gusty())
    run.holder.x = 1
    run.holder.z = -6
    play(run, 4.5)
    expect([run.gusting(0), run.gusting(1)]).toEqual([true, true])
    expect(run.lights()[4]!.on).toBe(false)
  })

  it('never gusts with no gusts set, and drains no faster than the wind does', () => {
    const tuning = { ...gusty(), gustLength: 0 }
    const run = new Run(windy(), tuning)
    run.holder.z = -6
    play(run, 13)
    expect(run.gusting(0)).toBe(false)
    expect(run.fuel).toBeCloseTo(1 - 13 * 0.05, 6)
    expect(run.lights()[2]!.on).toBe(true)
  })
})

describe('a fragile flame', () => {
  it('is put out by the rats overrunning it, and an ordinary flame never is', () => {
    const tuning = defaultRunTuning()
    const run = new Run(windy(), tuning)
    const atLights = [0, 0, tuning.overrun - 1, 1000, 0]
    play(run, 1, still({ atLights }))
    expect(run.lights().map((l) => l.on)).toEqual([true, true, true, true, true])
    atLights[2] = tuning.overrun
    run.step(still({ atLights }))
    expect(run.lights().map((l) => l.on)).toEqual([true, true, false, true, true])
  })

  it('stays out once put out: no light, and no fuel however long the torch is held in it', () => {
    const tuning = { ...defaultRunTuning(), burnRate: 0.05 }
    const run = new Run(windy(), tuning)
    run.step(still({ atLights: [0, 0, 0, 0, tuning.overrun] }))
    walkTo(run, 0, 8)
    const fuel = run.fuel
    play(run, 2)
    expect(run.fuel).toBeCloseTo(fuel - 0.1, 6)
    // The rats long gone from it.
    expect(run.lights()[4]!.on).toBe(false)
  })

  it('refuels the torch while it burns, as any flame', () => {
    const tuning = { ...defaultRunTuning(), burnRate: 0.05 }
    const run = new Run(windy(), tuning)
    walkTo(run, 0, 6)
    expect(run.fuel).toBeLessThan(0.9)
    walkTo(run, 0, 8)
    expect(run.fuel).toBe(1)
  })

  it('burns again when the run starts again after the player is caught', () => {
    const tuning = { ...defaultRunTuning(), burnRate: 0.5 }
    const run = new Run(windy(), tuning)
    run.step(still({ atLights: [0, 0, tuning.overrun, 0, tuning.overrun] }))
    expect(run.lights().map((l) => l.on)).toEqual([true, true, false, true, false])
    play(run, 3)
    run.step(still({ reached: tuning.catchCount }))
    expect(run.caught).toBe(1)
    expect(run.lights().map((l) => l.on)).toEqual([true, true, true, true, true])
  })
})

describe('caught', () => {
  it('is what the rats reaching the holder do once the torch is out, and the run starts again with a full torch', () => {
    const tuning = { ...defaultRunTuning(), burnRate: 0.5 }
    const run = new Run(level(), tuning)
    walkTo(run, 3, 4)
    play(run, 3)
    expect(run.torch.lit).toBe(false)
    expect(run.caught).toBe(0)
    // A few rats, not yet enough.
    run.step(still({ reached: tuning.catchCount - 1 }))
    expect(run.caught).toBe(0)
    run.step(still({ reached: tuning.catchCount }))
    expect(run.caught).toBe(1)
    expect(run.holder).toEqual({ x: 0, z: 0 })
    expect(run.fuel).toBe(1)
    expect(run.torch.lit).toBe(true)
  })

  it('does not come while the torch burns, whatever the rats', () => {
    const run = new Run(level(), defaultRunTuning())
    play(run, 1, still({ reached: 100 }))
    expect(run.caught).toBe(0)
  })
})

describe('a run', () => {
  it('is the same run for the same inputs, twice', () => {
    const inputs: RunInput[] = []
    for (let i = 0; i < 1200; i++) {
      const toward = i % 300 < 200 ? { x: Math.sin(i * 0.01) * 12, z: Math.cos(i * 0.013) * 9 } : null
      inputs.push(still({ toward, speed: 1 + (i % 7) * 0.3, interact: i % 50 === 0, reached: i % 400 > 380 ? 10 : 0, atLights: [0, 0, 0, 0, i > 900 ? 100 : 0] }))
    }
    const trace = () => {
      const run = new Run(windy(), { ...gusty(), burnRate: 0.08 })
      return inputs.map((input) => {
        run.step(input)
        return [run.holder.x, run.holder.z, run.fuel, run.torch.reach, run.torch.lit, run.caught, run.gusting(0), ...run.lights().map((l) => l.on)]
      })
    }
    const first = trace()
    expect(trace()).toEqual(first)
    // And the trace is not trivial: the torch went out and the player was caught along the way.
    expect(first.some(([, , fuel]) => fuel === 0)).toBe(true)
    expect(first.some(([, , , , , caught]) => (caught as number) > 0)).toBe(true)
  })
})
