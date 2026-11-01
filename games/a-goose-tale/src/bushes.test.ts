// The goose game's bushes: scattered as the dead trees are, nearer the road, never on a trunk.
import { describe, expect, it } from 'vitest'
import { bushes, defaultBushShape } from './bushes'
import { behindWalls, deadTrees, offWay } from './deadtrees'
import { laid, ROUTE } from './plain'
import { defaultRoadShape, roadLine } from './road'
import { defaultRoadWallLook, roadWallsOf } from './roadwalls'

const plain = laid(ROUTE)
const shape = defaultBushShape()
const road = roadLine(plain, defaultRoadShape()).points
const walls = roadWallsOf(plain, { points: road }, defaultRoadWallLook())
const trees = deadTrees(plain, road, 5, undefined, walls)
const laidBushes = bushes(plain, road, 4, trees, shape, walls)
const distance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z)

describe("the goose game's bushes", () => {
  it('stand in their band either side of the road, behind its walls where by one', () => {
    expect(laidBushes.length).toBeGreaterThan(40)
    for (const b of laidBushes) {
      expect(offWay(road, b)).toBeGreaterThanOrEqual(shape.clear)
      expect(offWay(road, b)).toBeLessThanOrEqual(shape.band)
      expect(behindWalls(road, walls, shape, b)).toBe(true)
    }
  })

  it("stand off every tree's trunk, as tall as the shape allows, each one of the four bushes", () => {
    for (const b of laidBushes) {
      for (const t of trees) expect(distance(b, t)).toBeGreaterThanOrEqual(1.2)
      expect(b.height).toBeGreaterThanOrEqual(shape.shortest)
      expect(b.height).toBeLessThanOrEqual(shape.tallest)
    }
    expect(new Set(laidBushes.map((b) => b.variant)).size).toBe(4)
  })

  it('stand where trunks were once the trees are gone', () => {
    const alone = bushes(plain, road, 4, [], shape, walls)
    expect(alone.length).toBeGreaterThan(laidBushes.length)
  })
})
