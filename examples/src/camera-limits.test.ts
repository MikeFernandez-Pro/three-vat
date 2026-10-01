// The limits are the occlusion dither example's, scaled to a page's framing:
// a page starts inside them, and neither close enough to pass through its
// subject nor under the floor.
import { describe, expect, it } from 'vitest'
import { limitsFor } from './camera-limits.js'

describe('the camera limits', () => {
  it("are webgpu_tsl_occlusion_dither's at its own framing", () => {
    const { minDistance, maxDistance } = limitsFor(16.6)

    expect(minDistance).toBeCloseTo(6, 0)
    expect(maxDistance).toBeCloseTo(25, 0)
  })

  it.each([11, 15, 49])('hold a page that starts %d away inside them', (distance) => {
    const { minDistance, maxDistance } = limitsFor(distance)

    expect(minDistance).toBeLessThan(distance)
    expect(maxDistance).toBeGreaterThan(distance)
  })

  it('stop the camera above the floor', () => {
    expect(limitsFor(20).maxPolarAngle).toBeLessThan(Math.PI / 2)
  })
})
