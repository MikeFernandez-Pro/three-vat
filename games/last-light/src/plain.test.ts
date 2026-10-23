// The goose game's plain (#187): the seed's route of braziers to the pond.
import { describe, expect, it } from 'vitest'
import { plain } from './plain'

/** A full torch's walk: 25 s of fuel at 2 m/s. */
const WALK = { burnRate: 1 / 25, pace: 2 }

describe("the goose game's plain", () => {
  it('gives the same plain for the same seed, and another for another', () => {
    expect(plain(5, WALK)).toEqual(plain(5, WALK))
    expect(plain(6, WALK).braziers).not.toEqual(plain(5, WALK).braziers)
  })

  it('places 6 or 7 braziers, a gosling waiting in each one\'s light', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { braziers } = plain(seed, WALK)
      expect([6, 7]).toContain(braziers.length)
      // The well's gosling is down the well, as far off as its lantern hangs from it: the test below.
      for (const b of braziers) if (b.scene !== 'well') expect(Math.hypot(b.gosling.x - b.x, b.gosling.z - b.z)).toBeLessThan(b.reach - 0.5)
    }
  })

  it("sets the well at the first brazier and the dead tree at the second, whatever the seed: the well's gosling down it, in the brazier's light, the tree's up it", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { braziers } = plain(seed, WALK)
      expect(braziers.map((b) => b.scene).filter(Boolean)).toEqual(['well', 'tree', 'cage', 'log'])
      expect(braziers[0]!.scene).toBe('well')
      expect(braziers[1]!.scene).toBe('tree')
      const well = braziers.find((b) => b.scene === 'well')!
      const d = Math.hypot(well.gosling.x - well.x, well.gosling.z - well.z)
      expect(d).toBeGreaterThan(1.5)
      expect(d).toBeLessThan(well.reach)
      const tree = braziers.find((b) => b.scene === 'tree')!
      expect(tree.gosling).toEqual({ x: tree.x, z: tree.z })
    }
  })

  it("sets the cage at the third brazier, in its light, and its key's skull a few metres off in the dark, out of every light", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { braziers, start, pond } = plain(seed, WALK)
      const b = braziers[2]!
      expect(b.scene).toBe('cage')
      const cage = Math.hypot(b.gosling.x - b.x, b.gosling.z - b.z)
      expect(cage).toBeGreaterThan(1.5)
      expect(cage).toBeLessThan(b.reach - 0.5)
      const skull = b.skull!
      const out = Math.hypot(skull.x - b.x, skull.z - b.z)
      expect(out).toBeGreaterThan(b.reach + 1.5)
      expect(out).toBeLessThan(b.reach + 4)
      for (const other of braziers) expect(Math.hypot(skull.x - other.x, skull.z - other.z)).toBeGreaterThan(other.reach + 1.5)
      expect(Math.hypot(skull.x - start.x, skull.z - start.z)).toBeGreaterThan(5)
      expect(Math.hypot(skull.x - pond.x, skull.z - pond.z)).toBeGreaterThan(pond.radius + 3)
    }
  })

  it('sets the hollow log at the fourth brazier, beside it in its light, along the way she came, its gosling deep in it', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { braziers } = plain(seed, WALK)
      const b = braziers[3]!
      expect(b.scene).toBe('log')
      const log = b.log!
      // The gosling deep in it, in its middle; both its ends in the brazier's light, neither in its dip.
      expect(b.gosling.x).toBeCloseTo((log.near.x + log.far.x) / 2, 9)
      expect(b.gosling.z).toBeCloseTo((log.near.z + log.far.z) / 2, 9)
      for (const end of [log.near, log.far]) {
        const d = Math.hypot(end.x - b.x, end.z - b.z)
        expect(d).toBeGreaterThan(1.5)
        expect(d).toBeLessThan(b.reach)
      }
      // Its near end toward where she comes from, the brazier before it; its far end up the plain.
      const was = braziers[2]!
      expect(Math.hypot(log.near.x - was.x, log.near.z - was.z)).toBeLessThan(Math.hypot(log.far.x - was.x, log.far.z - was.z) - 1)
      expect(log.far.z).toBeLessThan(log.near.z)
    }
  })

  it('keeps every gap, from the start to the first brazier, brazier to brazier, and to the pond, within a full torch at a walk, with a margin', () => {
    const full = WALK.pace / WALK.burnRate
    for (let seed = 1; seed <= 40; seed++) {
      const p = plain(seed, WALK)
      const stops = [p.start, ...p.braziers, p.home]
      for (let k = 1; k < stops.length; k++) {
        const gap = Math.hypot(stops[k]!.x - stops[k - 1]!.x, stops[k]!.z - stops[k - 1]!.z)
        expect(gap).toBeLessThanOrEqual(full * 0.75)
        expect(gap).toBeGreaterThan(8)
      }
    }
  })

  it('runs one way, up the screen, wandering sideways, the pond past the last brazier, all inside its box', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const p = plain(seed, WALK)
      const stops = [p.start, ...p.braziers, p.pond]
      for (let k = 1; k < stops.length; k++) expect(stops[k]!.z).toBeLessThan(stops[k - 1]!.z)
      for (const s of stops) {
        expect(s.x).toBeGreaterThan(p.bounds.minX)
        expect(s.x).toBeLessThan(p.bounds.maxX)
        expect(s.z).toBeGreaterThan(p.bounds.minZ)
        expect(s.z).toBeLessThan(p.bounds.maxZ)
      }
      // The home point is in the water, short of its middle.
      const d = Math.hypot(p.home.x - p.pond.x, p.home.z - p.pond.z)
      expect(d).toBeLessThan(p.pond.radius)
      expect(d).toBeGreaterThan(0)
    }
  })
})
