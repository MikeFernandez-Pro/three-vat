// The run, through its own calls only: a small level written here, stepped by
// input at a fixed time step, and read for what a player would see: where
// the holder stands, whether the torch burns and how far it reaches, and
// whether the player was caught.
import { describe, expect, it } from 'vitest'
import { Run, defaultRunTuning, type Level, type RunInput } from './run'

const DT = 1 / 60
const ARENA = 30

/** A brazier ten metres east of the start, and a lit window ten metres west. */
const level = (): Level => ({
  start: { x: 0, z: 0 },
  lights: [
    { x: 10, z: 0, reach: 1.5, flame: true, on: true },
    { x: -10, z: 0, reach: 2, flame: false, on: true },
  ],
})

/** A frame of input: nothing held, no rat at the holder. */
const still = (extra: Partial<RunInput> = {}): RunInput => ({ dt: DT, toward: null, speed: 2, arena: ARENA, interact: false, reached: 0, ...extra })

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
      inputs.push(still({ toward, speed: 1 + (i % 7) * 0.3, interact: i % 50 === 0, reached: i % 400 > 380 ? 10 : 0 }))
    }
    const trace = () => {
      const run = new Run(level(), { ...defaultRunTuning(), burnRate: 0.08 })
      return inputs.map((input) => {
        run.step(input)
        return [run.holder.x, run.holder.z, run.fuel, run.torch.reach, run.torch.lit, run.caught]
      })
    }
    const first = trace()
    expect(trace()).toEqual(first)
    // And the trace is not trivial: the torch went out and the player was caught along the way.
    expect(first.some(([, , fuel]) => fuel === 0)).toBe(true)
    expect(first.some(([, , , , , caught]) => (caught as number) > 0)).toBe(true)
  })
})
