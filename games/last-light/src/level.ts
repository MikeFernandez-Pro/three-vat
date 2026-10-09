// The level, as data (#173): for now the open arena as it stands, with no
// walls, and lights placed in it to play against. Three braziers to run
// between, each a flame the torch can be dipped into, and a lit window that
// holds rats off as well as any but refuels nothing. The holder starts in the
// middle, about ten metres from each.
import type { Level } from './run'

export const openArena = (): Level => ({
  start: { x: 0, z: 0 },
  lights: [
    { x: 0, z: -9, reach: 1.6, flame: true, on: true },
    { x: 10, z: 3, reach: 1.6, flame: true, on: true },
    { x: -8, z: 8, reach: 1.6, flame: true, on: true },
    { x: -9, z: -5, reach: 2.2, flame: false, on: true },
  ],
})
