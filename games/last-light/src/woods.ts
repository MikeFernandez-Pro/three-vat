// The woods: the new level (design/level.html), as data, beats 1 to 4, and the
// last, 6. One level for every page: the play step (play.ts) plays it, and the
// 2D page (twod.prototype.ts) and the tests build it from here.
//
// The burning tree: a clearing in the woods ringed with bushes, the child by
// its big tree, the cracked tree eleven metres off at the mouth of the only gap
// north, between two rocks, and a dark gully east that leads nowhere. Lost: an
// open wood north of the gap, a wide low thicket filling its west side from
// the gap's west rock to the treeline, so the gap opens only north-east, and the
// way round it east through the open wood, past a rock either side, to the
// estate wall at the wood's north end. Glowing mushrooms along the way round,
// faint in the dark, are on trial.
//
// The estate gate: the manor's estate wall, stone, runs across the level and
// into the forest both ways. The road goes through it by a barred gate,
// locked, in the wood's north-east corner. The gamekeeper lit a torch either
// side of it, outside, on his round: what the way through the wood makes for,
// the first arrival at the last second, and the safe place to light the torch
// again while searching for the key; and a torch under its arch, holding the
// gate's width from inside, so no rat comes through the bars. The bars stop
// the child, never the rats or the light. The gamekeeper lies 11 m along the
// wall, in the dark between bushes, among waiting rats, the key on him: seen
// only once a light reaches him. Opened, the gate stays open.
//
// The bridge: through the gate a short bank, and a river runs the level's
// full width; the bridge, 3 m wide and 7 m long, is its only crossing,
// straight on from the gate. A cart stands on it, its back at the south end,
// as wide as the deck lets it be, its brazier burning: the gate's torch and
// its light just touch, and it covers the child pushing it. Pushed, it rolls
// north off the far end and jams against the bottom step, where the road
// starts up the hill. Rats wait thick where the bridge lands. As it jams the
// storm breaks: the rain puts the stick out at once, then the cart's fire as
// the child steps round it, then the braziers. The cart and the rain are the
// run's (run.ts), as the jammed cart's checkpoint is.
//
// The climb: the road goes up the wooded hill as stone steps, a brazier at the
// foot and at each turn, lit by the gamekeeper at dusk and burned low since,
// close enough that their light always touches. The rain drowns them one after
// the other: each goes out just as the child leaves it, so there is a moment of
// dark before the next one's light, and the way back is dark. One gutters out
// as he comes up to it instead, leaving a metre of dark to cross. The ravine is
// thick with rats under the pine. The braziers are the only way on, the forest
// either side the rats' dark. At the top, the ravine: the road's footbridge
// was smashed by a pine the storm blew down, which now lies across it, the
// only way over; on it the child is out of the rats' reach, and slow: the
// run's no-catch zone. From the hilltop, the manor is seen. Past the pine the
// rain stops, and a brazier on the far side lights the stick again: a
// checkpoint zone.
//
// Last light: past the far brazier the road goes on as a forest path, winding
// down through the wood to the manor, the trees thick either side. Small
// whitewashed posts mark it, a carved lantern set on each for the feast, every
// one drowned by the rain; only those on the manor's steps still burn, under
// the porch. The storm brought a big tree down across the path, its crown a
// tangle of broken branches propped at crawling height over four metres of
// it, and the wood leaves no way round. The path comes out onto the lawn at
// the foot of the steps, and the door stands ajar. The stick caught again at
// the far brazier is damp, so it burns short, and it gutters out a few metres
// short of the fallen tree, and the child runs for the steps' light, the far
// side's rats on his heels.
//
// The rats are set down at spawn spots: inside the bushes and the thicket,
// where nothing shows them, each woken when the child comes near it. Some wait
// from the start: in two bushes either side of the walk to the trunk, in the
// dark of the gap past the trunk, and at the gap's way out, still until the
// child comes within their notice.
//
// The run's rules (run.ts) take these places: under the cracked tree once it
// is down, and under the tangle, passed only crawling; the checkpoints in the
// wood, the clearing and the gate's torches, where a catch starts the run
// again once the stick has caught; and past the pine, where the stick is damp
// and burns short, the place on the path where it gutters out, and the dark
// run its going out sets off.
//
// The ground's height (heights.ts) is written as a few shapes: the play is
// flat, and only the drawing climbs them. The river's bed is sunk, the bridge
// level over it. North of the river the ground rises up the hill to the
// hilltop and stays up over the far side, and comes down along the forest
// path to the lawn; the ravine is cut into it, its floor deepest under the
// pine. The road climbs the hill as a flight of steps, each as high as the
// hill is at its top edge.
// The manor's steps climb from the lawn to the door as a flight of their own,
// three treads 0.15 m apart, on three plateaus that stack up under them.
//
// Laid out in map metres, x east and y south from the top left corner, and set
// into the game's ground (x, z) round the origin, north up the screen at -z, as
// the swarm's arena wants its level centred.
import type { Flight, HeightShape } from './heights'
import type { Cart, Level } from './run'
import type { Bounds } from './swarm'
import type { Wall } from './walls'

/** A point on the ground. */
export interface Point {
  x: number
  z: number
}

/** A circle on the ground: a bush, a tree's trunk, a spawn spot. */
export interface Circle extends Point {
  r: number
}

/** The level and the script round it. */
export interface Woods {
  /** The run's level: the treeline, the river's banks, the tall rocks and the trees as walls, which stop the holder, the rats and the light; the five lights; the gate and its key; the way out, past the gate. */
  level: Level
  /** The water's edge, the bridge's rails and the ravine's rims, among the level's walls: they stop the holder, the rats and the light, never the eye. */
  banks: Wall[]
  /** The river, the level's full width, and the bridge's deck over it, for the drawing. */
  river: Point[]
  bridge: Bounds
  /** The cart on the bridge, the level's own: pushed north over it, it jams against the bottom step. */
  cart: Cart
  /** Where the guard lies, fallen near the gate, the key on him: seen only in a light. */
  guard: Point
  /** The estate wall, for the drawing: the wood's north edge and the bank's south edge are its faces. */
  wall: Wall[]
  /** The stone steps up the hill, for the drawing; the ravine, for the drawing; where the hilltop is, from which the manor is seen; and the manor's door, far off. */
  path: Point[]
  ravine: Point[]
  hilltop: Bounds
  manor: Point
  /**
   * The way to the manor, for the drawing: the road from the far brazier and
   * on along the forest path, its middle; the posts marking the path, each
   * with its drowned lantern; the lawn at the foot of the steps; the steps;
   * and the manor's front.
   */
  trail: Point[]
  posts: Point[]
  lawn: Point[]
  steps: Bounds
  front: Bounds
  /** Where the first drowned lanterns are passed. */
  pastLanterns: Bounds
  /**
   * The tree down across the path: its root plate in the wood west, its crown
   * over the path, and the stretch of the path under its branches, from one
   * side of the wood to the other, where the child gets through only crawling.
   */
  tangle: { root: Point; crown: Point; zone: Point[] }
  /** By their index in the level: past the pine, the burn-rate zone where the stick caught again is damp and burns short, and the dark run its going out sets off; and the gutter place on the path, where it gutters out if it lasts that long. */
  dampZone: number
  darkRun: number
  gutterPlace: number
  /**
   * The fallen pine: from its roots on the near side to its crown past the far
   * side, and its half-width, m; the box over the ravine along it, where the
   * child is out of the rats' reach and slow, the level's no-catch zone; and
   * the far side, past it, where the rain has stopped.
   */
  pine: { from: Point; to: Point; half: number }
  overRavine: Bounds
  /** Across the pine's two ends, where it meets the rims: they stop the rats, never the child, so no rat follows him over it. */
  pineEnds: Wall[]
  farSide: Bounds
  /** The low growth, the thicket and the bushes: it stops the holder, never the rats, the light or the eye, and it hides the rats in it. */
  thickets: Point[][]
  /** The treeline round the ground that can be walked, the rocks and the trees, for the drawing. */
  treeline: Point[]
  rocks: Point[][]
  trees: Circle[]
  /** Glowing mushrooms along both ways round the thicket. */
  mushrooms: Point[]
  /** Where rats are set down: inside the bushes and the thicket. */
  spots: Circle[]
  /** Where some of the rats wait from the start, how many at each, and in which beat: a run started again from a checkpoint past a beat sets none of its groups down. */
  waiting: { spot: Circle; count: number; beat: number }[]
  /** The cracked tree: its root, and where its crown lands. Fallen, it stops the holder unless crawling: the level's crawl zone `trunkCrawl`, there once it is down. */
  trunk: { root: Point; crown: Point }
  trunkCrawl: number
  /** The level's checkpoint zones, by index: the clearing's, the gate torches', and the far side's. */
  clearingZone: number
  entranceZone: number
  farZone: number
  /** The ground's height, as shapes, and the steps up the hill: the drawing's alone, never the play's. */
  heights: HeightShape[]
  flights: Flight[]
  /** The manor's steps, by their index among the flights. */
  manorFlight: number
  /** How high the hill stands over the river, m, and how far under it the ravine's floor sinks below the river. */
  hill: number
  ravineFloor: number
  /** The lights by their index in the level: the big tree, the fallen crown, the two torches outside the gate, the cart's brazier, the torch under the gate's arch, the brazier at the foot of the steps; the climb's braziers follow, the far side's last. */
  bigTree: number
  crown: number
  entrance: number[]
  brazier: number
  gateTorch: number
  foot: number
  /** The script, s from the start: the first strike, on the big tree, the child alone till then, its flash showing the rats' eyes all round him, and control given; the rats rush. */
  strike: number
  rush: number
  /**
   * The second strike, on the cracked tree, which falls burning over `falling`
   * across the gap: `afterLit` seconds after the stick first catches, an answer
   * to the fire he made, and till then he has all the time he wants to look
   * round. Or sooner, should the child first walk into `fallTrigger`, out of the
   * big tree's light toward the gap, stick lit or not, so it falls in front of
   * him, never on him, and the gap is never open to slip through.
   */
  afterLit: number
  fallTrigger: Bounds
  falling: number
  /** Where the run starts again once the torch has been lit: inside the crown's light, south of the trunk; once dipped at the gate's torches, between them; past the gate, the gate's own; once the cart has jammed, at its side by the foot of the steps, the cart's own; past the pine, at the far side's brazier. */
  checkpoint: Point
  entranceCheckpoint: Point
  cartCheckpoint: Point
  farCheckpoint: Point
  farBrazier: number
  /** The brazier that gutters out in the rain as the child comes up to it; every other on the climb goes out as he leaves it. */
  gutters: number
  /** The lanterns on the steps, sheltered by the porch: the last light. */
  stepsLight: number
}

/** How high the hill stands over the river, m; and how far below the river the ravine's floor sinks under the pine. */
const HILL = 4.5
/** How high each of the manor's three steps rises, m. */
const MANOR_STEP = 0.15
const RAVINE_FLOOR = 2

/** Map metres, set into the game's ground. */
const at = (x: number, y: number): Point => ({ x: x - 18, z: y })
const ring = (points: [number, number][]) => points.map(([x, y]) => at(x, y))
const circle = ([x, y, r]: [number, number, number]): Circle => ({ ...at(x, y), r })
/** A closed outline's walls, each side one. */
export const sides = (outline: Point[]): Wall[] => outline.map((from, k) => ({ from, to: outline[(k + 1) % outline.length]! }))
/** A circle as an octagon. */
export const octagon = (c: Circle) => Array.from({ length: 8 }, (_, k) => ({ x: c.x + c.r * Math.cos((k / 8) * Math.PI * 2), z: c.z + c.r * Math.sin((k / 8) * Math.PI * 2) }))

/** The forest path to the manor, map metres: its middle, from the far side's wood to the lawn at the steps, and its half-width there. */
const PATH: [number, number, number][] = [
  [4, -34.5, 1.5], [3.6, -39.5, 1.5], [4.8, -44.5, 1.6], [5.6, -49.5, 1.5], [5, -54.5, 1.5], [4.6, -59, 1.8],
]

/** The path's two sides, map metres, from the far side's wood on: east, and west, each a point a side of each of its middle's. */
function pathSides(): { east: [number, number][]; west: [number, number][] } {
  const east: [number, number][] = []
  const west: [number, number][] = []
  PATH.forEach(([x, y, half], k) => {
    const [ax, ay] = PATH[Math.max(0, k - 1)]!
    const [bx, by] = PATH[Math.min(PATH.length - 1, k + 1)]!
    // Across the way on, east of it: the way on runs north, -y.
    const dx = bx - ax
    const dy = by - ay
    const d = Math.hypot(dx, dy)
    const nx = -dy / d
    const ny = dx / d
    // The ends sit on the wood's edge and the lawn's: straight across, east to west.
    const end = k === 0 || k === PATH.length - 1
    east.push(end ? [x + half, y] : [x + nx * half, y + ny * half])
    west.push(end ? [x - half, y] : [x - nx * half, y - ny * half])
  })
  return { east, west }
}

export function woods(): Woods {
  // The ground that can be walked: the clearing, the gully east, the gap
  // between the rocks, the wood up to the estate wall, through the gate the
  // bank, over the bridge, and the hill. A side marked W runs along the
  // water's edge or a rail.
  const W = 1
  const pathEdges = pathSides()
  const shore: ([number, number] | [number, number, typeof W])[] = [
    // The wood's west side.
    [1.5, 24], [2, 34], [4, 40], [6.5, 43],
    // The west rock's face along the gap.
    [10, 42], [10, 50],
    // The clearing's west and south side.
    [7.5, 51.5], [5, 55], [4, 60], [5, 65], [8, 68.5], [12, 69.5], [16, 68.5], [18.5, 66],
    // The gully east, a dead end.
    [24, 68.5], [27, 72], [29, 71.5], [28.5, 68.5], [24.5, 64], [20, 61.5],
    // The clearing's east side, up to the east rock's face along the gap.
    [20, 56], [17.5, 52], [14, 50.5], [14, 42],
    // The wood's east side, up to the estate wall, and the wall's south face east of the gate.
    [19, 43], [25, 41.5], [31, 38], [35, 30], [35, 20], [34.5, 12.5], [32.5, 12.5],
    // Through the gate: the wall's north face east of it, the bank's east side, the river's edge to the bridge, its east rail,
    // and where it lands, the river's edge east.
    [32.5, 12], [35, 12], [35, 7.5, W], [32.5, 7.5, W], [32.5, 0.5, W], [35.5, 0.5],
    // The hill's east side and its north edge, in the forest.
    [35.5, -34.5],
    // The ravine's east rim north of the pine, the pine's north edge over it, its west rim north of the pine. Marked W: a drop stops
    // the eye no more than the water does.
    [18.5, -34.5, W], [19.6, -27, W], [19.3, -22, W], [19.3, -19.44, W], [11.5, -20.6, W], [11.5, -23, W], [11.4, -27, W], [12.5, -34.5],
    // The far side's north edge to the forest path; up its east side to the lawn, round the lawn and the foot of the steps to
    // the manor's front, and back down the path's west side; the far side's north edge on, its west side, and its south edge,
    // in the forest, west of the ravine.
    ...pathEdges.east,
    [9.5, -59], [9.5, -63], [7, -63], [7, -66.5], [1, -66.5], [1, -63], [0.5, -63], [0.5, -59],
    ...[...pathEdges.west].reverse(),
    [0.5, -34.5], [0.5, -2.5],
    // The ravine's west rim south of the pine, the pine's south edge, its east rim south of the pine.
    [12.2, -2.5, W], [11.8, -9, W], [11.5, -17, W], [11.5, -19.59, W], [19.3, -18.43, W], [19.3, -16, W], [19, -9, W], [18.6, -2.5],
    // The hill's foot, in the forest, to where the bridge lands; the river's edge there to the bridge, its west rail, the river's
    // edge west, the bank's west side, the wall's north face to the gate, its west side, and the wall's south face west.
    [26, -2.5], [26, 0.5, W], [29.5, 0.5, W], [29.5, 7.5, W], [26, 7.5], [26, 12], [29.5, 12], [29.5, 12.5],
    // The wall's south face west to the gamekeeper's bushes, and back along the thicket's north edge: west of them, the forest.
    [16.5, 12.5], [16.5, 22.4], [14, 22], [10, 22], [8, 22.4], [1.5, 23],
  ]
  const treeline = ring(shore.map(([x, y]) => [x, y]))
  const edges = sides(treeline)
  const shoreBanks = edges.filter((_, k) => shore[k]![2] === W)
  // The ravine, under the pine. It runs from the hill's foot to the forest's edge north, so the only way over is the pine.
  const ravine = ring([
    [12.2, -2.5], [18.6, -2.5], [19, -9], [19.3, -16], [19.3, -22], [19.6, -27], [18.5, -34.5],
    [12.5, -34.5], [11.4, -27], [11.5, -23], [11.5, -17], [11.8, -9],
  ])
  /** A box on the map, from one corner to the other. */
  const box = (x0: number, y0: number, x1: number, y1: number): Bounds => ({ minX: at(x0, 0).x, maxX: at(x1, 0).x, minZ: at(0, y0).z, maxZ: at(0, y1).z })
  // The road up the hill: from where the bridge lands, turning where the slope turns, to the pine's roots.
  const path = ring([[31, -2.5], [30, -6.5], [27, -9.5], [27.5, -14], [24, -17.5], [20.2, -18.8]])
  const banks = shoreBanks
  const rocks = [
    // Either side of the gap: drawn only, the treeline is their face.
    ring([[6.5, 43], [10, 42], [10, 50], [7.5, 51.5], [5.5, 48]]),
    ring([[14, 42], [19, 43], [20.5, 48], [20, 56], [17.5, 52], [14, 50.5]]),
    // A rock in the east of the wood.
    ring([[24, 23.5], [27.5, 22.5], [29, 27.5], [25.5, 28.5]]),
  ]
  const trees = ([
    [26.5, 40, 0.6], [30, 20, 0.9], [33, 26, 0.7], [28, 33, 0.8],
    // The hill's wood, either side of the steps; and past the pine.
    [33, -17, 0.8], [22.5, -7.5, 0.7], [29, -23, 0.9], [23, -27, 0.8], [33, -28, 0.7], [5, -12, 0.8], [8.2, -30, 0.7], [3.5, -20, 0.6],
  ] as [number, number, number][]).map(circle)
  const bushes = ([
    // Round the clearing, just past the big tree's light.
    [6, 56, 1.3], [5.4, 62, 1.3], [8.4, 67, 1.3], [14.5, 68.2, 1.2], [19, 58.5, 1.3],
    // Either side of the walk to the trunk.
    [6.4, 53, 0.9], [17.6, 54.3, 0.9],
    // In the wood, off both ways round the thicket.
    [22, 39.5, 1.2], [23.5, 35.5, 1], [24, 31, 1.3], [22.5, 25.5, 1], [24, 19, 1.3],
    // Either side of the gamekeeper.
    [22, 14.1, 0.8], [17.8, 13.9, 0.8],
    // On the bank inside the gate, either side of the road; and either side of where the bridge lands.
    [27.2, 9.6, 0.8], [34, 9.4, 0.8], [27.4, -1.1, 0.8], [34.2, -1.1, 0.8],
    // In the hill's wood, off the steps; and on the far side.
    [33.5, -8.5, 1], [23, -12.5, 1], [31.5, -19.5, 1], [25.5, -23.5, 1], [6.5, -16, 1], [4, -25.5, 1],
  ] as [number, number, number][]).map(circle)
  const thickets = [
    // The wood's west side, from the gap's west rock to the treeline, closing the pocket's south side between its rocks.
    ring([[1, 23], [8, 22.4], [10, 22], [14, 22], [16, 22.4], [19.5, 25], [19, 33], [16, 36.5], [12.5, 38.5], [10.3, 41.8], [6.5, 43], [1, 40]]),
    ...bushes.map(octagon),
  ]
  // The cart, its back 0.4 m onto the deck; it jams with its front against the bottom step, its back 1.4 m past the far end,
  // room for the child to come round it. Its brazier, light 4, burns east of its middle; jammed, the run starts again west of
  // it, between its brazier and the foot's.
  const cart: Cart = { from: at(31, 7.1), jam: at(31, -0.9), half: 1.05, length: 1.6, speed: 1, light: 4, across: 0.85, along: 0.8, checkpoint: at(29.3, -1.6) }
  const river = ring([
    [0, 7.8], [6, 7.4], [12, 8], [18, 7.6], [26, 7.5], [29.5, 7.5], [32.5, 7.5], [35, 7.5], [36, 7.7],
    [36, 0.2], [35.5, 0.5], [32.5, 0.5], [29.5, 0.5], [26, 0.5], [18, 0.9], [12, 0.3], [6, 1], [0, 0.6],
  ])
  // From the clearing's north-west edge to the east rock: no way past it but under.
  const trunk = { root: at(7.6, 51.4), crown: at(13.75, 49.6) }
  // Its root plate in the wood west of the path, its crown over the path: two and a half metres of branches, past both of
  // its sides, the last of them where the wood ends, under four metres short of the steps' light.
  const tangle = { root: at(-0.5, -55.5), crown: at(6.5, -57), zone: ring([[2.7, -55], [6.9, -55], [6.9, -57.5], [2.6, -57.5]]) }
  const [ta, tb, tc, td] = tangle.zone as [Point, Point, Point, Point]
  const checkpoint = at(12, 52.3)
  const farSide = box(0.5, -34.5, 11.4, -2.5)
  const farCheckpoint = at(9.6, -22.6)
  // The pine: from its roots on the hill to its crown on the far side; and its trunk over the ravine, out of the rats' reach,
  // a band either side of its line, cut where the box over the ravine ends.
  const pine = { from: at(20.2, -18.8), to: at(10.8, -20.2), half: 0.5 }
  const overRavine = box(11.5, -21, 19.3, -18)
  const pineArea = ((): Point[] => {
    const slope = (pine.to.z - pine.from.z) / (pine.to.x - pine.from.x)
    const lineAt = (x: number) => pine.from.z + (x - pine.from.x) * slope
    // Its half-width and a little, as the line runs, measured straight across x.
    const band = (pine.half + 0.1) * Math.hypot(1, slope)
    const { minX, maxX } = overRavine
    return [
      { x: maxX, z: lineAt(maxX) - band },
      { x: maxX, z: lineAt(maxX) + band },
      { x: minX, z: lineAt(minX) + band },
      { x: minX, z: lineAt(minX) - band },
    ]
  })()
  /** A box spanning the level and past it east and west, from map y `y0` to `y1`. */
  const across = (y0: number, y1: number) => ring([[-40, y0], [80, y0], [80, y1], [-40, y1]])
  // Between the gate's two torches, outside it.
  const entranceCheckpoint = at(31, 14.3)
  // The guard, 11 m west of the gate, off the way the wood makes for it, out of its torches' light, in the dark among bushes.
  const guard = at(20, 13.4)
  /**
   * The box a climb brazier's script is set off in as the child leaves it for
   * the next one: from `past` m beyond it toward the next, a band a metre deep,
   * square to the way's main heading and seven metres across it.
   */
  const leaving = ([ax, ay]: [number, number], [bx, by]: [number, number], past: number): Bounds => {
    const d = Math.hypot(bx - ax, by - ay)
    const ux = (bx - ax) / d
    const uy = (by - ay) / d
    const px = ax + ux * past
    const py = ay + uy * past
    if (Math.abs(uy) >= Math.abs(ux)) return uy < 0 ? box(px - 3.5, py - 1, px + 3.5, py) : box(px - 3.5, py, px + 3.5, py + 1)
    return ux < 0 ? box(px - 1, py - 3.5, px, py + 3.5) : box(px, py - 3.5, px + 1, py + 3.5)
  }
  // The climb's braziers, map metres: at the foot of the steps, beside the cart jammed there, and at each turn.
  const foot: [number, number] = [29, -3.3]
  const climb: [number, number][] = [[29.38, -7.12], [27.11, -10.53], [27.45, -13.5], [25.38, -16.12], [21.6, -18.3]]
  const [b1, b2, b3, b4, b5] = climb as [[number, number], [number, number], [number, number], [number, number], [number, number]]
  // Everything west of the ravine past the pine, the far side down to the manor's front.
  const pastPine = box(0.5, -67, 11.4, -2.5)
  // The manor's steps, from the lawn's edge up to its front.
  const steps = box(1, -66.5, 7, -63)
  const stepsMiddle = (steps.minX + steps.maxX) / 2
  // The flight up them, along their middle from the lawn to just short of the front.
  const manorFlight = { from: steps.maxZ, length: steps.maxZ - steps.minZ - 0.1 }
  const level: Level = {
    start: at(10.5, 63.5),
    lights: [
      // The big tree, struck: it burns for good.
      { ...at(12, 61), reach: 4.5, flame: true, on: false },
      // The cracked tree's crown, burning where it lands against the east rock.
      { ...at(13.5, 49.7), reach: 3.5, flame: true, on: false },
      // The torches either side of the gate, outside it, lit by the gamekeeper on his round: where the way through the wood
      // ends, the last-second arrival, and the safe place to light the torch again while searching for the key.
      { ...at(28.6, 13.7), reach: 2.5, flame: true, on: true },
      { ...at(33.4, 13.7), reach: 2.5, flame: true, on: true },
      // The cart's brazier, where the cart stands: the rain drowns it as the child comes past the jammed cart's front, either side of it, for
      // the steps, the first light to go behind him.
      { x: cart.from.x + cart.across, z: cart.from.z - cart.along, reach: 3, flame: true, on: true, fragile: { trigger: box(26, -3.2, 35.5, -2.2) } },
      // The torch the gamekeeper lit under the gate's arch: its light through the bars covers the gate's whole width and a metre
      // of the near side, and just touches the cart's on the bridge. A flame, so it refuels too.
      { ...at(31, 11.2), reach: 2.5, flame: true, on: true },
      // The braziers up the hill, at most 4.4 m apart along the steps, so their light always touches; and the far side's, past the
      // pine, beyond the rain. The rain drowns them one after the other: each goes out as the child leaves it for the next, while
      // he's still in its light, leaving a moment of dark to cross before the next one's. The fourth gutters out as he comes up
      // to it instead, 0.3 s after he walks into the steps below it: its two neighbours stand 3 m either side, so it leaves a dark
      // stretch of about a metre, crossed walking, deadly to stop in; the one before it goes out only at its light's edge.
      { ...at(...foot), reach: 2.5, flame: true, on: true, fragile: { trigger: leaving(foot, b1, 0.3) } },
      { ...at(...b1), reach: 2.5, flame: true, on: true, fragile: { trigger: leaving(b1, b2, 0.5) } },
      { ...at(...b2), reach: 2.5, flame: true, on: true, fragile: { trigger: leaving(b2, b4, 2.3) } },
      { ...at(...b3), reach: 2.5, flame: true, on: true, fragile: { trigger: box(26, -12.3, 28.6, -11), after: 0.3 } },
      { ...at(...b4), reach: 2.5, flame: true, on: true, fragile: { trigger: leaving(b4, b5, 0.7) } },
      { ...at(...b5), reach: 2.5, flame: true, on: true, fragile: { trigger: leaving(b5, [19.3, -18.7], 1) } },
      { ...at(9.6, -21), reach: 2.5, flame: true, on: true },
      // The lanterns on the manor's steps, under the porch: not a flame to dip into, only the light that holds the rats off.
      { ...at(4, -65.2), reach: 4, flame: false, on: true },
    ],
    walls: [...edges, ...rocks.slice(2).flatMap(sides), ...trees.flatMap((tree) => sides(octagon(tree)))],
    wind: [],
    // The gate in the estate wall: opened, it stays open; a checkpoint.
    gates: [{ from: at(29.5, 12.5), to: at(32.5, 12.5), checkpoint: at(31, 10.5) }],
    // On the guard who fell near the gate.
    keys: [{ ...guard, gate: 0 }],
    levers: [],
    // The manor's door, ajar.
    exit: { ...at(4, -66.1), radius: 0.7 },
    bounds: { minX: -18, maxX: 18, minZ: -74, maxZ: 74 },
    crawls: [
      // The cracked tree, down across the gap once the second strike knocks it over.
      { walls: [{ from: trunk.root, to: trunk.crown }], on: false },
      // The tangle across the path: its two ends stop him standing; the wood either side is its sides.
      {
        walls: [
          { from: ta, to: tb },
          { from: tc, to: td },
        ],
        area: tangle.zone,
      },
    ],
    // Past the pine, the far side, the path and the lawn: the stick caught again is damp, it burns a full torch in 22 s, and
    // its going out sets him running for the steps.
    burns: [{ ...pastPine, rate: 1 / 22 }],
    // Across the path seven metres short of the branches: where the damp stick gutters out, if it lasts that long.
    gutters: [box(0.5, -48.5, 9.5, -48)],
    darkRuns: [pastPine],
    checkpoints: [
      // The clearing's north side, walked into on the way to the trunk, past the big tree's light: a catch once the stick has
      // caught starts him again in the crown's light.
      { ...box(3, 51.6, 21, 58.5), at: checkpoint, before: 0 },
      // The gate's torches, the first arrival: from there on, between them.
      { ...box(27.8, 12.8, 34.2, 14.6), at: entranceCheckpoint, before: 0 },
      // The far side, off the pine: from there on, at its brazier.
      { ...farSide, at: farCheckpoint },
    ],
    cart,
    // It rains from when the cart jams until he is past the pine.
    rain: { starts: 'jammed', stops: farSide },
    // On the pine, over the ravine, out of the rats' reach, slow.
    noCatch: [{ area: pineArea, speed: 0.8 }],
  }
  return {
    level,
    banks,
    river,
    bridge: { minX: at(29.5, 0).x, maxX: at(32.5, 0).x, minZ: at(0, 0.5).z, maxZ: at(0, 7.5).z },
    cart,
    wall: [
      { from: at(13, 12.25), to: at(29.5, 12.25) },
      { from: at(32.5, 12.25), to: at(36, 12.25) },
    ],
    path,
    ravine,
    hilltop: box(20, -20, 26.5, -15.5),
    manor: at(4, -66.5),
    trail: ring([[9.6, -21], [7, -24], [5.8, -28], [4.5, -32], ...PATH.map(([x, y]): [number, number] => [x, y]), [4, -63]]),
    // Along the path's sides, turn about, a post every few metres, set in from the wood's edge.
    posts: ring(
      PATH.slice(0, -1).map(([x, y], k): [number, number] => {
        const [ex, ey] = pathEdges.east[k]!
        const [wx, wy] = pathEdges.west[k]!
        const [fx, fy] = k % 2 === 0 ? [wx, wy] : [ex, ey]
        return [fx + (x - fx) * 0.25, fy + (y - fy) * 0.25]
      }),
    ),
    lawn: ring([[0.5, -59], [9.5, -59], [9.5, -63], [7, -63], [7, -66.5], [1, -66.5], [1, -63], [0.5, -63]]),
    steps,
    front: box(-6, -71, 14, -66.5),
    pastLanterns: box(1.5, -40, 6.5, -37),
    tangle,
    dampZone: 0,
    darkRun: 0,
    gutterPlace: 0,
    pine,
    overRavine,
    pineEnds: [
      { from: at(19.3, -18.43), to: at(19.3, -19.44) },
      { from: at(11.5, -19.59), to: at(11.5, -20.6) },
    ],
    farSide,
    thickets,
    treeline,
    rocks,
    trees,
    mushrooms: ring([[15, 39], [18, 36], [20.4, 31], [20.6, 26], [19.5, 20], [22.5, 17], [26, 15]]),
    spots: [
      ...bushes.map((bush) => ({ ...bush, r: bush.r * 0.6 })),
      circle([25.5, 68.5, 1]),
      ...([[8, 33, 1], [12, 31, 1], [16, 33, 1], [7, 26.5, 0.8], [17, 26.5, 0.8], [12, 25, 1], [5, 37, 1], [4, 29, 1], [15.5, 35, 1], [17.5, 30, 1], [17.5, 25, 0.8]] as [number, number, number][]).map(circle),
    ],
    waiting: [
      { spot: circle([6.4, 53, 0.55]), count: 80, beat: 1 },
      { spot: circle([17.6, 54.3, 0.55]), count: 80, beat: 1 },
      // In the gap's dark, past the trunk, at the edge of the crown's light.
      { spot: circle([12, 44, 1.2]), count: 150, beat: 1 },
      // At the gap's way out.
      { spot: circle([16, 40.5, 1.2]), count: 150, beat: 1 },
      // Round the guard.
      { spot: circle([20, 14.6, 2]), count: 250, beat: 3 },
      // Thick either side of where the bridge lands: brought in past the gate.
      { spot: circle([27.6, -1.1, 1.1]), count: 100, beat: 3.5 },
      { spot: circle([34, -1.1, 1.1]), count: 100, beat: 3.5 },
      // The hill's wood, either side of the steps.
      { spot: circle([33.5, -12, 1.5]), count: 70, beat: 4 },
      { spot: circle([22.5, -11, 1.5]), count: 70, beat: 4 },
      // The ravine, thick under the pine, either side of it: beat 4's too, but brought in only once the cart has jammed, and the
      // rats where the bridge lands are let go.
      { spot: circle([15.4, -22.6, 2.2]), count: 250, beat: 4.5 },
      { spot: circle([15.4, -16.8, 2.2]), count: 250, beat: 4.5 },
      // The far side's wood, either side of the road down to the path: they press round the damp stick, and follow him down it.
      { spot: circle([2.5, -29, 1.2]), count: 150, beat: 6 },
      { spot: circle([9.5, -27.5, 1.2]), count: 150, beat: 6 },
    ],
    trunk,
    trunkCrawl: 0,
    clearingZone: 0,
    entranceZone: 1,
    farZone: 2,
    heights: [
      // The river's bed, sunk under its banks either side of the bridge, which stays level with them.
      { outline: ring([[0, 7.8], [6, 7.4], [12, 8], [18, 7.6], [26, 7.5], [29.5, 7.5], [29.5, 0.5], [26, 0.5], [18, 0.9], [12, 0.3], [6, 1], [0, 0.6]]), height: -0.8, edge: 1 },
      { outline: ring([[32.5, 7.5], [35, 7.5], [36, 7.7], [36, 0.2], [35.5, 0.5], [32.5, 0.5]]), height: -0.8, edge: 1 },
      // The hill: up from the bottom step to the hilltop, and level over it and the far side.
      { outline: across(-2.5, -34.5), height: HILL, edge: 0, along: { from: at(31, -2.5), to: at(31, -18.8) } },
      // Down the forest path to the lawn, from the far side's height.
      { outline: across(-34.5, -59), height: HILL, edge: 0, along: { from: at(4, -59), to: at(4, -34.5) } },
      // The ravine, cut into the hill as it rises, its rims steep, its floor deepest under the pine.
      { outline: ravine, height: -(HILL + RAVINE_FLOOR), edge: 0.8, along: { from: at(15, -2.5), to: at(15, -18.8) } },
      // The manor's steps: three plateaus stacked, each 0.15 m, the second and third starting just past the first and second
      // treads' top edges, so each tread stands a step above the last; short of the manor's front, which stands on the lawn.
      ...[0, 1, 2].map((k) => {
        const z = steps.maxZ - (k * (manorFlight.length)) / 3 - (k > 0 ? 0.01 : -0.1)
        return {
          outline: [
            { x: steps.minX, z },
            { x: steps.maxX, z },
            { x: steps.maxX, z: steps.minZ + 0.05 },
            { x: steps.minX, z: steps.minZ + 0.05 },
          ],
          height: MANOR_STEP,
          edge: 0,
        }
      }),
    ],
    // The road up the hill, a stone step a metre deep each, its braziers on it at the turns.
    manorFlight: 1,
    flights: [
      { line: path, half: 1.3, count: 22 },
      {
        line: [
          { x: stepsMiddle, z: manorFlight.from },
          { x: stepsMiddle, z: manorFlight.from - manorFlight.length },
        ],
        half: (steps.maxX - steps.minX) / 2,
        count: 3,
      },
    ],
    hill: HILL,
    ravineFloor: RAVINE_FLOOR,
    bigTree: 0,
    crown: 1,
    entrance: [2, 3],
    brazier: 4,
    gateTorch: 5,
    guard,
    strike: 4,
    rush: 4.6,
    afterLit: 3,
    // The clearing's north side, from the big tree's light's edge to five and a half metres short of the trunk.
    fallTrigger: { minX: at(4, 0).x, maxX: at(20, 0).x, minZ: at(0, 50).z, maxZ: at(0, 57).z },
    falling: 0.8,
    checkpoint,
    entranceCheckpoint,
    cartCheckpoint: cart.checkpoint,
    farCheckpoint,
    foot: 6,
    farBrazier: 12,
    gutters: 9,
    stepsLight: 13,
  }
}
