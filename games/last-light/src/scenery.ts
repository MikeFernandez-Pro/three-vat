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
// Everything here but the ground is cut by the see-through round the child.
import {
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshToonNodeMaterial,
  Quaternion,
  Shape,
  SphereGeometry,
  Vector2,
  Vector3,
  type Object3D,
} from 'three/webgpu'
import { defaultSeeThrough, seeThrough, type SeeThrough } from './blockout'
import { heightAt, toOutline } from './heights'
import { inBox } from './play'
import { createToonGradient } from './toon'
import { within } from './walls'
import type { Bounds } from './swarm'
import type { Point, Woods } from './woods'

/** How far the forest runs past the ground that can be walked, m, and how far past it the ground still runs under the last trees. */
const BAND = 8
/** The ground's grid, m a cell. */
const CELL = 1
/** How far apart the forest's trees stand, m, before each is moved off its place; and how far past the treeline the nearest stands. */
const SPACING = 1.8
const CLEAR = 0.7
const COLOURS = { trunk: 0x3a2a1c, crown: 0x1b2619, rock: 0x5f5a54, thicket: 0x1f2e1b, bush: 0x24331f }
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
  /** The trees as the script has them at `t`, s: the big one blasted from the first strike, the cracked one falling from `fellAt` over `falling`. */
  update(t: number, fellAt: number): void
}

/** A repeatable draw, 0 to 1, by an index and a channel. */
const draw = (k: number, n: number) => {
  const s = Math.sin(k * 127.1 + n * 311.7) * 43758.5453
  return s - Math.floor(s)
}

/** The woods' ground, forest, trees, rocks and growth, drawn. */
export function createScenery(map: Woods, look: SeeThrough = defaultSeeThrough()): Scenery {
  const { level, heights } = map
  const groundAt = (x: number, z: number) => heightAt(heights, x, z)
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

  const ground = groundOf(map.treeline, level.bounds, groundAt)

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

  return {
    object,
    ground,
    seeThroughTo(point) {
      subject.value.copy(point)
    },
    update(t, fellAt) {
      bigCrown.visible = t < map.strike
      const fall = Number.isNaN(fellAt) ? 0 : Math.min(1, Math.max(0, (t - fellAt) / map.falling))
      falling.rotation.z = (-Math.PI / 2) * fall * fall
      // The crown burns away as it lands: from there the fallen crown's flame is the light's.
      top.visible = fall < 1
    },
  }
}

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
 * the band of it, every vertex at the ground's height there.
 */
function groundOf(treeline: readonly Point[], bounds: Bounds, groundAt: (x: number, z: number) => number): BufferGeometry {
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
      if (!within(treeline, x, z) && toOutline(treeline, x, z) > BAND + CELL) continue
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
