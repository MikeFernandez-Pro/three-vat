// The ground's height (#182): the woods' height shapes read where the play
// happens. What is checked is what the drawing stands things on.
import { describe, expect, it } from 'vitest'
import { contours, heightAt, type HeightShape } from './heights'
import { woods } from './woods'

const map = woods()
/** The woods' ground at a map point, as the level is laid out. */
const at = (x: number, y: number) => heightAt(map.heights, x - 18, y)

describe("the woods' ground", () => {
  it('is flat everywhere the child goes: the clearing, the wood, the gate, over the bridge, up the steps and down the path', () => {
    for (const [x, y] of [[10.5, 63.5], [12, 52.3], [20.6, 31], [31, 14.3], [31, 4], [29.3, -1.6], [27.3, -10.2], [9.6, -21], [4, -63]] as [number, number][]) {
      expect(at(x, y)).toBeCloseTo(0, 9)
    }
  })

  it("sinks the river's bed beside the bridge, and draws its banks as contours, none elsewhere", () => {
    expect(at(20, 4)).toBeCloseTo(-0.8, 5)
    const lines = contours(map.heights, map.level.bounds, 0.5, 0.5)
    expect(lines.length).toBeGreaterThan(0)
    for (const { a, level } of lines) {
      expect(level).toBe(-0.5)
      expect(a.z).toBeGreaterThan(-1)
      expect(a.z).toBeLessThan(9)
    }
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
})
