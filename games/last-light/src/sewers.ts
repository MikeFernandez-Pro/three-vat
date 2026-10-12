// PROTOTYPE: the sewers, Last Light's new level (2026-10-12), as data, in
// metres, x east and z south. A fresh game: nothing of the woods is kept but
// the run's torch, the swarm and the walls.
//
// The run, in order (the design talk of 2026-10-12 and the sketches
// over the first plan, recorded in the memory notes until the design page
// exists):
//   1. The collector: he wakes by a lantern, rats all round its light, the
//      gutter on his left with a small boat drifting in it; a straight way,
//      a narrow gap past a fallen block, and a few steps on, the hub.
//   2. The hub, small and round: a great fire in the middle, the lever
//      between the fire and the huge door, held by three rods; the lever
//      moves last. A chest by the wall.
//   3. The gas branch (west), all right angles: gas jets out of its walls on
//      a rhythm, putting the torch out; a light at its mouth and one by its
//      lever, none between; a worker's remains in a corner with the chest's
//      key.
//   4. The water branch (east): one straight gallery, five chandeliers
//      swinging so that two always meet; bats burst out of the vault as he
//      comes under the first, putting his torch out; a lamp by the lever,
//      which drops the chandeliers, burning on the floor: flames now, the
//      torch lit again at any of them, which drops the chandeliers, whose light on
//      the floor drives every rat off.
//   5. The hub lever, a long push; the huge door opens.
//   6. The cascade: poison water falling across the way puts the light out;
//      the rats, who keep off poison water, never cross it.
//   7. The mushroom cave, a gentle S: a safe place, no rat in it, the
//      mushrooms' glow leading to a brazier at its end; the rats are in the
//      room past it.
//   8. The cistern, a round tank: four pillars in its middle, four numbered
//      plates seen only in the light, a door of four symbols in its north face.
//   9. The rush: straight north out of that door, a wave of rats, a beam
//      across a pit of rats walked on balance, the torch dying, the ladder on
//      the landing beyond, the manhole cover.
//
// The floor is drawn as shapes, faces where the stone stands: polygons, paths
// of a width (curved through their points if `smooth`), circles; deep water,
// solid masses (pillars, the pit) and bridges over them. The walls are
// worked out from them: the floor laid on a grid of GRID cells, its edge
// traced and simplified into lines, each a wall's middle, half a wall's
// thickness outside the face, so the way between two faces is as wide as
// drawn.
import type { Level, PlacedLight } from './run'
import type { Bounds } from './swarm'
import { WALL_THICKNESS, type Wall } from './walls'

export interface Point {
  x: number
  z: number
}

/** A shape on the ground: a polygon; a path of a width, each point its own if `widths` is given; or a circle. */
export type Shape =
  | { kind: 'poly'; points: Point[] }
  | { kind: 'path'; points: Point[]; width: number; widths?: number[]; smooth?: boolean }
  | { kind: 'circle'; x: number; z: number; r: number }

/** What a shape is: floor to walk, deep water, a solid mass, or a bridge laid over water or a pit. */
export type Layer = 'floor' | 'water' | 'solid' | 'bridge'

export interface Piece {
  layer: Layer
  shape: Shape
}

/** The grid the floor is laid on, m a cell. */
export const GRID = 0.125
/** How far a traced edge may stray from the grid's steps, m. */
const SIMPLIFY = 0.12
const HALF = WALL_THICKNESS / 2

/** A light the level places, named for the script. */
export interface NamedLight extends PlacedLight {
  name: string
  /** How it is drawn: an oil lamp or a lantern, a brazier, the hub's great fire, a chandelier. */
  look: 'lamp' | 'brazier' | 'fire' | 'chandelier'
}

/** A hole in a wall rats come out of and dive back into; or a pipe's mouth. Live while `when` says. */
export interface Hole {
  x: number
  z: number
  pipe?: boolean
  /** Which part of the run it serves, read by the play: it lets rats out only once that part is live. */
  when: HoleWhen
}

export type HoleWhen = 'start' | 'hub0' | 'hub1' | 'hub2' | 'push' | 'gas' | 'nave' | 'cistern' | 'rush'

/** A door pushed open, held for `hold` s while touching it: a wall from `from` to `to` while shut. */
export interface Door extends Wall {
  name: string
  hold: number
  /** Where the child pushes it from: within reach of this point. */
  at: Point
}

/** A lever worked by holding the interact key for `hold` s, standing within reach. */
export interface Lever extends Point {
  name: 'gas' | 'water' | 'hub'
  hold: number
}

/**
 * A gas jet out of a wall: from its mouth on the wall, `length` m out along
 * the unit way (dx, dz), `half` m either side; it jets on a rhythm, `on` s of
 * every `period`, from `phase` s into it. Inside it while it jets, the torch
 * goes out.
 */
export interface Jet extends Point {
  dx: number
  dz: number
  length: number
  half: number
  period: number
  on: number
  phase: number
}

/** A chandelier: hung at `pivot`, swinging `amplitude` m along `axis` and back every `period` s, from `phase` (radians). */
export interface Chandelier {
  pivot: Point
  axis: Point
  amplitude: number
  period: number
  phase: number
  /** Its light's index in the level's lights. */
  light: number
}

/** A plate on the cistern's floor: its number, I to IV, and its symbol. */
export interface Plate extends Point {
  numeral: number
  symbol: Glyph
}

export type Glyph = 'fish' | 'wheel' | 'skull' | 'key'

/** A group of rats set down at the start, waiting still until the child comes within their notice; or, `round`, on him from the first moment. */
export interface Waiting extends Point {
  r: number
  count: number
  round?: boolean
}

/** A text label for a space, drawn on the plan. */
export interface Label extends Point {
  text: string
}

/** A prop drawn on the plan only: plays no part. */
export interface Prop extends Point {
  kind: 'sign' | 'ladder' | 'grate' | 'mushrooms' | 'valve' | 'pipes' | 'bones' | 'crate' | 'barrel' | 'chains'
  /** Facing, radians, where it matters. */
  angle?: number
  size?: number
}

export interface Sewers {
  pieces: Piece[]
  /** Every wall: the floor's traced edge, water and pits included. */
  walls: Wall[]
  /** What stops the eye and the light: the edge against solid stone only, water seen across. */
  sight: Wall[]
  /** The same edge as closed loops, for drawing the floor: filled even-odd, they are the ground, water and all. */
  outlines: Point[][]
  level: Level
  lights: NamedLight[]
  holes: Hole[]
  doors: Door[]
  levers: Lever[]
  jets: Jet[]
  chandeliers: Chandelier[]
  plates: Plate[]
  /** The cistern door's buttons, in the order they stand along it, each its symbol. */
  buttons: (Point & { symbol: Glyph })[]
  /** The cistern door: a wall while shut. */
  symbolDoor: Wall
  waiting: Waiting[]
  /** Where the boat drifts in the gutter, from first to last point, at BOAT_SPEED. */
  boatPath: Point[]
  /** The worker's remains, where the key is picked up; and the chest. */
  corpse: Point
  chest: Point
  /** The cascade's curtain: a box the light dies in; and the line across it no rat crosses. */
  cascade: Bounds
  cascadeWall: Wall
  /** Where the bats burst out of the vault and put the torch out, before the first chandelier. */
  bats: Bounds
  /** The beam over the pit: from its near end to its far, its width; and the pit, which is death to fall in. */
  beam: { from: Point; to: Point; width: number }
  pit: Point[]
  /** The ladder at the end. */
  ladder: Point
  /** The gap past the fallen block: walked slowly, sideways. */
  squeeze: Bounds
  /** The checkpoint zones' indices in the level's: the hub and the cistern. */
  hubZone: number
  cisternZone: number
  labels: Label[]
  props: Prop[]
  /** The grid: whether each cell is floor, and what it is, for the drawing and the spawns. */
  grid: Grid
}

/** The floor laid on cells: 1 floor, 2 deep water, 0 stone. */
export interface Grid {
  minX: number
  minZ: number
  cols: number
  rows: number
  cells: Uint8Array
}

export const BOUNDS: Bounds = { minX: -42, maxX: 66, minZ: -90, maxZ: 22 }

const P = (x: number, z: number): Point => ({ x, z })
const poly = (layer: Layer, ...points: Point[]): Piece => ({ layer, shape: { kind: 'poly', points } })
const path = (layer: Layer, width: number, points: Point[], smooth = false, widths?: number[]): Piece => ({ layer, shape: { kind: 'path', points, width, widths, smooth } })
const box = (layer: Layer, minX: number, minZ: number, maxX: number, maxZ: number): Piece => poly(layer, P(minX, minZ), P(maxX, minZ), P(maxX, maxZ), P(minX, maxZ))
/** A pillar: a hexagon of radius `r`. */
const pillar = (x: number, z: number, r = 0.5): Piece => poly('solid', ...Array.from({ length: 6 }, (_, k) => P(x + Math.cos((k * Math.PI) / 3 + Math.PI / 6) * r, z + Math.sin((k * Math.PI) / 3 + Math.PI / 6) * r)))
/** An ellipse as a polygon of `n` sides. */
const ellipse = (cx: number, cz: number, rx: number, rz: number, n = 32): Point[] => Array.from({ length: n }, (_, k) => P(cx + Math.cos((k * 2 * Math.PI) / n) * rx, cz + Math.sin((k * 2 * Math.PI) / n) * rz))

/** The cistern: its middle and its radius. */
const CISTERN = { x: 4.5, z: -56.5, r: 7 }
/** The chandeliers' gallery: where it leaves the hub, the way along it, and how long it is, m. */
const GALLERY = { from: { x: 9.5, z: -10.6 }, ux: 0.894, uz: 0.447, length: 33.4 }
/** The point `along` m down the gallery and `across` m to the right of its middle line. */
const at = (along: number, across = 0): Point => ({
  x: GALLERY.from.x + GALLERY.ux * along - GALLERY.uz * across,
  z: GALLERY.from.z + GALLERY.uz * along + GALLERY.ux * across,
})
/** The hub: its middle, where the fire burns, and its half-sizes across and along. */
const HUB = { x: 0.4, z: -11.6, rx: 10.9, rz: 7.6 }

/** The sewers, built. */
export function sewers(): Sewers {
  const pieces: Piece[] = []
  const add = (...more: Piece[]) => pieces.push(...more)

  // 1. The collector, straight north to the hub: 5 m between faces, the gutter along the west face, 0.9 m of dark water
  // running north into a drain at the hub's edge. 9 m from the lantern fallen blocks fill the way but for a gap 0.85 m
  // wide in the middle of the walk, 3 m long; the hub 8 m on.
  add(box('floor', -2.5, -6, 2.5, 16.5))
  add(box('water', -2.5, -3, -1.6, 22))
  add(box('solid', -2.6, 2.5, 0.025, 5.5), box('solid', 0.875, 2.5, 2.6, 5.5))

  // 2. The hub: an ellipse round the fire, nothing in the way.
  const hub = ellipse(HUB.x, HUB.z, HUB.rx, HUB.rz)
  add({ layer: 'floor', shape: { kind: 'poly', points: hub } })

  // 3. The gas branch, west, all right angles: a gallery out of the hub, a wider leg north, a dead end west with the lever.
  add(box('floor', -29.2, -11.3, -9, -8.1))
  add(box('floor', -29.2, -20.1, -24, -8.1))
  add(box('floor', -36.2, -20.1, -24, -15.6))

  // 4. The water branch, east-south-east: one straight gallery out of the hub, 4 m between faces, 33 m long.
  add(path('floor', 4, [GALLERY.from, at(GALLERY.length)]))

  // 5. Past the huge door, north: the passage the cascade falls across, 4.5 m.
  add(box('floor', -2.25, -26.8, 2.25, -18.6))

  // 7. The mushroom cave: no masonry, a gentle S north from the cascade, bending east into the cistern.
  add(path('floor', 4.5, [P(0, -26.4), P(2.4, -31), P(0.6, -36), P(-2.4, -40.5), P(-2.6, -45), P(0.4, -49.4), P(2.8, -51.8)], true, [4.5, 5, 4, 5.2, 4.6, 4.4, 4.5]))

  // 8. The cistern: a round tank, 14 m across, four pillars in its middle, the door in its north face.
  add({ layer: 'floor', shape: { kind: 'circle', x: CISTERN.x, z: CISTERN.z, r: CISTERN.r } })
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as const) add(pillar(CISTERN.x + dx, CISTERN.z + dz, 0.5))

  // 9. The rush: straight north out of the door, a gallery to the pit's edge, the beam over the pit, the landing with
  // the ladder across the far side. The pit is stone to walk on: nothing crosses it but the beam.
  add(box('floor', 2.4, -74.4, 6, -62.6))
  add(box('floor', 0.4, -85, 9, -81.6))
  const pit = [P(0.4, -81.8), P(9, -81.8), P(9, -74.2), P(0.4, -74.2)]
  add({ layer: 'solid', shape: { kind: 'poly', points: pit } })
  const beam = { from: P(4.2, -74), to: P(4.2, -82), width: 1 }
  add(path('bridge', beam.width, [beam.from, beam.to]))

  // The lights: lanterns and oil lamps (a flame), braziers (a flame), the hub's fire, chandeliers (light, no flame, swung).
  const lights: NamedLight[] = []
  const light = (name: string, look: NamedLight['look'], x: number, z: number, reach: number, flame = true): number => lights.push({ name, look, x, z, reach, flame, on: true }) - 1
  light('waking lantern', 'lamp', 1.6, 14.4, 1.8)
  light('hub fire', 'fire', HUB.x, HUB.z, 2.6)
  light('gas mouth', 'brazier', -12.6, -10.4, 1.3)
  light('gas lever', 'lamp', -35.4, -19.2, 1.2)
  const chandeliers: Chandelier[] = []
  const chandelier = (x: number, z: number, phase: number) => {
    const k = light(`chandelier ${chandeliers.length + 1}`, 'chandelier', x, z, 1.5, false)
    chandeliers.push({ pivot: P(x, z), axis: P(GALLERY.ux, GALLERY.uz), amplitude: 1.5, period: 4.4, phase, light: k })
  }
  // Six metres apart, each swinging two either way, neighbours in opposite phase: two of them always meet, their light
  // overlapping, while the others stand apart with the dark between.
  for (let k = 0; k < 5; k++) {
    const p = at(10 + k * 4.5)
    chandelier(p.x, p.z, k % 2 ? Math.PI : 0)
  }
  const lamp = at(32.4, 1.3)
  light('water lever', 'lamp', lamp.x, lamp.z, 1.2)
  light('cave mouth', 'brazier', -1.4, -48.2, 1.8)
  light('symbol door', 'brazier', 8.6, -61.2, 1.3)

  const holes: Hole[] = [
    // The collector: round him from the first moment.
    { x: 2.5, z: 10.5, when: 'start' },
    { x: 2.5, z: 6.2, when: 'start' },
    { x: 2.5, z: 16.5, when: 'start' },
    // The hub: a few at first, more after each branch, every one in the final push, and its pipes.
    { x: -6.5, z: -5.6, when: 'hub0' },
    { x: 8.6, z: -6.4, when: 'hub0' },
    { x: -9.6, z: -14.8, when: 'hub0' },
    { x: 7.2, z: -17.6, when: 'hub1' },
    { x: -5.6, z: -18, when: 'hub1' },
    { x: 11.2, z: -12.8, when: 'hub1' },
    { x: -10.6, z: -7.6, when: 'hub2' },
    { x: 4.6, z: -4.2, when: 'hub2' },
    { x: -3.6, z: -19, pipe: true, when: 'push' },
    { x: 4.4, z: -19, pipe: true, when: 'push' },
    // The gas branch.
    { x: -18, z: -8.1, when: 'gas' },
    { x: -24, z: -13.8, when: 'gas' },
    { x: -29.2, z: -12.6, when: 'gas' },
    { x: -30, z: -20.1, when: 'gas' },
    // The chandeliers' gallery: both faces, and a pipe at its end.
    { ...at(12.2, -2), when: 'nave' },
    { ...at(16.8, 2), when: 'nave' },
    { ...at(21.2, -2), when: 'nave' },
    { ...at(25.8, 2), when: 'nave' },
    { ...at(33.4), pipe: true, when: 'nave' },
    // The cistern's walls.
    { x: 11.5, z: -56.5, when: 'cistern' },
    { x: 9.4, z: -51.5, when: 'cistern' },
    { x: -2.5, z: -57.5, when: 'cistern' },
    { x: -0.6, z: -61.6, when: 'cistern' },
    { x: 10, z: -61, when: 'cistern' },
    // The rush: pipes behind him in the cistern and along the gallery.
    { x: 11.5, z: -55, pipe: true, when: 'rush' },
    { x: -2.5, z: -55.5, pipe: true, when: 'rush' },
    { x: 2.4, z: -67, pipe: true, when: 'rush' },
    { x: 6, z: -70.4, pipe: true, when: 'rush' },
  ]

  const doors: Door[] = []
  const hugeDoor: Door = { name: 'huge door', from: P(-2.4, -19.4), to: P(2.4, -19.4), hold: 5, at: P(HUB.x, -15.6) }
  const levers: Lever[] = [
    { name: 'gas', x: -35.4, z: -17.8, hold: 2 },
    { name: 'water', ...at(32.2), hold: 2 },
    { name: 'hub', x: hugeDoor.at.x, z: hugeDoor.at.z, hold: hugeDoor.hold },
  ]
  // The jets, out of the walls, each across the way: the mouth's wall, the way in, how far it reaches.
  const jets: Jet[] = [
    { x: -16, z: -11.3, dx: 0, dz: 1, length: 3.2, half: 0.8, period: 4, on: 1.6, phase: 0 },
    { x: -21.6, z: -8.1, dx: 0, dz: -1, length: 3.2, half: 0.8, period: 3.6, on: 1.5, phase: 1.4 },
    { x: -29.2, z: -13.4, dx: 1, dz: 0, length: 5.2, half: 0.8, period: 3.4, on: 1.5, phase: 0.5 },
    { x: -24, z: -17.2, dx: -1, dz: 0, length: 5.2, half: 0.8, period: 3.2, on: 1.4, phase: 2.2 },
    { x: -30.4, z: -20.1, dx: 0, dz: 1, length: 4.5, half: 0.8, period: 3, on: 1.4, phase: 0.9 },
  ]
  const plates: Plate[] = [
    { numeral: 1, symbol: 'fish', x: CISTERN.x - 4.6, z: CISTERN.z + 0.4 },
    { numeral: 2, symbol: 'wheel', x: CISTERN.x + 4.8, z: CISTERN.z - 1 },
    { numeral: 3, symbol: 'skull', x: CISTERN.x + 0.2, z: CISTERN.z + 4.4 },
    { numeral: 4, symbol: 'key', x: CISTERN.x, z: CISTERN.z },
  ]
  // The door's buttons along its inner face, west to east, in no telling order.
  const symbolDoor: Wall = { from: P(2.3, -63.5), to: P(6.1, -63.5) }
  const buttons = (['key', 'fish', 'skull', 'wheel'] as Glyph[]).map((symbol, k) => ({ symbol, x: 2.7 + k * 1, z: -62.2 }))

  const waiting: Waiting[] = [
    // Round the lantern he wakes by, pressing its light.
    { x: 0.4, z: 9.5, r: 2.4, count: 60, round: true },
    { x: 0.6, z: 15.8, r: 0.8, count: 10, round: true },
    // The cistern's own, over the plates.
    { x: CISTERN.x, z: CISTERN.z, r: 5.5, count: 160 },
  ]

  const boatPath = [P(-2.05, 15.6), P(-2.05, 5.7)]

  const checkpoints = [
    { minX: -2.5, maxX: 3.2, minZ: -6.4, maxZ: -3.4, at: P(0.4, -5.2) },
    { minX: -3, maxX: 2.5, minZ: -50, maxZ: -46, at: P(0.2, -47.4) },
  ]

  const labels: Label[] = [
    { x: 6.4, z: 12, text: 'COLLECTOR' },
    { x: -5.4, z: -15.6, text: 'HUB' },
    { x: -20, z: -22.4, text: 'GAS BRANCH' },
    { ...at(18, -4.4), text: 'CHANDELIER GALLERY' },
    { x: 6.6, z: -23, text: 'CASCADE' },
    { x: -7.6, z: -38, text: 'MUSHROOM CAVE' },
    { x: 15.4, z: -56.5, text: 'CISTERN' },
    { x: 10.4, z: -68.4, text: 'THE RUSH' },
    { x: 12, z: -78, text: 'PIT' },
    { x: 4.2, z: -86.6, text: 'LADDER' },
  ]
  const props: Prop[] = [
    { kind: 'grate', x: -2.05, z: 5.5, angle: 0, size: 0.9 },
    { kind: 'grate', x: -2.05, z: -3, angle: 0, size: 0.9 },
    { kind: 'ladder', x: 2.15, z: 1.2, angle: 0 },
    { kind: 'chains', x: -0.6, z: 8.6 },
    { kind: 'sign', x: -11.4, z: -8.6 },
    { kind: 'sign', x: -25, z: -9 },
    { kind: 'pipes', x: -26.6, z: -20.1, angle: 0, size: 5 },
    { kind: 'valve', x: -33.6, z: -16 },
    { kind: 'barrel', x: -35.4, z: -16.2 },
    { kind: 'crate', x: 8.8, z: -14.6 },
    { kind: 'barrel', x: -8.2, z: -9.4 },
    { kind: 'bones', x: 6.2, z: -5.4 },
    { kind: 'sign', x: 3.6, z: -20.2 },
    { kind: 'chains', ...at(14.2, 1.2) },
    { kind: 'bones', x: 8.2, z: -52.4 },
    { kind: 'sign', x: 6.6, z: -73.6 },
    { kind: 'bones', x: 2.4, z: -78 },
  ]
  for (const [x, z] of [
    [2.2, -29], [-0.4, -32.8], [2.4, -35.6], [-0.8, -38.6], [-3.8, -41.6], [-0.4, -43.8], [-4.4, -45.6], [1.4, -47.4], [3.4, -50.2],
  ] as const) props.push({ kind: 'mushrooms', x, z })

  // The level the run reads: the walls come in once traced, the doors are the play's.
  const level: Level = {
    start: P(0.2, 13.2),
    lights,
    walls: [],
    wind: [],
    gates: [],
    keys: [],
    levers: [],
    bounds: BOUNDS,
    checkpoints,
  }

  const grid = lay(pieces)
  const { walls, sight, outlines } = trace(grid)
  level.walls = walls
  // Each hole set on the floor nearest where it is written: at the foot of the wall it opens in.
  for (const hole of holes) Object.assign(hole, nearestFloor(grid, hole))

  return {
    pieces,
    walls,
    sight,
    outlines,
    level,
    lights,
    holes,
    doors: [...doors, hugeDoor],
    levers,
    jets,
    chandeliers,
    plates,
    buttons,
    symbolDoor,
    waiting,
    boatPath,
    corpse: P(-28.2, -9),
    chest: P(6.6, -7.2),
    cascade: { minX: -2.25, maxX: 2.25, minZ: -23.6, maxZ: -22.2 },
    cascadeWall: { from: P(-2.6, -22.9), to: P(2.6, -22.9) },
    // The bats: a band across the gallery a metre and a half short of the first chandelier.
    bats: { minX: at(8).x - 0.4, maxX: at(8).x + 0.4, minZ: at(8).z - 2.4, maxZ: at(8).z + 2.4 },
    beam,
    pit,
    ladder: P(4.2, -84),
    squeeze: { minX: -0.1, maxX: 1, minZ: 2.3, maxZ: 5.7 },
    hubZone: 0,
    cisternZone: 1,
    labels,
    props,
    grid,
  }
}

/** Whether (x, z) is on the floor's grid cells: 1 floor, 2 deep water, 0 stone or off the grid. */
export function cellAt(grid: Grid, x: number, z: number): number {
  const c = Math.floor((x - grid.minX) / GRID)
  const r = Math.floor((z - grid.minZ) / GRID)
  if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return 0
  return grid.cells[r * grid.cols + c]!
}

/** The middle of the floor cell nearest `p`, within 2 m; `p` itself if none is. */
export function nearestFloor(grid: Grid, p: Point): Point {
  let best = p
  let off = Infinity
  for (let dz = -2; dz <= 2; dz += GRID) {
    for (let dx = -2; dx <= 2; dx += GRID) {
      const x = p.x + dx
      const z = p.z + dz
      if (cellAt(grid, x, z) !== 1) continue
      const cx = grid.minX + (Math.floor((x - grid.minX) / GRID) + 0.5) * GRID
      const cz = grid.minZ + (Math.floor((z - grid.minZ) / GRID) + 0.5) * GRID
      const d = Math.hypot(cx - p.x, cz - p.z)
      if (d < off) {
        off = d
        best = P(cx, cz)
      }
    }
  }
  return best
}

/** How far (x, z) is outside `shape`, m; below 0 inside it. */
export function signedDistance(shape: Shape, x: number, z: number): number {
  if (shape.kind === 'circle') return Math.hypot(x - shape.x, z - shape.z) - shape.r
  if (shape.kind === 'path') {
    const points = shape.smooth ? smoothed(shape.points) : shape.points
    const widths = shape.widths ? (shape.smooth ? smoothedWidths(shape.widths) : shape.widths) : undefined
    let best = Infinity
    for (let k = 0; k + 1 < points.length; k++) {
      const a = points[k]!
      const b = points[k + 1]!
      const t = along(a, b, x, z)
      const w = widths ? widths[k]! + (widths[k + 1]! - widths[k]!) * t : shape.width
      best = Math.min(best, Math.hypot(x - a.x - (b.x - a.x) * t, z - a.z - (b.z - a.z) * t) - w / 2)
    }
    return best
  }
  const { points } = shape
  let d = Infinity
  let inside = false
  for (let k = 0, j = points.length - 1; k < points.length; j = k++) {
    const a = points[j]!
    const b = points[k]!
    const t = along(a, b, x, z)
    d = Math.min(d, Math.hypot(x - a.x - (b.x - a.x) * t, z - a.z - (b.z - a.z) * t))
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside
  }
  return inside ? -d : d
}

/** How far along a to b the nearest point to (x, z) lies, 0 to 1. */
function along(a: Point, b: Point, x: number, z: number): number {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const l2 = dx * dx + dz * dz
  return l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2))
}

/** Steps a curved path takes between two of its points. */
const CURVE_STEPS = 8
const cache = new WeakMap<Point[], Point[]>()

/** A path's points curved through: Catmull-Rom, CURVE_STEPS between each two. */
export function smoothed(points: Point[]): Point[] {
  const hit = cache.get(points)
  if (hit) return hit
  const out: Point[] = []
  for (let k = 0; k + 1 < points.length; k++) {
    const p0 = points[Math.max(0, k - 1)]!
    const p1 = points[k]!
    const p2 = points[k + 1]!
    const p3 = points[Math.min(points.length - 1, k + 2)]!
    for (let s = 0; s < CURVE_STEPS; s++) {
      const t = s / CURVE_STEPS
      const t2 = t * t
      const t3 = t2 * t
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      out.push(P(f(p0.x, p1.x, p2.x, p3.x), f(p0.z, p1.z, p2.z, p3.z)))
    }
  }
  out.push(points[points.length - 1]!)
  cache.set(points, out)
  return out
}

function smoothedWidths(widths: number[]): number[] {
  const out: number[] = []
  for (let k = 0; k + 1 < widths.length; k++) for (let s = 0; s < CURVE_STEPS; s++) out.push(widths[k]! + ((widths[k + 1]! - widths[k]!) * s) / CURVE_STEPS)
  out.push(widths[widths.length - 1]!)
  return out
}

/** A shape's box, m, grown by `pad`. */
function boxOf(shape: Shape, pad: number): Bounds {
  if (shape.kind === 'circle') return { minX: shape.x - shape.r - pad, maxX: shape.x + shape.r + pad, minZ: shape.z - shape.r - pad, maxZ: shape.z + shape.r + pad }
  const grow = pad + (shape.kind === 'path' ? Math.max(shape.width, ...(shape.widths ?? [])) / 2 : 0)
  const points = shape.kind === 'path' && shape.smooth ? smoothed(shape.points) : shape.points
  return {
    minX: Math.min(...points.map((p) => p.x)) - grow,
    maxX: Math.max(...points.map((p) => p.x)) + grow,
    minZ: Math.min(...points.map((p) => p.z)) - grow,
    maxZ: Math.max(...points.map((p) => p.z)) + grow,
  }
}

/**
 * The floor laid on the grid, each cell read at its middle: floor where a
 * floor or bridge shape reaches, grown by half a wall's thickness so the
 * traced line stands that far out from the face; deep water and solid where
 * theirs reach, shrunk as much, and a bridge laid over both.
 */
export function lay(pieces: readonly Piece[]): Grid {
  const minX = BOUNDS.minX
  const minZ = BOUNDS.minZ
  const cols = Math.ceil((BOUNDS.maxX - minX) / GRID)
  const rows = Math.ceil((BOUNDS.maxZ - minZ) / GRID)
  const FLOOR = 1
  const WATER = 2
  const SOLID = 4
  const BRIDGE = 8
  const bits = new Uint8Array(cols * rows)
  for (const { layer, shape } of pieces) {
    const bit = layer === 'floor' ? FLOOR : layer === 'water' ? WATER : layer === 'solid' ? SOLID : BRIDGE
    const grows = layer === 'floor' || layer === 'bridge'
    const b = boxOf(shape, HALF + GRID)
    const c0 = Math.max(0, Math.floor((b.minX - minX) / GRID))
    const c1 = Math.min(cols - 1, Math.ceil((b.maxX - minX) / GRID))
    const r0 = Math.max(0, Math.floor((b.minZ - minZ) / GRID))
    const r1 = Math.min(rows - 1, Math.ceil((b.maxZ - minZ) / GRID))
    for (let r = r0; r <= r1; r++) {
      const z = minZ + (r + 0.5) * GRID
      for (let c = c0; c <= c1; c++) {
        const x = minX + (c + 0.5) * GRID
        const d = signedDistance(shape, x, z)
        if (grows ? d <= HALF : d <= -HALF) bits[r * cols + c]! |= bit
      }
    }
  }
  const cells = new Uint8Array(cols * rows)
  for (let k = 0; k < cells.length; k++) {
    const v = bits[k]!
    if (v & BRIDGE) cells[k] = 1
    else if (v & FLOOR && !(v & SOLID)) cells[k] = v & WATER ? 2 : 1
  }
  return { minX, minZ, cols, rows, cells }
}

/**
 * The floor's edge traced into walls: every grid edge between a floor cell
 * and one that is not, chained round into loops, each loop simplified within
 * SIMPLIFY into straight lines. `walls` round everything the child and the
 * rats cannot stand on; `sight` round the stone alone, deep water seen over.
 */
export function trace(grid: Grid): { walls: Wall[]; sight: Wall[]; outlines: Point[][] } {
  const outlines = loops(grid, (v) => v !== 0)
  return { walls: wallsOf(loops(grid, (v) => v === 1)), sight: wallsOf(outlines), outlines }
}

/** Each loop's sides as walls. */
const wallsOf = (outlines: Point[][]): Wall[] => outlines.flatMap((points) => points.map((from, i) => ({ from, to: points[(i + 1) % points.length]! })))

function loops(grid: Grid, open: (v: number) => boolean): Point[][] {
  const { cols, rows, cells, minX, minZ } = grid
  const at = (c: number, r: number) => (c < 0 || r < 0 || c >= cols || r >= rows ? false : open(cells[r * cols + c]!))
  // Directed edges, the open side on the left going along, keyed by their start corner.
  const W = cols + 1
  const next = new Map<number, number[]>()
  const push = (c0: number, r0: number, c1: number, r1: number) => {
    const from = r0 * W + c0
    const list = next.get(from)
    const to = r1 * W + c1
    if (list) list.push(to)
    else next.set(from, [to])
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!at(c, r)) continue
      // x east, z south: going round the cell with it on the left.
      if (!at(c, r - 1)) push(c + 1, r, c, r)
      if (!at(c - 1, r)) push(c, r, c, r + 1)
      if (!at(c, r + 1)) push(c, r + 1, c + 1, r + 1)
      if (!at(c + 1, r)) push(c + 1, r + 1, c + 1, r)
    }
  }
  const out: Point[][] = []
  const corner = (k: number): Point => P(minX + (k % W) * GRID, minZ + Math.floor(k / W) * GRID)
  while (next.size > 0) {
    const [start] = next.keys()
    const loop: number[] = []
    let k = start!
    for (;;) {
      const list = next.get(k)
      if (!list) break
      const to = list.pop()!
      if (list.length === 0) next.delete(k)
      loop.push(k)
      k = to
      if (k === start) break
    }
    const points = simplifyLoop(loop.map(corner))
    if (points.length >= 3) out.push(points)
  }
  return out
}

/** A closed loop simplified: Douglas-Peucker from its two furthest-apart points. */
function simplifyLoop(points: Point[]): Point[] {
  if (points.length < 4) return points
  let far = 0
  let best = -1
  for (let k = 1; k < points.length; k++) {
    const d = Math.hypot(points[k]!.x - points[0]!.x, points[k]!.z - points[0]!.z)
    if (d > best) {
      best = d
      far = k
    }
  }
  const a = simplify(points.slice(0, far + 1))
  const b = simplify([...points.slice(far), points[0]!])
  return [...a.slice(0, -1), ...b.slice(0, -1)]
}

function simplify(points: Point[]): Point[] {
  if (points.length < 3) return points
  const a = points[0]!
  const b = points[points.length - 1]!
  let worst = 0
  let at = 0
  for (let k = 1; k < points.length - 1; k++) {
    const p = points[k]!
    const t = along(a, b, p.x, p.z)
    const d = Math.hypot(p.x - a.x - (b.x - a.x) * t, p.z - a.z - (b.z - a.z) * t)
    if (d > worst) {
      worst = d
      at = k
    }
  }
  if (worst <= SIMPLIFY) return [a, b]
  return [...simplify(points.slice(0, at + 1)).slice(0, -1), ...simplify(points.slice(at))]
}
