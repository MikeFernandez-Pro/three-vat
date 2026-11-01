// The goose game's plain (#187): a night plain crossed one way, laid by hand
// (gooseroute.json, placed on the 2D page, goose2d.html). The goose starts at
// its south end with a full torch, or, the start `unlit`, with it out, to
// light at the first brazier, and heads north, up the screen, from brazier to
// brazier, each a lit flame with one of her goslings waiting in its light; a
// little past the last is the pond, home. There are no walls.
//
// A brazier may have no gosling, a fire alone, as the one she starts by.
//
// A searching gosling waits at the edge of its brazier's light, looking out
// into the dark for her.
//
// Scenes (#190) take a brazier's place: the well, its lantern the light, the
// gosling down it in the bucket; the dead tree, standing in its brazier's
// stead with no light of its own, the gosling up it. Then (#191) the cage, in
// its brazier's light, the gosling in it, and the skull its key lies by a few
// metres off in the dark.
//
// A dying light is a brazier the route's script puts out: it starts dying a
// while after she first comes near it, its light shrinking to nothing, its
// gosling left in the dark.
//
// The braziers are met in the order they lie up the plain, the furthest south
// first, wherever the route lists them.
import type { Bounds } from './swarm'
import saved from './gooseroute.json'

/** A point on the ground, m. */
export interface Point {
  x: number
  z: number
}

/** A scene in a brazier's place: the well beside it, the dead tree in its stead, or the cage in its light. */
export type Scene = 'well' | 'tree' | 'cage'

/**
 * A dying light's script: once she first comes within `trigger` m of it, it
 * burns on `after` s, then its light shrinks to nothing over `lasts` s and is
 * out.
 */
export interface Dying {
  trigger: number
  after: number
  lasts: number
}

/**
 * A brazier: where it stands, how far its light reaches, m, and where its
 * gosling waits in it, if one does: none, a fire alone; or, with a `scene`, the scene's place: at the well, its
 * gosling is down it, the well where the gosling is, the brazier's place unlit
 * where its lantern stood, its fire pit at `fire`, or across it from that place
 * (gooseplay.ts, WELL_FIRE) with none; at the dead tree, which stands where the brazier would and lights
 * nothing until lit, up the tree, the brazier by it at `fire`, or where the
 * tree's file has it (TREE_FIRE) with none; at the cage, in it, the brazier's
 * place its campfire's, its key by the `skull`, and its cart's middle at
 * `cart`, or where the cage's file has it with none. With `dying`, its flame dies by that script. With
 * `searching`, its gosling paces the edge of its light round where it waits,
 * looking out into the dark, until she comes near it.
 * `turn`, degrees about the ground's up, from +z toward +x: how far the well,
 * the dead tree or the cage's set is turned, as the 3D page's edit mode turns
 * it; none, as each stands by default. `drawn`, how its pieces are drawn off their places, as the edit mode raises and
 * sizes them; none, each where and as big as the play has it.
 */
export interface Brazier extends Point {
  reach: number
  gosling?: Point
  scene?: Scene
  turn?: number
  skull?: Point
  fire?: Point
  cart?: Point
  dying?: Dying
  searching?: boolean
  drawn?: Partial<Record<ShownPiece, Shown>>
}

/** A brazier's pieces the edit mode raises and sizes: its scene's own (the well, the dead tree, the cage), its fire, the cage's cart and dead body, its gosling. */
export type ShownPiece = 'scene' | 'fire' | 'cart' | 'body' | 'gosling'

/** How a piece is drawn off its place: `y` m up, `size` times as big, about its own place; only drawn so, the play's places as they are. */
export interface Shown {
  y: number
  size: number
}

/** Where she starts; `unlit`, with her torch out. */
export interface Start extends Point {
  unlit?: boolean
}

/** The pond: water no rat enters, round (x, z), `radius` m; `shore`, from 0 to 1, the turn of its wandering shore (pond.ts). */
export interface Pond extends Point {
  radius: number
  shore: number
}

/** The route as laid by hand: where she starts, the braziers, in any order, the pond, and the old road's points, in its order (road.ts), if laid by hand. */
export interface Route {
  start: Start
  braziers: Brazier[]
  pond: Pond
  road?: Point[]
}

/** The plain as the goose play and the page both read it. */
export interface Plain extends Route {
  /** The braziers, in the order she meets them going up the plain. */
  braziers: Brazier[]
  /** Where in the pond the goose is home, WADE into the water, on the side toward the last brazier. */
  home: Point
  /** The box the route lies in, and the rats with it. */
  bounds: Bounds
}

/** How far a brazier's light reaches, m. */
export const BRAZIER_REACH = 3
/** How far past the pond's edge the goose is home, m. */
export const WADE = 0.6
/** How far past the route the box reaches, m: round the pond, and either side of the braziers. */
const MARGIN = 12

/** The route as last saved from the 2D page. */
const SAVED = saved as Route

/**
 * The spawn's brazier: the brazier she starts by, with no scene and no
 * gosling, and her torch out to light at it. Set false, the game plays the
 * saved route without it, her torch lit, and any route saved has it put back
 * (`toSave`), so the file keeps it.
 */
const SPAWN_BRAZIER = true
/** Whether `b` is the spawn's brazier: no scene, no gosling, and `start` in its light. */
const atSpawn = (b: Brazier, start: Point) => b.scene === undefined && b.gosling === undefined && Math.hypot(b.x - start.x, b.z - start.z) < b.reach

/** The route the game plays: as saved, but for the spawn's brazier while it is off. */
export const ROUTE: Route = SPAWN_BRAZIER ? SAVED : { ...SAVED, start: { x: SAVED.start.x, z: SAVED.start.z }, braziers: SAVED.braziers.filter((b) => !atSpawn(b, SAVED.start)) }

/** `route` as it is saved: with the spawn's brazier and her unlit torch put back while it is off. */
export function toSave(route: Route): Route {
  const braziers = route.braziers.map(drawnAsSaved)
  if (SPAWN_BRAZIER) return { ...route, braziers }
  return { ...route, start: { ...route.start, unlit: SAVED.start.unlit }, braziers: [...SAVED.braziers.filter((b) => atSpawn(b, SAVED.start)), ...braziers] }
}

/** A piece drawn where and as big as the play has it. */
const UNMOVED: Readonly<Shown> = Object.freeze({ y: 0, size: 1 })

/** How `b`'s `piece` is drawn off its place. */
export function shownOf(b: Brazier | undefined, piece: ShownPiece): Readonly<Shown> {
  return b?.drawn?.[piece] ?? UNMOVED
}

/** How `b`'s `piece` is drawn off its place, laid into `b` if it is not yet, for the edit mode to change. */
export function keptShown(b: Brazier, piece: ShownPiece): Shown {
  return ((b.drawn ??= {})[piece] ??= { ...UNMOVED })
}

/** `b` as saved: its pieces drawn off their places to the millimetre and the hundredth, those drawn as played left out, and `drawn` with them if all are. */
function drawnAsSaved(b: Brazier): Brazier {
  const round = (v: number, by: number) => Math.round(v * by) / by
  const off = Object.entries(b.drawn ?? {})
    .map(([piece, { y, size }]) => [piece, { y: round(y, 1000), size: round(size, 100) }] as const)
    .filter(([, { y, size }]) => y !== 0 || size !== 1)
  const saved = { ...b }
  delete saved.drawn
  if (off.length > 0) saved.drawn = Object.fromEntries(off)
  return saved
}

/** `route` as the play reads it: its braziers in the order she meets them, home on the pond's near side, and its box. */
export function laid(route: Route): Plain {
  const { start, pond, road } = structuredClone(route)
  const braziers = structuredClone(route.braziers).sort((a, b) => b.z - a.z)
  const last = braziers.at(-1) ?? start
  const away = Math.hypot(pond.x - last.x, pond.z - last.z) || 1
  const reach = pond.radius - WADE
  const home = { x: pond.x - ((pond.x - last.x) / away) * reach, z: pond.z - ((pond.z - last.z) / away) * reach }
  const points = [start, ...(road ?? []), ...braziers.flatMap((b) => [b, ...[b.gosling, b.skull, b.fire, b.cart].filter((p) => p !== undefined)])]
  const xs = [...points.map((p) => p.x), pond.x - pond.radius, pond.x + pond.radius]
  const zs = [...points.map((p) => p.z), pond.z - pond.radius, pond.z + pond.radius]
  return {
    start,
    braziers,
    pond,
    ...(road ? { road } : {}),
    home,
    bounds: { minX: Math.min(...xs) - MARGIN, maxX: Math.max(...xs) + MARGIN, minZ: Math.min(...zs) - MARGIN, maxZ: Math.max(...zs) + MARGIN },
  }
}
