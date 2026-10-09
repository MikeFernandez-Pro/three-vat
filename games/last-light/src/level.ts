// The level, as data (#173): walls, lights, wind zones, gates, keys, levers and the exit,
// where the holder starts, in a box the rats fill wherever it is dark. The
// first section (#176), in grey boxes: outside the property.
//
// The holder starts in the street, south. A brazier stands near the start, to
// learn refuelling at, a short wall beside it; the gate's key lies in the
// wall's shadow, in the rats, within reach of the brazier's light. The
// property's fence runs east to west across the middle, the locked gate in it
// to the east, and the gate's checkpoint just beyond. Inside, the house front
// runs along the north; its lit door, at the west end, is the exit, a stand-in
// until the next sections exist. A parked car, a box, stands in the street.
// A full torch walks about sixty metres: the brazier to the gate is twenty,
// the gate to the door about twenty.
//
// A test of the wind (#177), before the windy side alley is built: a wind
// zone across the street, between the brazier and the gate, and in it a
// fragile flame, a small flame on a post, beside the car. Its gusts keep time
// from the holder coming in, so it burns until the player gets to it and dies
// at the first gust, a few seconds after: refuel from it quickly, or not at all.
//
// Up the screen is north, -z.
import type { Level } from './run'

/** The level's half-width, and its south edge, m. */
const WIDE = 16
const SOUTH = 22
/** The fence's line, and its gate's ends along it. */
const FENCE = 0
const GATE_WEST = 6
const GATE_EAST = 8.5
/** The house front's line: the level's north edge. */
const HOUSE = -17

/** The first section, as data: a fresh copy each call, so the panel's edits to one never reach another. */
export const blockout = (): Level => ({
  start: { x: -2, z: 18 },
  lights: [
    // The brazier near the start.
    { x: -6, z: 15, reach: 1.8, flame: true, on: true },
    // The house's lit door: a light, not a flame.
    { x: -10, z: HOUSE + 0.6, reach: 2.2, flame: false, on: true },
    // The fragile flame in the wind.
    { x: 2, z: 7, reach: 1.2, flame: true, on: true, fragile: true },
  ],
  walls: [
    // The level's edge, the house front its north side.
    { from: { x: -WIDE, z: HOUSE }, to: { x: WIDE, z: HOUSE } },
    { from: { x: WIDE, z: HOUSE }, to: { x: WIDE, z: SOUTH } },
    { from: { x: WIDE, z: SOUTH }, to: { x: -WIDE, z: SOUTH } },
    { from: { x: -WIDE, z: SOUTH }, to: { x: -WIDE, z: HOUSE } },
    // The property's fence, either side of the gate.
    { from: { x: -WIDE, z: FENCE }, to: { x: GATE_WEST, z: FENCE } },
    { from: { x: GATE_EAST, z: FENCE }, to: { x: WIDE, z: FENCE } },
    // The short wall beside the brazier: the key lies in its shadow.
    { from: { x: -7.6, z: 13.4 }, to: { x: -7.6, z: 16.6 } },
    // The parked car.
    { from: { x: 2, z: 9.8 }, to: { x: 5.5, z: 9.8 } },
  ],
  wind: [{ minX: -3, maxX: 7, minZ: 2, maxZ: 9 }],
  gates: [{ from: { x: GATE_WEST, z: FENCE }, to: { x: GATE_EAST, z: FENCE }, checkpoint: { x: (GATE_WEST + GATE_EAST) / 2, z: FENCE - 2.5 } }],
  keys: [{ x: -9, z: 15.2, gate: 0 }],
  levers: [],
  exit: { x: -10, z: HOUSE + 1, radius: 0.9 },
  bounds: { minX: -WIDE, maxX: WIDE, minZ: HOUSE, maxZ: SOUTH },
})
