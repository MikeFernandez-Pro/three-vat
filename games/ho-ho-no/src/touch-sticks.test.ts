import { describe, expect, it } from 'vitest'
import type { Simulation } from './simulation/simulation'
import { FPS, run, simulate } from './simulation/test-crowds'
import { TouchSticks, type ContactPhase } from './touch-sticks'

// The touch controls over a real simulation: contacts go in as a player's
// thumbs would put them down, and what comes out is what the run shows, where
// Santa stands and faces, and when and where he throws. A landscape phone,
// 800 by 400: the left half moves, the right half throws.

const VIEWPORT = { width: 800, height: 400 }
const LEFT = { x: 200, y: 200 }
const RIGHT = { x: 600, y: 200 }

/** Skeletons rise at (17, 0), then (-17, 0), turn about, so the first is always the nearer. */
function eastThenWest() {
  let spawns = 0
  return () => (spawns++ % 2 === 0 ? 0 : 0.5)
}

async function play(random?: () => number) {
  const { simulation: sim } = await simulate(random ? { random } : {})
  const sticks = new TouchSticks(sim, VIEWPORT)
  const shots: { facing: number; at: number }[] = []
  sim.on('shoot', ({ facing }) => shots.push({ facing, at: Math.round(sim.elapsed * FPS) }))
  sim.start(0)
  let t = 0
  return {
    sim,
    sticks,
    shots,
    get t() {
      return t
    },
    /** Put a contact down, move it or lift it, now. */
    touch(phase: ContactPhase, id: number, at: { x: number; y: number }) {
      sticks.touch(phase, { id, x: at.x, y: at.y, time: t * 1000 })
    },
    /** Play `seconds` of frames, each on the input the thumbs give. */
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
const distanceToSanta = (sim: Simulation, skeleton: Simulation['skeletons'][number]) =>
  Math.hypot(skeleton.position.x - sim.santa.position.x, skeleton.position.z - sim.santa.position.z)

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

  it('at the same speed however little it is pushed past its dead zone', async () => {
    const game = await play()
    game.wait(0.5)
    const before = game.sim.santa.position.clone()

    game.touch('down', 1, LEFT)
    game.touch('move', 1, offset(LEFT, 0, -20)) // a third of the way out: up the screen
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
})

describe('the throw thumb, tapped', () => {
  it('throws once, at the nearest skeleton in reach, facing it', async () => {
    const game = await play(eastThenWest())
    game.until(() => game.sim.skeletons.length >= 2 && distanceToSanta(game.sim, game.sim.skeletons[0]) < 13)
    const [east, west] = game.sim.skeletons
    expect(east.position.x).toBeGreaterThan(0)
    expect(west.position.x).toBeLessThan(0)

    game.touch('down', 2, RIGHT)
    game.wait(3 / FPS)
    game.touch('up', 2, offset(RIGHT, 3, 2))
    game.wait(1 / FPS)

    expect(game.shots).toHaveLength(1)
    const toward = Math.atan2(east.position.x - game.sim.santa.position.x, east.position.z - game.sim.santa.position.z)
    expect(game.shots[0].facing).toBeCloseTo(toward, 1)
    expect(game.sim.santa.facing).toBeCloseTo(toward, 1)
    expect(game.sim.snowballs[0].yaw).toBeCloseTo(toward, 1)

    game.wait(1)
    expect(game.shots).toHaveLength(1)
  })

  it('throws nothing with no skeleton in reach', async () => {
    const game = await play(() => 0)
    // Before the first spawn, and then with the first still rising, 17 units out.
    game.touch('down', 2, RIGHT)
    game.touch('up', 2, RIGHT)
    game.wait(0.1)
    game.until(() => game.sim.skeletons.length > 0)
    game.touch('down', 2, RIGHT)
    game.touch('up', 2, RIGHT)
    game.wait(0.1)

    expect(game.shots).toEqual([])
  })

  it('is not a tap held past the tap time', async () => {
    const game = await play(() => 0)
    game.until(() => game.sim.skeletons.length > 0 && distanceToSanta(game.sim, game.sim.skeletons[0]) < 13)

    game.touch('down', 2, RIGHT)
    game.wait(0.3)
    game.touch('up', 2, RIGHT)
    game.wait(0.1)

    expect(game.shots).toEqual([])
  })

  it('is not a tap dragged past the dead zone and back', async () => {
    const game = await play(() => 0)
    game.until(() => game.sim.skeletons.length > 0 && distanceToSanta(game.sim, game.sim.skeletons[0]) < 13)

    // The skeleton is east; the drag throws west, and the quick lift aims
    // nothing east: a tap then would be lost to the cooldown, but Santa would
    // still turn to it.
    game.touch('down', 2, RIGHT)
    game.touch('move', 2, offset(RIGHT, -40, 0))
    game.wait(2 / FPS)
    game.touch('move', 2, RIGHT)
    game.wait(1 / FPS)
    game.touch('up', 2, RIGHT)
    game.wait(1)

    expect(game.shots).toHaveLength(1)
    expect(game.shots[0].facing).toBeCloseTo(-Math.PI / 2, 1)
    expect(game.sim.santa.facing).toBeCloseTo(-Math.PI / 2, 1)
  })
})

describe('the throw thumb, dragged', () => {
  it('throws the way it is dragged, at the desktop cadence, for as long as it is held', async () => {
    const game = await play()
    game.touch('down', 2, RIGHT)
    game.touch('move', 2, offset(RIGHT, 0, 50)) // down the screen: toward the camera, +z
    game.wait(3)

    expect(game.shots.length).toBeGreaterThan(5)
    expect(game.shots[0].at).toBe(1)
    const gaps = game.shots.slice(1).map((shot, i) => shot.at - game.shots[i].at)
    expect(new Set(gaps)).toEqual(new Set([25]))
    for (const { facing } of game.shots) expect(facing).toBeCloseTo(0, 5)

    game.touch('up', 2, offset(RIGHT, 0, 50))
    const thrown = game.shots.length
    game.wait(2)
    expect(game.shots).toHaveLength(thrown)
  })

  it('throws once for a flick between two frames', async () => {
    const game = await play()
    game.touch('down', 2, RIGHT)
    game.touch('move', 2, offset(RIGHT, 0, -50))
    game.touch('up', 2, offset(RIGHT, 0, -50))
    game.wait(1)

    expect(game.shots).toHaveLength(1)
    expect(Math.abs(game.shots[0].facing)).toBeCloseTo(Math.PI, 1)
  })

  it('throws once for a swipe the page reports only as it lifts', async () => {
    const game = await play()
    game.touch('down', 2, RIGHT)
    game.touch('up', 2, offset(RIGHT, 50, 0))
    game.wait(1)

    expect(game.shots).toHaveLength(1)
    expect(game.shots[0].facing).toBeCloseTo(Math.PI / 2, 1)
  })

  it('holds fire back once the thumb is back inside the dead zone', async () => {
    const game = await play()
    game.touch('down', 2, RIGHT)
    game.touch('move', 2, offset(RIGHT, 50, 0))
    game.wait(0.2)
    game.touch('move', 2, offset(RIGHT, 4, 0))
    game.wait(2)

    expect(game.shots).toHaveLength(1)
    expect(game.shots[0].facing).toBeCloseTo(Math.PI / 2, 1)
  })
})

describe('both thumbs', () => {
  it('walk and throw at once', async () => {
    const game = await play()
    game.wait(0.5)
    const before = game.sim.santa.position.clone()

    game.touch('down', 1, LEFT)
    game.touch('move', 1, offset(LEFT, -60, 0))
    game.touch('down', 2, RIGHT)
    game.touch('move', 2, offset(RIGHT, 0, -60))
    game.wait(1)

    expect(game.sim.santa.position.x - before.x).toBeLessThan(-7)
    expect(game.shots.length).toBeGreaterThan(1)
    for (const { facing } of game.shots) expect(Math.abs(facing)).toBeCloseTo(Math.PI, 1)
  })

  it('keep their roles across the middle, and a third thumb is ignored', async () => {
    const game = await play()
    game.wait(0.5)
    const before = game.sim.santa.position.clone()

    // The move thumb swipes far to the right; the throw thumb drifts left.
    game.touch('down', 1, LEFT)
    game.touch('move', 1, offset(LEFT, 500, 0))
    game.touch('down', 2, RIGHT)
    game.touch('move', 2, offset(RIGHT, -500, 0))
    game.touch('down', 3, { x: 100, y: 100 })
    game.touch('move', 3, { x: 100, y: 300 })
    game.wait(1)

    expect(game.sim.santa.position.x - before.x).toBeGreaterThan(7)
    expect(game.sim.santa.position.z - before.z).toBeCloseTo(0, 1)
    expect(game.shots.length).toBeGreaterThan(1)
    for (const { facing } of game.shots) expect(facing).toBeCloseTo(-Math.PI / 2, 1)
  })

  it('let go on a cancel, which is never a tap', async () => {
    const game = await play(() => 0)
    game.until(() => game.sim.skeletons.length > 0 && distanceToSanta(game.sim, game.sim.skeletons[0]) < 13)

    game.touch('down', 1, LEFT)
    game.touch('move', 1, offset(LEFT, 0, 60))
    game.touch('down', 2, RIGHT)
    game.wait(0.1)
    game.touch('cancel', 1, offset(LEFT, 0, 60))
    game.touch('cancel', 2, RIGHT)
    game.wait(2 / FPS)
    const cancelled = game.sim.santa.position.clone()
    game.wait(0.5)

    expect(game.sim.santa.position.z).toBeCloseTo(cancelled.z, 1)
    expect(game.sim.santa.moving).toBe(false)
    expect(game.shots).toEqual([])
  })

  it('let go when the page loses focus', async () => {
    const game = await play()
    game.touch('down', 1, LEFT)
    game.touch('move', 1, offset(LEFT, 60, 0))
    game.touch('down', 2, RIGHT)
    game.touch('move', 2, offset(RIGHT, 60, 0))
    game.wait(0.2)
    const thrown = game.shots.length

    game.sticks.letGo()
    game.wait(2 / FPS)
    const released = game.sim.santa.position.clone()
    game.wait(1)

    expect(game.sim.santa.position.x).toBeCloseTo(released.x, 1)
    expect(game.shots).toHaveLength(thrown)
  })
})
