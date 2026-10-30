// The ground's height read off a grid: what the GPU's rats stand on.
import { describe, expect, it } from 'vitest'
import { HeightGrid } from './heights'

describe('the height grid', () => {
  it('reads the same at its points, between them in between, and its edge past it', () => {
    const height = (x: number, z: number) => Math.max(0, 3 - Math.hypot(x, z) / 3)
    const grid = new HeightGrid(height, { minX: -12, maxX: 12, minZ: -12, maxZ: 12 }, 0.5)
    expect(grid.at(-12, -12)).toBe(0)
    expect(grid.at(0, 0)).toBeCloseTo(3, 5)
    expect(grid.at(-6.5, 1)).toBeCloseTo(height(-6.5, 1), 5)
    const between = grid.at(-6.25, 1)
    expect(between).toBeGreaterThan(Math.min(grid.at(-6.5, 1), grid.at(-6, 1)) - 1e-9)
    expect(between).toBeLessThan(Math.max(grid.at(-6.5, 1), grid.at(-6, 1)) + 1e-9)
    expect(grid.at(-40, 0)).toBe(grid.at(-12, 0))
  })
})
