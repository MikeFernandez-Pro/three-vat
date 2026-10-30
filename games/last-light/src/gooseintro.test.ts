import { describe, expect, it } from 'vitest'
import { CHAT, INTRO, WALK_PACE, roadAheadOf, afterglow, cowering, flameGrown, goslingAt, litShare, ratsOut, shakeAt, startled, walkAt, walkOf } from './gooseintro'

const AT = { x: 0, z: 0 }
const UP = { x: 0, z: -1 }
const HOME = { x: 3, z: -20 }

describe('the goose game opening', () => {
  it('walks her up the road to where she starts, from as far back as she walks', () => {
    const start = { x: 2, z: 50 }
    const road = [
      { x: 8, z: 66 },
      { x: 3, z: 59 },
      { x: 1, z: 52 },
      { x: -2, z: 45 },
    ]
    const walk = walkOf(start, road)
    expect(walk[walk.length - 1]).toEqual(start)
    let length = 0
    for (let k = 1; k < walk.length; k++) length += Math.hypot(walk[k]!.x - walk[k - 1]!.x, walk[k]!.z - walk[k - 1]!.z)
    expect(length).toBeCloseTo(WALK_PACE * INTRO.strike)
    expect(walk[0]!.z).toBeGreaterThan(start.z)
    expect(walkAt(walk, INTRO.strike).at.x).toBeCloseTo(start.x)
    expect(walkAt(walk, INTRO.strike).at.z).toBeCloseTo(start.z)
    expect(walkAt(walk, INTRO.strike + 1).at).toEqual(walkAt(walk, INTRO.strike).at)
    expect(walkAt(walk, 1).facing.z).toBeLessThan(0)
  })

  it('turns her round a bend of the road over a stretch of it, never at once', () => {
    const walk = walkOf({ x: 0, z: 0 }, [
      { x: 0, z: 20 },
      { x: 0, z: 3 },
      { x: 2, z: -3 },
    ])
    const yaw = (t: number) => Math.atan2(walkAt(walk, t).facing.x, -walkAt(walk, t).facing.z)
    for (let t = 0.05; t <= INTRO.strike; t += 0.05) expect(Math.abs(yaw(t) - yaw(t - 0.05))).toBeLessThan(0.05)
  })

  it('bolts the goslings on up the road', () => {
    const road = [
      { x: 0, z: 5 },
      { x: 0, z: 0 },
      { x: 10, z: -10 },
    ]
    const ahead = roadAheadOf({ x: 0, z: 0 }, road)
    expect(ahead.x).toBeCloseTo(Math.SQRT1_2)
    expect(ahead.z).toBeCloseTo(-Math.SQRT1_2)
    expect(roadAheadOf(AT)).toEqual(UP)
    const running = goslingAt(INTRO.bolt + INTRO.stagger + 1, 1, 0, 3, AT, UP, ahead, HOME, false)
    expect(running.x).toBeGreaterThan(1)
  })

  it('walks straight back down the plain with no road', () => {
    const walk = walkOf(AT)
    expect(walk[0]).toEqual({ x: 0, z: WALK_PACE * INTRO.strike })
  })

  it('has the goslings peep at her and her answer them as they walk, hushed by the strike', () => {
    expect(CHAT.some((line) => typeof line.who === 'number')).toBe(true)
    expect(CHAT.some((line) => typeof line.who !== 'number')).toBe(true)
    for (let k = 1; k < CHAT.length; k++) expect(CHAT[k]!.at).toBeGreaterThan(CHAT[k - 1]!.at)
    expect(CHAT[CHAT.length - 1]!.at).toBeLessThan(INTRO.strike - 1)
  })

  it('stops them dead at the strike, frightened, before the goslings bolt', () => {
    expect(startled(INTRO.strike - 0.01)).toBeUndefined()
    expect(startled(INTRO.strike + 0.1)).toBeGreaterThan(0)
    expect(cowering(INTRO.strike + 0.1)).toBe(true)
    expect(cowering(INTRO.bolt)).toBe(false)
  })

  it('leaves the night pale after the strike, easing back to dark', () => {
    expect(afterglow(INTRO.strike - 0.01)).toBe(0)
    expect(afterglow(INTRO.strike + 0.2)).toBeGreaterThan(afterglow(INTRO.strike + 0.8))
    expect(afterglow(INTRO.strike + 0.8)).toBeGreaterThan(0)
    expect(afterglow(INTRO.strike + 3)).toBe(0)
  })

  it('keeps the tree dark until the strike, lit at once by it, and the rats away until their rush after it', () => {
    expect(litShare(INTRO.strike - 0.01)).toBe(0)
    expect(litShare(INTRO.strike)).toBeGreaterThan(0.5)
    expect(INTRO.rush).toBeGreaterThan(INTRO.bolt)
    expect(ratsOut(INTRO.rush - 0.01)).toBe(false)
    expect(ratsOut(INTRO.rush)).toBe(true)
    expect(litShare(INTRO.strike + INTRO.spread / 2)).toBeGreaterThan(litShare(INTRO.strike))
    expect(litShare(INTRO.strike + INTRO.spread + 0.01)).toBe(1)
  })

  it('climbs the tree from its foot, where the strike lands, to its crown', () => {
    const t = INTRO.strike + INTRO.spread / 2
    expect(flameGrown(INTRO.strike - 0.01, 0)).toBe(0)
    expect(flameGrown(t, 0)).toBe(1)
    expect(flameGrown(t, 1)).toBe(0)
    expect(flameGrown(INTRO.strike + INTRO.spread + 1, 1)).toBe(1)
  })

  it('walks the goslings round her back, bolts them up the plain, and has them waiting once out of view', () => {
    const walking = goslingAt(0, 1, 0, 3, AT, UP, UP, HOME, false)
    expect(Math.hypot(walking.x, walking.z)).toBeLessThan(1)
    expect(walking.z).toBeGreaterThan(0)
    const running = goslingAt(INTRO.bolt + INTRO.stagger + 1, 1, 0, 3, AT, UP, UP, HOME, false)
    expect(running.z).toBeLessThan(walking.z - 1)
    expect(goslingAt(INTRO.end, 1, 0, 3, AT, UP, UP, HOME, false)).toEqual(HOME)
  })

  it('stops the one that freezes where it waits', () => {
    const near = { x: 2, z: 1 }
    expect(goslingAt(INTRO.end, 0, 0, 3, AT, UP, UP, near, true)).toEqual(near)
  })

  it('shakes the screen the moment the strike hits, not before', () => {
    expect(shakeAt(INTRO.strike - 0.01)).toEqual({ x: 0, y: 0, z: 0 })
    expect(Math.abs(shakeAt(INTRO.strike + 0.02).y) + Math.abs(shakeAt(INTRO.strike + 0.02).x)).toBeGreaterThan(0)
    expect(shakeAt(INTRO.strike + INTRO.shaking + 0.1)).toEqual({ x: 0, y: 0, z: 0 })
  })
})
