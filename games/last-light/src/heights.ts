// The ground's height (#182): written in the level as a few shapes, read by
// the drawing alone. The play stays on the flat ground, x and z; the ground,
// the child, the trees and the lights are drawn at the height the shapes give
// where they stand, and the 2D page draws the same shapes as contours.
//
// A shape raises the ground inside its outline, or sinks it, rising to its
// full height over `edge` metres in from the outline. Given a way along it,
// it rises along that way instead, none of it at the way's start and all of
// it from the way's end on: a slope up a hill. Shapes add up.
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
