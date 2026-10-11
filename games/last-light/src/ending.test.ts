// The ending (#185): the child reaches the door, goes in, and the door shuts
// behind him; then the night fades out and the last word shows. What is
// checked is the order the player sees it in, and that he walks it.
import { describe, expect, it } from 'vitest'
import { DOOR_AJAR, ENDING, ending } from './ending'
import { woods } from './woods'

const map = woods()
const exit = map.level.exit!
/** Where the child reached the door: at the edge of the exit's reach, on the top step. */
const reached = { x: exit.x + 0.3, z: exit.z + 0.6 }
const STEP = 1 / 60

describe('the ending', () => {
  it('starts where he reached the door, the door ajar as he left it, the screen clear', () => {
    const start = ending(map, reached, 0)
    expect(start).toMatchObject({ x: reached.x, z: reached.z, shown: true, fade: 0, words: 0 })
    expect(start.door).toBeCloseTo(DOOR_AJAR, 9)
  })

  it('walks him in, pushing the door open, out of sight past it; then the door shuts, and stays shut', () => {
    let wasX = reached.x
    let wasZ = reached.z
    let hiddenAt = Number.NaN
    let shutAt = Number.NaN
    let widest = 0
    for (let t = STEP; t <= ENDING; t += STEP) {
      const now = ending(map, reached, t)
      // A walk, never a jump.
      expect(Math.hypot(now.x - wasX, now.z - wasZ) / STEP).toBeLessThan(1.5)
      wasX = now.x
      wasZ = now.z
      if (Number.isNaN(hiddenAt)) widest = Math.max(widest, now.door)
      if (Number.isNaN(hiddenAt) && !now.shown) {
        hiddenAt = t
        // Through the door, into the house.
        expect(now.z).toBeLessThan(map.front.maxZ)
        expect(Math.abs(now.x - exit.x)).toBeLessThan(0.3)
      }
      if (!Number.isNaN(hiddenAt)) expect(now.shown).toBe(false)
      if (Number.isNaN(shutAt) && now.door === 0) shutAt = t
      if (!Number.isNaN(shutAt)) expect(now.door).toBe(0)
    }
    expect(widest).toBeGreaterThan(DOOR_AJAR)
    expect(hiddenAt).toBeLessThan(shutAt)
    expect(hiddenAt).toBeLessThan(4)
  })

  it('fades the night out only once the door has shut, and the last word after it', () => {
    let shutAt = Number.NaN
    let fadedAt = Number.NaN
    for (let t = 0; t <= ENDING; t += STEP) {
      const now = ending(map, reached, t)
      if (Number.isNaN(shutAt) && now.door === 0) shutAt = t
      if (Number.isNaN(shutAt)) expect(now.fade).toBe(0)
      if (Number.isNaN(fadedAt) && now.fade === 1) fadedAt = t
      if (Number.isNaN(fadedAt)) expect(now.words).toBe(0)
    }
    expect(fadedAt).toBeGreaterThan(shutAt)
    expect(ending(map, reached, ENDING)).toMatchObject({ fade: 1, words: 1 })
    expect(ending(map, reached, ENDING + 30)).toMatchObject({ fade: 1, words: 1, door: 0, shown: false })
  })
})
