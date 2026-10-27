// The goose game's pond, drawn: its noisy shore, the floor cut round it, and the bank down to the bed.
import { describe, expect, it } from 'vitest'
import { ROUTE, laid } from './plain'
import { bankGeometry, SHORE_FIELD, SHORE_REACH, shoreField, swimmingIn, bankHeight, defaultPondLook, groundOf, standingIn, floorAround, FROM_SHORE, FURTHEST, NEAREST, SEGMENTS, shoreAt, shoreline, waterGeometry, waterline } from './pond'

/** The route's pond, its shore turned by `seed`: each seed a shore of its own. */
const pondOf = (seed: number) => defaultPondLook({ ...ROUTE.pond, shore: (seed * 0.618034) % 1 })

describe("the goose game's pond", () => {
  it('has a shore that wanders in and out of its radius, within its bounds, and closes on itself', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const pond = pondOf(seed)
      const radii = shoreline(pond).map((p) => Math.hypot(p.x - pond.x, p.z - pond.z))
      expect(radii).toHaveLength(SEGMENTS)
      for (const r of radii) {
        expect(r).toBeGreaterThanOrEqual(pond.radius * NEAREST - 1e-9)
        expect(r).toBeLessThanOrEqual(pond.radius * FURTHEST + 1e-9)
      }
      // Not a circle: the nearest and furthest of the shore at least a metre apart.
      expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(1)
      // Round the full turn it comes back to where it began.
      expect(shoreAt(pond, Math.PI * 2)).toBeCloseTo(shoreAt(pond, 0), 9)
    }
  })

  it('is a circle when the shore does not wander', () => {
    const look = { ...pondOf(4), stray: 0 }
    for (const p of shoreline(look)) expect(Math.hypot(p.x - look.x, p.z - look.z)).toBeCloseTo(look.radius, 9)
  })

  it('gives the same shore for the same seed, and another for another', () => {
    expect(shoreline(pondOf(5))).toEqual(shoreline(pondOf(5)))
    const a = pondOf(5)
    const b = { ...pondOf(6), x: a.x, z: a.z }
    expect(shoreline(b)).not.toEqual(shoreline(a))
  })

  it('cuts the shore out of the floor, the floor flat round it', () => {
    const p = laid(ROUTE)
    const floor = floorAround(p.bounds, defaultPondLook(p.pond))
    const positions = floor.getAttribute('position')
    // Every point of the shore is one of the floor's, in its plane.
    const nearest = (x: number, y: number) => {
      let best = Infinity
      for (let i = 0; i < positions.count; i++) best = Math.min(best, Math.hypot(positions.getX(i) - x, positions.getY(i) - y))
      return best
    }
    for (const { x, z } of shoreline(defaultPondLook(p.pond))) expect(nearest(x, -z)).toBeLessThan(1e-4)
    for (let i = 0; i < positions.count; i++) expect(positions.getZ(i)).toBeCloseTo(0, 9)
  })

  it('falls from the floor\'s level at the shore to the bed, smoothly, below the water', () => {
    const look = pondOf(3)
    const height = (s: number) => bankHeight(look, s)
    expect(height(1)).toBeCloseTo(0, 9)
    expect(height(0)).toBe(-look.depth)
    for (let s = 0; s < 1; s += 0.05) expect(height(s)).toBeLessThanOrEqual(height(s + 0.05))
    expect(-look.depth).toBeLessThan(look.water)
    // Level with the floor where they meet: no lip at the shore.
    expect((height(1) - height(1 - 1e-5)) / 1e-5).toBeCloseTo(0, 2)
  })

  it('starts its bank on the shore, at the floor\'s level, and faces it up', () => {
    const pond = pondOf(3)
    const bank = bankGeometry(pond)
    const positions = bank.getAttribute('position')
    shoreline(pond).forEach(({ x, z }, j) => {
      expect(positions.getX(j)).toBeCloseTo(x, 4)
      expect(positions.getY(j)).toBeCloseTo(0, 9)
      expect(positions.getZ(j)).toBeCloseTo(z, 4)
    })
    const normals = bank.getAttribute('normal')
    for (let i = 0; i < normals.count; i++) expect(normals.getY(i)).toBeGreaterThan(0)
  })

  it('lays its water flat at its level, from the waterline in, each point knowing how far it is from the shore', () => {
    // Its water a little under the floor, for a waterline down the bank.
    const look = { ...pondOf(3), water: -0.1 }
    const line = waterline(look)
    expect(bankHeight(look, line)).toBeCloseTo(look.water, 6)
    const water = waterGeometry(look)
    const positions = water.getAttribute('position')
    const fromShore = water.getAttribute(FROM_SHORE)
    for (let i = 0; i < positions.count; i++) expect(positions.getY(i)).toBeCloseTo(look.water, 6)
    // Its edge a little under the bank, the rest further and further out on the water toward the middle.
    for (let j = 0; j < SEGMENTS; j++) {
      expect(fromShore.getX(j)).toBeLessThan(0)
      expect(fromShore.getX(j)).toBeGreaterThan(-0.05 * look.radius * FURTHEST)
      expect(fromShore.getX(j + SEGMENTS)).toBeGreaterThan(fromShore.getX(j))
    }
    expect(fromShore.getX(fromShore.count - 1)).toBeGreaterThan(1)
  })

  it('has no water when its level is under the bed', () => {
    const look = pondOf(3)
    expect(waterGeometry({ ...look, water: -look.depth - 1 }).getAttribute('position')).toBeUndefined()
  })

  it('lets the goose walk down its bank into the water, afloat where it is deeper than she wades', () => {
    const look = pondOf(3)
    // On the floor outside the shore, and on the bank inside it, down to the bed in the middle.
    expect(standingIn(look, look.x + look.radius * 3, look.z, look.goose)).toBe(0)
    const r = shoreAt(look, 0)
    expect(groundOf(look, look.x + r * 0.95, look.z)).toBeCloseTo(bankHeight(look, 0.95), 6)
    expect(groundOf(look, look.x, look.z)).toBe(-look.depth)
    // Afloat in the middle, where the bed is far under the water, at her height over it; and higher if she floats higher.
    expect(swimmingIn(look, look.x, look.z, look.goose)).toBe(1)
    expect(standingIn(look, look.x, look.z, look.goose)).toBeCloseTo(look.water + look.goose.height, 9)
    expect(standingIn(look, look.x, look.z, { ...look.goose, height: 0.1 })).toBeCloseTo(look.water + 0.1, 9)
    // Wading, in water shallower than her legs, on the bed.
    const shallow = waterline(look) * shoreAt(look, 0) * 0.99
    expect(swimmingIn(look, look.x + shallow, look.z, look.goose)).toBe(0)
    expect(standingIn(look, look.x + shallow, look.z, look.goose)).toBeCloseTo(groundOf(look, look.x + shallow, look.z), 9)
  })

  it('knows how far each point round it is from its shore, for the beach: 0 on the shore, less inside, more out', () => {
    const look = pondOf(3)
    const field = shoreField(look)
    const step = field.size / SHORE_FIELD
    /** The field's value at the texel nearest (x, z). */
    const at = (x: number, z: number) => field.data[Math.floor((z - field.minZ) / step) * SHORE_FIELD + Math.floor((x - field.minX) / step)]!
    expect(at(look.x, look.z)).toBeLessThan(-1)
    const r = shoreAt(look, 0)
    expect(Math.abs(at(look.x + r, look.z))).toBeLessThan(step * 2)
    expect(at(look.x + r + 3, look.z)).toBeCloseTo(3, 0)
    expect(at(field.minX + step, field.minZ + step)).toBe(SHORE_REACH)
  })
})
