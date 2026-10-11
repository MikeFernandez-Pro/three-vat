// The ground's height (#182): written in the level as a few shapes, read by
// the drawing alone. The play stays on the flat ground, x and z; the ground,
// the child, the trees and the lights are drawn at the height the shapes give
// where they stand, and the 2D page draws the same shapes as contours.
//
// A shape raises the ground inside its outline, or sinks it, rising to its
// full height over `edge` metres in from the outline. Given a way along it,
// it rises along that way instead, none of it at the way's start and all of
// it from the way's end on: a slope up a hill. Shapes add up.
//
// A flight of steps (#183) climbs the shapes along a line: within its
// half-width of the line the ground is its treads', each level, as high as the
// shapes have the tread's top edge at its highest, so a step never sinks under
// the slope it climbs. What stands on the ground stands on them; the ground's
// own surface leaves them to their own blocks.
import type { Bounds } from './swarm'
import { distanceTo, within } from './walls'
import type { Point } from './woods'

/** A stretch of ground raised, or sunk, inside an outline. */
export interface HeightShape {
  outline: Point[]
  /** How high it raises the ground, m; below 0, how deep it sinks it. */
  height: number
  /** How far in from the outline the ground takes to come up to its height, m: 0, at once. */
  edge: number
  /** If given, it rises along the way from `from` to `to`: none of it at `from`, all of it from `to` on. */
  along?: { from: Point; to: Point }
}

/** A contour's piece: from one point to the other, at `level` m. */
export interface ContourPiece {
  a: Point
  b: Point
  level: number
}

/** 0 to 1 and back, eased at both ends. */
const ease = (t: number) => {
  const c = Math.min(1, Math.max(0, t))
  return c * c * (3 - 2 * c)
}

/** How far (x, z) is from `outline`'s nearest side, m. */
export function toOutline(outline: readonly Point[], x: number, z: number): number {
  let best = Infinity
  outline.forEach((from, k) => (best = Math.min(best, distanceTo({ from, to: outline[(k + 1) % outline.length]! }, x, z))))
  return best
}

/** The ground's height at (x, z), m: every shape's there, added up. */
export function heightAt(shapes: readonly HeightShape[], x: number, z: number): number {
  let y = 0
  for (const shape of shapes) {
    if (!within(shape.outline, x, z)) continue
    let share = shape.edge > 0 ? ease(toOutline(shape.outline, x, z) / shape.edge) : 1
    const way = shape.along
    if (way !== undefined) {
      const dx = way.to.x - way.from.x
      const dz = way.to.z - way.from.z
      share *= ease(((x - way.from.x) * dx + (z - way.from.z) * dz) / (dx * dx + dz * dz || 1))
    }
    y += shape.height * share
  }
  return y
}

/** A flight of steps up a line: `half` m either side of it, in `count` treads of the same length along it. */
export interface Flight {
  line: Point[]
  half: number
  count: number
}

/** A tread of a flight: from `from` m along its line to `to`, its top `height` m. */
export interface Tread {
  from: number
  to: number
  height: number
}

/** The ground and what climbs it: its shapes, and its flights of steps. */
export interface Terrain {
  heights: readonly HeightShape[]
  flights: readonly Flight[]
}

/** How long `line` is, m. */
const lengthOf = (line: readonly Point[]) => line.slice(1).reduce((sum, p, k) => sum + Math.hypot(p.x - line[k]!.x, p.z - line[k]!.z), 0)

/** The point `s` m along `line`, held at its ends, and the way the line runs there, a unit direction. */
export function pointAlong(line: readonly Point[], s: number): Point & { ux: number; uz: number } {
  let left = Math.max(0, s)
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1]!
    const b = line[k]!
    const d = Math.hypot(b.x - a.x, b.z - a.z)
    if (left <= d || k === line.length - 1) {
      const t = d > 0 ? Math.min(1, left / d) : 0
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, ux: d > 0 ? (b.x - a.x) / d : 1, uz: d > 0 ? (b.z - a.z) / d : 0 }
    }
    left -= d
  }
  return { ...line[0]!, ux: 1, uz: 0 }
}

/** How high tread `k` of `flight` stands, its line `length` m long: as high as `shapes` have its top edge, across the flight, at its highest. */
function treadHeight(shapes: readonly HeightShape[], flight: Flight, length: number, k: number): number {
  const top = pointAlong(flight.line, ((k + 1) * length) / flight.count)
  const across = (side: number) => heightAt(shapes, top.x - top.uz * flight.half * side, top.z + top.ux * flight.half * side)
  return Math.max(across(-1), across(0), across(1))
}

/** How far along `line` the point nearest (x, z) is, m, and how far off it (x, z) is: infinitely, before its start or past its end. */
function nearestAlong(line: readonly Point[], x: number, z: number): { along: number; off: number } {
  let best = { along: 0, off: Infinity }
  let start = 0
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1]!
    const b = line[k]!
    const dx = b.x - a.x
    const dz = b.z - a.z
    const d = Math.hypot(dx, dz)
    const s = d > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / (d * d) : 0
    const t = Math.min(1, Math.max(0, s))
    const beyond = (k === 1 && s < 0) || (k === line.length - 1 && s > 1)
    const off = beyond ? Infinity : Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t))
    if (off < best.off) best = { along: start + t * d, off }
    start += d
  }
  return best
}

/** A flight's treads, in order up it: each as high as `shapes` have its top edge at its highest. */
export function treads(shapes: readonly HeightShape[], flight: Flight): Tread[] {
  const length = lengthOf(flight.line)
  const tread = length / flight.count
  return Array.from({ length: flight.count }, (_, k) => ({ from: k * tread, to: (k + 1) * tread, height: treadHeight(shapes, flight, length, k) }))
}

/** The ground's height where something stands at (x, z), m: on a flight's tread, its top; anywhere else, the shapes'. */
export function standingAt(terrain: Terrain, x: number, z: number): number {
  for (const flight of terrain.flights) {
    const { along, off } = nearestAlong(flight.line, x, z)
    if (off > flight.half) continue
    const length = lengthOf(flight.line)
    return treadHeight(terrain.heights, flight, length, Math.min(flight.count - 1, Math.floor((along / length) * flight.count)))
  }
  return heightAt(terrain.heights, x, z)
}

/** Whether (x, z) is on a flight of steps. */
export function onFlight(terrain: Terrain, x: number, z: number): boolean {
  return terrain.flights.some((flight) => nearestAlong(flight.line, x, z).off <= flight.half)
}

/**
 * The ground's height read off a grid `cell` m a side over `bounds`, for a
 * shader to read as the GPU's rats are stood: row by row along x, from the
 * box's corner, and between the grid's points as the shader reads it.
 */
export class HeightGrid {
  /** Where the grid's first point stands, its corner. */
  readonly minX: number
  readonly minZ: number
  /** Points along x and along z. */
  readonly nx: number
  readonly nz: number
  /** The height at each point, m: along x, a row at a time. */
  readonly heights: Float32Array

  constructor(
    at: (x: number, z: number) => number,
    bounds: Bounds,
    readonly cell: number,
  ) {
    this.minX = bounds.minX
    this.minZ = bounds.minZ
    this.nx = Math.ceil((bounds.maxX - bounds.minX) / cell) + 1
    this.nz = Math.ceil((bounds.maxZ - bounds.minZ) / cell) + 1
    this.heights = new Float32Array(this.nx * this.nz)
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) this.heights[j * this.nx + i] = at(this.minX + i * cell, this.minZ + j * cell)
  }

  /** The height at (x, z), m: between the four grid points round it, held at the grid's edge. */
  at(x: number, z: number): number {
    const fx = Math.min(this.nx - 1, Math.max(0, (x - this.minX) / this.cell))
    const fz = Math.min(this.nz - 1, Math.max(0, (z - this.minZ) / this.cell))
    const i = Math.min(this.nx - 2, Math.floor(fx))
    const j = Math.min(this.nz - 2, Math.floor(fz))
    const tx = fx - i
    const tz = fz - j
    const h = this.heights
    const row = j * this.nx + i
    const a = h[row]! + (h[row + 1]! - h[row]!) * tx
    const b = h[row + this.nx]! + (h[row + this.nx + 1]! - h[row + this.nx]!) * tx
    return a + (b - a) * tz
  }
}

/**
 * The contours of the ground over `bounds`, read on a grid `cell` m a side:
 * a line every `every` m of height, up and down, none at the flat ground's.
 */
export function contours(shapes: readonly HeightShape[], bounds: Bounds, cell: number, every: number): ContourPiece[] {
  const nx = Math.ceil((bounds.maxX - bounds.minX) / cell)
  const nz = Math.ceil((bounds.maxZ - bounds.minZ) / cell)
  const heights = new Float64Array((nx + 1) * (nz + 1))
  let low = 0
  let high = 0
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const y = heightAt(shapes, bounds.minX + i * cell, bounds.minZ + j * cell)
      heights[j * (nx + 1) + i] = y
      low = Math.min(low, y)
      high = Math.max(high, y)
    }
  }
  const pieces: ContourPiece[] = []
  for (let level = Math.ceil(low / every) * every; level <= high; level += every) {
    if (Math.abs(level) < 1e-9) continue
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        // The cell's corners, round it: where the level crosses each side, between the corners either end.
        const corners = [
          [i, j],
          [i + 1, j],
          [i + 1, j + 1],
          [i, j + 1],
        ] as const
        const crossings: Point[] = []
        for (let k = 0; k < 4; k++) {
          const [ai, aj] = corners[k]!
          const [bi, bj] = corners[(k + 1) % 4]!
          const ya = heights[aj * (nx + 1) + ai]!
          const yb = heights[bj * (nx + 1) + bi]!
          if (ya >= level === yb >= level) continue
          const t = (level - ya) / (yb - ya)
          crossings.push({ x: bounds.minX + (ai + (bi - ai) * t) * cell, z: bounds.minZ + (aj + (bj - aj) * t) * cell })
        }
        for (let k = 0; k + 1 < crossings.length; k += 2) pieces.push({ a: crossings[k]!, b: crossings[k + 1]!, level })
      }
    }
  }
  return pieces
}
