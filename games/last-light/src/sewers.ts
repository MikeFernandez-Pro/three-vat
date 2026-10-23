// PROTOTYPE: the sewers, Last Light's new level (2026-10-12), as data, in
// metres, x east and z south. A fresh game: nothing of the woods is kept but
// the run's torch, the swarm and the walls.
//
// The run, in order (the design talk of 2026-10-12 and the sketches
// over the first plan; simplified 2026-10-16: no boat or gutter, no squeeze,
// no cascade, no beam, and a canal where the mushroom cave was):
//   1. The collector: he wakes by a lantern, rats all round its light; a
//      straight way north to the hub.
//   2. The hub, small and round: a great fire in the middle, the lever
//      between the fire and the huge door, held by three rods; the lever
//      moves last. A chest by the wall.
//   3. The gas branch (west), one straight gallery of one width: four gas
//      jets out of its walls on a rhythm, putting the torch out; a light at
//      its mouth and one by its lever, none between; a worker's remains by
//      the wall with the chest's key.
//   4. The water branch (east): one straight gallery, four chandeliers
//      swinging, never quite meeting; a lamp by the lever, which drops the
//      chandeliers, burning on the floor: flames now, the torch lit again at
//      any of them, their light on the floor driving every rat off.
//   5. The hub lever, a long push; the huge door opens.
//   6. The canal: a gallery north, a shallow canal down its middle between
//      two walkways. He wades up it, out of the rats' reach: no rat goes in
//      the water. Where the walkways end, the water spreads from wall to
//      wall, the gallery as wide as ever, to a landing with a brazier, before
//      the cistern.
//   7. The cistern, a round tank: four pillars in its middle, four numbered
//      plates seen only in the light, a door of four symbols in its north face.
//   8. The rush: straight north out of that door, a wave of rats, the ladder
//      at the gallery's end, the manhole cover.
//
// The floor is drawn as shapes, faces where the stone stands: polygons, paths
// of a width (curved through their points if `smooth`), circles; deep water,
// solid masses (pillars) and bridges over them. The walls are
// worked out from them: the floor laid on a grid of GRID cells, its edge
// traced and simplified into lines, each a wall's middle, half a wall's
// thickness outside the face, so the way between two faces is as wide as
// drawn.
import type { Level, PlacedLight } from './run'
import type { Bounds } from './swarm'
import { WALL_THICKNESS, within, type Wall } from './walls'
import { COLLIDERS, type Collider } from './sewers.colliders'

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

/** An escape hole: a slot at the foot of a wall, `half` m either side of its middle along the wall's way (dx, dz). */
export interface Escape extends Point {
  dx: number
  dz: number
  half: number
}

/** A plate on the cistern's floor: its number, I to IV, and its symbol. */
export interface Plate extends Point {
  numeral: number
  symbol: Glyph
}

export type Glyph = 'fish' | 'wheel' | 'skull' | 'key'

/** A text label for a space, drawn on the plan. */
export interface Label extends Point {
  text: string
}

/** A prop drawn on the plan only: plays no part. */
export interface Prop extends Point {
  kind: 'sign' | 'ladder' | 'grate' | 'valve' | 'pipes' | 'bones' | 'crate' | 'barrel' | 'chains'
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
  doors: Door[]
  levers: Lever[]
  jets: Jet[]
  chandeliers: Chandelier[]
  /**
   * Holes at the foot of the chandeliers' gallery's walls, either side between each two chandeliers: rats in the light
   * run into them, and none comes out. Each a slot `half` m either side of its middle, along the wall (dx, dz).
   */
  escapes: Escape[]
  plates: Plate[]
  /** The cistern door's buttons, in the order they stand along it, each its symbol. */
  buttons: (Point & { symbol: Glyph })[]
  /** The huge door's colliders from the Blender file, as walls: the bar across it while shut; its open leaves and its swung arm once open. */
  hugeDoorColliders: { shut: Wall[]; open: Wall[] }
  /** The colliders a light stands in, a lantern's body, a brazier's bowl, the hub fire's ring, as walls that stop him alone: a mass there would cut its own light off the ground. */
  holderColliders: Wall[]
  /** The cistern door: a wall while shut. */
  symbolDoor: Wall
  /** The cistern: its middle and radius, where most of the rats wait once he is in the canal. */
  cistern: { x: number; z: number; r: number }
  /** The worker's remains, where the key is picked up; and the chest. */
  corpse: Point
  chest: Point
  /** The canal's shapes: floor he wades, water no rat enters; its box; its edge, walls for the rats only. */
  canal: Piece[]
  canalBox: Bounds
  ratWalls: Wall[]
  /** The ladder at the end. */
  ladder: Point
  /** The checkpoint zones' indices in the level's: the hub and the cistern. */
  hubZone: number
  cisternZone: number
  labels: Label[]
  props: Prop[]
  /** The grid: whether each cell is floor, and what it is, for the drawing and the spawns. */
  grid: Grid
  /** The canal's grid: 1 where its water is. */
  water: Grid
}

/** The floor laid on cells: 1 floor, 2 deep water, 0 stone. */
export interface Grid {
  minX: number
  minZ: number
  cols: number
  rows: number
  cells: Uint8Array
}

export const BOUNDS: Bounds = { minX: -42, maxX: 66, minZ: -84, maxZ: 30 }

const P = (x: number, z: number): Point => ({ x, z })
const poly = (layer: Layer, ...points: Point[]): Piece => ({ layer, shape: { kind: 'poly', points } })
const path = (layer: Layer, width: number, points: Point[], smooth = false, widths?: number[]): Piece => ({ layer, shape: { kind: 'path', points, width, widths, smooth } })
const box = (layer: Layer, minX: number, minZ: number, maxX: number, maxZ: number): Piece => poly(layer, P(minX, minZ), P(maxX, minZ), P(maxX, maxZ), P(minX, maxZ))
/** A pillar: a hexagon of radius `r`. */
const pillar = (x: number, z: number, r = 0.5): Piece => poly('solid', ...Array.from({ length: 6 }, (_, k) => P(x + Math.cos((k * Math.PI) / 3 + Math.PI / 6) * r, z + Math.sin((k * Math.PI) / 3 + Math.PI / 6) * r)))

/** The cistern: its middle and its radius. */
const CISTERN = { x: 4.5, z: -50.75, r: 7 }
/** The hub: a circle round the fire, on the collector's line. */
const HUB = { x: 0, z: -11.2, r: 8 }
/** The chandeliers' gallery: where it starts, 1.7 m inside the hub's east edge, the way along it, due east, and how long it is, m. */
const GALLERY = { from: { x: HUB.x + HUB.r - 1.7, z: HUB.z }, ux: 1, uz: 0, length: 34.4 }
/** The point `along` m down the gallery and `across` m to the right of its middle line. */
const at = (along: number, across = 0): Point => ({
  x: GALLERY.from.x + GALLERY.ux * along - GALLERY.uz * across,
  z: GALLERY.from.z + GALLERY.uz * along + GALLERY.ux * across,
})
/** The gas branch, due west of the hub on its middle line: the point `d` m west of the hub's edge and `across` m south of the middle line. */
const gas = (d: number, across = 0): Point => ({ x: HUB.x - HUB.r - d, z: HUB.z + across })
/** The gas branch's half width and length from the hub's edge, m: 4.27 m between faces, a third wider since 2026-10-18. */
const GAS_HALF = 3.2 * (4 / 3) / 2
const GAS_LENGTH = 26.05
/** The huge door's line, across the way north out of the hub. */
const HUGE_DOOR_Z = -19.4
/** The canal, down the middle of the gallery past the huge door to where the water spreads across it. */
const CANAL: Bounds = { minX: -0.5, maxX: 0.5, minZ: -41.5, maxZ: -21.5 }
/** Where the gallery's walkways end, the water spreading from wall to wall to the landing. */
export const WALKWAYS_END = -38.5
/** The brazier on the landing out of the canal, before the cistern. */
const LANDING_BRAZIER = { x: 0.04, z: -42.66 }

/** The sewers, built. */
export function sewers(): Sewers {
  const pieces: Piece[] = []
  const add = (...more: Piece[]) => pieces.push(...more)

  // 1. The collector, straight north to the hub: 4.5 m between faces (a third narrower since 2026-10-16), nothing in the way.
  add(box('floor', -2.25, -6, 2.25, 22.5))

  // 2. The hub: a circle 16 m across round the fire, nothing in the way.
  add({ layer: 'floor', shape: { kind: 'circle', x: HUB.x, z: HUB.z, r: HUB.r } })

  // 3. The gas branch, due west: one straight gallery out of the hub, 4.27 m wide all along, 26 m from the hub's edge, the
  // lever at its end.
  // Its end rounded, bulging 1.25 m past the old square end at its middle (the Blender pass of 2026-10-16).
  add(path('floor', 2 * GAS_HALF, [gas(-0.5), gas(GAS_LENGTH + 1.25 - GAS_HALF)]))

  // 4. The water branch, due east: one straight gallery out of the hub, 5.3 m between faces (a third wider since
  // 2026-10-16), 33 m long.
  add(path('floor', 5.3, [GALLERY.from, at(GALLERY.length)]))

  // 5. Past the huge door, north: a gallery 4.5 m wide all the way to the landing, its walls straight; its walkways end
  // 19 m on where the water spreads from wall to wall.
  add(box('floor', -2.25, CANAL.minZ, 2.25, -18.6))

  // 6. The canal down its middle, 1 m wide, the walkways either side 1.75, from 2 m past the door; where the walkways
  // end, the water spreads across the whole gallery, 3 m to the landing; out of it, the landing bending east into the
  // cistern, reached by no rat of the gallery but through the water.
  const canal = [box('floor', CANAL.minX, CANAL.minZ, CANAL.maxX, CANAL.maxZ), box('floor', -2.25, CANAL.minZ, 2.25, WALKWAYS_END)]
  add(...canal)
  add(path('floor', 4.4, [P(0, -42), P(1, -44.2), P(2.8, -46.4)], false, [4.4, 4, 3.8]))

  // 7. The cistern: a round tank, 14 m across, four pillars in its middle, the door in its north face.
  add({ layer: 'floor', shape: { kind: 'circle', x: CISTERN.x, z: CISTERN.z, r: CISTERN.r } })
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as const) add(pillar(CISTERN.x + dx, CISTERN.z + dz, 0.5))

  // 8. The rush: straight north out of the door, a gallery 15 m to the ladder at its end.
  add(box('floor', 2.4, -72, 6, -56.85))

  // The lights: lanterns and oil lamps (a flame), braziers (a flame), the hub's fire, chandeliers (light, no flame, swung).
  const lights: NamedLight[] = []
  const light = (name: string, look: NamedLight['look'], x: number, z: number, reach: number, flame = true): number => lights.push({ name, look, x, z, reach, flame, on: true }) - 1
  light('waking lantern', 'lamp', 1.6, 20.4, 1.8)
  light('hub fire', 'fire', HUB.x, HUB.z, 1.8)
  light('gas mouth', 'brazier', gas(2.45).x, gas(2.45, -0.7).z, 1.3)
  light('gas lever', 'lamp', gas(25.23).x, gas(25.23, -0.79).z, 1.2)
  const chandeliers: Chandelier[] = []
  const chandelier = (along: number, phase: number) => {
    const { x, z } = at(along)
    const k = light(`chandelier ${chandeliers.length + 1}`, 'chandelier', x, z, 1.5, false)
    chandeliers.push({ pivot: P(x, z), axis: P(GALLERY.ux, GALLERY.uz), amplitude: 1.5, period: 4.8, phase, light: k })
  }
  // 6.2 m apart, each swinging one and a half either way every 4.8 s, neighbours in opposite phase: at their nearest
  // 20 cm of dark still lies between two pools, and at their furthest 6.2 m; crossed only by timing them. The last
  // hangs 3.6 m short of the lever.
  for (let k = 0; k < 4; k++) chandelier(10 + k * 6.2, k % 2 ? Math.PI : 0)
  // An escape hole in either wall halfway between each two chandeliers (2026-10-16).
  // Each a slot 2.1 m long along its wall (stretched in the Blender pass of 2026-10-16).
  const escapes: Escape[] = []
  for (let k = 0; k < 3; k++) for (const side of [-1, 1]) escapes.push({ ...at(10 + k * 6.2 + 3.1, side * 2.65), dx: GALLERY.ux, dz: GALLERY.uz, half: 1.07 })
  const lamp = at(32.96, 0.9)
  light('water lever', 'lamp', lamp.x, lamp.z, 1.2)
  light('landing', 'brazier', LANDING_BRAZIER.x, LANDING_BRAZIER.z, 2.4)
  // Named for the door it once lit; since the Blender pass of 2026-10-16 it burns in the cistern's middle, the plates round it.
  light('symbol door', 'brazier', 4.62, -50.86, 1.3)

  const doors: Door[] = []
  const hugeDoor: Door = { name: 'huge door', from: P(-2.4, HUGE_DOOR_Z), to: P(2.4, HUGE_DOOR_Z), hold: 5, at: P(HUB.x, -15.6) }
  const levers: Lever[] = [
    { name: 'gas', ...gas(25.25), hold: 2 },
    { name: 'water', ...at(32.97), hold: 2 },
    { name: 'hub', x: hugeDoor.at.x, z: hugeDoor.at.z, hold: hugeDoor.hold },
  ]
  // The four jets, out of either wall in turn, each across the whole way: the mouth's wall, the way in, how far it reaches.
  const jets: Jet[] = [
    { ...gas(5.85, -GAS_HALF), dx: 0, dz: 1, length: 2 * GAS_HALF, half: 0.8, period: 4, on: 1.6, phase: 0 },
    { ...gas(11.45, GAS_HALF), dx: 0, dz: -1, length: 2 * GAS_HALF, half: 0.8, period: 3.6, on: 1.5, phase: 1.4 },
    { ...gas(17.05, -GAS_HALF), dx: 0, dz: 1, length: 2 * GAS_HALF, half: 0.8, period: 3.4, on: 1.5, phase: 0.5 },
    { ...gas(21.85, GAS_HALF), dx: 0, dz: -1, length: 2 * GAS_HALF, half: 0.8, period: 3.2, on: 1.4, phase: 2.2 },
  ]
  const plates: Plate[] = [
    { numeral: 1, symbol: 'fish', x: 0.06, z: -50.74 },
    { numeral: 2, symbol: 'wheel', x: 10.08, z: -51.84 },
    { numeral: 3, symbol: 'skull', x: 6.78, z: -45.55 },
    { numeral: 4, symbol: 'key', x: 1.78, z: -53.8 },
  ]
  // The door's buttons along its inner face, west to east, in no telling order.
  const symbolDoor: Wall = { from: P(2.3, -57.75), to: P(6.1, -57.75) }
  const buttons = (['key', 'fish', 'skull', 'wheel'] as Glyph[]).map((symbol, k) => ({ symbol, x: 2.7 + k * 1, z: -56.45 }))

  // Where a catch starts the run again: the last of them walked into. The hub counts again each time he comes back
  // through it from a branch.
  const checkpoints = [
    { minX: -2.8, maxX: 2.8, minZ: -9.15, maxZ: -6.15, at: P(0, -7.55), again: true },
    // The landing out of the canal, by its brazier: the cistern's threshold.
    { minX: -2.4, maxX: 2.4, minZ: -44.5, maxZ: -41.6, at: P(0.2, -42.6) },
    // The gas branch's end, by its lever, past the last jet.
    { minX: gas(GAS_LENGTH).x, maxX: gas(23.05).x, minZ: HUB.z - GAS_HALF, maxZ: HUB.z + GAS_HALF, at: gas(24.25) },
    // The chandeliers' gallery's end, by its lever.
    { minX: at(29.78).x, maxX: at(33.78).x, minZ: HUB.z - 2.65, maxZ: HUB.z + 2.65, at: at(31.78) },
    // In the canal, the rats left on the walkways.
    { minX: CANAL.minX, maxX: CANAL.maxX, minZ: -24.5, maxZ: -22.5, at: P(0, -23.5) },
    // In the cistern's middle, by its brazier (moved there in the Blender pass of 2026-10-16).
    { minX: 2.78, maxX: 6.38, minZ: -51.98, maxZ: -49.78, at: P(4.58, -50.58) },
    // The gas branch's mouth, by its fire, kept again each time he walks through: caught anywhere after it, he starts
    // again here rather than at the far branch's lever (2026-10-16).
    { minX: gas(4).x, maxX: gas(1).x, minZ: HUB.z - GAS_HALF, maxZ: HUB.z + GAS_HALF, at: gas(2.45, 0.6), again: true },
  ]

  const labels: Label[] = [
    { x: 7.2, z: 15, text: 'COLLECTOR' },
    { x: -4.2, z: -15.2, text: 'HUB' },
    { ...gas(12, -3.9), text: 'GAS BRANCH' },
    { ...at(18, -5), text: 'CHANDELIER GALLERY' },
    { x: -6.4, z: -30, text: 'CANAL' },
    { x: 15.4, z: -50.75, text: 'CISTERN' },
    { x: 10.4, z: -62.65, text: 'THE RUSH' },
    { x: 4.2, z: -73.6, text: 'LADDER' },
  ]
  const props: Prop[] = [
    { kind: 'ladder', x: 1.9, z: 1.2, angle: 0 },
    { kind: 'chains', x: -0.6, z: 13.6 },
    { kind: 'sign', ...gas(1.25, 1.1) },
    { kind: 'pipes', ...gas(14.25, GAS_HALF), angle: 0, size: 5 },
    { kind: 'valve', ...gas(23.45, -1.3) },
    { kind: 'barrel', ...gas(25.45, 1.1) },
    { kind: 'crate', x: 5.6, z: -15.4 },
    { kind: 'barrel', x: -5.8, z: -14.2 },
    { kind: 'bones', x: 4.8, z: -6.2 },
    { kind: 'sign', x: 3.6, z: -20.2 },
    { kind: 'chains', ...at(14.2, 1.2) },
    { kind: 'bones', x: 8.2, z: -46.65 },
  ]

  // The level the run reads: the walls come in once traced, the doors are the play's.
  const level: Level = {
    // He wakes on the lantern's left (west), half its reach from it, in its light (2026-10-16).
    start: P(0.7, 20.4),
    lights,
    walls: [],
    wind: [],
    gates: [],
    keys: [],
    levers: [],
    bounds: BOUNDS,
    checkpoints,
  }

  // The colliders modelled in Blender (sewers.colliders.ts, `pnpm import-colliders`): solid masses where they stand,
  // and their walls set straight from their outlines, since a post as thin as a lever's shrinks to nothing on the
  // grid and the trace loses it; but for the huge door's, which stand and fall with it (sewerplay.ts), and a light's,
  // walls for him alone: a lit area is worked out on the ground between the walls, and a mass round a light would
  // wall its own light in.
  const doorColliders = new Set([...HUGE_DOOR_COLLIDERS.shut, ...HUGE_DOOR_COLLIDERS.open])
  const holderColliders: Wall[] = []
  const colliderWallsAll: Wall[] = []
  for (const collider of COLLIDERS) {
    if (doorColliders.has(collider.name)) continue
    const its = wallsOf([shrunk(collider, WALL_THICKNESS / 2)])
    if (lights.some((light) => within(collider.outline, light.x, light.z))) holderColliders.push(...its)
    else {
      add(poly('solid', ...collider.outline))
      colliderWallsAll.push(...its)
    }
  }
  const hugeDoorColliders = {
    shut: HUGE_DOOR_COLLIDERS.shut.flatMap(colliderWalls),
    open: HUGE_DOOR_COLLIDERS.open.flatMap(colliderWalls),
  }
  // A light with a body is dipped into from its edge.
  for (const light of lights) light.pad = colliderPad(light)

  const grid = lay(pieces)
  const { walls, sight, outlines } = trace(grid)
  walls.push(...colliderWallsAll)
  level.walls = walls
  // Each hole set on the floor nearest where it is written: at the foot of the wall it opens in.
  // The canal's own grid, laid no wider than drawn, its edge walls for the rats.
  const water = lay(canal, 0)
  const ratWalls = wallsOf(loops(water, (v) => v === 1))
  // Each escape hole on the floor nearest it: at the foot of its wall.
  for (const hole of escapes) Object.assign(hole, nearestFloor(grid, hole))

  return {
    pieces,
    walls,
    sight,
    outlines,
    level,
    lights,
    doors: [...doors, hugeDoor],
    levers,
    jets,
    chandeliers,
    escapes,
    plates,
    buttons,
    hugeDoorColliders,
    holderColliders,
    symbolDoor,
    cistern: CISTERN,
    corpse: gas(14.25, -1.15),
    chest: P(5.4, -7.6),
    canal,
    canalBox: CANAL,
    ratWalls,
    ladder: P(4.2, -71.2),
    hubZone: 0,
    cisternZone: 1,
    labels,
    props,
    grid,
    water,
  }
}

/** Whether (x, z) is on the hub's side of the huge door: everything south of its line. */
export const beforeDoor = (_x: number, z: number) => z > HUGE_DOOR_Z

/** Whether (x, z) is in the canal's gallery, past the huge door, short of where its walkways end: the walkways, or the water between them. */
export const inCanalGallery = (x: number, z: number) => !beforeDoor(x, z) && z > WALKWAYS_END && Math.abs(x) < 2.5

/** Whether (x, z) is where the rats are set down from the start: the hub's side of the huge door, and the canal gallery's walkways behind it. */
export const hubSide = (x: number, z: number) => beforeDoor(x, z) || inCanalGallery(x, z)

/** Whether (x, z) is in the canal's water. */
export const inCanal = (map: Sewers, x: number, z: number) => cellAt(map.water, x, z) === 1

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
 * floor or bridge shape reaches, grown by `grow`, half a wall's thickness
 * unless told, so the traced line stands that far out from the face; deep
 * water and solid where theirs reach, shrunk as much, and a bridge laid over
 * both.
 */
export function lay(pieces: readonly Piece[], grow = HALF, bounds: Bounds = BOUNDS): Grid {
  const minX = bounds.minX
  const minZ = bounds.minZ
  const cols = Math.ceil((bounds.maxX - minX) / GRID)
  const rows = Math.ceil((bounds.maxZ - minZ) / GRID)
  const FLOOR = 1
  const WATER = 2
  const SOLID = 4
  const BRIDGE = 8
  const bits = new Uint8Array(cols * rows)
  for (const { layer, shape } of pieces) {
    const bit = layer === 'floor' ? FLOOR : layer === 'water' ? WATER : layer === 'solid' ? SOLID : BRIDGE
    const grows = layer === 'floor' || layer === 'bridge'
    const b = boxOf(shape, grow + GRID)
    const c0 = Math.max(0, Math.floor((b.minX - minX) / GRID))
    const c1 = Math.min(cols - 1, Math.ceil((b.maxX - minX) / GRID))
    const r0 = Math.max(0, Math.floor((b.minZ - minZ) / GRID))
    const r1 = Math.min(rows - 1, Math.ceil((b.maxZ - minZ) / GRID))
    for (let r = r0; r <= r1; r++) {
      const z = minZ + (r + 0.5) * GRID
      for (let c = c0; c <= c1; c++) {
        const x = minX + (c + 0.5) * GRID
        const d = signedDistance(shape, x, z)
        if (grows ? d <= grow : d <= -grow) bits[r * cols + c]! |= bit
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

/**
 * How far round `p` its body stands, m: the farthest corner of the collider it is inside, 0 outside them all. What is
 * worked by standing near it, a lever, the chest, a button, a flame, is reached from that much further, since its
 * collider keeps him off its middle.
 */
export function colliderPad(p: Point): number {
  let pad = 0
  for (const { outline } of COLLIDERS) {
    if (!within(outline, p.x, p.z)) continue
    for (const q of outline) pad = Math.max(pad, Math.hypot(q.x - p.x, q.z - p.z))
  }
  return pad
}

/** The huge door's colliders in the Blender file, by name: the bar across it while shut; the leaves and the swung arm once open. */
export const HUGE_DOOR_COLLIDERS = {
  shut: ['collider.026'],
  open: ['collider.023', 'collider.024', 'collider.025', 'collider.027'],
}

/**
 * A collider's walls, by its name in the file, none if the file has no such collider: its outline's edges, each drawn in
 * by half a wall's thickness, as the trace sets a wall's middle half its thickness into the stone, so the collider's
 * face is where it was modelled.
 */
function colliderWalls(name: string): Wall[] {
  const collider = COLLIDERS.find((c) => c.name === name)
  return collider === undefined ? [] : wallsOf([shrunk(collider, WALL_THICKNESS / 2)])
}

/** A convex outline drawn in by `by` m: each edge moved toward the middle, the corners where neighbouring edges meet again. */
function shrunk(collider: Collider, by: number): Point[] {
  const points = collider.outline
  const n = points.length
  const cx = points.reduce((sum, p) => sum + p.x, 0) / n
  const cz = points.reduce((sum, p) => sum + p.z, 0) / n
  // Each edge as a line: a point on it moved in, and its direction.
  const edges = points.map((a, i) => {
    const b = points[(i + 1) % n]!
    const dx = b.x - a.x
    const dz = b.z - a.z
    const length = Math.hypot(dx, dz) || 1
    let nx = -dz / length
    let nz = dx / length
    // The normal toward the middle.
    if ((cx - a.x) * nx + (cz - a.z) * nz < 0) {
      nx = -nx
      nz = -nz
    }
    return { x: a.x + nx * by, z: a.z + nz * by, dx, dz }
  })
  return edges.map((edge, i) => {
    const before = edges[(i - 1 + n) % n]!
    // Where the previous edge's line meets this one's.
    const det = before.dx * edge.dz - before.dz * edge.dx
    if (Math.abs(det) < 1e-9) return { x: edge.x, z: edge.z }
    const t = ((edge.x - before.x) * edge.dz - (edge.z - before.z) * edge.dx) / det
    return { x: before.x + before.dx * t, z: before.z + before.dz * t }
  })
}

/** The edge round every cell `open` says, traced into simplified closed loops: the open side on the left going round, x east and z south. */
export function loops(grid: Grid, open: (v: number) => boolean): Point[][] {
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
