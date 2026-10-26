import { describe, expect, it } from 'vitest'
import { laid, ROUTE, type Route } from './plain'
import { defaultRoadShape, ROAD_REACH, roadAt, roadField, roadLine, roadPoints, roadStops } from './road'

// The route without its hand-laid road, if it has one: the road laid from the fires.
const { road: _hand, ...FIRES } = ROUTE
const plain = laid(FIRES)
const shape = defaultRoadShape()
const line = roadLine(plain, shape)
const distance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z)
/** How far `p` is from the road's middle, m. */
const offRoad = (p: { x: number; z: number }) => Math.min(...line.points.map((q) => distance(p, q)))

describe('the old road', () => {
  it("passes each fire `side` m off it, a scene's on the side away from its body", () => {
    const stops = roadStops(plain, shape.side)
    plain.braziers.forEach((b, k) => {
      expect(distance(stops[k]!, b)).toBeCloseTo(shape.side, 9)
      if (b.scene === 'well' || b.scene === 'cage') expect(distance(stops[k]!, b.gosling!)).toBeGreaterThan(distance(b, b.gosling!))
    })
    for (const stop of stops) expect(offRoad(stop)).toBeLessThan(0.01)
  })

  it('runs from back past her start, fading in out of the dark, to home', () => {
    const first = line.points[0]!
    expect(distance(first, plain.start)).toBeGreaterThan(shape.behind * 0.8)
    expect(first.left).toBe(0)
    expect(distance(line.points.at(-1)!, plain.home)).toBeLessThan(0.01)
  })

  it('is whole by the fires and thins to what is left out in the dark', () => {
    const lights = plain.braziers.map((b) => ({ x: b.x, z: b.z }))
    for (const p of line.points) {
      const nearest = Math.min(...lights.map((l) => distance(p, l)))
      if (nearest < shape.whole && distance(p, line.points[0]!) > shape.behind) expect(p.left).toBeCloseTo(1, 6)
      expect(p.left).toBeGreaterThanOrEqual(0)
      expect(p.left).toBeLessThanOrEqual(1)
    }
    // Past her start, the longest gap's middle: only what is left.
    const first = roadStops(plain, shape.side)[0]!
    const from = line.points.findIndex((p) => distance(p, first) < 0.01)
    expect(Math.min(...line.points.slice(from).map((p) => p.left))).toBeCloseTo(shape.left, 6)
  })

  it('is the same road for the same plain', () => {
    expect(roadLine(laid(FIRES), shape)).toEqual(line)
  })

  it('lays a field the floor reads: on the road near its middle, far off it nothing', () => {
    const field = roadField(line)
    for (const p of line.points.filter((_, k) => k % 7 === 0)) {
      const at = roadAt(field, p.x, p.z)
      expect(at.away).toBeLessThan(field.cell)
      expect(at.left).toBeCloseTo(p.left, 1)
    }
    const aside = line.points[Math.floor(line.points.length / 2)]!
    expect(roadAt(field, aside.x + 40, aside.z)).toEqual({ away: ROAD_REACH, across: ROAD_REACH, left: 0, along: 0 })
  })

  it('says how far along the road a cell is, and how far across it, to the right more than nought, so its slabs can follow it', () => {
    const field = roadField(line)
    let along = 0
    line.points.forEach((p, k) => {
      if (k > 0) along += distance(p, line.points[k - 1]!)
      if (k % 7 !== 0 || k + 1 === line.points.length) return
      expect(roadAt(field, p.x, p.z).along).toBeCloseTo(along, 0)
      // A metre to each side of the way, square to it: the same way along, either side across.
      const next = line.points[k + 1]!
      const way = { x: (next.x - p.x) / distance(next, p), z: (next.z - p.z) / distance(next, p) }
      const right = roadAt(field, p.x - way.z, p.z + way.x)
      const left = roadAt(field, p.x + way.z, p.z - way.x)
      expect(right.across).toBeGreaterThan(0.5)
      expect(left.across).toBeLessThan(-0.5)
      expect(Math.abs(right.along - along)).toBeLessThan(0.5)
      expect(Math.abs(left.along - along)).toBeLessThan(0.5)
    })
  })

  it('is laid through the points it is laid from: back past her start, each stop and home', () => {
    const through = roadPoints(plain, shape)
    for (const p of through) expect(offRoad(p)).toBeLessThan(0.01)
    expect(distance(through[0]!, line.points[0]!)).toBeLessThan(1e-9)
    expect(distance(through.at(-1)!, plain.home)).toBeLessThan(1e-9)
  })

  it('runs through the route\'s own points, in their order, if it lays it by hand, the fires laying nothing', () => {
    const road = [
      { x: 0, z: 60 },
      { x: 6, z: 30 },
      { x: -4, z: 0 },
      { x: 0, z: -50 },
    ]
    const hand = laid({ ...FIRES, road })
    expect(hand.road).toEqual(road)
    // Its box holds the road too.
    expect(hand.bounds.maxZ).toBeGreaterThan(60)
    const by = roadLine(hand, shape)
    for (const p of road) expect(Math.min(...by.points.map((q) => distance(p, q)))).toBeLessThan(0.01)
    expect(distance(by.points[0]!, road[0]!)).toBeLessThan(1e-9)
    expect(distance(by.points.at(-1)!, road.at(-1)!)).toBeLessThan(1e-9)
    // Fading in out of the dark from its first point, as the fires' road does.
    expect(by.points[0]!.left).toBe(0)
  })

  it('lays no road on a plain with no braziers', () => {
    const bare: Route = { ...FIRES, braziers: [] }
    const field = roadField(roadLine(laid(bare), shape))
    expect(roadAt(field, 0, 0).away).toBe(ROAD_REACH)
  })
})
