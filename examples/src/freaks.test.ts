// The twisted crowd's freak show: every soldier its own seed, read in the
// post-decode hook through the instance index, and its own size. The shader
// turns the seed into a shape by the rule `shapeOf` states, so the rule is
// held here, where it runs without a GPU.
import { describe, expect, it } from 'vitest'
import { freaksOf, shapeOf } from './freaks.js'

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

  it('gives every soldier its own size, within a crowd of soldiers', () => {
    const scales = crowd.map((f) => f.scale)
    expect(Math.min(...scales)).toBeGreaterThanOrEqual(0.75)
    expect(Math.max(...scales)).toBeLessThanOrEqual(1.3)
    // Spread, not bunched: the shortest and tallest are far apart.
    expect(Math.max(...scales) - Math.min(...scales)).toBeGreaterThan(0.4)
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

describe('shapeOf', () => {
  it('reads the first third of the seeds as a bulge, and only a bulge', () => {
    expect(shapeOf(0.1)).toEqual({ kind: 'bulge', bulge: expect.any(Number), stretch: 1, wring: 0 })
    expect(shapeOf(0.01).bulge).toBeCloseTo(0.35 + 0.65 * 0.03, 6)
    expect(shapeOf(0.33).bulge).toBeCloseTo(0.35 + 0.65 * 0.99, 6)
  })

  it('reads the second third as a stretch, taller or squatter', () => {
    expect(shapeOf(0.5)).toEqual({ kind: 'stretch', bulge: 0, stretch: expect.any(Number), wring: 0 })
    expect(shapeOf(0.34).stretch).toBeCloseTo(0.6 + 1 * 0.02, 6)
    expect(shapeOf(0.66).stretch).toBeCloseTo(0.6 + 1 * 0.98, 6)
  })

  it('reads the last third as a wring of the body, in radians, never none', () => {
    expect(shapeOf(0.8)).toEqual({ kind: 'wring', bulge: 0, stretch: 1, wring: expect.any(Number) })
    expect(shapeOf(0.67).wring).toBeCloseTo(0.6 + 1 * 0.01, 6)
    expect(shapeOf(0.99).wring).toBeCloseTo(0.6 + 1 * 0.97, 6)
  })
})
