// The goose game's pond, drawn: a hollow in the floor inside a wandering
// shore, the floor's own grass running down its bank to a bed under still
// water. The shore strays in and out of the pond's radius by Perlin noise read
// round a circle, so it closes on itself, a different stretch of the noise for
// each seed (plain.ts). The floor is laid with the shore cut out of it
// (`floorAround`), and the bank falls from the shore smoothly, level with the
// floor where they meet, so no edge shows; the water lies flat across it.
// The water is its own mesh, from the waterline in, each of its points
// knowing how far it is from the shore across the water (`FROM_SHORE`), for
// the water's shore line and waves (water.ts) to be drawn by.
// The pond folder edits its look (`PondLook`), and every change lays the
// floor, the bank and the water again, which takes a millisecond or two.
// The water's own look is water.ts's.
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, Path, Shape, ShapeGeometry, Vector2, type Material } from 'three/webgpu'
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { HeightGrid } from './heights'
import type { Point, Pond } from './plain'
import { POND_PAD, ROLLING_CELL, pondSquare, rollingFloor } from './rolling'
import type { Bounds } from './swarm'

/** What the pond folder edits. */
export interface PondLook {
  /** Where its middle is, m. */
  x: number
  z: number
  /** How far its shore is from the middle on the whole, m: it wanders in and out of this. */
  radius: number
  /** How far the shore wanders in and out, as a share of the radius: 0 a circle. */
  stray: number
  /** How many bays and points round the shore: 1 as drawn, more a busier shore. */
  bays: number
  /** Which stretch of the noise the shore is read from, 0 to 1: each its own shore. */
  shore: number
  /** How deep the bed lies under the floor, m. */
  depth: number
  /** How far in from the shore the bank reaches the bed, as a share of the way to the middle: small a gentle bank, large a steep one. */
  bank: number
  /** The water's level, m: under the floor, so the bank shows above it. */
  water: number
  /** How the goose and her goslings take to it; and how fast she swims, a share of her walking pace. */
  goose: Afloat & { pace: number }
  gosling: Afloat
}

/**
 * How a bird takes to the water: how deep it wades before it floats, m, about its legs' length; and how high it
 * floats, m, where its feet would be on land, from the water's surface. Its swim clips sink its body to where it
 * floats as modelled, so 0 is as its file has it, less sits it deeper, more higher.
 */
export interface Afloat {
  wade: number
  height: number
}

/** How many points the shore is drawn with, round the pond: enough that its bays never show a corner. */
export const SEGMENTS = 512
/** The least and most of the radius the shore reaches, however far it strays: it never closes on the middle. */
export const NEAREST = 0.25
export const FURTHEST = 2
/**
 * The noise's octaves: how wide a circle each reads in the noise, the wider
 * the more bays and points round the shore, and how much each counts.
 */
const OCTAVES = [
  { width: 0.9, weight: 1 },
  { width: 2.2, weight: 0.45 },
  { width: 4.6, weight: 0.2 },
]
/** How far apart each seed's stretch of the noise is, and each octave's, so neither repeats another. */
const SEED_STRIDE = 10
const OCTAVE_STRIDE = 17.3
/** How many rings the bank and the water are drawn with, from the shore in to the middle, closest at the shore. */
const RINGS = 40
/** The water's attribute: how far each point is from the shore across the water, m, less than 0 under the bank. */
export const FROM_SHORE = 'fromShore'
/** How far past the waterline the water runs under the bank, as a share of the way out: so no gap shows at its edge. */
const UNDER_BANK = 0.02

/** The rings' shares of the way out, from 1 at the shore to the last before the middle: closest together at the shore. */
const ringShares = Array.from({ length: RINGS }, (_, k) => 1 - (k / RINGS) ** 2)

/**
 * The look of `pond`, at its place, on the seed's own stretch of the shore's noise, as set from the panel on
 * 2026-10-21: a wide pond, its shore wandering half its 14 m radius in long bays, its bed 2.8 m down a steep bank,
 * the water 0.31 m under the floor; the goose and her goslings a little low in it.
 */
export function defaultPondLook(pond: Pond): PondLook {
  return {
    x: pond.x,
    z: pond.z,
    radius: 14.1,
    stray: 0.5,
    bays: 0.64,
    shore: pond.shore,
    depth: 2.76,
    bank: 0.29,
    water: -0.31,
    goose: { wade: 0.25, height: -0.02, pace: 0.7 },
    gosling: { wade: 0.06, height: -0.015 },
  }
}

const noise = new ImprovedNoise()

/** How far the shore of `look` is from its middle `angle` radians round from +x toward +z, m. */
export function shoreAt(look: PondLook, angle: number): number {
  let n = 0
  OCTAVES.forEach(({ width, weight }, k) => {
    const w = width * look.bays
    n += weight * noise.noise(Math.cos(angle) * w, Math.sin(angle) * w, look.shore * SEED_STRIDE + k * OCTAVE_STRIDE)
  })
  return look.radius * Math.min(FURTHEST, Math.max(NEAREST, 1 + look.stray * n))
}

/** The shore of `look`, SEGMENTS points round it from +x toward +z, the last joining back to the first. */
export function shoreline(look: PondLook): Point[] {
  return Array.from({ length: SEGMENTS }, (_, j) => {
    const angle = (j / SEGMENTS) * Math.PI * 2
    const r = shoreAt(look, angle)
    return { x: look.x + Math.cos(angle) * r, z: look.z + Math.sin(angle) * r }
  })
}

/** How high the ground of `look` is at (x, z), m: the floor's 0 outside the shore, the bank's height inside it. */
export function groundOf(look: PondLook, x: number, z: number): number {
  const dx = x - look.x
  const dz = z - look.z
  const s = Math.hypot(dx, dz) / shoreAt(look, Math.atan2(dz, dx))
  return s >= 1 ? 0 : bankHeight(look, s)
}

/** How far into the depth it wades a bird starts to float, as a share of it: it takes to the water from there to all of it. */
const TAKES_TO = 0.6

/**
 * How far a bird at (x, z) is swimming, 0 to 1: 0 on the ground or wading in the shallows, 1 afloat, rising smoothly
 * as the water nears the depth it wades to, so it takes to the water as its feet leave the bed.
 */
export function swimmingIn(look: PondLook, x: number, z: number, bird: Afloat): number {
  const wade = Math.max(0.001, bird.wade)
  const t = Math.min(1, Math.max(0, (look.water - groundOf(look, x, z) - wade * TAKES_TO) / (wade * (1 - TAKES_TO))))
  return t * t * (3 - 2 * t)
}

/**
 * Where a bird stands at (x, z), m: on the ground, down the bank and into the water, and afloat at its height over
 * the surface once out of its depth, the two blended as it takes to the water.
 */
export function standingIn(look: PondLook, x: number, z: number, bird: Afloat): number {
  const ground = groundOf(look, x, z)
  return ground + (look.water + bird.height - ground) * swimmingIn(look, x, z, bird)
}

/** The bank's height `s` of the way out from the middle to the shore, m: the bed's depth, rising smoothly to the floor's level at the shore. */
export function bankHeight(look: PondLook, s: number): number {
  const t = Math.min(1, Math.max(0, (1 - s) / Math.max(0.01, look.bank)))
  return -look.depth * t * t * (3 - 2 * t)
}

/** How far the shore of `look` is from its middle at its widest, m. */
export const widestShore = (look: PondLook): number => Math.max(...shoreline(look).map((p) => Math.hypot(p.x - look.x, p.z - look.z)))

/** The shore of `look` in a flat plane's own (x, y), as the floor's plane draws the ground's (x, -z). */
const inPlane = (look: PondLook) => shoreline(look).map(({ x, z }) => new Vector2(x, -z))

/**
 * The floor over `box`, flat, with the shore of `look` cut out: drawn in its
 * plane, to be turned flat as the floor's plane is, a quarter turn about x, so
 * its (x, y) lies on the ground at (x, -y).
 */
export function floorAround(box: Bounds, look: PondLook): ShapeGeometry {
  const outline = new Shape()
  outline.moveTo(box.minX, -box.maxZ)
  outline.lineTo(box.maxX, -box.maxZ)
  outline.lineTo(box.maxX, -box.minZ)
  outline.lineTo(box.minX, -box.minZ)
  outline.closePath()
  outline.holes.push(new Path(inPlane(look)))
  return new ShapeGeometry(outline)
}

/**
 * The floor over the plain's rolling ground `rolling` (rolling.ts) with the
 * shore of `look` cut out: the grid's floor but for a square round the pond,
 * inside the ground's flat pad round it, and in the square the flat floor
 * round the shore, as `floorAround` lays it, meeting the grid's cells at the
 * square's sides.
 */
export function rollingFloorAround(rolling: HeightGrid, look: PondLook): BufferGeometry {
  const { geometry, cut } = rollingFloor(rolling, pondSquare(look.x, look.z, widestShore(look), POND_PAD - ROLLING_CELL))
  const flat = floorAround(cut, look)
  const floor = mergeGeometries([geometry, flat])
  geometry.dispose()
  flat.dispose()
  return floor
}

/** How far out the waterline of `look` is, as a share of the way to the shore: where the bank falls to the water. */
export function waterline(look: PondLook): number {
  if (look.water >= 0) return 1
  if (look.water <= -look.depth) return 0
  // The bank falls all the way in, so the halving closes on the one share it meets the water at.
  let inside = 0
  let outside = 1
  for (let k = 0; k < 40; k++) {
    const s = (inside + outside) / 2
    if (bankHeight(look, s) < look.water) inside = s
    else outside = s
  }
  return (inside + outside) / 2
}

/**
 * Rings round the middle of `look` at the `shares` of the way out to the
 * shore, each at its height, the last joined to
 * a single point in the middle; wound to face up.
 */
function ringed(look: PondLook, shares: readonly number[], height: (s: number) => number, middleHeight: number): BufferGeometry {
  const shore = shoreline(look)
  const positions: number[] = []
  for (const s of shares) {
    const y = height(s)
    for (const p of shore) positions.push(look.x + (p.x - look.x) * s, y, look.z + (p.z - look.z) * s)
  }
  const middle = shares.length * SEGMENTS
  positions.push(look.x, middleHeight, look.z)
  const indices: number[] = []
  for (let k = 0; k < shares.length; k++) {
    for (let j = 0; j < SEGMENTS; j++) {
      const next = (j + 1) % SEGMENTS
      const outer = k * SEGMENTS
      if (k === shares.length - 1) {
        indices.push(outer + j, middle, outer + next)
      } else {
        const inner = outer + SEGMENTS
        indices.push(outer + j, inner + j, outer + next, outer + next, inner + j, inner + next)
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** The bank of `look` in the world: rings from the shore in to its middle, the last a single point on the bed. */
export function bankGeometry(look: PondLook): BufferGeometry {
  return ringed(look, ringShares, (s) => bankHeight(look, s), bankHeight(look, 0))
}

/**
 * The water of `look`, flat at its level, from a little under the bank in to
 * the middle, closest together at the waterline; each point with how far it
 * is from the shore across the water, m (`FROM_SHORE`): out from the middle,
 * the way to the waterline, by the shore's own distance there. Empty where
 * the pond is dry.
 */
export function waterGeometry(look: PondLook): BufferGeometry {
  const line = waterline(look)
  if (line <= 0) return new BufferGeometry()
  const edge = Math.min(1, line + UNDER_BANK)
  const shares = ringShares.map((s) => s * edge)
  const geometry = ringed(look, shares, () => look.water, look.water)
  const radii = Array.from({ length: SEGMENTS }, (_, j) => shoreAt(look, (j / SEGMENTS) * Math.PI * 2))
  const distances: number[] = []
  for (const s of shares) for (const r of radii) distances.push((line - s) * r)
  // The middle: as far from the shore as the nearest point of it.
  distances.push(line * Math.min(...radii))
  geometry.setAttribute(FROM_SHORE, new Float32BufferAttribute(distances, 1))
  return geometry
}

/** How many texels a side the shore's distance field has. */
export const SHORE_FIELD = 192
/** How far past the shore the field reaches, m, and the most it holds either way: further than any beach reaches. */
export const SHORE_REACH = 12

/** How far each point of a square round the pond is from its shore, m, more than 0 outside, less inside. */
export interface ShoreField {
  /** SHORE_FIELD x SHORE_FIELD distances, a row a step in z from `minZ`, each a step in x from `minX`, at texel middles. */
  data: Float32Array
  minX: number
  minZ: number
  /** How wide the square is, m. */
  size: number
}

/**
 * The shore of `look` as a field of distances, for the floor to fade into its bed out past the shore by (ground.ts):
 * each the way out from the middle past the shore there, which is near enough the way to it for a fade, held within
 * SHORE_REACH either way.
 */
export function shoreField(look: PondLook): ShoreField {
  const size = 2 * (look.radius * FURTHEST + SHORE_REACH)
  const minX = look.x - size / 2
  const minZ = look.z - size / 2
  const step = size / SHORE_FIELD
  const data = new Float32Array(SHORE_FIELD * SHORE_FIELD)
  for (let j = 0; j < SHORE_FIELD; j++) {
    for (let i = 0; i < SHORE_FIELD; i++) {
      const dx = minX + (i + 0.5) * step - look.x
      const dz = minZ + (j + 0.5) * step - look.z
      const past = Math.hypot(dx, dz) - shoreAt(look, Math.atan2(dz, dx))
      data[j * SHORE_FIELD + i] = Math.min(SHORE_REACH, Math.max(-SHORE_REACH, past))
    }
  }
  return { data, minX, minZ, size }
}

export interface PondMesh {
  object: Group
  /** Lay the floor, the bank and the water again to `look`. */
  set(look: PondLook): void
}

/**
 * The pond: the floor `ground` laid over `box` round its shore, its bank in the floor's own material, and its water
 * in `water`; its shore's distances handed to `shore` each time it is laid, for the floor's beach. On `rolling`
 * ground, the floor is laid over the grid's box instead, rolling but round the pond.
 */
export function createPond(ground: Mesh, box: Bounds, look: PondLook, water: Material, shore: (field: ShoreField) => void = () => {}, rolling?: HeightGrid): PondMesh {
  const bank = new Mesh(undefined, ground.material)
  bank.receiveShadow = true
  const surface = new Mesh(undefined, water)
  surface.receiveShadow = true
  const laid = (mesh: Mesh, geometry: BufferGeometry) => {
    mesh.geometry.dispose()
    mesh.geometry = geometry
  }
  const pond = {
    object: new Group().add(bank, surface),
    set(look: PondLook) {
      laid(ground, rolling ? rollingFloorAround(rolling, look) : floorAround(box, look))
      laid(bank, bankGeometry(look))
      laid(surface, waterGeometry(look))
      shore(shoreField(look))
    },
  }
  ground.position.set(0, 0, 0)
  pond.set(look)
  return pond
}
