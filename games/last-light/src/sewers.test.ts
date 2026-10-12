import { describe, expect, it } from 'vitest'
import { GRID, cellAt, sewers, type Point } from './sewers'
import { HOLDER_RADIUS, Walls } from './walls'

const map = sewers()

/** The floor cells the child's body fits on, every one reachable from `from` without crossing a wall: a flood over the grid. */
function reach(from: Point): Set<number> {
  const { grid } = map
  const walls = new Walls(map.walls)
  const fits = (c: number, r: number) => {
    if (grid.cells[r * grid.cols + c] !== 1) return false
    return !walls.inside(grid.minX + (c + 0.5) * GRID, grid.minZ + (r + 0.5) * GRID, HOLDER_RADIUS)
  }
  const start = Math.floor((from.z - grid.minZ) / GRID) * grid.cols + Math.floor((from.x - grid.minX) / GRID)
  const seen = new Set([start])
  const queue = [start]
  while (queue.length) {
    const k = queue.pop()!
    const c = k % grid.cols
    const r = Math.floor(k / grid.cols)
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n = (r + dr) * grid.cols + c + dc
      if (!seen.has(n) && fits(c + dc, r + dr)) {
        seen.add(n)
        queue.push(n)
      }
    }
  }
  return seen
}

const cellOf = (p: Point) => Math.floor((p.z - map.grid.minZ) / GRID) * map.grid.cols + Math.floor((p.x - map.grid.minX) / GRID)

describe('the sewers', () => {
  it('lays the start on the floor and the canal in water', () => {
    expect(cellAt(map.grid, map.level.start.x, map.level.start.z)).toBe(1)
    expect(cellAt(map.grid, -2.05, 10)).toBe(2)
  })

  it('traces walls round the floor, few enough to stream', () => {
    expect(map.walls.length).toBeGreaterThan(100)
    expect(map.walls.length).toBeLessThan(3000)
    for (const wall of map.walls) expect(Math.hypot(wall.to.x - wall.from.x, wall.to.z - wall.from.z)).toBeGreaterThan(0)
  })

  it('lets the child walk from the start to every place the run goes, the doors aside', () => {
    const reached = reach(map.level.start)
    const places: Record<string, Point> = {
      'waking lantern': { x: 1.4, z: 13.8 },
      'past the squeeze': { x: 0.4, z: 1.4 },
      hub: { x: 0.4, z: -5.2 },
      'gas lever': map.levers[0]!,
      corpse: map.corpse,
      'water lever': map.levers[1]!,
      chest: map.chest,
      'hub lever': map.levers[2]!,
      'past the huge door': { x: 0, z: -25 },
      'cave mouth': { x: 0.2, z: -47.4 },
      'cistern door': { x: 4.2, z: -62.4 },
      'past the cistern door': { x: 4.2, z: -65 },
      'beam start': { x: 4.2, z: -73.6 },
      'beam end': { x: 4.2, z: -82.6 },
      ladder: map.ladder,
    }
    const missing = Object.entries(places).filter(([, p]) => !reached.has(cellOf(p)))
    expect(missing.map(([name]) => name)).toEqual([])
  })

  it('puts every plate, button and hole on the floor', () => {
    for (const p of [...map.plates, ...map.buttons]) expect(cellAt(map.grid, p.x, p.z)).toBe(1)
    for (const hole of map.holes) {
      const near = [-0.4, 0, 0.4].some((dx) => [-0.4, 0, 0.4].some((dz) => cellAt(map.grid, hole.x + dx, hole.z + dz) === 1))
      expect(near, `hole at ${hole.x}, ${hole.z}`).toBe(true)
    }
  })
})
