import { describe, expect, it } from 'vitest'
import { GRID, cellAt, colliderPad, inCanal, sewers, type Point } from './sewers'
import { HOLDER_RADIUS, Walls } from './walls'

const map = sewers()

/** The floor cells the child's body fits on, every one reachable from `from` without crossing a wall: a flood over the grid; or, `rat`, a rat's, the canal's water a wall. */
function reach(from: Point, rat = false): Set<number> {
  const { grid } = map
  const walls = new Walls(map.walls)
  const fits = (c: number, r: number) => {
    if (grid.cells[r * grid.cols + c] !== 1) return false
    const x = grid.minX + (c + 0.5) * GRID
    const z = grid.minZ + (r + 0.5) * GRID
    if (rat) return !inCanal(map, x, z) && !walls.inside(x, z, 0.1)
    return !walls.inside(x, z, HOLDER_RADIUS)
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
  it('lays the start on the floor, and the canal down the gallery between its walkways', () => {
    expect(cellAt(map.grid, map.level.start.x, map.level.start.z)).toBe(1)
    expect(cellAt(map.grid, 0, -30)).toBe(1)
    expect(inCanal(map, 0, -30)).toBe(true)
    for (const x of [-1.7, 1.7]) expect(inCanal(map, x, -30)).toBe(false)
    expect(cellAt(map.grid, 1.7, -30)).toBe(1)
  })

  it('leaves the rats on the walkways no way to the landing but through the water', () => {
    const reached = reach({ x: -1.7, z: -30 }, true)
    expect(reached.has(cellOf({ x: 0, z: -15 }))).toBe(true)
    expect(reached.has(cellOf({ x: 0.2, z: -42.6 }))).toBe(false)
  })

  it('traces walls round the floor, few enough to stream', () => {
    expect(map.walls.length).toBeGreaterThan(100)
    expect(map.walls.length).toBeLessThan(3000)
    for (const wall of map.walls) expect(Math.hypot(wall.to.x - wall.from.x, wall.to.z - wall.from.z)).toBeGreaterThan(0)
  })

  it('lets the child walk from the start to every place the run goes, the doors aside', () => {
    const reached = reach(map.level.start)
    const places: Record<string, Point> = {
      'waking lantern': { x: 1.4, z: 19.8 },
      hub: { x: 0, z: -5.2 },
      'gas lever': map.levers[0]!,
      corpse: map.corpse,
      'water lever': map.levers[1]!,
      chest: map.chest,
      'hub lever': map.levers[2]!,
      'past the huge door': { x: 0, z: -20.5 },
      'in the canal': { x: 0, z: -30 },
      'a walkway': { x: 1.7, z: -30 },
      landing: { x: 0.2, z: -42.6 },
      'cistern door': { x: 4.2, z: -56.65 },
      'past the cistern door': { x: 4.2, z: -59.25 },
      ladder: map.ladder,
    }
    // A place with a body, a lever's post, a lantern, the chest, is reached by standing at its edge.
    const nearEnough = (p: Point) => {
      const r = 0.5 + colliderPad(p)
      for (const k of reached) {
        const x = map.grid.minX + ((k % map.grid.cols) + 0.5) * GRID
        const z = map.grid.minZ + (Math.floor(k / map.grid.cols) + 0.5) * GRID
        if (Math.hypot(x - p.x, z - p.z) <= r) return true
      }
      return false
    }
    const missing = Object.entries(places).filter(([, p]) => !nearEnough(p))
    expect(missing.map(([name]) => name)).toEqual([])
  })

  it('puts every plate and button on the floor', () => {
    for (const p of [...map.plates, ...map.buttons]) expect(cellAt(map.grid, p.x, p.z)).toBe(1)
  })
})
