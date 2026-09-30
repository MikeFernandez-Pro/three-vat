import { describe, expect, it } from 'vitest'
import type { Simulation } from './simulation/simulation'
import { FPS, run, simulate } from './simulation/test-crowds'
import { TouchSticks, type ContactPhase } from './touch-sticks'

// The touch controls over a real simulation: contacts go in as a player's
// thumb would put them down, and what comes out is what the run shows, where
// Santa stands and faces, and when and at what he throws.

const LEFT = { x: 200, y: 200 }
const RIGHT = { x: 600, y: 200 }
/** Tap reach, in units: the rule under test, restated. */
const REACH = 14

/** Skeletons rise at (17, 0), then (-17, 0), turn about, so the first is always the nearer. */
function eastThenWest() {
  let spawns = 0
  return () => (spawns++ % 2 === 0 ? 0 : 0.5)
}

type Skeletons = Simulation['skeletons']

const distanceToSanta = (sim: Simulation, skeleton: Skeletons[number]) =>
  Math.hypot(skeleton.position.x - sim.santa.position.x, skeleton.position.z - sim.santa.position.z)

/** The standing skeletons within reach, nearest first. */
function inReach(sim: Simulation) {
  return sim.skeletons
    .filter(({ state }) => state === 'rising' || state === 'walking')
    .filter((skeleton) => distanceToSanta(sim, skeleton) < REACH)
    .sort((a, b) => distanceToSanta(sim, a) - distanceToSanta(sim, b))
}

async function play(random?: () => number) {
  const { simulation: sim } = await simulate(random ? { random } : {})
  const sticks = new TouchSticks(sim)
  /** Each throw: the frame, the way Santa faced, and the nearest skeleton in reach as he threw, if any. */
  const shots: { at: number; facing: number; nearest: Skeletons[number] | undefined; toward: number | null }[] = []
  sim.on('shoot', ({ facing }) => {
    const [nearest] = inReach(sim)
    const toward = nearest
      ? Math.atan2(nearest.position.x - sim.santa.position.x, nearest.position.z - sim.santa.position.z)
      : null
    shots.push({ at: Math.round(sim.elapsed * FPS), facing, nearest, toward })
  })
  sim.start(0)
  let t = 0
  return {
    sim,
    sticks,
    shots,
    /** Put a contact down, move it or lift it, now. */
    touch(phase: ContactPhase, id: number, at: { x: number; y: number }) {
      sticks.touch(phase, { id, x: at.x, y: at.y })
    },
    /** Play `seconds` of frames, each on the input the thumb gives. */
    wait(seconds: number) {
      t = run(sim, t, seconds, () => sticks.sample())
    },
    /** Play until `done`, or fail after `limit` seconds. */
    until(done: () => boolean, limit = 30) {
      const from = t
      while (!done()) {
        if (t - from > limit) throw new Error(`nothing happened in ${limit} s`)
        t = run(sim, t, 1 / FPS, () => sticks.sample())
      }
    },
  }
}

const offset = (from: { x: number; y: number }, x: number, y: number) => ({ x: from.x + x, y: from.y + y })

describe('the move stick', () => {
  it('walks Santa the way it is pushed, at the keyboard speed', async () => {
    const game = await play()
    game.wait(0.5) // let him land
    const before = game.sim.santa.position.clone()

    game.touch('down', 1, LEFT)
    game.touch('move', 1, offset(LEFT, 200, 200)) // past the rim: clamped
    game.wait(1)

    const moved = game.sim.santa.position.clone().sub(before)
    expect(moved.x).toBeCloseTo(moved.z, 1)
    expect(moved.x).toBeGreaterThan(0)
    expect(Math.hypot(moved.x, moved.z)).toBeGreaterThan(7.0)
    expect(Math.hypot(moved.x, moved.z)).toBeLessThan(7.6)
    expect(game.sim.santa.moving).toBe(true)
  })

  it('lands wherever the thumb does, the right half too, and moves at one speed past its dead zone', async () => {
    const game = await play()
    game.wait(0.5)
    const before = game.sim.santa.position.clone()

    game.touch('down', 1, RIGHT)
    game.touch('move', 1, offset(RIGHT, 0, -20)) // a third of the way out: up the screen
    game.wait(1)

    const moved = game.sim.santa.position.clone().sub(before)
    expect(moved.x).toBeCloseTo(0, 2)
    expect(moved.z).toBeLessThan(-7.0)
    expect(moved.z).toBeGreaterThan(-7.6)
  })

  it('moves nothing inside its dead zone', async () => {
    const game = await play()
    game.wait(0.5)
    const before = game.sim.santa.position.clone()

    game.touch('down', 1, LEFT)
    game.touch('move', 1, offset(LEFT, 8, 6))
    game.wait(1)

    expect(game.sim.santa.position.distanceTo(before)).toBeLessThan(0.05)
    expect(game.sim.santa.moving).toBe(false)
  })

  it('stops Santa when the thumb lifts', async () => {
    const game = await play()
    game.touch('down', 1, LEFT)
    game.touch('move', 1, offset(LEFT, 60, 0))
    game.wait(0.5)
    game.touch('up', 1, offset(LEFT, 60, 0))
    game.wait(2 / FPS) // the release lands one step late, as the keys' does
    const released = game.sim.santa.position.clone()

    game.wait(1)

    expect(game.sim.santa.position.x).toBeCloseTo(released.x, 1)
    expect(game.sim.santa.moving).toBe(false)
  })

  it('follows the thumb that started it, and ignores a second', async () => {
    const game = await play()
    game.wait(0.5)
    const before = game.sim.santa.position.clone()

    game.touch('down', 1, LEFT)
    game.touch('move', 1, offset(LEFT, 60, 0))
    game.touch('down', 2, RIGHT)
    game.touch('move', 2, offset(RIGHT, 0, 60))
    game.wait(1)

    expect(game.sim.santa.position.x - before.x).toBeGreaterThan(7)
    expect(game.sim.santa.position.z - before.z).toBeCloseTo(0, 1)
  })

  it('lets go on a cancel, and when the page loses focus', async () => {
    const game = await play()
    game.touch('down', 1, LEFT)
    game.touch('move', 1, offset(LEFT, 60, 0))
    game.wait(0.3)
    game.touch('cancel', 1, offset(LEFT, 60, 0))
    game.wait(2 / FPS)
    const cancelled = game.sim.santa.position.clone()
    game.wait(0.5)
    expect(game.sim.santa.position.x).toBeCloseTo(cancelled.x, 1)

    game.touch('down', 3, LEFT)
    game.touch('move', 3, offset(LEFT, 0, 60))
    game.wait(0.3)
    game.sticks.letGo()
    game.wait(2 / FPS)
    const blurred = game.sim.santa.position.clone()
    game.wait(0.5)
    expect(game.sim.santa.position.z).toBeCloseTo(blurred.z, 1)
    expect(game.sim.santa.moving).toBe(false)
  })

  it('turns Santa the way he walks while there is nothing to throw at', async () => {
    const game = await play()
    game.touch('down', 1, LEFT)
    game.touch('move', 1, offset(LEFT, -60, 0)) // screen left: -x
    game.wait(0.3)
    expect(game.sim.santa.facing).toBeCloseTo(-Math.PI / 2, 2)

    game.touch('move', 1, offset(LEFT, 0, 60)) // screen down: +z
    game.wait(0.1)
    expect(game.sim.santa.facing).toBeCloseTo(0, 2)
  })
})

describe('Santa throws by himself', () => {
  it('at nothing, before a skeleton is in reach', async () => {
    const game = await play(() => 0)
    // The first rises 17 units out: seen, but out of reach.
    game.until(() => game.sim.skeletons.length > 0)
    game.wait(0.2)
    expect(distanceToSanta(game.sim, game.sim.skeletons[0])).toBeGreaterThan(REACH)
    expect(game.shots).toEqual([])
  })

  it('at the nearest skeleton in reach, facing it', async () => {
    const game = await play(eastThenWest())
    game.until(() => game.shots.length > 0)

    const [shot] = game.shots
    expect(shot.nearest).toBe(game.sim.skeletons[0])
    expect(shot.nearest!.position.x).toBeGreaterThan(0)
    expect(shot.facing).toBeCloseTo(shot.toward!, 1)
    expect(game.sim.snowballs[0].yaw).toBeCloseTo(shot.toward!, 1)
  })

  it('every throw at the nearest standing skeleton in reach, no faster than the desktop cadence', async () => {
    const game = await play(eastThenWest())
    game.wait(15)

    expect(game.shots.length).toBeGreaterThan(8)
    expect(game.sim.kills).toBeGreaterThan(4)
    for (const shot of game.shots) {
      // Never at a corpse, never at one out of reach, never at empty snow.
      expect(shot.nearest).toBeDefined()
      expect(shot.facing).toBeCloseTo(shot.toward!, 1)
    }
    const gaps = game.shots.slice(1).map((shot, i) => shot.at - game.shots[i].at)
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(25)
  })

  it('while he walks', async () => {
    const game = await play(() => 0)
    game.touch('down', 1, LEFT)
    game.touch('move', 1, offset(LEFT, 60, 10)) // toward the skeletons: he outwalks them the other way
    game.until(() => game.shots.length > 0)

    expect(game.sim.santa.moving).toBe(true)
    expect(game.shots[0].facing).toBeCloseTo(game.shots[0].toward!, 1)
  })
})
