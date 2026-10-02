// The crowd page's camera frames the soldiers on show: a close-up of one, the
// page's own framing of all of them, and in between it backs off as the
// visible crowd widens.
import { describe, expect, it } from 'vitest'
import { framingDistance } from './crowd-framing.js'

describe('the distance that frames the soldiers on show', () => {
  it('is the close-up for one soldier and the full framing for all of them', () => {
    expect(framingDistance(1, 500, 7, 49)).toBe(7)
    expect(framingDistance(500, 500, 7, 49)).toBeCloseTo(49, 10)
  })

  it('backs off with every soldier added', () => {
    let last = framingDistance(1, 500, 7, 49)
    for (let count = 2; count <= 500; count++) {
      const distance = framingDistance(count, 500, 7, 49)
      expect(distance).toBeGreaterThan(last)
      last = distance
    }
  })

  it('goes with the radius of the crowd, not its count', () => {
    // A quarter of the soldiers stand within about half the radius.
    const quarter = framingDistance(125, 500, 0, 1)
    expect(quarter).toBeGreaterThan(0.45)
    expect(quarter).toBeLessThan(0.55)
  })

  it('stays inside its two ends for a count outside the crowd', () => {
    expect(framingDistance(0, 500, 7, 49)).toBe(7)
    expect(framingDistance(900, 500, 7, 49)).toBeCloseTo(49, 10)
  })
})
