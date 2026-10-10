// PROTOTYPE: the new level's first three beats (design/level.html), as data
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
// The gate: the way on to the stairs is a gap between two rocks in the far
// bank's north-east, shut by a gate with a lantern on it, seen from the cart.
// The lantern holds rats off and refuels nothing. The key is on the remains of
// a guard who fell near the gate, 8 m west of it, out of the lantern's light,
// between bushes, among waiting rats: seen only once a light reaches him. The
// cart is the only flame on the far bank.
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
  /** The water's edge and the bridge's rails, among the level's walls: they stop the holder, the rats and the light, never the eye. */
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
  /** The lights by their index in the level: the big tree, the fallen crown, the faint flame, the cart's brazier, the gate's lantern, the torch behind the gate. */
  bigTree: number
  crown: number
  faint: number
  brazier: number
  lantern: number
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
  /** Where the run starts again once the torch has been lit: inside the crown's light, south of the trunk; once dipped at the faint flame, beside it; once dipped at the cart's brazier, at the cart's side. */
  checkpoint: Point
  flameCheckpoint: Point
  cartCheckpoint: Point
}

/** Map metres, set into the game's ground. */
const at = (x: number, y: number): Point => ({ x: x - 18, z: y - 25 })
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
    // The far bank's east side, its wood's edge, and its west side.
    [35, -0.5], [35, -6], [32.5, -11],
    // The gap to the stairs, past the gate, closed off past the exit.
    [32.5, -22], [29.5, -22], [29.5, -15],
    [26, -15], [19, -16], [12, -14.5], [6, -11], [2, -6],
    // The far bank's water's edge east to the bridge, its west rail, and the south bank's water's edge west.
    [1, -1, W], [6, -1.5, W], [12, -2.5, W], [18, -2, W], [22.5, -2, W], [22.5, 5, W], [18, 4.6, W], [12, 5.5, W], [6, 5, W],
  ]
  const treeline = ring(shore.map(([x, y]) => [x, y]))
  const edges = sides(treeline)
  const banks = edges.filter((_, k) => shore[k]![2] === W)
  const rocks = [
    // Either side of the gap, and either side of the gate's gap: drawn only, the treeline is their face.
    ring([[6.5, 43], [10, 42], [10, 50], [7.5, 51.5], [5.5, 48]]),
    ring([[14, 42], [19, 43], [20.5, 48], [20, 56], [17.5, 52], [14, 50.5]]),
    ring([[26, -15], [29.5, -15], [29.5, -21], [27, -19]]),
    ring([[32.5, -11], [35, -12], [35, -20], [32.5, -21]]),
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
    // Either side of the guard.
    [25.5, -13.2, 0.9], [20.5, -14.3, 0.9],
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
      // The gate's lantern: it holds rats off and refuels nothing.
      { ...at(30, -14.4), reach: 2, flame: false, on: true },
      // A torch on the rock just behind the gate: shut, the gate keeps its light in; open, it holds the gap while the child goes through. A flame, so it refuels too.
      { ...at(30.2, -16.2), reach: 2.5, flame: true, on: true },
    ],
    walls: [...edges, ...rocks.slice(4).flatMap(sides), ...trees.flatMap((tree) => sides(octagon(tree)))],
    wind: [],
    // The gate across the gap to the stairs: it shuts behind the child, and is a checkpoint.
    gates: [{ from: at(29.5, -15), to: at(32.5, -15), checkpoint: at(31, -17), shutsBehind: true }],
    // On the guard who fell near the gate.
    keys: [{ ...guard, gate: 0 }],
    levers: [],
    // Past the gate, for now: the stairs are next.
    exit: { ...at(31, -20.5), radius: 1.2 },
    bounds: { minX: -18, maxX: 18, minZ: -47, maxZ: 47 },
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
    ],
    // From the clearing's north-west edge to the east rock: no way past it but under.
    trunk: { root: at(7.6, 51.4), crown: at(13.75, 49.6) },
    bigTree: 0,
    crown: 1,
    faint: 2,
    brazier: 3,
    lantern: 4,
    gateTorch: 5,
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
  }
}
