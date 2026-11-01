// The goose game's plain (#187): the route laid by hand, as the play reads it.
import { describe, expect, it } from 'vitest'
import { ROUTE, WADE, keptShown, laid, toSave, type Route } from './plain'
import saved from './gooseroute.json'

/** A route listed out of order: the cage's brazier south of the well's. */
const ROUTE_OF_THREE: Route = {
  start: { x: 0, z: 30 },
  braziers: [
    { x: 2, z: -10, reach: 3, gosling: { x: 3, z: -10 } },
    { x: -1, z: 15, reach: 3, gosling: { x: -1, z: 14 }, scene: 'cage', skull: { x: -8, z: 15 } },
    { x: 0, z: 2, reach: 3, gosling: { x: 0, z: 1 }, dying: { trigger: 6, after: 2, lasts: 3 } },
  ],
  pond: { x: 2, z: -30, radius: 5, shore: 0.3 },
}

describe("the goose game's plain", () => {
  it('takes the braziers in the order she meets them going up the plain, whatever order the route lists them in', () => {
    const p = laid(ROUTE_OF_THREE)
    expect(p.braziers.map((b) => b.z)).toEqual([15, 2, -10])
    expect(p.braziers[0]!.scene).toBe('cage')
    expect(p.braziers[1]!.dying).toEqual({ trigger: 6, after: 2, lasts: 3 })
  })

  it('sets home in the pond, WADE in from its shore on the side toward the last brazier', () => {
    const p = laid(ROUTE_OF_THREE)
    expect(Math.hypot(p.home.x - p.pond.x, p.home.z - p.pond.z)).toBeCloseTo(p.pond.radius - WADE, 9)
    // Straight between the last brazier and the pond's middle.
    expect(p.home.x).toBeCloseTo(2, 9)
    expect(p.home.z).toBeCloseTo(-30 + 5 - WADE, 9)
  })

  it('boxes the whole route, the pond, the skull and every gosling with room round them', () => {
    const p = laid(ROUTE_OF_THREE)
    const inside = ({ x, z }: { x: number; z: number }) => x > p.bounds.minX + 5 && x < p.bounds.maxX - 5 && z > p.bounds.minZ + 5 && z < p.bounds.maxZ - 5
    for (const point of [p.start, ...p.braziers, ...p.braziers.map((b) => b.gosling!), { x: -8, z: 15 }]) expect(inside(point)).toBe(true)
    expect(inside({ x: p.pond.x, z: p.pond.z - p.pond.radius })).toBe(true)
  })

  it('leaves the route it was given as it was', () => {
    const before = structuredClone(ROUTE_OF_THREE)
    const p = laid(ROUTE_OF_THREE)
    p.braziers[0]!.x = 99
    p.start.x = 99
    expect(ROUTE_OF_THREE).toEqual(before)
  })

  it('has the saved route hold each scene once', () => {
    const scenes = laid(ROUTE).braziers.flatMap((b) => (b.scene ? [b.scene] : []))
    expect([...scenes].sort()).toEqual(['cage', 'tree', 'well'])
  })

  it("plays the route with the spawn's brazier, her torch out to light at it, and saves it as the file has it", () => {
    expect(ROUTE.braziers.length).toBe(saved.braziers.length)
    expect(ROUTE.start.unlit).toBe(true)
    expect(toSave(structuredClone(ROUTE))).toEqual(saved)
  })

  it('saves the pieces drawn off their places, rounded, and leaves out those drawn as played', () => {
    // From nothing drawn off its place, whatever the saved route draws so.
    const route = structuredClone(ROUTE)
    for (const b of route.braziers) delete b.drawn
    keptShown(route.braziers[0]!, 'fire')
    Object.assign(keptShown(route.braziers[1]!, 'scene'), { y: 0.12345, size: 1.234 })
    keptShown(route.braziers[1]!, 'gosling')
    const out = toSave(route)
    expect(out.braziers[0]).not.toHaveProperty('drawn')
    expect(out.braziers[1]!.drawn).toEqual({ scene: { y: 0.123, size: 1.23 } })
    expect(route.braziers[1]!.drawn?.gosling).toEqual({ y: 0, size: 1 })
  })
})
