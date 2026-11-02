import { describe, expect, it } from 'vitest'
import { leafFalls } from './islandtree'

describe('leafFalls', () => {
  const crown = [
    { x: 0, y: 4, z: 0 },
    { x: 1, y: 3, z: -1 },
  ]
  const fall = { speed: 0.5, lifetime: 14 }
  const east = { x: 1, z: 0 }

  it('lands each leaf on the ground where it comes down', () => {
    // The ground rising with x: where a leaf lands sets how far it falls.
    const groundAt = (x: number) => x * 0.05
    for (const { to } of leafFalls(crown, 20, 1, fall, east, 0.4, groundAt)) expect(to.y).toBeCloseTo(groundAt(to.x), 5)
  })

  it('drifts each leaf downwind, the further the longer it falls', () => {
    const falls = leafFalls(crown, 20, 1, fall, east, 0.4, () => 0)
    for (const { from, to } of falls) {
      expect(to.x - from.x).toBeCloseTo((from.y / fall.speed) * 0.4, 5)
      expect(to.z).toBeCloseTo(from.z, 5)
    }
  })

  it('leaves each leaf part of its life to lie, however long it would fall', () => {
    const slow = { speed: 0.01, lifetime: 14 }
    for (const { inAir } of leafFalls(crown, 20, 1, slow, east, 0.4, () => 0)) {
      expect(inAir).toBeGreaterThan(0)
      expect(inAir).toBeLessThan(1)
    }
  })

  it('starts each leaf at a point of the crown', () => {
    for (const { from } of leafFalls(crown, 20, 1, fall, east, 0.4, () => 0)) expect(crown).toContainEqual(from)
  })
})
