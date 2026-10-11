// The woods drawn (#182), grey-boxed: the play's level (woods.ts) as plain
// shapes, so the beats are judged in 3D before any art is made.
//
// The ground covers the level's own shape and a band of forest round it, and
// nothing past it: the fog closes over the rest. In the band stand simple
// trees, a trunk and a cone each, instanced, so the edges of the ground that
// can be walked read as forest, never as walls. The level's own trees stand
// among them; its rocks are grey blocks, its low thicket a low dark block,
// its bushes low domes; everything on the ground's height (heights.ts).
//
// The big tree stands in its crown until the first strike blasts the crown
// away, and burns bare after. The cracked tree stands at the gap's mouth until
// the second strike, then falls about its root across the gap, and lies
// propped at crawling height, its crown burnt off against the east rock. The
// flames are the lights' own (lights.ts).
//
// Past the wood (#183): the estate wall, stone, running on into the forest
// both ways, its barred gate between two pillars, its leaves swinging in once
// the key opens it; the gamekeeper lying along the wall; the river, a dark
// sheet in its sunk bed, and the bridge over it, a plank deck between rails;
// the cart, where the run has rolled it, its coal pan under the brazier's
// flame; the steps up the hill, a stone block a tread, as high as the ground
// is under them (heights.ts); the ravine, the ground's own; the pine lying
// across it, its root plate on the hill; and the manor's front far off, its
// windows lit. The child stands on the ground, or on the pine's trunk.
//
// Everything here but the ground and the water is cut by the see-through round
// the child.
import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  MeshToonNodeMaterial,
  Quaternion,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Vector2,
  Vector3,
  type Object3D,
} from 'three/webgpu'
import { defaultSeeThrough, seeThrough, type SeeThrough } from './blockout'
import { heightAt, onFlight, standingAt, pointAlong, toOutline, treads } from './heights'
import { inBox } from './play'
import { leaveUnshaded } from './post'
import { createToonGradient } from './toon'
import { distanceTo, within } from './walls'
import type { Run } from './run'
import type { Bounds } from './swarm'
import type { Point, Woods } from './woods'

/** How far the forest runs past the ground that can be walked, m, and how far past it the ground still runs under the last trees. */
const BAND = 8
/** The ground's grid, m a cell. */
const CELL = 1
/** How far apart the forest's trees stand, m, before each is moved off its place; and how far past the treeline the nearest stands. */
const SPACING = 1.8
const CLEAR = 0.7
const COLOURS = {
  trunk: 0x3a2a1c,
  crown: 0x1b2619,
  rock: 0x5f5a54,
  thicket: 0x1f2e1b,
  bush: 0x24331f,
  stone: 0x6f6a63,
  step: 0x7d776f,
  bars: 0x2b2724,
  wood: 0x5a3f28,
  water: 0x15212c,
  cloth: 0x4a4038,
  coals: 0x231d19,
  manor: 0x55504b,
  roof: 0x2c282b,
  window: 0xffc06a,
}
/** The estate wall: how high, m, and how thick, between its faces; its gate's pillars, how wide and how high. */
const WALL = { height: 2.6, thick: 0.5, pillar: 0.8, pillarHeight: 3.2 }
/** How far round each of the gate's leaves swings, radians, and how long it takes, s. */
const GATE_SWING = 1.75
const GATE_OPENING = 1.4
/** The cart: how high its bed stands, m, its wheels' radius, and how high its coal pan stands, under the brazier's flame. */
const CART = { bed: 0.55, wheel: 0.33, pan: 0.85 }
/** How high the cart's flame burns over the ground, m: on its coal pan. */
export const CART_FLAME = { bare: true, height: CART.pan + 0.2, size: 1 }
/** The pine's trunk: its radius, m, and how far it lies sunk into the rims it rests on. */
const LOG = { radius: 0.42, sunk: 0.15 }
/** Where the river's water lies, m: under its banks, over its sunk bed. */
const WATER = -0.45
/** The manor's front: how high, m, and its windows, how far apart and how big. */
const MANOR = { height: 7.5, roof: 3, spacing: 2.6, window: { width: 0.9, height: 1.3 }, rows: [2, 4.9] }
/** How high the fallen trunk lies at its middle, m, and how thick it is: the child crawls under it. */
const PROPPED = 0.85
const TRUNK = 0.32
/** How high the rocks and the low thicket stand, m, and the bushes. */
const ROCK = 2.6
const THICKET = 1.1
const BUSH = 1.1
/** The big tree: its trunk's radius, how high it stands once blasted, and its crown on top until then. */
const BIG = { radius: 0.45, height: 4.6, crown: 5 }
/** How high a burning tree's flame stands, m, and how big it is against a brazier's: the big tree's, and the fallen crown's. */
export const BIG_FLAME = { bare: true, height: BIG.height, size: 3.5 }
export const CROWN_FLAME = { bare: true, height: PROPPED, size: 2.2 }

export interface Scenery {
  readonly object: Group
  /** The ground under the level and its forest, laid with the floor's own material: every vertex at the ground's height. */
  readonly ground: BufferGeometry
  /** Where the see-through's hole is cut round, this frame: the child. */
  seeThroughTo(subject: Vector3): void
  /** How high the child stands at (x, z), m: on the pine's trunk over the ravine, or on the ground. */
  standAt(x: number, z: number): number
  /**
   * The woods as the script and the run have them at `t`, s: the big tree
   * blasted from the first strike, the cracked one falling from `fellAt` over
   * `falling`; the gate swinging open once opened; the cart where it has
   * rolled.
   */
  update(t: number, fellAt: number, run: Run): void
}

/** A repeatable draw, 0 to 1, by an index and a channel. */
const draw = (k: number, n: number) => {
  const s = Math.sin(k * 127.1 + n * 311.7) * 43758.5453
  return s - Math.floor(s)
}

/** The woods' ground, forest, trees, rocks and growth, drawn. */
export function createScenery(map: Woods, look: SeeThrough = defaultSeeThrough()): Scenery {
  const { level, heights } = map
  // What stands on the ground stands on the steps too; the ground's own surface is the shapes', and leaves the steps a hole.
  const groundAt = (x: number, z: number) => standingAt(map, x, z)
  const surfaceAt = (x: number, z: number) => heightAt(heights, x, z)
  const gradient = createToonGradient()
  const { subject, cut } = seeThrough(look)
  const toon = (color: number) => {
    const material = new MeshToonNodeMaterial({ color, gradientMap: gradient })
    cut(material)
    return material
  }
  const trunkMaterial = toon(COLOURS.trunk)
  const crownMaterial = toon(COLOURS.crown)
  const object = new Group()
  const add = <T extends Object3D>(o: T): T => {
    o.traverse((part) => (part.castShadow = part.receiveShadow = true))
    object.add(o)
    return o
  }

  const ground = groundOf(map.treeline, level.bounds, surfaceAt, (x, z) => onFlight(map, x, z))

  // The forest: a tree every few metres in the band past the treeline, out of the river, the ravine, the rocks and the manor.
  const out = [map.river, map.ravine, ...map.rocks]
  const b = level.bounds
  const trees: { x: number; z: number; r: number; h: number }[] = []
  let k = 0
  for (let z = b.minZ - BAND; z <= b.maxZ + BAND; z += SPACING) {
    for (let x = b.minX - BAND; x <= b.maxX + BAND; x += SPACING, k++) {
      const px = x + (draw(k, 1) - 0.5) * SPACING * 0.8
      const pz = z + (draw(k, 2) - 0.5) * SPACING * 0.8
      if (within(map.treeline, px, pz) || out.some((shape) => within(shape, px, pz)) || inBox(map.front, { x: px, z: pz })) continue
      const d = toOutline(map.treeline, px, pz)
      if (d < CLEAR || d > BAND) continue
      trees.push({ x: px, z: pz, r: 0.16 + draw(k, 3) * 0.14, h: 5 + draw(k, 4) * 3 })
    }
  }
  // The level's own trees, among them, their trunks as wide as the walls round them.
  map.trees.forEach((tree, t) => trees.push({ x: tree.x, z: tree.z, r: tree.r * 0.6, h: 7 + draw(t, 5) * 2 }))
  const trunks = new InstancedMesh(new CylinderGeometry(0.75, 1, 1, 7), trunkMaterial, trees.length)
  const crowns = new InstancedMesh(new ConeGeometry(1, 1, 7), crownMaterial, trees.length)
  const m = new Matrix4()
  const turn = new Quaternion()
  const at = new Vector3()
  const size = new Vector3()
  trees.forEach(({ x, z, r, h }, t) => {
    const y = groundAt(x, z)
    const reach = 1 + r * 3 + draw(t, 6) * 0.6
    turn.setFromAxisAngle(UP, draw(t, 7) * Math.PI * 2)
    trunks.setMatrixAt(t, m.compose(at.set(x, y + h / 2, z), turn, size.set(r, h, r)))
    crowns.setMatrixAt(t, m.compose(at.set(x, y + h * 0.3 + (h * 0.75) / 2, z), turn, size.set(reach, h * 0.75, reach)))
  })
  add(trunks)
  add(crowns)

  // The rocks, grey blocks; the low thicket, a low dark block; the bushes, low domes.
  const rockMaterial = toon(COLOURS.rock)
  for (const rock of map.rocks) add(block(rock, ROCK, rockMaterial, groundAt))
  const [thicket, ...bushes] = map.thickets as [Point[], ...Point[][]]
  add(block(thicket, THICKET, toon(COLOURS.thicket), groundAt))
  const dome = new SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)
  const bushMaterial = toon(COLOURS.bush)
  for (const outline of bushes) {
    const cx = outline.reduce((sum, p) => sum + p.x, 0) / outline.length
    const cz = outline.reduce((sum, p) => sum + p.z, 0) / outline.length
    const r = Math.hypot(outline[0]!.x - cx, outline[0]!.z - cz)
    const bush = add(new Mesh(dome, bushMaterial))
    bush.position.set(cx, groundAt(cx, cz), cz)
    bush.scale.set(r, BUSH, r)
  }

  // The big tree, its crown on top until the strike.
  const big = level.lights[map.bigTree]!
  const bigTree = add(new Group())
  bigTree.position.set(big.x, groundAt(big.x, big.z), big.z)
  const bigTrunk = new Mesh(new CylinderGeometry(BIG.radius * 0.7, BIG.radius, BIG.height, 9), trunkMaterial)
  bigTrunk.position.y = BIG.height / 2
  const bigCrown = new Mesh(new ConeGeometry(2.6, BIG.crown, 9), crownMaterial)
  bigCrown.position.y = BIG.height + BIG.crown / 2 - 0.6
  bigTree.add(bigTrunk, bigCrown)

  // The cracked tree: a stump up to where it breaks, and the rest turning over about it, toward where its crown lands.
  const { root, crown } = map.trunk
  const length = Math.hypot(crown.x - root.x, crown.z - root.z) + 0.4
  const cracked = add(new Group())
  cracked.position.set(root.x, groundAt(root.x, root.z) + PROPPED, root.z)
  cracked.rotation.y = -Math.atan2(crown.z - root.z, crown.x - root.x)
  const stump = new Mesh(new CylinderGeometry(TRUNK, TRUNK * 1.15, PROPPED, 8), trunkMaterial)
  stump.position.y = -PROPPED / 2
  const falling = new Group()
  const log = new Mesh(new CylinderGeometry(TRUNK * 0.8, TRUNK, length, 8), trunkMaterial)
  log.position.y = length / 2
  const top = new Mesh(new ConeGeometry(1.6, 3.4, 8), crownMaterial)
  top.position.y = length + 0.6
  falling.add(log, top)
  cracked.add(stump, falling)

  // A block from one point to another, `thick` m across, standing from `base` m up to `top` m.
  const unit = new BoxGeometry(1, 1, 1)
  const slab = (from: Point, to: Point, thick: number, base: number, top: number, material: MeshToonNodeMaterial) => {
    const mesh = add(new Mesh(unit, material))
    mesh.position.set((from.x + to.x) / 2, (base + top) / 2, (from.z + to.z) / 2)
    mesh.scale.set(Math.hypot(to.x - from.x, to.z - from.z), top - base, thick)
    mesh.rotation.y = -Math.atan2(to.z - from.z, to.x - from.x)
    return mesh
  }
  /** `p` moved `d` m on, the way from `from` to it. */
  const onFrom = (from: Point, p: Point, d: number): Point => {
    const l = Math.hypot(p.x - from.x, p.z - from.z)
    return { x: p.x + ((p.x - from.x) / l) * d, z: p.z + ((p.z - from.z) / l) * d }
  }

  // The estate wall, on into the forest past both ends, and its gate's pillars.
  const stone = toon(COLOURS.stone)
  map.wall.forEach(({ from, to }, k) => {
    const a = k === 0 ? onFrom(to, from, BAND) : from
    const b = k === map.wall.length - 1 ? onFrom(from, to, BAND) : to
    slab(a, b, WALL.thick, Math.min(groundAt(a.x, a.z), groundAt(b.x, b.z)) - 0.3, WALL.height, stone)
  })
  const gate = level.gates[0]!
  for (const end of [gate.from, gate.to]) {
    const pillar = add(new Mesh(unit, stone))
    pillar.position.set(end.x, WALL.pillarHeight / 2 - 0.15, end.z)
    pillar.scale.set(WALL.pillar, WALL.pillarHeight, WALL.pillar)
  }
  // The gate's two leaves, bars in a frame, each hung on a pillar and swinging in, toward the gate's checkpoint.
  const barsMaterial = toon(COLOURS.bars)
  const across = Math.atan2(gate.to.z - gate.from.z, gate.to.x - gate.from.x)
  const middle = { x: (gate.from.x + gate.to.x) / 2, z: (gate.from.z + gate.to.z) / 2 }
  const leafWidth = Math.hypot(gate.to.x - gate.from.x, gate.to.z - gate.from.z) / 2 - WALL.pillar / 2
  /** Which way a turn swings a leaf in: toward the checkpoint's side of the gate. */
  const inward = Math.sign(-Math.sin(-across + Math.PI / 2) * (gate.checkpoint.z - middle.z) + Math.cos(-across + Math.PI / 2) * (gate.checkpoint.x - middle.x)) || 1
  const leaves = [gate.from, gate.to].map((hinge, side) => {
    const leaf = add(new Group())
    leaf.position.set(hinge.x, 0, hinge.z)
    const bar = (x: number, y: number, w: number, h: number) => {
      const piece = new Mesh(unit, barsMaterial)
      piece.position.set(x, y, 0)
      piece.scale.set(w, h, 0.06)
      piece.castShadow = piece.receiveShadow = true
      leaf.add(piece)
    }
    const from = WALL.pillar / 2
    for (const y of [0.15, 1.2, 2.25]) bar(from + leafWidth / 2, y, leafWidth, 0.08)
    for (let x = from + 0.06; x <= from + leafWidth; x += 0.17) bar(x, 1.2, 0.04, 2.3)
    return { leaf, rest: -across + (side === 0 ? 0 : Math.PI), turn: side === 0 ? inward : -inward }
  })
  let openedAt = Number.NaN

  // The gamekeeper, fallen along the wall, the key on him.
  const cloth = toon(COLOURS.cloth)
  const keeper = add(new Group())
  keeper.position.set(map.guard.x, groundAt(map.guard.x, map.guard.z), map.guard.z)
  keeper.rotation.y = 0.35
  const body = new Mesh(unit, cloth)
  body.position.set(0, 0.13, 0)
  body.scale.set(1.5, 0.26, 0.42)
  const head = new Mesh(new SphereGeometry(0.14, 10, 8), cloth)
  head.position.set(0.88, 0.13, 0.05)
  keeper.add(body, head)
  keeper.traverse((part) => (part.castShadow = part.receiveShadow = true))

  // The river, a dark sheet over its sunk bed; the bridge over it, a deck of planks between rails.
  const water = new Mesh(new ShapeGeometry(new Shape(map.river.map((p) => new Vector2(p.x, -p.z)))).rotateX(-Math.PI / 2), new MeshToonNodeMaterial({ color: COLOURS.water, gradientMap: gradient }))
  water.position.y = WATER
  water.receiveShadow = true
  object.add(water)
  const wood = toon(COLOURS.wood)
  const { bridge } = map
  const deck = add(new Mesh(unit, wood))
  deck.position.set((bridge.minX + bridge.maxX) / 2, -0.1, (bridge.minZ + bridge.maxZ) / 2)
  deck.scale.set(bridge.maxX - bridge.minX + 0.3, 0.24, bridge.maxZ - bridge.minZ + 0.4)
  for (const x of [bridge.minX, bridge.maxX]) {
    slab({ x, z: bridge.minZ - 0.2 }, { x, z: bridge.maxZ + 0.2 }, 0.1, 0.85, 0.95, wood)
    const posts = Math.ceil((bridge.maxZ - bridge.minZ) / 1.2)
    for (let k = 0; k <= posts; k++) {
      const z = bridge.minZ - 0.15 + ((bridge.maxZ - bridge.minZ + 0.3) * k) / posts
      slab({ x, z: z - 0.06 }, { x, z: z + 0.06 }, 0.12, -0.3, 0.95, wood)
    }
  }

  // The cart: a bed on four wheels, boards round it, and its coal pan under the brazier's flame. Built along its own z, the
  // way on, its back at its origin; to the right of the way on is its own -x.
  const { cart } = map
  const cartGroup = add(new Group())
  const cartPart = (x: number, y: number, z: number, w: number, h: number, d: number) => {
    const part = new Mesh(unit, wood)
    part.position.set(x, y, z)
    part.scale.set(w, h, d)
    cartGroup.add(part)
  }
  cartPart(0, CART.bed, cart.length / 2, cart.half * 2, 0.12, cart.length)
  for (const side of [-1, 1]) cartPart(side * (cart.half - 0.04), CART.bed + 0.25, cart.length / 2, 0.08, 0.4, cart.length)
  for (const z of [0.04, cart.length - 0.04]) cartPart(0, CART.bed + 0.3, z, cart.half * 2, 0.5, 0.08)
  const wheel = new CylinderGeometry(CART.wheel, CART.wheel, 0.1, 14).rotateZ(Math.PI / 2)
  for (const side of [-1, 1]) {
    for (const z of [0.35, cart.length - 0.35]) {
      const part = new Mesh(wheel, barsMaterial)
      part.position.set(side * (cart.half + 0.06), CART.wheel, z)
      cartGroup.add(part)
    }
  }
  const pan = new Mesh(new CylinderGeometry(0.34, 0.26, 0.24, 12), toon(COLOURS.coals))
  pan.position.set(-cart.across, CART.pan - 0.12, cart.along)
  cartGroup.add(pan)
  cartGroup.traverse((part) => (part.castShadow = part.receiveShadow = true))

  // The steps: a stone block a tread, along the road, split where the road turns; each as high as its tread, down past the
  // ground beside it.
  const stepMaterial = toon(COLOURS.step)
  for (const flight of map.flights) {
    const corners = flight.line.reduce<number[]>((at, p, k) => [...at, k === 0 ? 0 : at[k - 1]! + Math.hypot(p.x - flight.line[k - 1]!.x, p.z - flight.line[k - 1]!.z)], [])
    for (const tread of treads(heights, flight)) {
      const cuts = [tread.from, ...corners.filter((s) => s > tread.from && s < tread.to), tread.to]
      for (let k = 0; k + 1 < cuts.length; k++) {
        const a = pointAlong(flight.line, cuts[k]!)
        const b = pointAlong(flight.line, cuts[k + 1]!)
        // From where the piece starts, along the segment it lies on: the two cuts may sit either side of a turn's corner.
        const end = { x: a.x + a.ux * (cuts[k + 1]! - cuts[k]!), z: a.z + a.uz * (cuts[k + 1]! - cuts[k]!) }
        const sides = [-1, 1].flatMap((side) => [a, b].map((p) => surfaceAt(p.x - a.uz * flight.half * side, p.z + a.ux * flight.half * side)))
        slab(a, onFrom(a, end, 0.02), flight.half * 2, Math.min(...sides) - 0.3, tread.height, stepMaterial)
      }
    }
  }

  // The pine across the ravine: its trunk from its root plate on the hill to its broken top on the far side, lying on the
  // rims, sunk into them a little.
  const { pine } = map
  const pineLength = Math.hypot(pine.to.x - pine.from.x, pine.to.z - pine.from.z)
  const rootAt = groundAt(pine.from.x, pine.from.z)
  const topAt = groundAt(pine.to.x, pine.to.z)
  /** How high the trunk's top is along it, a share of the way from its root, m: the child stands on it. */
  const pineTop = (share: number) => rootAt + (topAt - rootAt) * share + 2 * LOG.radius - LOG.sunk
  const trunk = add(new Mesh(new CylinderGeometry(LOG.radius * 0.8, LOG.radius, pineLength + 1.4, 10), trunkMaterial))
  trunk.position.set((pine.from.x + pine.to.x) / 2, (rootAt + topAt) / 2 + LOG.radius - LOG.sunk, (pine.from.z + pine.to.z) / 2)
  trunk.quaternion.setFromUnitVectors(UP, new Vector3(pine.to.x - pine.from.x, topAt - rootAt, pine.to.z - pine.from.z).normalize())
  const plate = add(new Mesh(new CylinderGeometry(1.5, 1.5, 0.35, 12), trunkMaterial))
  const back = onFrom(pine.to, pine.from, 0.7)
  plate.position.set(back.x, rootAt + 0.9, back.z)
  plate.quaternion.copy(trunk.quaternion)

  // The manor's front, far off past the forest path, its windows lit: what the hilltop shows.
  const { front } = map
  const manorAt = groundAt((front.minX + front.maxX) / 2, front.maxZ)
  const manor = add(new Mesh(unit, toon(COLOURS.manor)))
  manor.position.set((front.minX + front.maxX) / 2, manorAt + MANOR.height / 2, (front.minZ + front.maxZ) / 2)
  manor.scale.set(front.maxX - front.minX, MANOR.height, front.maxZ - front.minZ)
  const gable = new Shape([new Vector2(front.minZ, 0), new Vector2(front.maxZ, 0), new Vector2((front.minZ + front.maxZ) / 2, MANOR.roof)])
  const roof = add(new Mesh(new ExtrudeGeometry(gable, { depth: front.maxX - front.minX, bevelEnabled: false }).rotateY(-Math.PI / 2), toon(COLOURS.roof)))
  roof.position.set(front.maxX, manorAt + MANOR.height, 0)
  const lit = new MeshBasicNodeMaterial({ color: COLOURS.window })
  lit.fog = false
  leaveUnshaded(lit)
  const pane = new BoxGeometry(MANOR.window.width, MANOR.window.height, 0.05)
  for (let x = front.minX + MANOR.spacing / 2; x < front.maxX; x += MANOR.spacing) {
    for (const y of MANOR.rows) {
      const glass = new Mesh(pane, lit)
      glass.position.set(x, manorAt + y, front.maxZ + 0.03)
      object.add(glass)
    }
  }

  return {
    object,
    ground,
    seeThroughTo(point) {
      subject.value.copy(point)
    },
    standAt(x, z) {
      if (!(level.noCatch ?? []).some((zone) => within(zone.area, x, z))) return groundAt(x, z)
      // On the trunk, as far along it as the child is.
      const share = ((x - pine.from.x) * (pine.to.x - pine.from.x) + (z - pine.from.z) * (pine.to.z - pine.from.z)) / (pineLength * pineLength)
      return distanceTo(pine, x, z) <= LOG.radius + 0.2 ? pineTop(Math.min(1, Math.max(0, share))) : groundAt(x, z)
    },
    update(t, fellAt, run) {
      bigCrown.visible = t < map.strike
      const fall = Number.isNaN(fellAt) ? 0 : Math.min(1, Math.max(0, (t - fellAt) / map.falling))
      falling.rotation.z = (-Math.PI / 2) * fall * fall
      // The crown burns away as it lands: from there the fallen crown's flame is the light's.
      top.visible = fall < 1
      // The gate: shut, or swinging in from when it opened.
      const open = run.open[0] === true
      if (!open) openedAt = Number.NaN
      else if (Number.isNaN(openedAt)) openedAt = t
      const swing = open ? GATE_SWING * ease(Math.min(1, (t - openedAt) / GATE_OPENING)) : 0
      for (const { leaf, rest, turn } of leaves) leaf.rotation.y = rest + turn * swing
      // The cart where it has rolled, turned the way on.
      const at = run.cartAt()
      if (at !== undefined) {
        cartGroup.position.set(at.x, groundAt(at.x + at.ux * cart.length * 0.5, at.z + at.uz * cart.length * 0.5), at.z)
        cartGroup.rotation.y = Math.atan2(at.ux, at.uz)
      }
    },
  }
}

/** 0 to 1, eased in and out. */
const ease = (t: number) => t * t * (3 - 2 * t)

const UP = new Vector3(0, 1, 0)

/** `outline` stood up `height` m off the lowest ground under its corners, as a block. */
function block(outline: readonly Point[], height: number, material: MeshToonNodeMaterial, groundAt: (x: number, z: number) => number): Mesh {
  // The shape in (x, -z): stood up by a quarter turn about x, its depth is the block's height and its y the ground's z.
  const shape = new Shape(outline.map((p) => new Vector2(p.x, -p.z)))
  const geometry = new ExtrudeGeometry(shape, { depth: height, bevelEnabled: false })
  geometry.rotateX(-Math.PI / 2)
  const mesh = new Mesh(geometry, material)
  mesh.position.y = Math.min(...outline.map((p) => groundAt(p.x, p.z)))
  return mesh
}

/**
 * The ground under the level and its forest: a grid over the level's box and
 * the band round it, each cell kept where it is inside the treeline or within
 * the band of it, and not `under` something that stands in its place, every
 * vertex at the ground's height there.
 */
function groundOf(treeline: readonly Point[], bounds: Bounds, groundAt: (x: number, z: number) => number, under: (x: number, z: number) => boolean): BufferGeometry {
  const minX = bounds.minX - BAND - CELL
  const minZ = bounds.minZ - BAND - CELL
  const nx = Math.ceil((bounds.maxX - bounds.minX + 2 * (BAND + CELL)) / CELL)
  const nz = Math.ceil((bounds.maxZ - bounds.minZ + 2 * (BAND + CELL)) / CELL)
  const positions = new Float32Array((nx + 1) * (nz + 1) * 3)
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = minX + i * CELL
      const z = minZ + j * CELL
      positions.set([x, groundAt(x, z), z], (j * (nx + 1) + i) * 3)
    }
  }
  const index: number[] = []
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = minX + (i + 0.5) * CELL
      const z = minZ + (j + 0.5) * CELL
      if ((!within(treeline, x, z) && toOutline(treeline, x, z) > BAND + CELL) || under(x, z)) continue
      const a = j * (nx + 1) + i
      const c = a + 1
      const b = a + nx + 1
      const d = b + 1
      // Wound to face up: z runs down the grid's rows.
      index.push(a, b, c, b, d, c)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return geometry
}
