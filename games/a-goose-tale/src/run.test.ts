// The run, through its own calls only: a small level written here, stepped by
// input at a fixed time step, and read for what a player would see: where
// the holder stands and the way he faces, and whether the torch burns and
// how far it reaches.
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
  bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 },
})

/** A frame of input: nothing held. */
const still = (extra: Partial<RunInput> = {}): RunInput => ({ dt: DT, toward: null, speed: 2, arena: ARENA, ...extra })

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

  it('holds full until the holder is first sent somewhere, then burns standing as well as walking', () => {
    const tuning = { ...defaultRunTuning(), burnRate: 0.05 }
    const run = new Run(level(), tuning)
    play(run, 4)
    expect(run.started).toBe(false)
    expect(run.fuel).toBe(1)
    play(run, 1, still({ toward: { x: 0, z: -10 } }))
    expect(run.started).toBe(true)
    expect(run.fuel).toBeCloseTo(0.95, 6)
    play(run, 2)
    expect(run.fuel).toBeCloseTo(0.85, 6)
  })

  it('burns its fuel at the set rate', () => {
    const tuning = { ...defaultRunTuning(), burnRate: 0.05 }
    const run = new Run(level(), tuning)
    run.started = true
    play(run, 4)
    expect(run.fuel).toBeCloseTo(0.8, 6)
    tuning.burnRate = 0.1
    play(run, 2)
    expect(run.fuel).toBeCloseTo(0.6, 6)
  })

  it('goes out at empty, and stays out', () => {
    const tuning = { ...defaultRunTuning(), burnRate: 0.25 }
    const run = new Run(level(), tuning)
    run.started = true
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
    run.started = true
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

  it('shrinks to its least reach rather than nothing while lit, along its curve', () => {
    const tuning = { ...defaultRunTuning(), burnRate: 0.1, fade: 1, torchReach: 2, torchLeast: 0.5, fadeCurve: 0.5 }
    const run = new Run(level(), tuning)
    run.started = true
    expect(run.torch.reach).toBeCloseTo(2, 6)
    // A quarter of the fuel left: the least and the root of a quarter, a half, of the rest.
    play(run, 7.5)
    expect(run.torch.reach).toBeCloseTo(0.5 + 1.5 * 0.5, 4)
    play(run, 2.4)
    expect(run.torch.lit).toBe(true)
    expect(run.torch.reach).toBeGreaterThan(0.5)
    play(run, 0.2)
    expect(run.torch.reach).toBe(0)
  })

  it('reaches as far as the tuning says, live', () => {
    const tuning = defaultRunTuning()
    const run = new Run(level(), tuning)
    run.started = true
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

  it('faces the way it last walked, north at first, and keeps facing it standing', () => {
    const run = new Run(level(), defaultRunTuning())
    expect(run.facing).toEqual({ x: 0, z: -1 })
    play(run, 0.5, still({ toward: { x: 10, z: 0 } }))
    expect(run.facing.x).toBeCloseTo(1, 6)
    expect(run.facing.z).toBeCloseTo(0, 6)
    play(run, 1)
    expect(run.facing.x).toBeCloseTo(1, 6)
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

describe('a run', () => {
  it('is the same run for the same inputs, twice', () => {
    const inputs: RunInput[] = []
    for (let i = 0; i < 1200; i++) {
      const toward = i % 300 < 200 ? { x: Math.sin(i * 0.01) * 12, z: Math.cos(i * 0.013) * 9 } : null
      inputs.push(still({ toward, speed: 1 + (i % 7) * 0.3 }))
    }
    const trace = () => {
      const run = new Run(level(), { ...defaultRunTuning(), burnRate: 0.08 })
      return inputs.map((input) => {
        run.step(input)
        return [run.holder.x, run.holder.z, run.facing.x, run.facing.z, run.fuel, run.torch.reach, run.torch.lit]
      })
    }
    const first = trace()
    expect(trace()).toEqual(first)
    // And the trace is not trivial: the torch went out along the way.
    expect(first.some(([, , , , fuel]) => fuel === 0)).toBe(true)
  })
})
