// PROTOTYPE: the new level's first two beats (design/level.html), as data for
// the 2D page (twod.prototype.ts). The burning tree: a clearing in the woods,
// the child by its big tree, the only gap north between two rocks, and a dark
// gully east that leads nowhere. Lost: an open wood north of the gap, a low
// thicket and a tall rock between the gap and a faint flame, trees and a
// second rock scattered, the way on north past the flame.
//
// Laid out in the design page's map metres, x east and y south from its top
// left corner, and set into the game's ground (x, z) round the origin, north
// up the screen at -z, as the swarm's arena wants its level centred.
import type { Level } from './run'
import type { Wall } from './walls'

/** A point on the ground. */
export interface Point {
  x: number
  z: number
}

/** A route point the designer overlay reads: where it is, and the seconds of light the map planned on arrival there. */
export interface RoutePoint extends Point {
  name: string
  planned: number
}

/** The level and the script round it. */
export interface Woods {
  /** The run's level: the treeline, the rocks and the trees as walls, which stop the holder, the rats and the light; the three lights; the way out north. */
  level: Level
  /** The low thickets: they stop the holder, never the rats or the light, and never the eye. */
  thickets: Point[][]
  /** The treeline round the ground that can be walked, the rocks and the trees, for the drawing. */
  treeline: Point[]
  rocks: Point[][]
  trees: { x: number; z: number; r: number }[]
  /** The cracked tree: its root, and where its crown lands. Fallen, it stops the holder unless crawling. */
  trunk: { root: Point; crown: Point }
  /** The lights by their index in the level: the big tree, the fallen crown, the faint flame. */
  bigTree: number
  crown: number
  faint: number
  /** Where the rats are kept out of at the start, so the clearing starts empty: round the big tree. */
  emptyAtStart: { x: number; z: number; reach: number }
  /** The script, s from the start: the rats notice the child; the first strike, and control given; the tree falls, taking this long; the second strike. */
  rush: number
  strike: number
  fall: number
  falling: number
  secondStrike: number
  /** Where the run starts again once the torch has been lit: inside both lights, south of the trunk. */
  checkpoint: Point
  route: RoutePoint[]
}

/** The design page's map metres, set into the game's ground. */
const at = (x: number, y: number): Point => ({ x: x - 20, z: y - 36 })
const ring = (points: [number, number][]) => points.map(([x, y]) => at(x, y))
/** A closed outline's walls, each side one. */
const sides = (outline: Point[]): Wall[] => outline.map((from, k) => ({ from, to: outline[(k + 1) % outline.length]! }))
/** A tree's trunk, an octagon `r` across from its centre. */
const octagon = (c: Point, r: number) => Array.from({ length: 8 }, (_, k) => ({ x: c.x + r * Math.cos((k / 8) * Math.PI * 2), z: c.z + r * Math.sin((k / 8) * Math.PI * 2) }))

export function woods(): Woods {
  // The ground that can be walked: the clearing, the gap between the rocks, the
  // gully east, the wood, and the way out north, closed off past the exit.
  const treeline = ring([
    [10, 2], [10, 8], [6, 9.5], [2.5, 14], [1.5, 24], [2.5, 36], [5.5, 42], [8.5, 46],
    // The west rock's face along the gap.
    [13.5, 45.5], [13.5, 53.5],
    // The clearing's west and south side.
    [11, 54.5], [10.5, 57], [11.5, 62], [13.5, 65.5], [17, 66], [20, 64.5], [21.5, 63],
    // The gully east, a dead end.
    [27, 65.5], [29.5, 68], [31.5, 67.5], [31, 65], [27.5, 61.5], [21.5, 58.5], [21.5, 56],
    // The east rock's face along the gap.
    [17.5, 54], [17.5, 45.5],
    // The wood's east side and north.
    [23, 46.5], [28, 44.5], [33, 40], [36, 32], [35.5, 20], [31, 12.5], [22, 9], [14, 8], [14, 2],
  ])
  const rocks = [
    // Either side of the gap: drawn only, the treeline is their face.
    ring([[8.5, 46], [13.5, 45.5], [13.5, 53.5], [11, 54.5], [8, 52]]),
    ring([[17.5, 45.5], [23, 46.5], [23.5, 52], [21.5, 56], [17.5, 54]]),
    // The tall rock that hides the faint flame from the east way round the thicket.
    ring([[17, 26.5], [21.5, 26], [22, 30], [21.5, 34], [17.5, 34.5], [17, 31]]),
    // A second rock in the east of the wood, to go round either side of.
    ring([[28, 30], [32, 29], [33.5, 34], [30, 36.5], [27.5, 34]]),
  ]
  const trees = [
    [11, 42, 0.6], [20, 42, 0.6], [26, 41, 0.7], [31, 25, 0.9], [27, 17, 1.1], [19, 12.5, 0.6], [6, 15, 0.7], [7.5, 28.5, 0.5], [33, 18, 0.7],
  ].map(([x, y, r]) => ({ ...at(x!, y!), r: r! }))
  const thickets = [
    // Between the gap and the faint flame: seen over, walked round, east past the tall rock or west along the treeline.
    ring([[4.5, 22], [10, 19.5], [16.5, 21], [16.8, 30], [15.5, 38], [9, 38.5], [4, 33]]),
  ]
  const bigTree = at(16, 60)
  const level: Level = {
    start: at(14.5, 62.5),
    lights: [
      // The big tree, struck: it burns for good.
      { ...bigTree, reach: 4.5, flame: true, on: false },
      // The cracked tree's crown, struck where it lands against the east rock.
      { ...at(17.1, 51.3), reach: 3.5, flame: true, on: false },
      // The faint flame, far off: someone's fire, left burning.
      { ...at(12, 15), reach: 1.8, flame: true, on: true },
    ],
    walls: [
      ...sides(treeline),
      // The two rocks either side of the gap are the treeline's own faces; the wood's are walls of their own.
      ...sides(rocks[2]!),
      ...sides(rocks[3]!),
      ...trees.flatMap((tree) => sides(octagon(tree, tree.r))),
    ],
    wind: [],
    gates: [],
    keys: [],
    levers: [],
    exit: { ...at(12, 3.5), radius: 1.5 },
    bounds: { minX: -20, maxX: 20, minZ: -36, maxZ: 36 },
  }
  return {
    level,
    thickets,
    treeline,
    rocks,
    trees,
    // From the clearing's west edge to the east rock: no way past it but under.
    trunk: { root: at(10.7, 57), crown: at(17.2, 51.2) },
    bigTree: 0,
    crown: 1,
    faint: 2,
    emptyAtStart: { ...bigTree, reach: 6.5 },
    rush: 2,
    strike: 5,
    fall: 6,
    falling: 0.6,
    secondStrike: 8,
    checkpoint: at(15, 57),
    route: [
      { name: 'under the trunk', ...at(15.5, 51.5), planned: 26.8 },
      { name: 'P1 flame seen', ...at(15, 43), planned: 23.3 },
      { name: 'P2 flame hidden', ...at(23.5, 38), planned: 18.3 },
      { name: 'P3 seen again', ...at(23.5, 25), planned: 11.8 },
      { name: 'faint flame', ...at(12, 15), planned: 4.2 },
    ],
  }
}
