// The river's own depth mask (#185): how far into the water a point is, from
// the waterline the sunk bed makes under the water's surface. The water's
// shoreline, ripples and splashes are drawn by it. What is checked is where
// the mask says water starts and how it deepens.
import { describe, expect, it } from 'vitest'
import { heightAt } from './heights'
import { WATER, riverMask } from './river'
import { woods } from './woods'

const map = woods()
const mask = riverMask(map)
/** A map point on the ground, as the level is laid out. */
const at = (x: number, y: number) => ({ x: x - 18, z: y })

describe("the river's depth mask", () => {
  it('covers the river from bank to bank, the level across', () => {
    for (const p of map.river) {
      expect(p.x).toBeGreaterThanOrEqual(mask.minX)
      expect(p.x).toBeLessThanOrEqual(mask.minX + (mask.nx - 1) * mask.cell)
      expect(p.z).toBeGreaterThanOrEqual(mask.minZ)
      expect(p.z).toBeLessThanOrEqual(mask.minZ + (mask.nz - 1) * mask.cell)
    }
  })

  it('is nothing where the ground stands over the water: the banks, and under the bridge', () => {
    for (const [x, y] of [[20, 9], [20, -1], [31, 4], [30, 2]] as [number, number][]) expect(mask.at(at(x, y).x, at(x, y).z)).toBe(0)
  })

  it('starts at the waterline and deepens into the river, either side of the bridge, to full where the river is wide', () => {
    // East of the bridge the river is three and a half metres bank to bank: it deepens, but not to full.
    for (const [x, deepest] of [[6, 1], [20, 1], [34, 0.5]] as [number, number][]) {
      let was = 0
      let most = 0
      // From the south bank north to the river's middle.
      for (let y = 8; y >= 4; y -= 0.1) {
        const p = at(x, y)
        const m = mask.at(p.x, p.z)
        expect(m).toBeGreaterThanOrEqual(was - 0.02)
        was = m
        if (m > 0) expect(heightAt(map.heights, p.x, p.z)).toBeLessThan(WATER + 0.1)
        most = Math.max(most, m)
      }
      expect(most).toBeGreaterThanOrEqual(deepest)
    }
    // On the river's outline, the ground is still over the water.
    for (const p of map.river) expect(mask.at(p.x, p.z)).toBe(0)
  })
})
