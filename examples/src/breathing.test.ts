// The crowd's breathing count: the page opens on the full circle and the count
// falls to a floor and rises back, slowly, so the draw calls holding at one are
// seen while the crowd changes size. Started again from the switch, the wave
// picks up at the count the slider left, not with a jump to the top.
import { describe, expect, it } from 'vitest'
import { breathFrom, breathingCount } from './breathing.js'

const wave = { floor: 20, max: 500, period: 16 }

describe('breathingCount', () => {
  it('opens on the full circle', () => {
    expect(breathingCount(0, wave)).toBe(500)
  })

  it('falls to the floor half a period in, and is back at the top a period in', () => {
    expect(breathingCount(8, wave)).toBe(20)
    expect(breathingCount(16, wave)).toBe(500)
    expect(breathingCount(32, wave)).toBe(500)
  })

  it('never leaves the range, and is always a whole soldier', () => {
    for (let t = 0; t < 40; t += 0.37) {
      const count = breathingCount(t, wave)
      expect(Number.isInteger(count)).toBe(true)
      expect(count).toBeGreaterThanOrEqual(20)
      expect(count).toBeLessThanOrEqual(500)
    }
  })

  it('moves slowly: a frame never adds or drops more than a few soldiers', () => {
    for (let t = 0; t < 16; t += 1 / 60) {
      expect(Math.abs(breathingCount(t + 1 / 60, wave) - breathingCount(t, wave))).toBeLessThanOrEqual(2)
    }
  })
})

describe('breathFrom', () => {
  it.each([500, 400, 260, 21, 20])('restarts the wave at %i', (count) => {
    expect(breathingCount(breathFrom(count, wave), wave)).toBe(count)
  })

  it.each([400, 260, 60])('restarts it falling from %i, as it opened', (count) => {
    expect(breathingCount(breathFrom(count, wave) + 0.5, wave)).toBeLessThan(count)
  })

  it('takes a count outside the wave as its nearest end', () => {
    expect(breathFrom(1, wave)).toBe(breathFrom(20, wave))
    expect(breathFrom(900, wave)).toBe(0)
  })
})
