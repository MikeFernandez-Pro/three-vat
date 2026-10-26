import { describe, expect, it } from 'vitest'
import { alongOf, archesOf, clearRoad } from './arches'
import { laid, ROUTE } from './plain'
import { defaultRoadShape, roadLine } from './road'
import { blocksGeometry, defaultRoadWallLook, ROAD_WALL_CLEAR, ROAD_WALL_DOOR_GAP, ROAD_WALL_STYLES, roadWallLines, roadWallsOf, roadWallStones, type StoneBlock } from './roadwalls'
import { distanceTo, WALL_THICKNESS } from './walls'

const plain = laid(ROUTE)
const line = roadLine(plain, defaultRoadShape())
const { along } = clearRoad(plain, line, 0)
const distance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z)
/** How near the road's middle a point comes, m. */
const offRoad = (p: { x: number; z: number }) => Math.min(...line.points.map((q) => distance(p, q)))
/** How long a wall's middle line is, m. */
const lengthOf = (wall: StoneBlock) => wall.line.slice(1).reduce((sum, p, k) => sum + distance(p, wall.line[k]!), 0)

describe("the old road's walls", () => {
  it('stand beside the road, never on it, and clear of the fires, in every kind', () => {
    const fires = [plain.start, ...plain.braziers, plain.home]
    for (const style of ROAD_WALL_STYLES.filter((s) => s !== 'none')) {
      const look = { ...defaultRoadWallLook(), style }
      const walls = roadWallsOf(plain, line, look)
      expect(walls.length).toBeGreaterThanOrEqual(look.count)
      for (const wall of walls) {
        expect(wall.line).toHaveLength(wall.tops.length + 1)
        expect(wall.tops.every((top) => top > 0)).toBe(true)
        for (const p of wall.line) {
          // Its middle line as far off the road's middle as its face is asked to be and half its thickness, give or take the road's bends.
          expect(offRoad(p)).toBeGreaterThan(look.off + wall.thick / 2 - 0.3)
          expect(Math.min(...fires.map((f) => distance(f, p)))).toBeGreaterThan(ROAD_WALL_CLEAR - 3)
        }
      }
    }
  })

  it('bend with the road, keeping as far off it all along', () => {
    const look = { ...defaultRoadWallLook(), length: 3 }
    for (const wall of roadWallsOf(plain, line, look)) {
      const offs = wall.line.map(offRoad)
      expect(Math.max(...offs) - Math.min(...offs)).toBeLessThan(0.25)
    }
  })

  it('wall the road on both sides as a lane, and on one side else', () => {
    const lane = roadWallsOf(plain, line, { ...defaultRoadWallLook(), style: 'lane', count: 1 })
    expect(lane).toHaveLength(2)
    const [a, b] = lane.map((w) => w.line[0]!)
    // Across the road from each other: further apart than either is off the road.
    expect(distance(a!, b!)).toBeGreaterThan(offRoad(a!) + 0.5)
  })

  it('are none for none, and the same walls for the same seed', () => {
    expect(roadWallsOf(plain, line, { ...defaultRoadWallLook(), style: 'none' })).toEqual([])
    expect(roadWallsOf(plain, line, { ...defaultRoadWallLook(), count: 0 })).toEqual([])
    expect(roadWallsOf(plain, line, defaultRoadWallLook())).toEqual(roadWallsOf(laid(ROUTE), roadLine(laid(ROUTE), defaultRoadShape()), defaultRoadWallLook()))
    expect(roadWallsOf(plain, line, { ...defaultRoadWallLook(), seed: 2 })).not.toEqual(roadWallsOf(plain, line, defaultRoadWallLook()))
  })

  it('stand as tall, as thick and as long as asked', () => {
    const walls = (height: number, thickness: number, length: number) => roadWallsOf(plain, line, { ...defaultRoadWallLook(), height, thickness, length, count: 3 })
    const tallest = (height: number) => Math.max(...walls(height, 1, 1).flatMap((b) => b.tops))
    expect(tallest(2)).toBeGreaterThan(tallest(1) * 1.5)
    expect(walls(1, 2, 1)[0]!.thick).toBeCloseTo(walls(1, 1, 1)[0]!.thick * 2, 6)
    const longest = (length: number) => Math.max(...walls(1, 1, length).map(lengthOf))
    expect(longest(0.5)).toBeLessThan(longest(1))
  })

  it('never stand by an arch: each breaks off either side of it', () => {
    const lane = { ...defaultRoadWallLook(), style: 'lane' as const, count: 12 }
    const doors = archesOf(plain, line, 12)
    const walls = roadWallsOf(plain, line, lane, doors)
    expect(walls.length).toBeGreaterThan(0)
    // No wall reaches, along the road, within the gap of an arch.
    for (const door of doors) {
      const at = alongOf(line, along, door)
      for (const p of walls.flatMap((w) => w.line)) expect(Math.abs(alongOf(line, along, p) - at)).toBeGreaterThan(ROAD_WALL_DOOR_GAP - 0.6)
    }
    // Without the arches, the same walls stand whole there.
    const total = (blocks: StoneBlock[]) => blocks.reduce((sum, w) => sum + lengthOf(w), 0)
    expect(total(roadWallsOf(plain, line, lane))).toBeGreaterThan(total(walls))
  })

  it('are bodies she keeps out of, a few columns each, as thick as the wall', () => {
    const blocks = roadWallsOf(plain, line, { ...defaultRoadWallLook(), style: 'ruins' })
    const stones = roadWallStones(blocks)
    expect(stones.length).toBeGreaterThanOrEqual(blocks.length)
    for (const { outline } of stones) {
      expect(outline).toHaveLength(4)
      // Its two ends across the wall.
      expect(distance(outline[1]!, outline[2]!)).toBeCloseTo(blocks[0]!.thick, 1)
    }
  })

  it("stop the rats all along them, at their faces where thicker than the swarm's walls", () => {
    for (const thickness of [0.4, 3]) {
      const blocks = roadWallsOf(plain, line, { ...defaultRoadWallLook(), thickness })
      const lines = roadWallLines(blocks)
      // Every point of every wall's middle line on one of the rats' walls, near enough.
      for (const p of blocks.flatMap((b) => b.line)) expect(Math.min(...lines.map((w) => distanceTo(w, p.x, p.z)))).toBeLessThan(0.1)
      // Thick walls: a wall of the rats' just inside either face too.
      const thick = blocks[0]!.thick
      if (thick > WALL_THICKNESS * 2) expect(lines.length).toBeGreaterThanOrEqual(blocks.length * 3)
      else expect(lines.length).toBeLessThan(blocks.reduce((sum, b) => sum + b.tops.length, 0))
    }
  })

  it('are drawn with every face turned out, standing on the ground', () => {
    const blocks = roadWallsOf(plain, line, defaultRoadWallLook())
    const geometry = blocksGeometry(blocks, () => 2)
    const position = geometry.getAttribute('position')
    const normal = geometry.getAttribute('normal')
    // Each triangle wound so its face looks the way its normal does.
    for (let i = 0; i < position.count; i += 3) {
      const [a, b, c] = [i, i + 1, i + 2].map((k) => [position.getX(k), position.getY(k), position.getZ(k)])
      const ab = [b![0]! - a![0]!, b![1]! - a![1]!, b![2]! - a![2]!]
      const ac = [c![0]! - a![0]!, c![1]! - a![1]!, c![2]! - a![2]!]
      const cross = [ab[1]! * ac[2]! - ab[2]! * ac[1]!, ab[2]! * ac[0]! - ab[0]! * ac[2]!, ab[0]! * ac[1]! - ab[1]! * ac[0]!]
      expect(cross[0]! * normal.getX(i) + cross[1]! * normal.getY(i) + cross[2]! * normal.getZ(i)).toBeGreaterThan(0)
    }
    // Up off the ground as the stone's own heights say.
    const up = geometry.getAttribute('stoneUp')
    for (let i = 0; i < position.count; i++) expect(position.getY(i)).toBeCloseTo(up.getX(i) + 2, 5)
  })
})
