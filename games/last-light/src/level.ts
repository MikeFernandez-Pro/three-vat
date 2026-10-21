// The level, as data (#173): walls, lights, wind zones, gates, keys, levers and the exit,
// where the holder starts, in a box the rats fill wherever it is dark. The
// page's open arena is the one level left here: the game plays the woods
// (woods.ts) since #182, and the first section's blockout, the test level the
// game played before, lives on in the run's tests. The sewers (`#sewers`) are
// a first corridor, for the move underground.
//
// Up the screen is north, -z.
import type { Level } from './run'
import { WALL_THICKNESS, type Wall } from './walls'

/** The arena's half-width, and its south and north edges, m. */
const WIDE = 16
const SOUTH = 22
const HOUSE = -17

/**
 * The sewer's corridor to start: its width between the walls' faces, narrow
 * enough that the torch's lamp at its starting strength reaches them; and how
 * far it runs either side of the middle, m.
 */
export const SEWER_WIDTH = 3
const SEWER_REACH = 30

/**
 * The sewers, a first corridor (2026-10-11): one straight tunnel running north
 * and south, `width` m between its walls, walled either side and shut at both
 * ends, the holder at its south end facing up it, no light but the torch. The
 * rats fill the dark of its box. A wall's line is its middle, so the lines
 * stand half a wall's thickness out from the faces.
 */
export const sewer = (width = SEWER_WIDTH): Level => {
  const half = width / 2
  const x = half + WALL_THICKNESS / 2
  const z = SEWER_REACH + WALL_THICKNESS / 2
  return {
    start: { x: 0, z: SEWER_REACH - 4 },
    lights: [],
    walls: [
      { from: { x: -x, z: -z }, to: { x: -x, z } },
      { from: { x, z: -z }, to: { x, z } },
      { from: { x: -x, z: -z }, to: { x, z: -z } },
      { from: { x: -x, z }, to: { x, z } },
    ],
    wind: [],
    gates: [],
    keys: [],
    levers: [],
    bounds: { minX: -half, maxX: half, minZ: -SEWER_REACH, maxZ: SEWER_REACH },
  }
}

/** How wide a rat hole is, m: a rat is 0.25 m across and keeps its radius off a wall's ends. */
export const SEWER_HOLE = 0.7
/** How deep the ground behind each side wall is that rats live in, m. */
const SEWER_BEHIND = 1.5
/** Where the rat holes are along the corridor, z, m: the west wall's and the east wall's, staggered. */
const SEWER_HOLES = { west: [-26, -11, 4, 17], east: [-19, -4, 10, 22] }

/**
 * The sewers as the rats have them, `width` m between the corridor's faces:
 * its side walls holed at the foot at SEWER_HOLES, SEWER_HOLE wide, and
 * behind each a strip of ground SEWER_BEHIND deep, shut in, that rats live in
 * and come out of through the holes. The light still stops at the walls
 * whole (`sewer`): the holes are the rats'. The box the rats start in is the
 * corridor and both strips; and each hole, on its wall's middle line.
 */
export const sewerRats = (width = SEWER_WIDTH): { walls: Wall[]; bounds: Level['bounds']; holes: { x: number; z: number }[] } => {
  const half = width / 2
  const x = half + WALL_THICKNESS / 2
  const z = SEWER_REACH + WALL_THICKNESS / 2
  const out = x + WALL_THICKNESS / 2 + SEWER_BEHIND + WALL_THICKNESS / 2
  /** The side wall at `wx`, from end to end, a gap round each hole. */
  const holed = (wx: number, at: number[]): Wall[] => {
    const walls: Wall[] = []
    let from = -z
    for (const hz of [...at].sort((a, b) => a - b)) {
      walls.push({ from: { x: wx, z: from }, to: { x: wx, z: hz - SEWER_HOLE / 2 } })
      from = hz + SEWER_HOLE / 2
    }
    walls.push({ from: { x: wx, z: from }, to: { x: wx, z } })
    return walls
  }
  return {
    walls: [
      ...holed(-x, SEWER_HOLES.west),
      ...holed(x, SEWER_HOLES.east),
      { from: { x: -out, z: -z }, to: { x: out, z: -z } },
      { from: { x: -out, z }, to: { x: out, z } },
      { from: { x: -out, z: -z }, to: { x: -out, z } },
      { from: { x: out, z: -z }, to: { x: out, z } },
    ],
    bounds: { minX: -out + WALL_THICKNESS / 2, maxX: out - WALL_THICKNESS / 2, minZ: -SEWER_REACH, maxZ: SEWER_REACH },
    holes: [...SEWER_HOLES.west.map((hz) => ({ x: -x, z: hz })), ...SEWER_HOLES.east.map((hz) => ({ x, z: hz }))],
  }
}

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

/** The round room's rings, m from its middle: the inner room's wall, the corridor's, the room's own; and the half-width of the square wall round the ground outside it. */
const ROOM_RINGS = { inner: 5, middle: 9, outer: 13, around: 16 }
/** How many sides each ring has as a whole polygon: the GPU step reads 64 walls at most (gpuswarm.ts), so the curves are coarse. */
const ROOM_SIDES = { inner: 8, middle: 12, outer: 16 }
/** How wide the ways through the round room's rings are, m: room for the holder. */
const ROOM_WAY = 1.8
/** How wide a rat hole through its outer wall is, m. */
const ROOM_HOLE = 1

/**
 * Where the round room's rats appear: in the maze itself, its two corridors between the middle room's wall and
 * the outer wall, kept off both; never in the middle room the holder starts in. They can still get out through
 * the outer wall's holes, onto the ground round it.
 */
export const ROOM_SPAWN = { x: 0, z: 0, inner: ROOM_RINGS.inner + 0.5, outer: ROOM_RINGS.outer - 0.5 }

/**
 * A round test room, `#hall`, a very simple maze: a ring wall round a small middle room, another round that,
 * and the room's own outer wall, each ring opened where the next is shut, so the way in and out winds; two short
 * walls across each corridor between the rings, so it cannot be walked round all the way. The outer wall is holed
 * in eight places, and outside it the ground, walled in square, that the rats can get out onto. Each ring is a
 * polygon of ROOM_SIDES sides, 44 walls in all. The holder starts in the middle.
 */
export const roundRoom = (): Level => {
  const walls: Wall[] = []
  /** The ring `radius` m out, from angle a0 to a1, radians, in straight pieces no wider than a side of its `sides`. */
  const arc = (radius: number, sides: number, a0: number, a1: number) => {
    const pieces = Math.max(1, Math.ceil(((a1 - a0) * sides) / (Math.PI * 2) - 1e-6))
    for (let k = 0; k < pieces; k++) {
      const t0 = a0 + ((a1 - a0) * k) / pieces
      const t1 = a0 + ((a1 - a0) * (k + 1)) / pieces
      walls.push({ from: { x: Math.cos(t0) * radius, z: Math.sin(t0) * radius }, to: { x: Math.cos(t1) * radius, z: Math.sin(t1) * radius } })
    }
  }
  /** The whole ring `radius` m out, of `sides`, a gap `width` m wide round each angle of `gaps`, degrees. */
  const ring = (radius: number, sides: number, gaps: number[], width: number) => {
    const half = width / 2 / radius
    const at = gaps.map((g) => (g * Math.PI) / 180).sort((a, b) => a - b)
    at.forEach((g, k) => arc(radius, sides, g + half, (at[(k + 1) % at.length]! + (k + 1 === at.length ? Math.PI * 2 : 0)) - half))
  }
  /** A straight wall across the corridor between rings r0 and r1, at `angle` degrees. */
  const across = (r0: number, r1: number, angle: number) => {
    const a = (angle * Math.PI) / 180
    walls.push({ from: { x: Math.cos(a) * r0, z: Math.sin(a) * r0 }, to: { x: Math.cos(a) * r1, z: Math.sin(a) * r1 } })
  }
  const { inner, middle, outer, around } = ROOM_RINGS
  ring(inner, ROOM_SIDES.inner, [0, 180], ROOM_WAY)
  ring(middle, ROOM_SIDES.middle, [90, 270], ROOM_WAY)
  ring(outer, ROOM_SIDES.outer, [0, 45, 90, 135, 180, 225, 270, 315].map((a) => a + 22.5), ROOM_HOLE)
  walls.push(
    { from: { x: -around, z: -around }, to: { x: around, z: -around } },
    { from: { x: around, z: -around }, to: { x: around, z: around } },
    { from: { x: around, z: around }, to: { x: -around, z: around } },
    { from: { x: -around, z: around }, to: { x: -around, z: -around } },
  )
  across(inner, middle, 135)
  across(inner, middle, 315)
  across(middle, outer, 45)
  across(middle, outer, 225)
  const half = WALL_THICKNESS / 2
  return {
    start: { x: 0, z: 0 },
    lights: [],
    walls,
    wind: [],
    gates: [],
    keys: [],
    levers: [],
    // The box the rats are kept in: round the wall round it all.
    bounds: { minX: -around + half, maxX: around - half, minZ: -around + half, maxZ: around - half },
  }
}
