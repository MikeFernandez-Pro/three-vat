import { describe, expect, it } from 'vitest'
import { ARCH_CLEAR, archesOf, archStones, archSurface, defaultArchLook } from './arches'
import { laid, ROUTE } from './plain'
import { defaultRoadShape, roadLine } from './road'

const plain = laid(ROUTE)
const line = roadLine(plain, defaultRoadShape())
const arches = archesOf(plain, line, 8)
const distance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z)

describe("the old road's arches", () => {
  it('stand as many as asked for on the road, clear of the fires, the road running through them', () => {
    expect(arches).toHaveLength(8)
    const fires = [plain.start, ...plain.braziers, plain.home]
    for (const arch of arches) {
      expect(Math.min(...line.points.map((p) => distance(p, arch)))).toBeLessThan(0.3)
      // Straight across, never nearer than the road's way round.
      expect(Math.min(...fires.map((f) => distance(f, arch)))).toBeGreaterThan(Math.hypot(ARCH_CLEAR, defaultRoadShape().side) - 1)
      expect(Math.hypot(arch.way.x, arch.way.z)).toBeCloseTo(1, 6)
    }
    expect(archesOf(plain, line, 0)).toEqual([])
    expect(archesOf(plain, line, 20)).toHaveLength(20)
  })

  it('stand evenly spaced up the road, none on another', () => {
    const many = archesOf(plain, line, 20)
    for (let k = 1; k < many.length; k++) expect(distance(many[k]!, many[k - 1]!)).toBeGreaterThan(2)
  })

  it('are the same arches for the same road', () => {
    expect(archesOf(laid(ROUTE), roadLine(laid(ROUTE), defaultRoadShape()), 8)).toEqual(arches)
  })

  it("lay the road's slabs along their middle line, from one foot over the point to the other, without a break", () => {
    // Up the left leg's middle, round its arc to the point, down the right: along grows all the way, out of the line nothing.
    const line = [
      ...[0, 2, 4.644].map((y) => ({ z: -2.5, y })),
      ...[0.3, 0.7, 1, Math.PI / 3 - 1e-9].map((a) => ({ z: 2.5 - 5 * Math.cos(a), y: 4.644 + 5 * Math.sin(a) })),
      ...[Math.PI / 3 - 1e-9, 1, 0.5].map((a) => ({ z: -2.5 + 5 * Math.cos(a), y: 4.644 + 5 * Math.sin(a) })),
      ...[4.644, 2, 0].map((y) => ({ z: 2.5, y })),
    ]
    const laid = line.map(({ z, y }) => archSurface(z, y))
    for (let k = 1; k < laid.length; k++) expect(laid[k]!.along).toBeGreaterThanOrEqual(laid[k - 1]!.along - 1e-6)
    for (const at of laid) expect(at.out).toBeCloseTo(0, 6)
    // The same at the spring from the leg and from the arc, and at the point from either side.
    expect(archSurface(-2.5, 4.644).along).toBeCloseTo(archSurface(-2.5, 4.644 + 1e-9).along, 6)
    expect(archSurface(-1e-9, 4.644 + Math.sqrt(18.75)).along).toBeCloseTo(archSurface(1e-9, 4.644 + Math.sqrt(18.75)).along, 6)
    // Out grows toward the outside on both legs and over the arc.
    expect(archSurface(-2.9, 1).out).toBeGreaterThan(0)
    expect(archSurface(2.1, 1).out).toBeLessThan(0)
    expect(archSurface(0, 9.5).out).toBeGreaterThan(0)
  })

  it('stand on their legs either side of the road', () => {
    const whole = arches[0]!
    const [left, right] = archStones(whole, defaultArchLook().scale)
    const across = { x: -whole.way.z, z: whole.way.x }
    const side = (p: { x: number; z: number }) => (p.x - whole.x) * across.x + (p.z - whole.z) * across.z
    expect(Math.sign(side(left!.at))).toBe(-Math.sign(side(right!.at)))
    // The inner faces of its legs, across the road, as far off its middle as each other, and closer the smaller it is.
    const inner = (stone: typeof left) => Math.min(...stone!.outline.map((p) => Math.abs(side({ x: stone!.at.x + p.x, z: stone!.at.z + p.z }))))
    expect(inner(left)).toBeCloseTo(inner(right), 6)
    expect(inner(archStones(whole, defaultArchLook().scale / 2)[0])).toBeCloseTo(inner(left) / 2, 6)
  })
})
