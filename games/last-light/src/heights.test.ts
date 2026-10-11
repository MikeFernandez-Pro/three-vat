// The ground's height (#182): the woods' height shapes read where the play
// happens. What is checked is what the drawing stands things on.
import { describe, expect, it } from 'vitest'
import { HeightGrid, contours, heightAt, standingAt, treads, type Flight, type HeightShape } from './heights'
import { woods } from './woods'

const map = woods()
/** The woods' ground at a map point, as the level is laid out: where something stands, on the steps or the shapes. */
const at = (x: number, y: number) => standingAt(map, x - 18, y)

describe("the woods' ground", () => {
  it('is flat south of the river and where the bridge lands: the clearing, the wood, the gate, over the bridge, the jammed cart', () => {
    for (const [x, y] of [[10.5, 63.5], [12, 52.3], [20.6, 31], [31, 14.3], [31, 4], [29.3, -1.6], [31, -2]] as [number, number][]) {
      expect(at(x, y)).toBeCloseTo(0, 9)
    }
  })

  it("sinks the river's bed beside the bridge", () => {
    expect(at(20, 4)).toBeCloseTo(-0.8, 5)
    const lines = contours(map.heights, map.level.bounds, 0.5, 0.5).filter((line) => line.level < 0 && line.a.z > 0)
    expect(lines.length).toBeGreaterThan(0)
    for (const { a } of lines) expect(a.z).toBeLessThan(9)
  })

  it('climbs the steps up the hill, a level tread at a time, to the pine, whose ends stand as high, over the ravine sunk under it', () => {
    const [flight] = map.flights as [Flight]
    const steps = treads(map.heights, flight)
    expect(steps).toHaveLength(flight.count)
    for (let k = 1; k < steps.length; k++) expect(steps[k]!.height).toBeGreaterThanOrEqual(steps[k - 1]!.height)
    expect(steps[0]!.height).toBeLessThan(0.1)
    expect(steps.at(-1)!.height).toBeCloseTo(map.hill, 5)
    // Up the road, the ground under the child never goes down, and is level along each tread.
    const heights = [[31, -2.6], [30.5, -4.5], [30, -6.5], [27, -9.5], [27.5, -14], [24, -17.5], [20.6, -18.7]].map(([x, y]) => at(x!, y!))
    for (let k = 1; k < heights.length; k++) expect(heights[k]!).toBeGreaterThanOrEqual(heights[k - 1]!)
    // The pine's two ends on the rims, the far side's brazier, the hilltop: the hill's height.
    for (const end of [map.pine.from, map.pine.to]) expect(standingAt(map, end.x, end.z)).toBeCloseTo(map.hill, 5)
    expect(at(9.6, -21)).toBeCloseTo(map.hill, 5)
    // The ravine's floor under the pine, the depth of the hill and more below the rims.
    expect(at(15.4, -19.5)).toBeCloseTo(-map.ravineFloor, 5)
  })

  it('comes down the forest path to the lawn, and the manor stands on the flat', () => {
    const heights = [[4, -34.5], [4.8, -44.5], [5, -54.5], [4.6, -59]].map(([x, y]) => at(x!, y!))
    for (let k = 1; k < heights.length; k++) expect(heights[k]!).toBeLessThan(heights[k - 1]!)
    expect(at(4, -62.5)).toBeCloseTo(0, 9)
    // Where the manor's front stands, past its steps: the ground's own shapes.
    expect(heightAt(map.heights, 4 - 18, -66.6)).toBeCloseTo(0, 9)
    expect(heightAt(map.heights, -5 - 18, -66.6)).toBeCloseTo(0, 9)
  })

  it("climbs the manor's steps from the lawn to the door, three treads of 0.15 m", () => {
    const flight = map.flights[1]!
    expect(treads(map.heights, flight).map((tread) => tread.height)).toEqual([0.15, 0.3, 0.45].map((h) => expect.closeTo(h, 9)))
    expect(at(4, -63.5)).toBeCloseTo(0.15, 9)
    expect(at(4, -64.7)).toBeCloseTo(0.3, 9)
    expect(at(4, -66.1)).toBeCloseTo(0.45, 9)
  })
})

describe('height shapes', () => {
  const square = (half: number) => [
    { x: -half, z: -half },
    { x: half, z: -half },
    { x: half, z: half },
    { x: -half, z: half },
  ]

  it('rise to their height over their edge, in from their outline, and add up', () => {
    const shapes: HeightShape[] = [{ outline: square(10), height: 2, edge: 4 }]
    expect(heightAt(shapes, 20, 0)).toBe(0)
    expect(heightAt(shapes, 9.99, 0)).toBeCloseTo(0, 2)
    expect(heightAt(shapes, 8, 0)).toBeCloseTo(1, 5)
    expect(heightAt(shapes, 0, 0)).toBe(2)
    expect(heightAt([...shapes, { outline: square(3), height: -1.5, edge: 0 }], 0, 0)).toBe(0.5)
  })

  it('rise along a way, none of it at its start and all of it from its end on', () => {
    const shapes: HeightShape[] = [{ outline: square(10), height: 3, edge: 0, along: { from: { x: 0, z: 5 }, to: { x: 0, z: -5 } } }]
    expect(heightAt(shapes, 0, 8)).toBe(0)
    expect(heightAt(shapes, 0, 0)).toBeCloseTo(1.5, 5)
    expect(heightAt(shapes, 0, -8)).toBe(3)
  })

  it('give a contour on every level crossed, where the ground is at that level', () => {
    const shapes: HeightShape[] = [{ outline: square(10), height: 3, edge: 6 }]
    const lines = contours(shapes, { minX: -12, maxX: 12, minZ: -12, maxZ: 12 }, 0.5, 1)
    expect(new Set(lines.map((line) => line.level))).toEqual(new Set([1, 2, 3]))
    for (const { a, level } of lines) expect(Math.abs(heightAt(shapes, a.x, a.z) - level)).toBeLessThan(0.3)
  })

  it('read off a grid the same at its points, and between them in between', () => {
    const shapes: HeightShape[] = [{ outline: square(10), height: 3, edge: 6 }]
    const grid = new HeightGrid((x, z) => heightAt(shapes, x, z), { minX: -12, maxX: 12, minZ: -12, maxZ: 12 }, 0.5)
    expect(grid.at(-12, -12)).toBe(0)
    expect(grid.at(0, 0)).toBeCloseTo(3, 5)
    expect(grid.at(-6.5, 1)).toBeCloseTo(heightAt(shapes, -6.5, 1), 5)
    const between = grid.at(-6.25, 1)
    expect(between).toBeGreaterThan(Math.min(grid.at(-6.5, 1), grid.at(-6, 1)) - 1e-9)
    expect(between).toBeLessThan(Math.max(grid.at(-6.5, 1), grid.at(-6, 1)) + 1e-9)
    // Past the grid's edge, its edge.
    expect(grid.at(-40, 0)).toBe(grid.at(-12, 0))
  })
})

describe('flights of steps', () => {
  // A slope up 2 m from z 5 to z -5, and a flight straight up it in four treads.
  const shapes: HeightShape[] = [{ outline: [{ x: -10, z: 10 }, { x: 10, z: 10 }, { x: 10, z: -10 }, { x: -10, z: -10 }], height: 2, edge: 0, along: { from: { x: 0, z: 5 }, to: { x: 0, z: -5 } } }]
  const flight: Flight = { line: [{ x: 0, z: 5 }, { x: 0, z: -5 }], half: 1, count: 4 }
  const terrain = { heights: shapes, flights: [flight] }

  it('stand each tread as high as the slope at its top edge, level along it, and never under the slope', () => {
    const steps = treads(shapes, flight)
    expect(steps.map((tread) => tread.to - tread.from)).toEqual([2.5, 2.5, 2.5, 2.5])
    for (const tread of steps) {
      expect(standingAt(terrain, 0.5, 5 - tread.from - 0.1)).toBe(tread.height)
      expect(standingAt(terrain, -0.5, 5 - tread.to + 0.1)).toBe(tread.height)
      for (let s = tread.from; s <= tread.to; s += 0.25) expect(tread.height).toBeGreaterThanOrEqual(heightAt(shapes, 0, 5 - s) - 1e-9)
    }
    expect(steps.at(-1)!.height).toBe(2)
  })

  it('leave the ground beside them to the slope', () => {
    expect(standingAt(terrain, 3, 0)).toBe(heightAt(shapes, 3, 0))
  })
})
