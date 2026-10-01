// The twisted crowd's freak show: every soldier its own seed, read in the
// post-decode hook through the instance index, and its own size. The shader
// turns the seed into a shape by the rule `shapeOf` states, so the rule is
// held here, where it runs without a GPU.
import { describe, expect, it } from 'vitest'
import { FREAKS, freaksOf, shapeOf } from './freaks.js'

// The deform pages' crowd: twelve columns, eight ranks.
const COUNT = 96
const crowd = freaksOf(COUNT)

describe('freaksOf', () => {
  it('gives every soldier a seed of its own, the same on every visit', () => {
    for (const { seed } of crowd) {
      expect(seed).toBeGreaterThanOrEqual(0)
      expect(seed).toBeLessThan(1)
    }
    expect(new Set(crowd.map((f) => f.seed)).size).toBe(COUNT)
    expect(freaksOf(COUNT)).toEqual(crowd)
  })

  it('holds a seed a float texture keeps exactly', () => {
    for (const { seed } of crowd) expect(Math.fround(seed)).toBe(seed)
  })

  it('gives every soldier its own size, from a child to a giant', () => {
    const scales = crowd.map((f) => f.scale)
    expect(Math.min(...scales)).toBeGreaterThanOrEqual(FREAKS.scale[0])
    expect(Math.max(...scales)).toBeLessThanOrEqual(FREAKS.scale[1])
    // Spread, not bunched: the tallest stands well over twice the shortest.
    expect(Math.max(...scales) / Math.min(...scales)).toBeGreaterThan(2.2)
  })

  it('makes no two soldiers alike', () => {
    const looks = crowd.map(({ seed, scale }) => ({ ...shapeOf(seed), scale }))
    for (let i = 0; i < COUNT; i++) {
      for (let j = i + 1; j < COUNT; j++) {
        const a = looks[i]!
        const b = looks[j]!
        if (a.kind !== b.kind) continue
        const apart =
          Math.abs(a.bulge - b.bulge) + Math.abs(a.stretch - b.stretch) + Math.abs(a.wring - b.wring) + Math.abs(a.scale - b.scale)
        expect(apart, `soldiers ${i} and ${j}`).toBeGreaterThan(0.01)
      }
    }
  })

  it('casts the three shapes evenly across the crowd', () => {
    const counts = { bulge: 0, stretch: 0, wring: 0 }
    for (const { seed } of crowd) counts[shapeOf(seed).kind]++
    expect(counts).toEqual({ bulge: COUNT / 3, stretch: COUNT / 3, wring: COUNT / 3 })
  })

  it('scatters the shapes, rather than dealing them down the columns', () => {
    // Twelve columns: shape by instance order would stand each column in one.
    const columns = Array.from({ length: 12 }, (_, c) => new Set(crowd.filter((_, i) => i % 12 === c).map((f) => shapeOf(f.seed).kind)))
    for (const kinds of columns) expect(kinds.size).toBeGreaterThan(1)
  })

  it('keeps every seed off the edge between two shapes, where a float could tip it', () => {
    for (const { seed } of crowd) {
      const third = seed * 3
      expect(Math.abs(third - Math.round(third))).toBeGreaterThan(1e-4)
    }
  })
})

describe('the freak show reads soldier by soldier', () => {
  // Each shape's range starts where it is already plain from across the
  // crowd, and ends well past what a body could be.
  it('swells the mildest belly by half the body, the worst by more than its width', () => {
    expect(FREAKS.bulge[0]).toBeGreaterThanOrEqual(0.5)
    expect(FREAKS.bulge[1]).toBeGreaterThan(1.2)
  })

  it('stretches from under half the height to near twice it', () => {
    expect(FREAKS.stretch[0]).toBeLessThan(0.5)
    expect(FREAKS.stretch[1]).toBeGreaterThanOrEqual(1.9)
  })

  it('wrings from near a quarter turn to well past it', () => {
    expect(FREAKS.wring[0]).toBeGreaterThanOrEqual(Math.PI / 4)
    expect(FREAKS.wring[1]).toBeGreaterThan((Math.PI * 3) / 4)
  })

  it('runs the crowd of each shape from the mildest of its range to the wildest', () => {
    // Evenly spaced: the crowd's bulges run from one end of the range to the other.
    const bulges = crowd.map((f) => shapeOf(f.seed)).filter((s) => s.kind === 'bulge').map((s) => s.bulge)
    expect(Math.min(...bulges)).toBeLessThan(FREAKS.bulge[0] + 0.05)
    expect(Math.max(...bulges)).toBeGreaterThan(FREAKS.bulge[1] - 0.05)
  })
})

describe('shapeOf', () => {
  const at = ([min, max]: readonly [number, number], amount: number) => min + (max - min) * amount

  it('reads the first third of the seeds as a bulge, and only a bulge', () => {
    expect(shapeOf(0.1)).toEqual({ kind: 'bulge', bulge: expect.any(Number), stretch: 1, wring: 0 })
    expect(shapeOf(0.01).bulge).toBeCloseTo(at(FREAKS.bulge, 0.03), 6)
    expect(shapeOf(0.33).bulge).toBeCloseTo(at(FREAKS.bulge, 0.99), 6)
  })

  it('reads the second third as a stretch, taller or squatter', () => {
    expect(shapeOf(0.5)).toEqual({ kind: 'stretch', bulge: 0, stretch: expect.any(Number), wring: 0 })
    expect(shapeOf(0.34).stretch).toBeCloseTo(at(FREAKS.stretch, 0.02), 6)
    expect(shapeOf(0.66).stretch).toBeCloseTo(at(FREAKS.stretch, 0.98), 6)
  })

  it('reads the last third as a wring of the body, in radians, never none', () => {
    expect(shapeOf(0.8)).toEqual({ kind: 'wring', bulge: 0, stretch: 1, wring: expect.any(Number) })
    expect(shapeOf(0.67).wring).toBeCloseTo(at(FREAKS.wring, 0.01), 6)
    expect(shapeOf(0.99).wring).toBeCloseTo(at(FREAKS.wring, 0.97), 6)
  })
})
