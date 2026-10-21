// The goose game's plain (#187): a night plain crossed one way, made from a
// seed. The goose starts at its south end with a full torch and heads north,
// up the screen, from brazier to brazier, each a lit flame with one of her
// goslings waiting in its light; past the last is the pond, home. The route
// wanders sideways, each leg at an angle of its own off north, and every gap,
// the start to the first brazier, brazier to brazier and the last to the
// water, is within what a full torch carries at the walking pace, with a
// margin: running out is never the plain's fault. There are no walls.
//
// Scenes (#190) take a brazier's place, in a fixed order, at places the seed
// picks, never the first brazier, so the first light is a plain reunion: the
// well, standing in its brazier's light, the gosling down it in the bucket;
// and the dead tree, standing in its brazier's stead, with no light of its
// own, the gosling up it.
//
// The plain is laid round the arena's centre, so the swarm's arena, which is
// sized to reach the corners of its box, holds the whole route.
//
// The same seed gives the same plain.
import { random, type Bounds } from './swarm'

/** A point on the ground, m. */
export interface Point {
  x: number
  z: number
}

/** A scene in a brazier's place: the well beside it, or the dead tree in its stead. */
export type Scene = 'well' | 'tree'

/**
 * A brazier: where it stands, how far its light reaches, m, and where its
 * gosling waits in it; or, with a `scene`, the scene's place: at the well, its
 * gosling is down it, the well where the gosling is; at the dead tree, which
 * stands where the brazier would and lights nothing until lit, up the tree.
 */
export interface Brazier extends Point {
  reach: number
  gosling: Point
  scene?: Scene
}

/** The pond: water no rat enters, round (x, z), `radius` m. */
export interface Pond extends Point {
  radius: number
}

/** The seed's plain, as the goose play and the page both read it. */
export interface Plain {
  /** Where the goose starts. */
  start: Point
  /** The braziers, in the order the route passes them: 6 or 7. */
  braziers: Brazier[]
  pond: Pond
  /** Where in the pond the goose is home, WADE into the water: walking this far in ends the run. */
  home: Point
  /** The box the route lies in, and the rats with it. */
  bounds: Bounds
}

/** What a full torch carries: the share of it that burns a second, and the walking pace, m/s. */
export interface TorchWalk {
  burnRate: number
  pace: number
}

/** The shortest and longest gap, as a share of a full torch's walk: the longest leaves two fifths of the torch in hand. */
const LEAST_GAP = 0.4
const MOST_GAP = 0.6
/** How far each leg turns off north at the most, radians, and how far east or west of the start the route strays, m. */
const WANDER = 0.45
const SIDEWAYS = 14
/** How far a brazier's light reaches, m; and how far from it its gosling waits. */
export const BRAZIER_REACH = 3
const GOSLING_WAITS = 1.3
/**
 * The scenes, in the order the route meets them; and how far from its brazier
 * the well stands, m: wherever she winches from, out of the brazier's dip and
 * inside its light (gooseplay.ts, WELL_REACH).
 */
const SCENES: readonly Scene[] = ['well', 'tree']
const WELL_STANDS = 1.9
/** The pond's radius, m, and how far past its edge the goose is home, m. */
const POND_RADIUS = 5
export const WADE = 0.6
/** How far past the route the box reaches, m: round the pond, and either side of the braziers. */
const MARGIN = 12

/** The plain of `seed`, its gaps sized to what a full torch carries at `walk`'s pace. */
export function plain(seed: number, walk: TorchWalk): Plain {
  const next = random(seed)
  const full = walk.pace / walk.burnRate
  const gap = () => full * (LEAST_GAP + (MOST_GAP - LEAST_GAP) * next())
  const count = next() < 0.5 ? 6 : 7
  /** A leg's way, off north by a seeded angle, turned back toward the middle where the route has strayed. */
  const way = (from: Point) => {
    const lean = Math.max(-1, Math.min(1, from.x / SIDEWAYS))
    const angle = (next() * 2 - 1) * WANDER - lean * WANDER
    return { x: Math.sin(angle), z: -Math.cos(angle) }
  }
  const start = { x: 0, z: 0 }
  const braziers: Brazier[] = []
  let at: Point = start
  for (let k = 0; k < count; k++) {
    const u = way(at)
    const g = gap()
    at = { x: at.x + u.x * g, z: at.z + u.z * g }
    const a = next() * Math.PI * 2
    braziers.push({ ...at, reach: BRAZIER_REACH, gosling: { x: at.x + Math.cos(a) * GOSLING_WAITS, z: at.z + Math.sin(a) * GOSLING_WAITS } })
  }
  const u = way(at)
  const g = gap()
  const home = { x: at.x + u.x * g, z: at.z + u.z * g }
  const pond = { x: home.x + u.x * (POND_RADIUS - WADE), z: home.z + u.z * (POND_RADIUS - WADE), radius: POND_RADIUS }
  // The scenes' places, after the first brazier, in the route's order: the well's gosling down it, the tree's up it.
  const free = braziers.slice(1)
  const places = SCENES.map(() => free.splice(Math.floor(next() * free.length), 1)[0]!)
  places.sort((a, b) => braziers.indexOf(a) - braziers.indexOf(b))
  places.forEach((b, i) => {
    b.scene = SCENES[i]!
    const s = b.scene === 'well' ? WELL_STANDS / GOSLING_WAITS : 0
    b.gosling = { x: b.x + (b.gosling.x - b.x) * s, z: b.z + (b.gosling.z - b.z) * s }
  })
  // Laid round the arena's centre.
  const xs = [start.x, ...braziers.map((b) => b.x), pond.x - POND_RADIUS, pond.x + POND_RADIUS]
  const zs = [start.z, ...braziers.map((b) => b.z), pond.z - POND_RADIUS]
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2
  const shift = <T extends Point>(p: T): T => ({ ...p, x: p.x - cx, z: p.z - cz })
  return {
    start: shift(start),
    braziers: braziers.map((b) => ({ ...shift(b), gosling: shift(b.gosling) })),
    pond: shift(pond),
    home: shift(home),
    bounds: {
      minX: Math.min(...xs) - cx - MARGIN,
      maxX: Math.max(...xs) - cx + MARGIN,
      minZ: Math.min(...zs) - cz - MARGIN,
      maxZ: Math.max(...zs) - cz + MARGIN,
    },
  }
}
