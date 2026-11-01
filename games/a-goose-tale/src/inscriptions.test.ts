// The graves' inscriptions: where on a stone's front its words go.
import { describe, expect, it } from 'vitest'
import { findPanel, slabPanel } from './inscriptions.prototype'

type Rect = [left: number, bottom: number, right: number, top: number, z: number, facing?: 1 | -1]

/** Rectangles as unindexed triangles, each facing +z or, with -1, -z. */
function stone(rects: Rect[]) {
  const corners: [number, number, number][] = []
  for (const [l, b, r, t, z, facing = 1] of rects) {
    const quad: [number, number, number][] = [[l, b, z], [r, b, z], [r, t, z], [l, b, z], [r, t, z], [l, t, z]]
    corners.push(...(facing === 1 ? quad : quad.reverse()))
  }
  return { count: corners.length, getX: (i: number) => corners[i]![0], getY: (i: number) => corners[i]![1], getZ: (i: number) => corners[i]![2] }
}

describe("the graves' inscriptions", () => {
  it('go on a cross along its crossbar, not down its post', () => {
    const panel = findPanel(stone([[-0.1, 0, 0.1, 1, 0.1], [-0.4, 0.6, 0.4, 0.8, 0.1], [-0.4, 0, 0.4, 1, -0.1, -1]]))!
    expect(panel.bottom).toBeGreaterThanOrEqual(0.6)
    expect(panel.top).toBeLessThanOrEqual(0.8)
    expect(panel.right - panel.left).toBeGreaterThan(0.5)
  })

  it('go high on a slab, inside its face, no taller than wide', () => {
    const panel = findPanel(stone([[-0.4, 0, 0.4, 1.2, 0.1]]))!
    const wide = panel.right - panel.left
    expect(panel.left).toBeGreaterThan(-0.4)
    expect(panel.right).toBeLessThan(0.4)
    expect(wide).toBeGreaterThan(0.5)
    expect(panel.top - panel.bottom).toBeLessThanOrEqual(wide)
    expect(panel.top).toBeGreaterThan(1)
  })

  it('stay on the face itself, not on the step of a plinth in front of it', () => {
    const panel = findPanel(stone([[-0.4, 0.2, 0.4, 1.2, 0.1], [-0.5, 0, 0.5, 0.2, 0.2]]))!
    expect(panel.bottom).toBeGreaterThanOrEqual(0.2)
    expect(panel.triangles.length).toBe(2)
  })

  it('go on slabs only: not on a cross, nor on a pillar as deep as it is wide', () => {
    const cross = stone([[-0.1, 0, 0.1, 1, 0.1], [-0.4, 0.6, 0.4, 0.8, 0.1], [-0.4, 0, 0.4, 1, -0.1, -1]])
    expect(slabPanel(cross)).toBeUndefined()
    expect(slabPanel(stone([[-0.4, 0, 0.4, 1.2, 0.1], [-0.4, 0, 0.4, 1.2, -0.1, -1]]))).toBeDefined()
    expect(slabPanel(stone([[-0.3, 0, 0.3, 2, 0.3], [-0.3, 0, 0.3, 2, -0.3, -1]]))).toBeUndefined()
  })

  it('find nothing on a stone with no front', () => {
    expect(findPanel(stone([[-0.4, 0, 0.4, 1, -0.1, -1]]))).toBeUndefined()
  })
})
