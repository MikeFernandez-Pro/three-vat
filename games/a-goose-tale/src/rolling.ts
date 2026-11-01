// The goose game's plain rolls: low, wide swells of the ground, read off
// Perlin noise, never below the flat ground's level, so nothing under the
// pond's water rule (ground.ts) mistakes a hollow for its bed. Where a scene
// or a fire stands the ground is flat, a pad round each, as it is round the
// pond, so a well or a cage stands level, and the pond's floor and bank
// are laid as before; from each pad's edge the swells come up over RAMP m.
//
// The play stays on the flat ground, x and z, as the woods' does (heights.ts):
// the height is the drawing's alone. It is read once into a HeightGrid, the
// one thing every reader takes it from: the rats on the GPU (gpucull.ts), and
// on the page the floor's points, the goose, her goslings and the scenes, so
// what stands on the ground stands where the floor is drawn. It never changes
// in play; the ground folder lays it again, in place, as it edits its look.
import { BufferGeometry, Float32BufferAttribute } from 'three/webgpu'
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js'
import { HeightGrid } from './heights'
import type { Plain, Point } from './plain'
import type { Bounds } from './swarm'

/** How the plain rolls: what the ground folder edits. */
export interface RollingLook {
  /** How high the swells rise above the flat ground at most, m. */
  height: number
  /** How far apart the swells are, m, about. */
  size: number
  /** The smaller swells over them: how much smaller, and how much of the height they take. */
  detail: number
  detailWeight: number
  /** How far the ground is flat round a brazier, m: its scene's pieces stand within it (the well 2.4 m off, the cage's set). */
  brazierPad: number
  /** How far round a gosling's spot, a skull, a fire or a cart, m. */
  piecePad: number
  /** How far from a pad's edge the swells take to come up, m. */
  ramp: number
}
export const defaultRollingLook = (): RollingLook => ({ height: 1, size: 10, detail: 2.6, detailWeight: 0.35, brazierPad: 4, piecePad: 2, ramp: 4 })
/**
 * How far apart the grid's points are, m: the floor's points, and what the rats are stood on. At 1 m the plain is
 * 39k triangles, not 155k at 0.5 m; what stands on it stands within 2 cm of the floor drawn for 99 points in 100,
 * 6 cm at worst, and the floor keeps within 4 cm of the swells (2026-10-25).
 */
export const ROLLING_CELL = 1
/** How far past the pond's widest shore the ground is flat, m: the floor's flat square round it (`floorAround`) lies inside. */
export const POND_PAD = 2
/** Which stretch of the noise the plain reads. */
const NOISE_Z = 3.7

const noise = new ImprovedNoise()

/** 0 to 1 and back, eased at both ends. */
const ease = (t: number) => {
  const c = Math.min(1, Math.max(0, t))
  return c * c * (3 - 2 * c)
}

/** How far (x, z) is from the way from `a` to `b`, m. */
function fromSegment(a: Point, b: Point, x: number, z: number): number {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)))
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t)
}

/** A flat pad: a way from `a` to `b` (a point, if the same), flat within `radius` m of it. */
export interface Pad {
  a: Point
  b: Point
  radius: number
}

/** The pads of `plain` as `look` sizes them: round its start, each brazier and each of its scene's pieces. */
export function padsOf(plain: Plain, look: RollingLook): Pad[] {
  const at = (p: Point, radius: number): Pad => ({ a: p, b: p, radius })
  return [
    at(plain.start, look.brazierPad),
    ...plain.braziers.flatMap((b) => [
      at(b, look.brazierPad),
      ...[b.gosling, b.skull, b.fire, b.cart].filter((p) => p !== undefined).map((p) => at(p, look.piecePad)),
    ]),
  ]
}

/** The plain's swells at (x, z) as `look` has them, before any pad flattens them, 0 to its height, m. */
export function swellAt(look: RollingLook, x: number, z: number): number {
  const { height, size, detail, detailWeight } = look
  const n = noise.noise(x / size, z / size, NOISE_Z) + detailWeight * noise.noise((x * detail) / size, (z * detail) / size, NOISE_Z + 11.3)
  return height * ease(0.5 + n * 0.8)
}

/**
 * The plain's ground at (x, z), m: the swells of `look`, flattened on each of
 * `pads` and in the square `pond` (flat within it, rising out from its sides
 * over the look's ramp).
 */
export function rollingAt(look: RollingLook, pads: readonly Pad[], pond: Bounds, x: number, z: number): number {
  const ramp = Math.max(0.01, look.ramp)
  let keep = ease(Math.max(pond.minX - x, x - pond.maxX, pond.minZ - z, z - pond.maxZ) / ramp)
  for (const pad of pads) {
    if (keep === 0) break
    keep = Math.min(keep, ease((fromSegment(pad.a, pad.b, x, z) - pad.radius) / ramp))
  }
  return keep === 0 ? 0 : swellAt(look, x, z) * keep
}

/** The square round a pond at (x, z), its widest shore `widest` m out, `past` m more. */
export const pondSquare = (x: number, z: number, widest: number, past: number): Bounds => ({ minX: x - widest - past, maxX: x + widest + past, minZ: z - widest - past, maxZ: z + widest + past })

/** Where the plain's pond is: at (x, z), its widest shore `widest` m out. */
export type PondPlace = Point & { widest: number }

/** The plain's ground at (x, z) as `look` has it: `plain`'s pads flat, and round `pond`. */
const groundOf = (plain: Plain, pond: PondPlace, look: RollingLook) => {
  const pads = padsOf(plain, look)
  const square = pondSquare(pond.x, pond.z, pond.widest, POND_PAD)
  return (x: number, z: number) => rollingAt(look, pads, square, x, z)
}

/** The plain's ground over `box` as a grid, as `look` has it: `plain`'s pads flat, and round `pond`. */
export function rollingGround(plain: Plain, pond: PondPlace, box: Bounds, look: RollingLook = defaultRollingLook()): HeightGrid {
  return new HeightGrid(groundOf(plain, pond, look), box, ROLLING_CELL)
}

/** Lay `grid` again in place as `look` now has the plain's ground; its readers take it up as each is told. */
export function rollAgain(grid: HeightGrid, plain: Plain, pond: PondPlace, look: RollingLook): void {
  const at = groundOf(plain, pond, look)
  for (let j = 0; j < grid.nz; j++) for (let i = 0; i < grid.nx; i++) grid.heights[j * grid.nx + i] = at(grid.minX + i * grid.cell, grid.minZ + j * grid.cell)
}

/**
 * The floor over `grid`, but for the cells inside `hole`: a point at each of
 * the grid's, at its height, its normal off the grid's slope; in a flat
 * plane's own (x, y), up its z, as the floor's plane is laid (pond.ts), a
 * quarter turn about x putting (x, y, h) on the ground at (x, h, -y). Returns
 * the hole as cut, its sides on the grid's lines, for the floor inside it to
 * be laid to.
 */
export function rollingFloor(grid: HeightGrid, hole: Bounds): { geometry: BufferGeometry; cut: Bounds } {
  const { nx, nz, cell, minX, minZ, heights } = grid
  const h = (i: number, j: number) => heights[Math.min(nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))]!
  const positions = new Float32Array(nx * nz * 3)
  const normals = new Float32Array(nx * nz * 3)
  const uvs = new Float32Array(nx * nz * 2)
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      const x = minX + i * cell
      const z = minZ + j * cell
      positions.set([x, -z, h(i, j)], k * 3)
      // The slope's normal on the ground, (-dh/dx, 1, -dh/dz), in the plane's (x, -z, up).
      const dx = (h(i + 1, j) - h(i - 1, j)) / (2 * cell)
      const dz = (h(i, j + 1) - h(i, j - 1)) / (2 * cell)
      const length = Math.hypot(dx, dz, 1)
      normals.set([-dx / length, dz / length, 1 / length], k * 3)
      uvs.set([x, -z], k * 2)
    }
  }
  // The hole on the grid's lines, outward, so the floor laid inside it meets these cells' edges.
  const i0 = Math.max(0, Math.floor((hole.minX - minX) / cell))
  const i1 = Math.min(nx - 1, Math.ceil((hole.maxX - minX) / cell))
  const j0 = Math.max(0, Math.floor((hole.minZ - minZ) / cell))
  const j1 = Math.min(nz - 1, Math.ceil((hole.maxZ - minZ) / cell))
  const indices: number[] = []
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      if (i >= i0 && i < i1 && j >= j0 && j < j1) continue
      const k = j * nx + i
      // Wound to face up the plane's z, as the ground's up once laid.
      indices.push(k, k + nx, k + 1, k + 1, k + nx, k + nx + 1)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  return { geometry, cut: { minX: minX + i0 * cell, maxX: minX + i1 * cell, minZ: minZ + j0 * cell, maxZ: minZ + j1 * cell } }
}
