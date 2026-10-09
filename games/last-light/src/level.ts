// The level, as data (#173, #175): walls, lights and where the holder starts,
// in a box the rats fill wherever it is dark. A grey-box blockout to find the
// play in, not the first section yet: a walled yard 36 metres square, cut
// into four bands by three walls, each open at one end, the openings at
// alternate ends, so the way from the south band to the north one doubles
// back on itself. A brazier in each band, a flame the torch can be dipped
// into, sits near where the way comes in; a lit window, a light that refuels
// nothing, stands in the north band beside the last brazier. A short wall
// stands a metre or so off each brazier, so its light is cut short and rats
// wait in the shadow beside it. The holder starts in the south band. A full
// torch walks about sixty metres, a little less than the way through: it has
// to be refuelled on the way.
//
// Up the screen is north, -z.
import type { Level } from './run'

/** The yard's half-width, m. */
const YARD = 18

/** The blockout, as data: a fresh copy each call, so the panel's edits to one never reach another. */
export const blockout = (): Level => ({
  start: { x: 0, z: 14 },
  lights: [
    { x: -8, z: 13, reach: 1.6, flame: true, on: true },
    { x: 12, z: 4, reach: 1.6, flame: true, on: true },
    { x: -12, z: -4, reach: 1.6, flame: true, on: true },
    { x: -6, z: -14, reach: 1.6, flame: true, on: true },
    { x: 10, z: -13, reach: 2.2, flame: false, on: true },
  ],
  walls: [
    // The yard's walls.
    { from: { x: -YARD, z: -YARD }, to: { x: YARD, z: -YARD } },
    { from: { x: YARD, z: -YARD }, to: { x: YARD, z: YARD } },
    { from: { x: YARD, z: YARD }, to: { x: -YARD, z: YARD } },
    { from: { x: -YARD, z: YARD }, to: { x: -YARD, z: -YARD } },
    // The bands: open east, then west, then east.
    { from: { x: -YARD, z: 8 }, to: { x: 4, z: 8 } },
    { from: { x: -6, z: 0 }, to: { x: YARD, z: 0 } },
    { from: { x: -YARD, z: -8 }, to: { x: 6, z: -8 } },
    // Short walls beside the braziers, casting their light short.
    { from: { x: -6.8, z: 11.5 }, to: { x: -6.8, z: 14.5 } },
    { from: { x: 10.5, z: 5.2 }, to: { x: 13.5, z: 5.2 } },
    { from: { x: -10.8, z: -5.5 }, to: { x: -10.8, z: -2.5 } },
    { from: { x: -4.8, z: -12.5 }, to: { x: -4.8, z: -15.5 } },
  ],
  bounds: { minX: -YARD, maxX: YARD, minZ: -YARD, maxZ: YARD },
})
