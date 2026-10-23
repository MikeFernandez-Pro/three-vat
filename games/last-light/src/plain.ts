// The goose game's plain (#187): a night plain crossed one way, made from a
// seed. The goose starts at its south end with a full torch and heads north,
// up the screen, from brazier to brazier, each a lit flame with one of her
// goslings waiting in its light; past the last is the pond, home. The route
// wanders sideways, each leg at an angle of its own off north, and every gap,
// the start to the first brazier, brazier to brazier and the last to the
// water, is within what a full torch carries at the walking pace, with a
// margin: running out is never the plain's fault. There are no walls.
//
// Scenes (#190) take a brazier's place: the well the first, its lantern the
// first light she makes for, the gosling down it in the bucket; and the dead
// tree the second, standing in its brazier's stead, with no light of its own,
// the gosling up it. Then (#191) the cage the third, in its brazier's light,
// the gosling in it, and the skull its key lies on a few metres off in the
// dark, on the far side of the light from the cage; and the hollow log the
// fourth, beside its brazier in its light, lying along the way she came, its
// near end toward her, the gosling deep in it.
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

/** A scene in a brazier's place: the well beside it, the dead tree in its stead, the cage in its light, or the hollow log beside it. */
export type Scene = 'well' | 'tree' | 'cage' | 'log'

/** The hollow log: its near end, where she puts the torch to it, and its far end, where the rats and its gosling come out. */
export interface Log {
  near: Point
  far: Point
}

/**
 * A brazier: where it stands, how far its light reaches, m, and where its
 * gosling waits in it; or, with a `scene`, the scene's place: at the well, its
 * gosling is down it, the well where the gosling is; at the dead tree, which
 * stands where the brazier would and lights nothing until lit, up the tree;
 * at the cage, in it, its key on the `skull`; at the hollow log, deep in the
 * `log`, in its middle.
 */
export interface Brazier extends Point {
  reach: number
  gosling: Point
  scene?: Scene
  skull?: Point
  log?: Log
}

/** The pond: water no rat enters, round (x, z), `radius` m; `shore`, from 0 to 1, the seed's turn of its wandering shore (pond.ts). */
export interface Pond extends Point {
  radius: number
  shore: number
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
 * How far from its brazier the cage stands, m, out of its dip; how far the
 * skull lies from it, m, past its light; how far to the side of it the hollow
 * log lies, m, and how far each of its ends is from its middle, m.
 */
const CAGE_STANDS = 2
const SKULL_OUT = BRAZIER_REACH + 2.5
const LOG_SIDE = 1.7
const LOG_HALF = 1.56
/**
 * Where the well's lantern
 * hangs from the well's middle, m, as the page stands the well, side on to the
 * plain's way (goosescenes.ts). The lantern is the well's light, in its
 * brazier's place, so the well stands that far off its brazier the other way:
 * in its light, and wherever she winches from, out of its dip (gooseplay.ts,
 * WELL_REACH).
 */
export const WELL_LANTERN: Point = { x: -1.2, z: 1.9 }
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
  /** The way each leg runs, into each brazier. */
  const ways: Point[] = []
  let at: Point = start
  for (let k = 0; k < count; k++) {
    const u = way(at)
    ways.push(u)
    const g = gap()
    at = { x: at.x + u.x * g, z: at.z + u.z * g }
    const a = next() * Math.PI * 2
    braziers.push({ ...at, reach: BRAZIER_REACH, gosling: { x: at.x + Math.cos(a) * GOSLING_WAITS, z: at.z + Math.sin(a) * GOSLING_WAITS } })
  }
  const u = way(at)
  const g = gap()
  const home = { x: at.x + u.x * g, z: at.z + u.z * g }
  const pond = { x: home.x + u.x * (POND_RADIUS - WADE), z: home.z + u.z * (POND_RADIUS - WADE), radius: POND_RADIUS, shore: next() }
  // The scenes' places: the well at the first brazier, its gosling down it; the tree at the second, its gosling up it.
  const well = braziers[0]!
  well.scene = 'well'
  well.gosling = { x: well.x - WELL_LANTERN.x, z: well.z - WELL_LANTERN.z }
  const tree = braziers[1]!
  tree.scene = 'tree'
  tree.gosling = { x: tree.x, z: tree.z }
  // The cage where the third brazier's gosling would wait, further out; its skull to the side of the way, across the light from it.
  const cage = braziers[2]!
  const right = (k: number) => ({ x: -ways[k]!.z, z: ways[k]!.x })
  const sideOf = (b: Brazier, k: number) => ((b.gosling.x - b.x) * right(k).x + (b.gosling.z - b.z) * right(k).z >= 0 ? 1 : -1)
  const out = (b: Brazier, by: number) => ({ x: b.x + ((b.gosling.x - b.x) / GOSLING_WAITS) * by, z: b.z + ((b.gosling.z - b.z) / GOSLING_WAITS) * by })
  const skullSide = -sideOf(cage, 2)
  cage.skull = { x: cage.x + right(2).x * skullSide * SKULL_OUT, z: cage.z + right(2).z * skullSide * SKULL_OUT }
  cage.gosling = out(cage, CAGE_STANDS)
  cage.scene = 'cage'
  // The log beside the fourth, on its gosling's side, along the leg into it.
  const log = braziers[3]!
  const along = ways[3]!
  const logSide = sideOf(log, 3)
  const middle = { x: log.x + right(3).x * logSide * LOG_SIDE, z: log.z + right(3).z * logSide * LOG_SIDE }
  log.log = { near: { x: middle.x - along.x * LOG_HALF, z: middle.z - along.z * LOG_HALF }, far: { x: middle.x + along.x * LOG_HALF, z: middle.z + along.z * LOG_HALF } }
  log.gosling = middle
  log.scene = 'log'
  // Laid round the arena's centre.
  const xs = [start.x, ...braziers.map((b) => b.x), pond.x - POND_RADIUS, pond.x + POND_RADIUS]
  const zs = [start.z, ...braziers.map((b) => b.z), pond.z - POND_RADIUS]
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2
  const shift = <T extends Point>(p: T): T => ({ ...p, x: p.x - cx, z: p.z - cz })
  return {
    start: shift(start),
    braziers: braziers.map((b) => ({
      ...shift(b),
      gosling: shift(b.gosling),
      ...(b.skull && { skull: shift(b.skull) }),
      ...(b.log && { log: { near: shift(b.log.near), far: shift(b.log.far) } }),
    })),
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
