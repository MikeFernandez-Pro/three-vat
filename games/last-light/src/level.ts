// The level, as data (#173): walls, lights, wind zones, gates, keys, levers and the exit,
// where the holder starts, in a box the rats fill wherever it is dark. The
// page's open arena is the one level left here: the game plays the woods
// (woods.ts) since #182, and the first section's blockout, the test level the
// game played before, lives on in the run's tests.
//
// Up the screen is north, -z.
import type { Level } from './run'

/** The arena's half-width, and its south and north edges, m. */
const WIDE = 16
const SOUTH = 22
const HOUSE = -17

/**
 * The open arena, the page's scene without `#game`: no walls, no lights, no
 * pieces, the holder at its centre. The swarm fills its own circle round it,
 * the box here only the type's.
 */
export const arena = (): Level => ({
  start: { x: 0, z: 0 },
  lights: [],
  walls: [],
  wind: [],
  gates: [],
  keys: [],
  levers: [],
  bounds: { minX: -WIDE, maxX: WIDE, minZ: HOUSE, maxZ: SOUTH },
})
