// The goose game's rolling plain: low swells, never below the flat ground,
// flat where the scenes, the fires and the pond stand, and the floor laid on
// the grid the rats are stood on.
import { describe, expect, it } from 'vitest'
import { ROUTE, laid } from './plain'
import { ROLLING_CELL, defaultRollingLook, padsOf, pondSquare, rollAgain, rollingAt, rollingFloor, rollingGround } from './rolling'

const plain = laid(ROUTE)
const pond = { x: plain.pond.x, z: plain.pond.z, widest: 10 }
const square = pondSquare(pond.x, pond.z, pond.widest, 2)
const look = defaultRollingLook()
const pads = padsOf(plain, look)
const at = (x: number, z: number) => rollingAt(look, pads, square, x, z)

describe("the goose game's rolling plain", () => {
  it('rolls between the flat ground and its height, and somewhere on the plain rises most of the way', () => {
    const { minX, maxX, minZ, maxZ } = plain.bounds
    let highest = 0
    for (let z = minZ; z <= maxZ; z += 0.7) {
      for (let x = minX; x <= maxX; x += 0.7) {
        const y = at(x, z)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(look.height)
        highest = Math.max(highest, y)
      }
    }
    expect(highest).toBeGreaterThan(look.height * 0.6)
  })

  it('is laid again in place as its look changes: twice as high, every point twice as high', () => {
    const box = { minX: -10, maxX: 10, minZ: 0, maxZ: 20 }
    const grid = rollingGround(plain, pond, box, look)
    const was = Float32Array.from(grid.heights)
    rollAgain(grid, plain, pond, { ...look, height: look.height * 2 })
    grid.heights.forEach((y, k) => expect(y).toBeCloseTo(was[k]! * 2, 5))
  })

  it('is flat where she starts, round every brazier and each scene piece, along the log and round the pond', () => {
    const spots = [plain.start, ...plain.braziers.flatMap((b) => [b, b.gosling, b.skull, b.fire, b.cart, b.log?.near, b.log?.far])].filter((p) => p !== undefined)
    for (const { x, z } of spots) for (const [dx, dz] of [[0, 0], [1.4, 0], [0, -1.4], [-1, 1]] as const) expect(at(x + dx, z + dz)).toBe(0)
    for (const { x, z } of [{ x: square.minX, z: square.minZ }, { x: square.maxX, z: square.maxZ }, pond]) expect(at(x, z)).toBe(0)
  })

  it('lays the floor on the grid the rats read, its normals up the slope, but for the cells inside the hole', () => {
    const box = { minX: -10, maxX: 10, minZ: 40, maxZ: 70 }
    const grid = rollingGround(plain, pond, box)
    const hole = { minX: -2.2, maxX: 2.3, minZ: 60.1, maxZ: 64 }
    const { geometry, cut } = rollingFloor(grid, hole)
    // Cut outward on the grid's lines.
    for (const [a, b] of [[cut.minX, hole.minX], [cut.minZ, hole.minZ]] as const) expect(a).toBeLessThanOrEqual(b)
    for (const [a, b] of [[cut.maxX, hole.maxX], [cut.maxZ, hole.maxZ]] as const) expect(a).toBeGreaterThanOrEqual(b)
    for (const side of [cut.minX - box.minX, cut.maxX - box.minX, cut.minZ - box.minZ, cut.maxZ - box.minZ]) expect((side / ROLLING_CELL) % 1).toBeCloseTo(0, 6)
    // Each point at the grid's height there, on the plane's (x, -z), up its z.
    const position = geometry.getAttribute('position')
    const normal = geometry.getAttribute('normal')
    for (let k = 0; k < position.count; k += 97) {
      expect(position.getZ(k)).toBeCloseTo(grid.at(position.getX(k), -position.getY(k)), 5)
      expect(Math.hypot(normal.getX(k), normal.getY(k), normal.getZ(k))).toBeCloseTo(1, 5)
      expect(normal.getZ(k)).toBeGreaterThan(0.9)
    }
    // No triangle inside the hole.
    const index = geometry.getIndex()!
    for (let t = 0; t < index.count; t += 3) {
      const xs = [0, 1, 2].map((v) => position.getX(index.getX(t + v)))
      const zs = [0, 1, 2].map((v) => -position.getY(index.getX(t + v)))
      const mx = (xs[0]! + xs[1]! + xs[2]!) / 3
      const mz = (zs[0]! + zs[1]! + zs[2]!) / 3
      expect(mx > cut.minX && mx < cut.maxX && mz > cut.minZ && mz < cut.maxZ).toBe(false)
    }
  })
})
