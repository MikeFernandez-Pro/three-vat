// The play step on the real level (#181): the woods walked on the keys, a
// sixtieth of a second a frame, from a checkpoint along a route, as a player
// holding the keys toward each point in turn would, with no browser. What is
// checked is what the player would see: where the child is, how much light he
// has left, which lights are out, and whether he was caught. Every walk checks
// on the way that the swarm has only the walls nearest the child.
import { describe, expect, it } from 'vitest'
import { Play } from './play'
import { STEP } from './swarm-remote'
import { MAX_WALLS, distanceTo } from './walls'

/**
 * A point of a route, map metres as the level is laid out, crawled to if
 * marked; or the key picked up, Space held until it is; or the cart pushed,
 * north, until it jams.
 */
type Waypoint = [number, number] | [number, number, 'crawl'] | 'key' | 'jam'

/** How near a point the walker takes the next, m. */
const ARRIVED = 0.25
/** How far round the child every wall that stops the rats is among those the swarm has, m: the nearest walls reach about fifteen metres round where they were picked, a metre at most behind him. */
const STREAMED = 13

/** Where a map point is on the ground: the level's own setting. */
const ground = ([x, y]: [number, number]) => ({ x: x - 18, z: y })

/** The way the keys send him toward (dx, dz): the nearest of the eight ways WASD hold, as a unit direction. */
function keysToward(dx: number, dz: number): { x: number; z: number } {
  const way = (Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) * Math.PI) / 4
  return { x: Math.cos(way), z: Math.sin(way) }
}

/** Every wall that stops the rats within STREAMED of the child is among the swarm's, and the swarm has MAX_WALLS at most. */
function expectStreamed(play: Play): void {
  const given = new Set(play.swarm.walls.walls)
  expect(given.size).toBeLessThanOrEqual(MAX_WALLS)
  const { x, z } = play.holder
  for (const wall of [...play.woods.level.walls, ...play.woods.pineEnds]) if (distanceTo(wall, x, z) < STREAMED) expect(given.has(wall)).toBe(true)
}

/** What a walk's watcher may do after a frame: let go of the keys, hold them another way, or end the walk. */
type Then = 'stop' | 'done' | { x: number; z: number } | void

/**
 * Walk `route` from where the play stands, a frame at a time, `each` told of
 * every frame after it is played: for the next frame it may let go of the
 * keys ('stop'), hold them toward a way of its own, or end the walk ('done').
 * Ends at the route's end, or once he is caught, or `most` seconds on. The
 * walls the swarm has are checked as it goes.
 */
function walk(play: Play, route: Waypoint[], each: (play: Play) => Then = () => {}, most = 60): void {
  let k = 0
  let then: Then = undefined
  for (let frame = 0; frame * STEP < most && k < route.length; frame++) {
    const point = route[k]!
    let heading: { x: number; z: number } | null = null
    let interact = false
    let crawl = false
    if (point === 'key') {
      interact = true
      if (play.run.carrying[0]) {
        k++
        continue
      }
    } else if (point === 'jam') {
      if (play.jammed) {
        k++
        continue
      }
      heading = { x: 0, z: -1 }
    } else {
      const { x, z } = ground([point[0], point[1]])
      const dx = x - play.holder.x
      const dz = z - play.holder.z
      if (Math.hypot(dx, dz) < ARRIVED) {
        k++
        continue
      }
      heading = keysToward(dx, dz)
      crawl = point[2] === 'crawl'
    }
    if (then === 'stop') heading = null
    else if (typeof then === 'object') heading = then
    play.frame(STEP, { heading, crawlHeld: crawl, interact })
    if (frame % 10 === 0) expectStreamed(play)
    then = each(play)
    if (then === 'done' || play.caught > 0 || play.run.won) return
  }
}

/** Whether the child stands in light: the torch's, or well inside a lit light's reach, where the flame's lean never leaves him. */
function inLight(play: Play): boolean {
  if (play.run.torch.lit) return true
  const { x, z } = play.holder
  return play.run.lights().some((light) => light.on && Math.hypot(x - light.x, z - light.z) < light.reach * 0.92)
}

/** The dark stretches walked through, each its length, s, and the most rats at him in it. */
function darkGaps(play: Play): { gaps: { length: number; rats: number }[]; each: () => void } {
  const gaps: { length: number; rats: number }[] = []
  let gap: { length: number; rats: number } | null = null
  return {
    gaps,
    each: () => {
      if (inLight(play)) {
        gap = null
        return
      }
      if (gap === null) gaps.push((gap = { length: 0, rats: 0 }))
      gap.length += STEP
      gap.rats = Math.max(gap.rats, play.report?.reached ?? 0)
    },
  }
}

/** Beat 2: from the trunk, crawled under, round the thicket through the wood to the west torch outside the gate. */
const TO_THE_GATE: Waypoint[] = [
  [12, 50.8], [12, 47.8, 'crawl'], [12, 44], [13.6, 41.4], [16.5, 39.6], [19.5, 38], [20.5, 35], [20.6, 31], [20.6, 26], [20.2, 21], [22.5, 17.2], [28.4, 14.1],
]
/** From the gate's torches along the wall to the gamekeeper, his key, and back through the gate. */
const THE_KEY: Waypoint[] = [[27, 16], [20, 15.6], [20, 13.75], 'key', [20, 15.6], [27, 16], [31, 14.4], [31, 12.6], [31, 10.5]]
/** From the jammed cart's side up the steps, brazier to brazier, to the pine's root; then over it to the far side's brazier. */
const UP_THE_STEPS: Waypoint[] = [[29.3, -3.5], [29.6, -6.6], [28.6, -8.4], [27.3, -10.2], [27.35, -12], [27.4, -13.8], [26.5, -15.2], [24.2, -17.3], [21.6, -18.3], [19.6, -18.8]]
const THE_CLIMB: Waypoint[] = [...UP_THE_STEPS, [11, -20.2], [9.8, -21.5]]
/** From the gate pushing the cart over the bridge until it jams, round it, and on up the climb. */
const OVER_THE_BRIDGE: Waypoint[] = [[31, 7.5], 'jam', [29.3, -0.6], ...THE_CLIMB]
/** From the far side's brazier down the forest path, through the tangle, to the door. */
const HOME: Waypoint[] = [[7, -24], [5.8, -28], [4.5, -32], [4, -34.5], [3.6, -39.5], [4.8, -44.5], [5.6, -49.5], [5, -54.5], [4.8, -58], [4.6, -59], [4, -63], [4, -66.1]]

describe('the woods played on the keys', () => {
  it("beat 2 reaches the gate's torches with about 5 s of light left", () => {
    const play = new Play()
    play.skipTo(0)
    let left = Number.NaN
    walk(play, TO_THE_GATE, () => {
      if (play.stage === 1) return 'done'
      left = play.left
    })
    expect(play.caught).toBe(0)
    expect(play.stage).toBe(1)
    expect(left).toBeGreaterThan(4.5)
    expect(left).toBeLessThan(6.5)
  })

  it('the key search and the gate leave about 15 s', () => {
    const play = new Play()
    play.skipTo(1)
    walk(play, THE_KEY, () => (play.stage === 2 ? 'done' : undefined))
    expect(play.caught).toBe(0)
    expect(play.run.carrying[0]).toBe(true)
    expect(play.stage).toBe(2)
    expect(play.left).toBeGreaterThan(14)
    expect(play.left).toBeLessThan(16.5)
  })

  it("puts the stick out as the cart jams, then the cart's fire, then the braziers in order up the climb, the gutterer ahead of him", () => {
    const play = new Play()
    play.skipTo(2)
    const { woods: map } = play
    const out: number[] = []
    let jammedAt = Number.NaN
    let fireOutAt = Number.NaN
    let stickOutAt = Number.NaN
    walk(play, OVER_THE_BRIDGE, () => {
      if (Number.isNaN(jammedAt) && play.jammed) jammedAt = play.t
      if (Number.isNaN(stickOutAt) && !play.run.torch.lit) stickOutAt = play.t
      play.run.lights().forEach((light, k) => {
        if (light.on || out.includes(k)) return
        out.push(k)
        if (k === map.brazier) fireOutAt = play.t
      })
    })
    expect(play.caught).toBe(0)
    expect(stickOutAt - jammedAt).toBeGreaterThanOrEqual(0)
    expect(stickOutAt - jammedAt).toBeLessThan(0.1)
    expect(fireOutAt - jammedAt).toBeGreaterThan(0.5)
    expect(fireOutAt - jammedAt).toBeLessThan(2)
    expect(play.stage).toBe(4)
    const { foot, gutters } = map
    expect(gutters).toBe(foot + 3)
    // The foot's, the first turn's, the gutterer ahead of him before the second turn's goes behind him, then the last two.
    expect(out).toEqual([map.brazier, foot, foot + 1, gutters, foot + 2, gutters + 1, gutters + 2])
  })

  it('leaves about 0.6 s of dark at each drowned brazier, and about 0.9 s at the gutterer, then the pine is dark', () => {
    const play = new Play()
    play.skipTo(3)
    const dark = darkGaps(play)
    walk(play, THE_CLIMB, dark.each)
    expect(play.caught).toBe(0)
    const lengths = dark.gaps.map((gap) => gap.length)
    expect(lengths).toHaveLength(5)
    const [first, second, gutterer, fourth, pine] = lengths as [number, number, number, number, number]
    for (const gap of [first, second, fourth]) expect(gap).toBeCloseTo(0.63, 1)
    expect(gutterer).toBeCloseTo(0.93, 1)
    expect(pine).toBeGreaterThan(8)
    // Walking on, never enough rats at him to catch him.
    for (const gap of dark.gaps) expect(gap.rats).toBeLessThan(play.runTuning.catchCount)
  })

  // The gap the gutterer leaves catches him on every seed tried. In the drowned gaps behind him a second is not enough for the
  // rats to come, on most seeds.
  it('catches a child who stops a second in the gap the gutterer leaves, and starts him again at the jammed cart, every brazier lit', () => {
    const play = new Play()
    play.skipTo(3)
    const { woods: map } = play
    let stopFor = 0
    let gaps = 0
    let wasLight = true
    walk(play, THE_CLIMB, () => {
      const light = inLight(play)
      if (wasLight && !light && ++gaps === 3) stopFor = 1
      wasLight = light
      if (stopFor > 0) {
        stopFor -= STEP
        return 'stop'
      }
    })
    expect(play.caught).toBe(1)
    const at = map.cartCheckpoint
    expect(play.holder.x).toBeCloseTo(at.x, 5)
    expect(play.holder.z).toBeCloseTo(at.z, 5)
    expect(play.run.lights()[map.brazier]!.on).toBe(true)
    expect(play.run.lights().slice(map.foot, map.farBrazier + 1).every((light) => light.on)).toBe(true)
    expect(play.cart.back).toBe(map.cart.jam)
    expect(play.raining).toBe(true)
    expect(play.run.torch.lit).toBe(false)
  })

  // The pine's corridor and its ends are walls to the rats, so none reaches him there: the rats under it are in the ravine.
  it("counts no catch on the pine, out of the rats' reach in the dark", () => {
    const play = new Play()
    play.skipTo(3)
    let still = 0
    walk(play, [...UP_THE_STEPS, [15.5, -19.5]], () => {
      if (!play.onPine(play.holder) || inLight(play)) return
      still += STEP
      return still < 6 ? 'stop' : 'done'
    })
    expect(play.onPine(play.holder)).toBe(true)
    expect(inLight(play)).toBe(false)
    expect(still).toBeGreaterThanOrEqual(6)
    expect(play.caught).toBe(0)
  })

  it('lets a runner through the dark run on the grip, where without it he is dragged down, and catches a child stopped in it', () => {
    // From the gate, as a player comes to it, the far side's rats following him down the path. On the play's own seed: the
    // dark run is close run, and on other seeds, walked the same way, the rats drag him down in the tangle about half the time.
    const home = (grip: number) => {
      const play = new Play({ grip })
      play.skipTo(2)
      walk(play, [...OVER_THE_BRIDGE, ...HOME], () => {}, 90)
      return play
    }
    const runner = home(2)
    expect(runner.panicking).toBe(true)
    expect(runner.caught).toBe(0)
    expect(runner.run.won).toBe(true)
    expect(home(0).caught).toBe(1)

    // Running by himself, he stops only against something: pressed into the path's west side once the stick has died, he is
    // dragged down, once the rats have held on long enough.
    const stopped = new Play()
    stopped.skipTo(4)
    let since = Number.NaN
    walk(stopped, HOME, () => {
      if (stopped.panicking && Number.isNaN(since)) since = stopped.t
      if (stopped.panicking && stopped.t - since > 0.5) return { x: -1, z: 0 }
    })
    expect(stopped.caught).toBe(1)
    expect(stopped.t - since).toBeGreaterThan(2)
  })
})
