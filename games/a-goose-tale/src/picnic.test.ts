import { describe, expect, it } from 'vitest'
import { defaultPicnicLook, picnicPlace, picnicReach } from './picnic'
import { ROUTE, laid } from './plain'
import { defaultPondLook, groundOf, islandMiddle, type PondLook } from './pond'
import { defaultIslandTreeLook } from './islandtree'
import { defaultTentLook } from './tent'
import { defaultNestLook } from './nest'

/** The route's pond with its island's shore turned across his way, as main.ts lays it; the island's ground goes with its middle. */
const plain = laid(ROUTE)
const own = defaultPondLook(plain.pond)
const way = Math.atan2(plain.pond.z - plain.home.z, plain.pond.x - plain.home.x)
const pond: PondLook = { ...own, island: { ...own.island, turn: (way * 180) / Math.PI + 90 } }
const look = defaultPicnicLook()
const reach = picnicReach(look.size)
const { x, y, z, up } = picnicPlace(look, pond)
const corners = Array.from({ length: 16 }, (_, k) => {
  const a = (k / 16) * Math.PI * 2
  return { x: x + Math.cos(a) * reach, z: z + Math.sin(a) * reach }
})

describe('the picnic as it starts', () => {
  it("lies in the island's bottom left as the camera sees it", () => {
    // The camera looks along -z: its left is -x, and what is nearest it, the bottom of the frame, is +z.
    const middle = islandMiddle(pond)
    expect(x).toBeLessThan(middle.x)
    expect(z).toBeGreaterThan(middle.z)
  })

  it('stays out of the water all round', () => {
    for (const corner of corners) expect(groundOf(pond, corner.x, corner.z)).toBeGreaterThan(pond.water)
  })

  it("keeps clear of the island's oak, tent and nest", () => {
    const middle = islandMiddle(pond)
    const off = (at: { x: number; z: number }) => Math.hypot(middle.x + at.x - x, middle.z + at.z - z)
    // Its corners short of the trunk's foot, 0.36 m round as the oak stands 5 m tall (islandtree.ts), set from the panel a little under a metre clear.
    expect(off(defaultIslandTreeLook())).toBeGreaterThan(reach + 0.36)
    expect(off(defaultTentLook())).toBeGreaterThan(reach + 1)
    expect(off(defaultNestLook())).toBeGreaterThan(reach + 1)
  })

  it('lies on the slope: its tipped tray stays within a few cm of the ground all round', () => {
    // How high its tray's plane stands over the point of the ground under each corner.
    for (const corner of corners) {
      const plane = y - (up.x * (corner.x - x) + up.z * (corner.z - z)) / up.y
      expect(Math.abs(plane - groundOf(pond, corner.x, corner.z))).toBeLessThan(0.04)
    }
  })
})
