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
      for (const b of braziers) expect(Math.hypot(b.gosling.x - b.x, b.gosling.z - b.z)).toBeLessThan(b.reach - 0.5)
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
