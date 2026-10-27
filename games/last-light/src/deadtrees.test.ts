// The goose game's dead trees: either side of the old road, never on it, behind its walls where by one.
import { describe, expect, it } from 'vitest'
import { Box3, CylinderGeometry, Sphere, Vector3 } from 'three/webgpu'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { TREE_STRETCH, behindWalls, deadTrees, defaultDeadTreeShape, offWay, shadowOf, stretchInReach, trunkCap, treeStretches } from './deadtrees'
import { laid, ROUTE } from './plain'
import { defaultRoadShape, roadLine } from './road'
import { defaultRoadWallLook, roadWallsOf } from './roadwalls'

const plain = laid(ROUTE)
const shape = defaultDeadTreeShape()
const road = roadLine(plain, defaultRoadShape()).points
const walls = roadWallsOf(plain, { points: road }, defaultRoadWallLook())
const trees = deadTrees(plain, road, 5, shape, walls)
const distance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z)

describe("the goose game's dead trees", () => {
  it('stand in a band either side of the road, never on it', () => {
    expect(trees.length).toBeGreaterThan(40)
    for (const t of trees) {
      expect(offWay(road, t)).toBeGreaterThanOrEqual(shape.clear)
      expect(offWay(road, t)).toBeLessThanOrEqual(shape.band)
    }
    // On both sides of it.
    const [a, b] = [road[0]!, road.at(-1)!]
    const sides = new Set(trees.map((t) => Math.sign((b.x - a.x) * (t.z - a.z) - (b.z - a.z) * (t.x - a.x))))
    expect(sides.size).toBe(2)
  })

  it('stand behind a wall where by one, never between it and the road', () => {
    expect(walls.length).toBeGreaterThan(0)
    const byWall = trees.filter((t) => walls.some((w) => w.line.some((p) => distance(p, t) < shape.byWall)))
    expect(byWall.length).toBeGreaterThan(0)
    for (const t of trees) expect(behindWalls(road, walls, shape, t)).toBe(true)
    // A tree halfway between a wall and the road is not behind it.
    const wall = walls[0]!
    const middle = wall.line[Math.floor(wall.line.length / 2)]!
    const onRoad = road.reduce((best, p) => (distance(p, middle) < distance(best, middle) ? p : best))
    expect(behindWalls(road, walls, shape, { x: (middle.x + onRoad.x) / 2, z: (middle.z + onRoad.z) / 2 })).toBe(false)
  })

  it("keep out of every brazier's light and off every scene's pieces", () => {
    for (const t of trees) {
      for (const b of plain.braziers) {
        expect(distance(t, b)).toBeGreaterThanOrEqual(b.reach + shape.light)
        for (const p of [b.gosling, b.fire, b.skull, b.cart]) if (p) expect(distance(t, p)).toBeGreaterThanOrEqual(shape.piece)
      }
    }
  })

  it('stand apart, each one of the variants, as tall as the shape allows and as wide as it has them', () => {
    trees.forEach((t, k) => {
      for (const u of trees.slice(k + 1)) expect(distance(t, u)).toBeGreaterThanOrEqual(shape.spacing)
      expect(Number.isInteger(t.variant) && t.variant >= 0 && t.variant < 5).toBe(true)
      expect(t.height).toBeGreaterThanOrEqual(shape.shortest)
      expect(t.height).toBeLessThanOrEqual(shape.tallest)
      expect(t.width).toBe(shape.width)
    })
    expect(new Set(trees.map((t) => t.variant)).size).toBe(5)
  })

  it('stand only where `clear` lets them, the same trees every time, other trees on another seed', () => {
    const west = deadTrees(plain, road, 5, shape, walls, [], (x) => x < 0)
    expect(west.length).toBeGreaterThan(0)
    for (const t of west) expect(t.x).toBeLessThan(0)
    expect(deadTrees(plain, road, 5, shape, walls)).toEqual(trees)
    expect(deadTrees(plain, road, 5, { ...shape, seed: 2 }, walls)).not.toEqual(trees)
  })
})

describe("the dead trees' stretches", () => {
  it('draw every tree once, each stretch one kind of tree inside one square of the plain, so the ones out of view are left out', () => {
    const stretches = treeStretches(trees)
    expect(stretches.flat().length).toBe(trees.length)
    expect(new Set(stretches.flat()).size).toBe(trees.length)
    for (const these of stretches) {
      expect(these.length).toBeGreaterThan(0)
      expect(new Set(these.map((t) => t.variant)).size).toBe(1)
      expect(new Set(these.map((t) => `${Math.floor(t.x / TREE_STRETCH)} ${Math.floor(t.z / TREE_STRETCH)}`)).size).toBe(1)
    }
    // The road runs on: its trees fall into many stretches, not one a kind.
    expect(stretches.length).toBeGreaterThan(5 * 3)
  })

  it('are drawn while any of a stretch comes within the reach, and left out once it is all past it', () => {
    expect(stretchInReach(20, 0, 5, 0, 0, 16)).toBe(true)
    expect(stretchInReach(20, 0, 5, 0, 0, 15)).toBe(true)
    expect(stretchInReach(20, 0, 5, 0, 0, 14.9)).toBe(false)
    expect(stretchInReach(0, 0, 5, 0, 0, Infinity)).toBe(true)
  })

  it("are kept while the shadow they throw away from the sun could be seen, the stretch itself out of sight", () => {
    // A metre round, its foot on the ground, the sun 45 degrees up toward +x: the shadow falls toward -x, its far edge
    // where the ray grazing the sphere's far side meets the ground.
    const bound = new Sphere(new Vector3(0, 1, 0), 1)
    const box = shadowOf(bound, new Vector3(1, 1, 0).normalize(), new Box3())
    expect(box.containsPoint(new Vector3(-1 - Math.SQRT2, 0, 0))).toBe(true)
    expect(box.containsPoint(new Vector3(1, 2, 0))).toBe(true)
    expect(box.min.x).toBeGreaterThan(-4)
    expect(box.max.x).toBeLessThanOrEqual(1)
    // The sun straight overhead: the shadow under the stretch, no further out than it.
    const under = shadowOf(bound, new Vector3(0, 1, 0), new Box3())
    expect([under.min.x, under.max.x, under.min.z, under.max.z]).toEqual([-1, 1, -1, 1])
    // Down: no shadow, only the stretch.
    expect(shadowOf(bound, new Vector3(1, -1, 0).normalize(), new Box3()).equals(bound.getBoundingBox(new Box3()))).toBe(true)
  })
})

describe("a trunk's cross-section", () => {
  // Two trunks side by side, 0.5 m round, 2 m tall, their feet on the ground.
  const trunk = (x: number) => new CylinderGeometry(0.5, 0.5, 2, 32, 4, true).translate(x, 1, 0)

  it('fills each piece of wood the plane cuts, flat at its height, out to its edge', () => {
    const cap = trunkCap(trunk(0), 0.7)!
    const position = cap.getAttribute('position')
    let area = 0
    for (let k = 0; k < position.count; k += 3) {
      const [ax, az, bx, bz, cx, cz] = [position.getX(k), position.getZ(k), position.getX(k + 1), position.getZ(k + 1), position.getX(k + 2), position.getZ(k + 2)]
      area += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2
      for (let v = k; v < k + 3; v++) expect(position.getY(v)).toBeCloseTo(0.7)
      // Facing up, every one, so none is drawn as a back face.
      expect((bx - ax) * (cz - az) - (bz - az) * (cx - ax)).toBeLessThan(0)
    }
    expect(area).toBeCloseTo(Math.PI * 0.25, 1)
    // The uv runs from the middle out to 1 at the edge, for the rings.
    const uv = cap.getAttribute('uv')
    expect(Math.hypot(uv.getX(0), uv.getY(0))).toBe(0)
    expect(Math.hypot(uv.getX(1), uv.getY(1))).toBeCloseTo(1)
  })

  it('gives each piece its own middle, and nothing where the plane misses the wood', () => {
    const cap = trunkCap(mergeGeometries([trunk(-2), trunk(2)]), 1.3)!
    const position = cap.getAttribute('position')
    const middles = new Set<number>()
    for (let k = 0; k < position.count; k += 3) middles.add(Math.round(position.getX(k)))
    expect([...middles].sort()).toEqual([-2, 2])
    expect(trunkCap(trunk(0), 2.5)).toBeUndefined()
  })
})
