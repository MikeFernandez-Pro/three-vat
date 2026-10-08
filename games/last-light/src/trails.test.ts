import { describe, expect, it } from 'vitest'
import { CUTS, POINTS, ROWS, cutAt, rowWeights } from './trails'

/** Row `j`'s place and slope on the Catmull-Rom curve through `p`, as the strip was laid on the CPU. */
function curve(p: number[], j: number): { at: number; slope: number } {
  const k = Math.min(POINTS - 2, Math.floor(j / CUTS))
  const u = j / CUTS - k
  const p0 = p[Math.max(0, k - 1)], p1 = p[k], p2 = p[k + 1], p3 = p[Math.min(POINTS - 1, k + 2)]
  const b = p2 - p0, c = 2 * p0 - 5 * p1 + 4 * p2 - p3, e = 3 * (p1 - p2) + p3 - p0
  return { at: p1 + 0.5 * u * (b + u * (c + u * e)), slope: b + u * (2 * c + 3 * u * e) }
}

describe('rowWeights', () => {
  it('lays every row where the curve through the places has it, and its slope', () => {
    const p = [0.3, -1.2, 2.5, 0.7, 4.1, -0.6, 1.9, 3.3]
    for (let j = 0; j < ROWS; j++) {
      const { place, slope } = rowWeights(j)
      const want = curve(p, j)
      expect(place.reduce((sum, w, i) => sum + w * p[i], 0)).toBeCloseTo(want.at, 5)
      expect(slope.reduce((sum, w, i) => sum + w * p[i], 0)).toBeCloseTo(want.slope, 5)
    }
  })

  it('starts at the eye and ends at the oldest place', () => {
    expect(Array.from(rowWeights(0).place)).toEqual([1, 0, 0, 0, 0, 0, 0, 0])
    expect(Array.from(rowWeights(ROWS - 1).place)).toEqual([0, 0, 0, 0, 0, 0, 0, 1])
  })
})

describe('cutAt', () => {
  /** One ribbon's places one metre apart along x, each a tenth of a second older than the last. */
  const history = new Float32Array(POINTS * 2).map((_, i) => (i % 2 === 0 ? i / 2 : 0))
  const ages = new Float32Array(POINTS).map((_, k) => 10 - k * 0.1)

  it('cuts where the path crossed the trail’s age, between the two places either side', () => {
    const cut = cutAt(history, ages, 0, 10, 0.25)
    expect(cut.first).toBe(3)
    expect(cut.x).toBeCloseTo(2.5, 5)
    expect(cut.z).toBeCloseTo(0, 5)
  })

  it('cuts nothing while every place is younger than the trail', () => {
    expect(cutAt(history, ages, 0, 10, 2).first).toBe(POINTS)
  })

  it('cuts at the eye itself for a trail of no length', () => {
    const cut = cutAt(history, ages, 0, 10, 0)
    expect(cut.first).toBe(1)
    expect(cut.x).toBeCloseTo(0, 5)
  })
})
