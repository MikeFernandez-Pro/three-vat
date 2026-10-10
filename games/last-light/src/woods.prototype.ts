// PROTOTYPE: the new level's first four beats (design/level.html), as data
// for the 2D page (twod.prototype.ts), second layout.
//
// The burning tree: a clearing in the woods ringed with bushes, the child by
// its big tree, the cracked tree eleven metres off at the mouth of the only gap
// north, between two rocks, and a dark gully east that leads nowhere. Lost: an
// open wood north of the gap, a wide low thicket filling its west side from
// the gap's west rock to the treeline, so the gap opens only north-east, and the
// way round it east through the open wood, past a rock either side. The faint flame sits in a pocket between two tall rocks, open
// north, the thicket closing it south: seen from the clearing through the gap
// and from the gap across the thicket, lost behind the east rock over the last
// sixteen metres, and seen again only rounding it into the pocket. Glowing
// mushrooms along the way round, faint in the dark, are on trial.
//
// The bridge: north of the wood a river runs the level's full width, and the
// bridge, 3 m wide and 7 m long, is its only crossing, east of the pocket, so
// the way on turns. A cart stands on it, its back at the south end, as wide as
// the deck lets it be: its brazier burns for good, toward its east side, so
// the torch is dipped into it only from there, which the deck leaves no room
// to reach. Its light covers the child pushing it. Pushed, it rolls north off
// the far end and jams against a tree where the bridge lands, and only then
// can the child walk round to its side. Rats wait thick where the bridge
// lands.
//
// The estate gate: the far bank ends at the manor's estate wall, stone,
// running into the forest both ways. The road goes through it by a barred
// gate, locked. The gamekeeper lit a torch under its arch on his round, the
// only light there, seen from the cart through the bars and holding a metre
// of the near side. The bars stop the child, never the rats or the light: the
// torch's light covers the gate's width, so no rat comes through. The
// gamekeeper lies 8 m along the wall, in the dark between bushes, among
// waiting rats, the key on him: seen only once a light reaches him. Opened,
// the gate stays open. The cart is the only flame this side.
//
// The climb: past the gate the road goes up the wooded hill as stone steps,
// a brazier at each turn, lit by the gamekeeper, close enough that their light
// always touches, but for one that gutters out in the rain as the child comes
// up to it, leaving a metre of dark to cross. The ravine is thick with rats
// under the pine. The rain starts at the gate (the page's
// script) and the stick is out the whole climb: the braziers are the only way
// on, the forest either side the rats' dark. At the top, the ravine: the
// road's footbridge was smashed by a pine the storm blew down, which now lies
// across it, the only way over; on it the child is out of the rats' reach,
// and slow. From the hilltop, the manor is seen. Past the pine the rain stops,
// and a brazier on the far side lights the stick again.
//
// The rats are set down at spawn spots: inside the bushes and the thicket,
// where nothing shows them, each woken when the child comes near it. Some wait
// from the start: in two bushes either side of the walk to the trunk, in the
// dark of the gap past the trunk, and at the gap's way out, still until the
// child comes within their notice.
//
// Laid out in map metres, x east and y south from the top left corner, and set
// into the game's ground (x, z) round the origin, north up the screen at -z, as
// the swarm's arena wants its level centred.
import type { Level } from './run'
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
  /** The water's edge, the bridge's rails, the beam's edges and the hollow's sides, among the level's walls: they stop the holder, the rats and the light, never the eye. */
  banks: Wall[]
  /** The river, the level's full width, and the bridge's deck over it, for the drawing. */
  river: Point[]
  bridge: Bounds
  /**
   * The cart: its middle across the bridge; where its back stands at the start
   * and where it jams, z; its half-width and length, m; where its brazier sits,
   * east of its middle and ahead of its back, m; and how fast the child pushes
   * it, m/s.
   */
  cart: { x: number; back: number; jam: number; half: number; length: number; across: number; along: number; speed: number }
  /** Where the guard lies, fallen near the gate, the key on him: seen only in a light. */
  guard: Point
  /** The estate wall, for the drawing: the far bank's north face and the hill's south face are its walls. */
  wall: Wall[]
  /** The stone steps up the hill, for the drawing; the ravine, for the drawing; where the hilltop is, from which the manor is seen; and the manor, far off. */
  path: Point[]
  ravine: Point[]
  hilltop: Bounds
  manor: Point
  /**
   * The fallen pine: from its roots on the near side to its crown past the far
   * side, and its half-width, m; the box over the ravine along it, where the
   * child is out of the rats' reach and slow; and the far side, past it,
   * where the rain has stopped.
   */
  pine: { from: Point; to: Point; half: number }
  overRavine: Bounds
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
  /** The cracked tree: its root, and where its crown lands. Fallen, it stops the holder unless crawling. */
  trunk: { root: Point; crown: Point }
  /** The lights by their index in the level: the big tree, the fallen crown, the faint flame, the cart's brazier, the torch under the gate's arch; the climb's braziers follow, the far side's last. */
  bigTree: number
  crown: number
  faint: number
  brazier: number
  gateTorch: number
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
  /** Where the run starts again once the torch has been lit: inside the crown's light, south of the trunk; once dipped at the faint flame, beside it; once dipped at the cart's brazier, at the cart's side; past the pine, at the far side's brazier. */
  checkpoint: Point
  flameCheckpoint: Point
  cartCheckpoint: Point
  farCheckpoint: Point
  farBrazier: number
  /** The brazier that gutters out in the rain as the child comes up to it. */
  gutters: number
}

/** Map metres, set into the game's ground. */
const at = (x: number, y: number): Point => ({ x: x - 18, z: y - 12.25 })
const ring = (points: [number, number][]) => points.map(([x, y]) => at(x, y))
const circle = ([x, y, r]: [number, number, number]): Circle => ({ ...at(x, y), r })
/** A closed outline's walls, each side one. */
export const sides = (outline: Point[]): Wall[] => outline.map((from, k) => ({ from, to: outline[(k + 1) % outline.length]! }))
/** A circle as an octagon. */
export const octagon = (c: Circle) => Array.from({ length: 8 }, (_, k) => ({ x: c.x + c.r * Math.cos((k / 8) * Math.PI * 2), z: c.z + c.r * Math.sin((k / 8) * Math.PI * 2) }))

export function woods(): Woods {
  // The ground that can be walked: the clearing, the gully east, the gap
  // between the rocks, the wood, the river's south bank, over the bridge, and
  // the far bank. A side marked W runs along the water's edge or a rail.
  const W = 1
  const shore: ([number, number] | [number, number, typeof W])[] = [
    // The south bank's west end, and the wood's west side.
    [1.5, 6], [2.5, 13], [1.5, 24], [2, 34], [4, 40], [6.5, 43],
    // The west rock's face along the gap.
    [10, 42], [10, 50],
    // The clearing's west and south side.
    [7.5, 51.5], [5, 55], [4, 60], [5, 65], [8, 68.5], [12, 69.5], [16, 68.5], [18.5, 66],
    // The gully east, a dead end.
    [24, 68.5], [27, 72], [29, 71.5], [28.5, 68.5], [24.5, 64], [20, 61.5],
    // The clearing's east side, up to the east rock's face along the gap.
    [20, 56], [17.5, 52], [14, 50.5], [14, 42],
    // The wood's east side, out onto the south bank.
    [19, 43], [25, 41.5], [31, 38], [35, 30], [35, 20], [31, 13], [33, 10],
    // The south bank's water's edge west to the bridge, its east rail, and the far bank's water's edge east.
    [34, 7, W], [29, 5.5, W], [25.5, 5, W], [25.5, -2, W], [29, -1.5, W],
    // The far bank's east side up to the estate wall, and the wall's south face east of the gate.
    [35, -0.5], [35, -15], [32.5, -15],
    // Through the gate: the hill's east side and its north edge, in the forest.
    [32.5, -15.5], [35.5, -15.5], [35.5, -47.5],
    // The ravine's east rim north of the pine, the pine's north edge over it, its west rim north of the pine. Marked W: a drop stops
    // the eye no more than the water does.
    [18.5, -47.5, W], [19.6, -40, W], [19.3, -35, W], [19.3, -32.44, W], [11.5, -33.6, W], [11.5, -36, W], [11.4, -40, W], [12.5, -47.5],
    // The far side's north edge and west side, and the wall's north face west of the ravine.
    [0.5, -47.5], [0.5, -15.5],
    // The ravine's west rim south of the pine, the pine's south edge, its east rim south of the pine.
    [12.2, -15.5, W], [11.8, -22, W], [11.5, -30, W], [11.5, -32.59, W], [19.3, -31.43, W], [19.3, -29, W], [19, -22, W], [18.6, -15.5],
    // The wall's north face to the gate, its west side, and the wall's south face west of the gate, to the far bank's west side.
    [29.5, -15.5], [29.5, -15],
    [12, -15], [6, -11], [2, -6],
    // The far bank's water's edge east to the bridge, its west rail, and the south bank's water's edge west.
    [1, -1, W], [6, -1.5, W], [12, -2.5, W], [18, -2, W], [22.5, -2, W], [22.5, 5, W], [18, 4.6, W], [12, 5.5, W], [6, 5, W],
  ]
  const treeline = ring(shore.map(([x, y]) => [x, y]))
  const edges = sides(treeline)
  const shoreBanks = edges.filter((_, k) => shore[k]![2] === W)
  // The ravine, under the pine. It runs from the wall to the forest's edge north, so the only way over is the pine.
  const ravine = ring([
    [12.2, -15.5], [18.6, -15.5], [19, -22], [19.3, -29], [19.3, -35], [19.6, -40], [18.5, -47.5],
    [12.5, -47.5], [11.4, -40], [11.5, -36], [11.5, -30], [11.8, -22],
  ])
  /** A box on the map, from one corner to the other. */
  const box = (x0: number, y0: number, x1: number, y1: number): Bounds => ({ minX: at(x0, 0).x, maxX: at(x1, 0).x, minZ: at(0, y0).z, maxZ: at(0, y1).z })
  // The road up the hill: from the gate, turning where the slope turns, to the pine's roots.
  const path = ring([[31, -15.5], [30, -19.5], [27, -22.5], [27.5, -27], [24, -30.5], [20.2, -31.8]])
  const banks = shoreBanks
  const rocks = [
    // Either side of the gap: drawn only, the treeline is their face.
    ring([[6.5, 43], [10, 42], [10, 50], [7.5, 51.5], [5.5, 48]]),
    ring([[14, 42], [19, 43], [20.5, 48], [20, 56], [17.5, 52], [14, 50.5]]),
    // The pocket's two rocks, either side of the faint flame.
    ring([[7.6, 16], [9.6, 15.6], [10, 22], [8, 22.4]]),
    ring([[14.4, 15.6], [16.4, 16], [16, 22.4], [14, 22]]),
    // A rock in the east of the wood.
    ring([[24, 23.5], [27.5, 22.5], [29, 27.5], [25.5, 28.5]]),
  ]
  const trees = ([
    [26.5, 40, 0.6], [30, 20, 0.9], [26, 13, 1], [21, 12.5, 0.6], [33, 26, 0.7], [28, 33, 0.8],
    // On the south bank, and the far bank.
    [5, 8.5, 0.7], [31, 9.5, 0.8], [15.5, 8, 0.5], [16, -9, 0.7], [27, -11, 0.8], [9, -11.5, 0.7],
    // The tree the cart jams against, where the bridge lands.
    [24, -5.9, 0.55],
    // The hill's wood, either side of the steps; and past the pine.
    [33, -30, 0.8], [22.5, -20.5, 0.7], [29, -36, 0.9], [23, -40, 0.8], [33, -41, 0.7], [5, -25, 0.8], [7, -42, 0.7], [3.5, -33, 0.6],
  ] as [number, number, number][]).map(circle)
  const bushes = ([
    // Round the clearing, just past the big tree's light.
    [6, 56, 1.3], [5.4, 62, 1.3], [8.4, 67, 1.3], [14.5, 68.2, 1.2], [19, 58.5, 1.3],
    // Either side of the walk to the trunk.
    [6.4, 53, 0.9], [17.6, 54.3, 0.9],
    // In the wood, off both ways round the thicket.
    [22, 39.5, 1.2], [23.5, 35.5, 1], [24, 31, 1.3], [22.5, 25.5, 1], [24, 19, 1.3], [6, 11, 1.1], [18, 11.5, 1.1],
    // On the south bank, off the way to the bridge.
    [9, 7.5, 1], [18.5, 6.8, 0.9], [29, 8.6, 1.1],
    // On the far bank, either side of where the bridge lands, and further off.
    [19.5, -5.5, 1.1], [29, -5, 1.2], [12, -6, 1.2], [31, -10.5, 1], [7, -7, 1.1],
    // Either side of the gamekeeper.
    [25.5, -13.2, 0.9], [20.5, -13.9, 0.8],
    // In the hill's wood, off the steps; and on the far side.
    [33.5, -21.5, 1], [23, -25.5, 1], [31.5, -32.5, 1], [25.5, -36.5, 1], [6.5, -29, 1], [4, -38.5, 1],
  ] as [number, number, number][]).map(circle)
  const thickets = [
    // The wood's west side, from the gap's west rock to the treeline, closing the pocket's south side between its rocks.
    ring([[1, 23], [8, 22.4], [10, 22], [14, 22], [16, 22.4], [19.5, 25], [19, 33], [16, 36.5], [12.5, 38.5], [10.3, 41.8], [6.5, 43], [1, 40]]),
    ...bushes.map(octagon),
  ]
  // The cart, its back 0.4 m onto the deck; it jams with its back 1.4 m past the far end, room for the child to come round it.
  const cart = { x: at(24, 0).x, back: at(0, 4.6).z, jam: at(0, -3.4).z, half: 1.05, length: 1.6, across: 0.85, along: 0.8, speed: 1 }
  // The guard, 8 m west of the gate, out of its lantern's light, in the dark among bushes.
  const guard = at(23, -14)
  const level: Level = {
    start: at(10.5, 63.5),
    lights: [
      // The big tree, struck: it burns for good.
      { ...at(12, 61), reach: 4.5, flame: true, on: false },
      // The cracked tree's crown, burning where it lands against the east rock.
      { ...at(13.5, 49.7), reach: 3.5, flame: true, on: false },
      // The faint flame, in its pocket: someone's fire, left burning.
      { ...at(12, 19), reach: 1.8, flame: true, on: true },
      // The cart's brazier, where the cart stands: it burns for good.
      { x: cart.x + cart.across, z: cart.back - cart.along, reach: 3, flame: true, on: true },
      // The torch the gamekeeper lit under the gate's arch: its light through the bars covers the gate's whole width and a metre of the near side. A flame, so it refuels too.
      { ...at(31, -16.2), reach: 2.5, flame: true, on: true },
      // The braziers up the hill, at most 4.4 m apart along the steps, so their light always touches; and the far side's, past the pine.
      // The third gutters out in the rain as the child comes up to it, 0.3 s after he walks into the steps below it: its two
      // neighbours stand 3 m either side, so it leaves a dark stretch of about a metre, crossed walking, deadly to stop in.
      { ...at(29.38, -20.12), reach: 2.5, flame: true, on: true },
      { ...at(27.11, -23.53), reach: 2.5, flame: true, on: true },
      { ...at(27.45, -26.5), reach: 2.5, flame: true, on: true, fragile: { trigger: box(26, -25.3, 28.6, -24), after: 0.3 } },
      { ...at(25.38, -29.12), reach: 2.5, flame: true, on: true },
      { ...at(21.6, -31.3), reach: 2.5, flame: true, on: true },
      { ...at(9.6, -34), reach: 2.5, flame: true, on: true },
    ],
    walls: [...edges, ...rocks.slice(2).flatMap(sides), ...trees.flatMap((tree) => sides(octagon(tree)))],
    wind: [],
    // The gate across the gap to the stairs: opened, it stays open; a checkpoint.
    gates: [{ from: at(29.5, -15), to: at(32.5, -15), checkpoint: at(31, -17) }],
    // On the guard who fell near the gate.
    keys: [{ ...guard, gate: 0 }],
    levers: [],
    // Past the far side, for now: the manor's park is next.
    exit: { ...at(4, -44), radius: 1.5 },
    bounds: { minX: -18, maxX: 18, minZ: -60, maxZ: 60 },
  }
  return {
    level,
    banks,
    river: ring([
      [0, 6.2], [1.5, 6], [6, 5], [12, 5.5], [18, 4.6], [22.5, 5], [25.5, 5], [29, 5.5], [34, 7], [36, 7.4],
      [36, -0.5], [35, -0.5], [29, -1.5], [25.5, -2], [22.5, -2], [18, -2], [12, -2.5], [6, -1.5], [1, -1], [0, -1],
    ]),
    bridge: { minX: at(22.5, 0).x, maxX: at(25.5, 0).x, minZ: at(0, -2).z, maxZ: at(0, 5).z },
    cart,
    wall: [
      { from: at(0, -15.25), to: at(29.5, -15.25) },
      { from: at(32.5, -15.25), to: at(36, -15.25) },
    ],
    path,
    ravine,
    hilltop: box(20, -33, 26.5, -28.5),
    manor: at(3, -55),
    pine: { from: at(20.2, -31.8), to: at(10.8, -33.2), half: 0.5 },
    overRavine: box(11.5, -34, 19.3, -31),
    farSide: box(0.5, -47.5, 11.4, -15.5),
    thickets,
    treeline,
    rocks,
    trees,
    mushrooms: ring([[15, 39], [18, 36], [20.4, 31], [20.6, 26], [19.5, 20], [17.5, 15.5], [14.5, 13.2], [17, 10.5], [21, 7.5]]),
    spots: [
      ...bushes.map((bush) => ({ ...bush, r: bush.r * 0.6 })),
      circle([25.5, 68.5, 1]),
      ...([[8, 33, 1], [12, 31, 1], [16, 33, 1], [7, 26.5, 0.8], [17, 26.5, 0.8], [12, 25, 1], [5, 37, 1], [4, 29, 1], [15.5, 35, 1], [17.5, 30, 1], [17.5, 25, 0.8]] as [number, number, number][]).map(circle),
      // Where the bridge lands on the far bank.
      circle([24, -5, 1.2]),
    ],
    waiting: [
      { spot: circle([6.4, 53, 0.55]), count: 80, beat: 1 },
      { spot: circle([17.6, 54.3, 0.55]), count: 80, beat: 1 },
      // In the gap's dark, past the trunk, at the edge of the crown's light.
      { spot: circle([12, 44, 1.2]), count: 150, beat: 1 },
      // At the gap's way out.
      { spot: circle([16, 40.5, 1.2]), count: 150, beat: 1 },
      // Thick where the bridge lands.
      { spot: circle([24, -5.5, 1.6]), count: 200, beat: 3 },
      // Round the guard.
      { spot: circle([23, -13.5, 2]), count: 250, beat: 3 },
      // The hill's wood, either side of the steps.
      { spot: circle([33.5, -25, 1.5]), count: 70, beat: 4 },
      { spot: circle([22.5, -24, 1.5]), count: 70, beat: 4 },
      // The ravine, thick under the pine, either side of it: beat 4's too, but brought in only past the gate, once the far bank's rats are let go.
      { spot: circle([15.4, -35.6, 2.2]), count: 250, beat: 4.5 },
      { spot: circle([15.4, -29.8, 2.2]), count: 250, beat: 4.5 },
    ],
    // From the clearing's north-west edge to the east rock: no way past it but under.
    trunk: { root: at(7.6, 51.4), crown: at(13.75, 49.6) },
    bigTree: 0,
    crown: 1,
    faint: 2,
    brazier: 3,
    gateTorch: 4,
    guard,
    strike: 4,
    rush: 4.6,
    afterLit: 3,
    // The clearing's north side, from the big tree's light's edge to five and a half metres short of the trunk.
    fallTrigger: { minX: at(4, 0).x, maxX: at(20, 0).x, minZ: at(0, 50).z, maxZ: at(0, 57).z },
    falling: 0.8,
    checkpoint: at(12, 52.3),
    flameCheckpoint: at(12, 17.6),
    cartCheckpoint: at(26, -4.2),
    farCheckpoint: at(9.6, -35.6),
    farBrazier: 10,
    gutters: 7,
  }
}
