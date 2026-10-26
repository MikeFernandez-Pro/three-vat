// The old road: the goose game's way up the plain, an old road the braziers
// stand along as its beacons, long given up, its stones mostly sunk under the
// dirt. Near a fire it is whole, its slabs laid edge to edge; out in the dark
// between two it thins to the odd slab, so the way still reads under the
// torch without a line drawn to the next light. The players got lost on a
// plain that looked the same everywhere: the road says which way and breaks
// the sameness.
//
// The route may lay it by hand (`Route.road`, placed on the 2D page): the
// road's middle runs through its points, in their order. Without, it is laid
// from the fires (`roadPoints`): its middle passes each a little to one side,
// never through it: on the inside of the way's bend at a brazier; at a scene,
// on the side away from the scene's body, the well, the cage, the log; at the
// dead tree, between the tree and its fire. Between them it strays a little
// sideways, each leg its own way, and it runs on back past where she starts,
// and on to the pond, where it ends at the water. Either way it fades in out
// of the dark from its first point, as a road that was there before her.
//
// The road is a field the floor reads (ground.ts): over a box round it, for
// each cell, how far it is across from the road's middle, to which side, how
// far along the road that is and how much of the road is left there. The floor
// lays the stones from it in the road's own way, along it and across, so its
// slabs follow it round its bends, each slab sinking from its edges in as less
// of the road is left.
import type { Plain, Point } from './plain'
import { random } from './swarm'

/** The road's way and how much of it is left, as the road folder edits it; its look on the floor is the floor's (ground.ts, RoadLook). */
export interface RoadShape {
  /** How far the road's middle passes off a fire, m. */
  side: number
  /** How far it strays sideways between two fires at the most, m. */
  wander: number
  /** How far from a fire it is whole, m, and how much further on it has thinned to what is left out in the dark, m. */
  whole: number
  thins: number
  /** How much of it is left out in the dark, 0 none to 1 whole. */
  left: number
  /** How far it runs on back past her start, m, fading out on the way. */
  behind: number
}

/** The road as set on 2026-10-24: a cart's width off each fire, straying a couple of metres, whole by the fires, a third of it left in the dark. */
export function defaultRoadShape(): RoadShape {
  return { side: 1.8, wander: 2, whole: 3.5, thins: 5, left: 0.35, behind: 14 }
}

/** How far past the road's middle the field reaches, m: past the widest road the floor lays and its wavering edge. */
export const ROAD_REACH = 4
/** How long a piece of the road's middle is, m. */
const PIECE = 0.5
/** How wide a cell of the field is, m. */
const CELL = 0.25

/** The road's middle, piece by piece, and how much of the road is left at each point, 0 to 1. */
export interface RoadLine {
  points: (Point & { left: number })[]
}

/**
 * The field the floor reads: `columns` by `rows` cells, CELL m wide, from
 * (minX, minZ), each four numbers: how far the cell is across from the road's
 * middle, m, ROAD_REACH at the most, to the right of the way she goes up it
 * and less than nought to the left; how much of the road is left at the
 * nearest point of it; how far along the road that point is from its first,
 * m; and nought, as a texel has four.
 */
export interface RoadField {
  minX: number
  minZ: number
  cell: number
  columns: number
  rows: number
  data: Float32Array
}

const sub = (a: Point, b: Point) => ({ x: a.x - b.x, z: a.z - b.z })
const length = (p: Point) => Math.hypot(p.x, p.z)
const unit = (p: Point) => {
  const l = length(p) || 1
  return { x: p.x / l, z: p.z / l }
}
const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

/** Where the road's middle passes each fire, in the order she meets them: off it by `side`, as the head of the file says. */
export function roadStops(plain: Plain, side: number): Point[] {
  const { braziers, home } = plain
  return braziers.map((b, k) => {
    const prev = k > 0 ? braziers[k - 1]! : plain.start
    const next = braziers[k + 1] ?? home
    let off: Point
    if (b.scene === 'tree') off = b.fire ? unit(sub(b.fire, b)) : unit(sub(next, b))
    else if (b.scene !== undefined && b.gosling) off = unit(sub(b, b.gosling))
    else {
      // The inside of the bend: toward the middle of where it comes from and goes to; going straight, to the right.
      const inside = sub({ x: (prev.x + next.x) / 2, z: (prev.z + next.z) / 2 }, b)
      const way = unit(sub(next, prev))
      off = length(inside) > 0.5 ? unit(inside) : { x: -way.z, z: way.x }
    }
    return { x: b.x + off.x * side, z: b.z + off.z * side }
  })
}

/** The places the road is whole round: the braziers', the dead trees' fires and home. */
function beacons(plain: Plain): Point[] {
  return [...plain.braziers.flatMap((b) => (b.fire && b.scene === 'tree' ? [b, b.fire] : [b])), plain.home]
}

/** A point on the centripetal Catmull-Rom curve through p1 and p2, `t` of the way, p0 and p3 its neighbours. */
function curve(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const knot = (a: Point, b: Point) => Math.max(Math.sqrt(length(sub(b, a))), 1e-4)
  const t1 = knot(p0, p1)
  const t2 = t1 + knot(p1, p2)
  const t3 = t2 + knot(p2, p3)
  const u = t1 + (t2 - t1) * t
  const lerp = (a: Point, b: Point, ta: number, tb: number) => ({ x: (a.x * (tb - u) + b.x * (u - ta)) / (tb - ta), z: (a.z * (tb - u) + b.z * (u - ta)) / (tb - ta) })
  const a1 = lerp(p0, p1, 0, t1)
  const a2 = lerp(p1, p2, t1, t2)
  const a3 = lerp(p2, p3, t2, t3)
  const b1 = lerp(a1, a2, 0, t2)
  const b2 = lerp(a2, a3, t1, t3)
  return lerp(b1, b2, t1, t2)
}

/** The curve's neighbours of the leg from `through[k]` to the next: the points either side, or, at an end, the leg's own way on past it. */
function legOf(through: readonly Point[], k: number): [Point, Point, Point, Point] {
  const p1 = through[k]!
  const p2 = through[k + 1]!
  const p0 = through[k - 1] ?? { x: 2 * p1.x - p2.x, z: 2 * p1.z - p2.z }
  const p3 = through[k + 2] ?? { x: 2 * p2.x - p1.x, z: 2 * p2.z - p1.z }
  return [p0, p1, p2, p3]
}

/**
 * The points the road is laid through from the fires, as `shape` lays it: back past her start, away from the way to
 * the first stop, each stop (`roadStops`), the middle of each leg strayed sideways its own way, and home. None on a
 * plain with no braziers.
 */
export function roadPoints(plain: Plain, shape: RoadShape): Point[] {
  const stops = roadStops(plain, shape.side)
  if (stops.length === 0) return []
  const first = stops[0]!
  const away = unit(sub(first, stops[1] ?? plain.home))
  const back = { x: first.x + away.x * shape.behind, z: first.z + away.z * shape.behind }
  const through = [back, ...stops, { ...plain.home }]
  const next = random(0x0a1d)
  return through.flatMap((p, k) => {
    if (k + 1 === through.length) return [p]
    const stray = (next() * 2 - 1) * shape.wander
    const legs = legOf(through, k)
    const way = unit(sub(legs[2], legs[1]))
    const middle = curve(...legs, 0.5)
    return [p, { x: middle.x - way.z * stray, z: middle.z + way.x * stray }]
  })
}

/** The road through `plain`: through the route's own points, if it lays it by hand, or else laid from the fires as `shape` lays it. The same plain, the same road. */
export function roadLine(plain: Plain, shape: RoadShape): RoadLine {
  const through = plain.road && plain.road.length >= 2 ? plain.road : roadPoints(plain, shape)
  if (through.length < 2) return { points: [] }
  const lights = beacons(plain)
  const points: (Point & { left: number })[] = []
  let along = 0
  for (let k = 0; k + 1 < through.length; k++) {
    const legs = legOf(through, k)
    const pieces = Math.max(1, Math.ceil(length(sub(legs[2], legs[1])) / PIECE))
    for (let i = k === 0 ? 0 : 1; i <= pieces; i++) {
      const at = curve(...legs, i / pieces)
      const prev = points.at(-1)
      if (prev) along += length(sub(at, prev))
      const nearest = Math.min(...lights.map((l) => length(sub(at, l))))
      const thinned = shape.left + (1 - shape.left) * (1 - smoothstep(shape.whole, shape.whole + shape.thins, nearest))
      // From its first point it fades in out of the dark.
      points.push({ ...at, left: thinned * smoothstep(0, shape.behind, along) })
    }
  }
  return { points }
}

/** The field of `line`, over a box round it, ROAD_REACH past it every way. */
export function roadField(line: RoadLine): RoadField {
  const { points } = line
  // No road: one cell, far from any.
  const xs = points.length > 0 ? points.map((p) => p.x) : [0]
  const zs = points.length > 0 ? points.map((p) => p.z) : [0]
  const minX = Math.floor((Math.min(...xs) - ROAD_REACH) / CELL) * CELL
  const minZ = Math.floor((Math.min(...zs) - ROAD_REACH) / CELL) * CELL
  const columns = Math.ceil((Math.max(...xs) + ROAD_REACH - minX) / CELL) + 1
  const rows = Math.ceil((Math.max(...zs) + ROAD_REACH - minZ) / CELL) + 1
  const data = new Float32Array(columns * rows * 4)
  for (let k = 0; k < data.length; k += 4) data[k] = ROAD_REACH
  // Each piece of the road over the cells within reach of it: the nearest piece wins.
  let along = 0
  for (let k = 0; k + 1 < points.length; k++) {
    const a = points[k]!
    const b = points[k + 1]!
    const ab = sub(b, a)
    const span = Math.max(ab.x * ab.x + ab.z * ab.z, 1e-9)
    const long = Math.sqrt(span)
    const c0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - ROAD_REACH - minX) / CELL))
    const c1 = Math.min(columns - 1, Math.ceil((Math.max(a.x, b.x) + ROAD_REACH - minX) / CELL))
    const r0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - ROAD_REACH - minZ) / CELL))
    const r1 = Math.min(rows - 1, Math.ceil((Math.max(a.z, b.z) + ROAD_REACH - minZ) / CELL))
    for (let r = r0; r <= r1; r++) {
      const z = minZ + r * CELL
      for (let c = c0; c <= c1; c++) {
        const x = minX + c * CELL
        const t = Math.min(1, Math.max(0, ((x - a.x) * ab.x + (z - a.z) * ab.z) / span))
        const d = Math.hypot(x - a.x - ab.x * t, z - a.z - ab.z * t)
        const cell = (r * columns + c) * 4
        if (d >= Math.abs(data[cell]!)) continue
        // Right of the way, more than nought: heading along x, the right is toward z.
        data[cell] = (ab.x * (z - a.z) - ab.z * (x - a.x) < 0 ? -1 : 1) * d
        data[cell + 1] = a.left + (b.left - a.left) * t
        data[cell + 2] = along + long * t
      }
    }
    along += long
  }
  return { minX, minZ, cell: CELL, columns, rows, data }
}

/** The field at (x, z), as the floor reads it, the nearest cell's: how far from the road's middle, m, how far across it, to the right more than nought, how much of it is left, and how far along it, m. */
export function roadAt(field: RoadField, x: number, z: number): { away: number; across: number; left: number; along: number } {
  const c = Math.round((x - field.minX) / field.cell)
  const r = Math.round((z - field.minZ) / field.cell)
  if (c < 0 || r < 0 || c >= field.columns || r >= field.rows) return { away: ROAD_REACH, across: ROAD_REACH, left: 0, along: 0 }
  const cell = (r * field.columns + c) * 4
  return { away: Math.abs(field.data[cell]!), across: field.data[cell]!, left: field.data[cell + 1]!, along: field.data[cell + 2]! }
}
