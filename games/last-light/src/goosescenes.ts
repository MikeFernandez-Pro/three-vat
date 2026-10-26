// The goose game's scenes, drawn where the goose play has them (#190). The
// well: `public/models/well.glb`, a ring of stone under a roof and a winch,
// turned side on to the camera; its bucket, the file's own, rises out of its
// shaft on a rope from the winch's axle as the interact key is held, the crank turning,
// and drops back down it, let go early, the crank spinning back. The model is
// one mesh: its winch, the axle, the crank and the rope coiled on the axle, is
// split off it as it loads, to turn; its own rope, hanging fixed, is dropped,
// and so are its colliders, the play keeping its own bodies (gooseplay.ts).
// Its lantern is taken off it as it loads: the fire pit by
// it is its light (gooseplay.ts), and its brazier's place, where the lantern
// stood, draws nothing (`WELL_LIGHT`).
// The dead tree: justASimpleTree's bare spooky tree, seed 663
// (`public/models/spookyTrees/spooky-663.glb`), drawn by the plain's dead
// trees as one of their own (deadtrees.ts, `treeWood`): their bark, shell,
// wind and see-through, standing `TreeLook.y` over the ground; its gosling
// perched on top of a branch, turned its own way, riding the branch as the
// wind sways it, and pumpkins round its foot, the well's own, in its palette.
// Its brazier the one Inuciian's tree (`public/models/deadTree.glb`, CC BY
// 4.0) has set by it, at that tree's scale. It never burns: its place's light,
// never lit, draws nothing (`TREE_LIGHT`). Its brazier, at the tree's scale, stands where the
// play has it (gooseplay.ts, TREE_FIRE), in the shell in its file's colours;
// its lamp over its bowl (`TREE_FIRE_LIGHT`), its flame the torch's, the
// page's (flame.ts).
// The cage and the skull (#191): `public/models/cage.glb`, a set laid out
// round the cage, drawn twice its file's size: the cage, its door split off it
// as it loads to swing open on its hinge, its padlock on it; the cart behind
// it; the campfire, the cage's brazier, standing on the brazier, the set
// turned so it does (gooseplay.ts, `Cage.turn`), its lamp over its logs
// (`CAGE_FIRE_LIGHT`), its flame the torch's, the page's (flame.ts); and the
// corpse out in the dark, its skull on the play's skull, the key lying on the
// ground beside it where the play has it, then carried in her right wing
// until it unlocks the cage; unlocked, the padlock drops off the door to the
// ground with the key in it, and the door swings open. The hollow log:
// `public/models/thunderLog.glb`, a fallen trunk lying along the play's line,
// turned half round so its roots are at the far end, as long as the play's
// log, in the shell in its own colour, sized and turned as the play lays it
// (gooseplay.ts, `logTurn`, `logSize`), its gosling running out along it, and
// rolled as its folder has it (`LogLook`). It has no brazier. The strike lands on the top of its roots,
// and from then it burns there and all along the top of its trunk
// (`logFires`), the bark charring: the page's flames, the torch's, and its
// light's lamp over the roots (`LOG_FIRE_LIGHT`). Each scene's fire burns as
// its own `SceneFireLook` has it.
// The fire pit: `public/models/firePit.glb`, an iron bowl of logs (a Tripo
// mesh, untextured), drawn for now on the spawn's brazier alone (`spawnPit`),
// in the shell in an iron colour, where its light stands; its lamp over the
// bowl (`PIT_LIGHT`), its flame the torch's, the page's, on the logs
// (`PIT_BOWL`).
// The goslings in them are goslings.ts's, lifted off the ground by `lift`: in
// the bucket, up the tree, and hopping out of the one and down from the other
// once with her.
import { Box3, Color, CylinderGeometry, Euler, Group, Quaternion, Mesh, MeshBasicNodeMaterial, MeshToonNodeMaterial, Object3D, Vector3, BufferGeometry, type Material, type Texture } from 'three/webgpu'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { CAGE_CAMPFIRE, CART_MIDDLE, WELL_RADIUS, airOf, turned as turnedBy, type GoosePlay, type SceneState, type Tree } from './gooseplay'
import type { Brazier, Point } from './plain'
import type { LightLook } from './lights'
import { ShellToonMaterial, type PaintLook, type ShellLook } from './shell'
import { createStrokes } from './strokes'
import type { ToonLook } from './toon'
import type { Lift } from './goslings'
import type { PlaySwarm } from './play'
import { createToonGradient } from './toon'
import { createPalette, type Palette } from './palettemesh'
import type { DeadTree } from './deadtrees'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * The well's file, and in its own units: the middle and the radius of its ring
 * of stone, the model scaled so its ring is WELL_RADIUS round; where its
 * winch's axle runs, along z through (x, y); and the box its winch lies in,
 * every piece of a part inside it turning with the axle. Its rope is the part
 * in MODEL_ROPE: coiled on the axle, inside the box, and hanging fixed into the
 * shaft, outside it.
 */
const WELL_MODEL = './models/well.glb'
const MODEL_RING = { x: 0.15, z: 0.05, radius: 1.97, top: 2.04 }
const MODEL_AXLE = { x: 0.165, y: 3.165 }
const MODEL_WINCH = new Box3(new Vector3(-0.1, 2.1, -4), new Vector3(0.4, 3.5, 4))
const MODEL_ROPE = 'Material.003'
/** The file's mesh, MODEL_MESH, stood MODEL_LIFT up in it: the ring, the axle and the winch above are the mesh's own, under it. */
const MODEL_MESH = 'Weel'
const MODEL_LIFT = 0.155
/** The lantern whole, its post with the lantern hanging from it: the file's object MODEL_LAMP_POST, taken off it. */
const MODEL_LAMP_POST = 'LanternWeel'
/** How long a body the shells' painted strokes count along, m: the goose's, so a stroke on it is the size of one on her. */
const STROKE_BODY = 0.9
/** The file's colliders, the well's and its lantern's, not drawn. */
const MODEL_COLLIDERS = ['ColliderWeel', 'ColliderLantern']
/** The well's materials that glow, in their own colour: the carved faces of its pumpkins. */
const MODEL_GLOWS = ['Material.011']
/**
 * The well's pumpkins, three, in its file's units: the middle of each on the ground, and the materials their pieces
 * are in, a body, a lid's rim, a stem and a carved face's two; each piece of those within PUMPKIN_REACH of a middle the
 * nearest one's.
 */
const MODEL_PUMPKINS = [
  { x: 0.29, z: 3.05 },
  { x: 1.52, z: 2.39 },
  { x: 1.35, z: -2.34 },
]
const PUMPKIN_MATERIALS = ['Material.012', 'Material.009', 'Material.010', 'Material.011', 'Material.014']
const PUMPKIN_REACH = 1
/** The well's colours over its file's own, by material, and how bright those that glow glow: set from the panel on 2026-10-22. */
const WELL_COLOURS: Record<string, number> = {
  Block2: 0xc5c5c5,
  'Material.001': 0xe08c55,
  'Material.002': 0xe74e00,
  dark2: 0x92562e,
  dark: 0xe08c55,
  Stone2: 0x6b6b6b,
  Stone1: 0xaeaeae,
  Stone3: 0xc5b3bb,
  'Material.004': 0xe5540c,
  Wood2: 0xb27f33,
  Wood1: 0xde9650,
  Block3: 0xa7a7a7,
  'Block3.001': 0x6e6e6e,
  Block1: 0xc9d5c8,
  'Material.012': 0xe78139,
  'Material.010': 0x644929,
  'Material.009': 0xc06c55,
  'Material.011': 0x2e2b29,
  'Material.014': 0xe7947b,
  'Material.003': 0xe7dda5,
  'Material.005': 0xca8761,
  'Material.006': 0x999999,
}
const WELL_GLOWS: Record<string, number> = { 'Material.011': 0 }
const SCALE = WELL_RADIUS / MODEL_RING.radius
/** How high the winch's axle is, m, and how deep the bucket hangs down the shaft, m, out of sight under the ground. */
const WINCH = (MODEL_AXLE.y + MODEL_LIFT) * SCALE
const DEPTH = -0.6
/**
 * The bucket, the file's object MODEL_BUCKET, apart from the well, and how
 * far its rim stands over its middle, m. Its gosling sits SEAT m down in it,
 * its head over the rim.
 */
const MODEL_BUCKET = 'Bucket'
const BUCKET_RIM = 0.54 * SCALE
const SEAT = 0.22
/** How high the ring's top is, m, where the gosling stops on its way out; and how much higher than a straight line each hop arcs, m: out of the bucket under the axle, and down to the ground. */
const RING_TOP = (MODEL_RING.top + MODEL_LIFT) * SCALE
const ARC = [0.12, 0.25] as const
/** How high the bucket's rim comes, wound all the way up, m: a little over the ring, well under the axle, room over its gosling to jump. */
const BUCKET_TOP = RING_TOP + 0.15
/** How many turns of the crank wind the bucket up from the bottom of the shaft to the top. */
const TURNS = 5
/** How fast the bucket drops back down the shaft, let go, m/s. */
const DROP = 4
/** The dead tree's file: justASimpleTree's bare spooky tree, chosen on 2026-10-26, its wood one mesh, its object MODEL_TREE. */
const TREE_MODEL = './models/spookyTrees/spooky-663.glb'
const MODEL_TREE = 'wood'
/** The brazier's file: Inuciian's dead tree, its tree MODEL_FIRE_TREE, and the brazier by it, MODEL_FIRE, at the tree's scale. */
const FIRE_MODEL = './models/deadTree.glb'
const MODEL_FIRE_TREE = 'DeadTree'
const MODEL_FIRE = 'Brazier'
/** How tall the dead tree's file, and the brazier's tree, are drawn at, m, its painted strokes counted at that size. */
const TREE_HEIGHT = 3
/** The share of its height its roots' middle is taken over, from the bottom up. */
const ROOTS = 0.1
/** The hollow log's file: a fallen trunk, one mesh, lying along x, its roots at its -x end. */
const LOG_MODEL = './models/thunderLog.glb'
/** How long the struck log's bark takes to char, s, and the colour it chars to. */
const CHAR = 4
const CHARRED = 0x1c1412
/** How far out of the log its gosling has run before its hiding place's offset is off, m. */
const LOG_HIDE = 1
/** Where along the log, from its roots' end, shares of its length, it burns on the top of its trunk, past its roots. */
const LOG_BURNS = [0.3, 0.48, 0.66, 0.84]
const SHAFT = 0x050405

/** The well's light, its brazier's place, unlit, as the lights draw it: not at all. */
export const WELL_LIGHT: LightLook = { scenery: true }

/**
 * The dead tree as the dead tree folder edits it, read live: how tall it stands, m, its top over its file's origin, how
 * far over the ground its foot stands, m, and how far it is turned, degrees; where its gosling perches, m, off its foot,
 * as it stands unturned at TREE_HEIGHT, moved with it; which way the gosling faces there, degrees, 0 toward the camera
 * (+z); how high over its branch it jumps before it falls, m; and the pumpkins round its foot, each off its trunk's
 * middle, m, along x and z, turned, degrees, and which of the well's three it is, 0 to 2.
 */
export interface TreeLook {
  height: number
  y: number
  turn: number
  perch: { x: number; y: number; z: number }
  goslingTurn: number
  jumpHeight: number
  pumpkins: { x: number; z: number; turn: number; kind: number }[]
}

/**
 * The hollow log as the hollow log folder edits it, read live: its wood; how
 * far it is rolled about its own z, degrees, across its length, tipping one end up; how far its gosling hides off its
 * middle in it, m: along the play's line toward the far end (x), up (y) and across it (z), easing off as it runs out;
 * and how far its first flame, the big one on the top of its roots, where the strike lands, burns off where the file
 * has it, m, in the log's own frame, turned and rolled with it: along it away from its roots (x), up (y) and across it (z).
 */
export interface LogLook {
  wood: number
  tilt: number
  gosling: { x: number; y: number; z: number }
  firstFlame: { x: number; y: number; z: number }
}

/** The dead tree's place's light, never lit, as the lights draw it: not at all. */
export const TREE_LIGHT: LightLook = { scenery: true }
/** The light of the brazier by it, as the lights draw it: its lamp alone, in the flame the page burns on its bowl, the bowl's top TREE_FIRE_BOWL m up. */
export const TREE_FIRE_BOWL = 0.93
export const TREE_FIRE_LIGHT: LightLook = { lampOnly: true, height: TREE_FIRE_BOWL + 0.2 }
/**
 * The cage's set's file, drawn SET_SCALE times its size, the cage CAGE round;
 * and in its own units, from the cage's middle: the box its door's pieces lie
 * in, and its hinge's line, up through (x, z); the middle of the corpse's
 * skull, and how high its top is, where the key lies. Its objects by name.
 */
const CAGE_MODEL = './models/cage.glb'
const SET_SCALE = 2
const MODEL_DOOR = new Box3(new Vector3(-0.065, 0.02, 0.07), new Vector3(0.07, 0.25, 0.145))
const MODEL_HINGE = { x: -0.067, z: 0.105 }
const MODEL_SKULL = { x: -2.607, z: -0.854, top: 0.245 }
const MODEL_SET = { cage: 'Cage', lock: 'Lock', key: 'Key', cart: 'Car', corpse: 'Corpse', campfire: 'Campfire' }
/** The fire pit's file: an iron bowl on legs, logs in it, in metres, its foot on the origin. */
const PIT_MODEL = './models/firePit.glb'
/** How big the fire pit is drawn, times its file; and its iron. */
const PIT_SCALE = 0.8
const PIT_IRON = 0x3a3330
/** How high the top of the logs in the fire pit stands, m, where its flame burns. */
export const PIT_BOWL = 0.36 * PIT_SCALE
/** The fire pit's light as the lights draw it: its lamp alone, over the bowl, the page burning the torch's flame on the logs. */
export const PIT_LIGHT: LightLook = { lampOnly: true, height: 0.8 }
/** Which brazier the fire pit is drawn on: for now the spawn's alone, the first on the plain, if no scene takes it; -1, none. */
export const spawnPit = (plain: { braziers: readonly Brazier[] }) => (plain.braziers[0] && plain.braziers[0].scene === undefined ? 0 : -1)
/** The log's fire, unlit until the strike, as the lights draw it: its lamp alone, over the top of its roots, the page burning the torch's flame on them. */
export const LOG_FIRE_LIGHT: LightLook = { lampOnly: true, height: 1.5 }
/** The cage's brazier, its set's campfire, as the lights draw it: its lamp alone, over the logs, the page burning the torch's flame on them. */
export const CAGE_FIRE_LIGHT: LightLook = { lampOnly: true, height: 0.6 }
/**
 * A scene's fire as it burns, the torch's flame (flame.ts) on its brazier or
 * its campfire: how tall and wide, m, and how high its foot stands off the
 * ground, m; how far off its fire it burns, m, along x and z; its colours,
 * outside in, its edge, its body and its core; and its lamp's colour and how
 * bright it shines.
 */
export interface SceneFireLook {
  height: number
  width: number
  foot: number
  x: number
  z: number
  color: number
  body: number
  core: number
  lamp: number
  intensity: number
}
/**
 * The cage's door: how far it swings open, rad, and how fast, rad/s. The key:
 * how high over her it is carried, m, how far it bobs there, m, and how fast,
 * rad/s, and how fast it turns, rad/s. The log: how long its near end glows
 * once lit, s.
 */
const DOOR_OPEN = 1.9
const DOOR_SWING = 3
/** How high off the ground the key's middle is, lying by the body, m. */
const KEY_LIES = 0.02
/** How fast the padlock falls off the unlocked door, m/s², and how high its middle lies off the ground once down, m. */
const LOCK_FALL = 9.8
const LOCK_LIES = 0.04
/** How far out in front of the door the padlock lands, m. */
const LOCK_OUT = 0.3
/** The goose's bones in her right wing, from her shoulder out, the key carried on one of them. */
export const RIGHT_WING = ['bone_wing_R1', 'bone_wing_R2', 'bone_wing_R3'] as const
/**
 * The key carried in her wing: on which of its bones; how far off it, m,
 * along the bone's own x, y and z, so it moves with the wing; how it is turned
 * there, degrees about the bone's x, y and z; and how big, times its size on
 * the ground.
 */
export interface KeyInWing {
  bone: string
  size: number
  x: number
  y: number
  z: number
  turnX: number
  turnY: number
  turnZ: number
}

/**
 * A scene's pieces as drawn: the well's winch, its bucket and rope, and how
 * high the bucket's rim is, m; the tree's bark; the cage's door, its key loose and in its padlock, and where
 * the key lies on the skull; the log, its bark, which way the play's line runs,
 * rad about y, and where it burns: the top of its roots, then along its trunk.
 */
/**
 * The padlock and the key in it, dropped off the unlocked door as one block:
 * the group they fall in, from their middle; where it starts and where it
 * lands, a little out in front of the door; the way out of the door, along the
 * ground; and where each came from on the door, to hang them back if the cage
 * is set again.
 */
interface Dropped {
  group: Group
  from: Vector3
  to: Vector3
  out: Vector3
  home: { piece: Object3D; parent: Object3D; position: Vector3; quaternion: Quaternion; scale: Vector3 }[]
}

type TreePart = Extract<Part, { kind: 'tree' }>
type Part = { group: Group } & (
  | { kind: 'well'; winch: Object3D; bucket: Object3D; rope: Mesh; rim: number }
  | { kind: 'tree'; model: Object3D; fire: Object3D; turn: number | null; pumpkins: Mesh; pumpkinsKey: string }
  | { kind: 'cage'; turned: Object3D; campfire: Object3D; door: Object3D; key: Object3D; locked: Object3D; lock: Object3D; drop: Dropped | null; set: Object3D; cart: Object3D; corpse: Object3D }
  | { kind: 'log'; model: Object3D; bark: ShellToonMaterial; along: number; fires: Object3D[] }
)

/**
 * A piece of a scene as the 3D page's edit mode (gooseedit.ts) moves and turns it: what it picks and boxes, its name,
 * and what moves it on the ground by (dx, dz) m and turns it by radians about its own place, the drawing and the play
 * together; and, for a scene's own piece, the whole scene written into `braziers`, the plain's, as the route will hold it.
 */
export interface EditPiece {
  name: string
  object: Object3D
  move(dx: number, dz: number): void
  turn?(by: number): void
  save?(braziers: Brazier[]): void
}

export interface GooseScenes {
  object: Group
  /** Each scene as `now` has it, its bucket moved over `dt` of play, s; the cage's key carried on her bone that `bone` finds by its name, if she carries it. */
  update(now: GoosePlay<PlaySwarm>, dt: number, bone?: (name: string) => Object3D | undefined): void
  /** The shells of the dead tree, the log, the fire pits and the cage's pieces, toon steps and painted strokes: the goose's look. */
  setShell(look: ShellLook & { paint: PaintLook; toon: ToonLook }): void
  /**
   * How far off its place gosling `k` is drawn, m: up off the ground in the
   * bucket, up the tree, hopping down from them; and across with the bucket's offset
   * while in it, easing off as it hops out onto the rim. None elsewhere. Up
   * the tree, the way it faces there too, and jumping down, the way it jumps.
   */
  lift(now: GoosePlay<PlaySwarm>, k: number): Lift
  /**
   * The well's colours, the bucket's among them, one a material of its file,
   * by the material's name; and how bright each of those that glow glows in
   * its colour, 0 not at all: as the panel edits them, `wellChanged` lays them on.
   */
  wellColours: Record<string, number>
  wellGlows: Record<string, number>
  wellChanged(): void
  /** How far the bucket is drawn off its place under the winch, m, across the screen (x), up (y) and toward the camera (z), its rope left where it hangs; its gosling's height with it. Read live. */
  bucketOffset: { x: number; y: number; z: number }
  /** The dead tree's look, every tree's. Read live. */
  tree: TreeLook
  /** The dead tree's wood, for the dead trees to draw as their own (DeadTreesMesh.own), `ownTrees` laying them. */
  treeWood: readonly BufferGeometry[]
  /** Every dead tree as the dead trees draw it, as `now` has its scene and the look has it: a variant of `treeWood` each. */
  ownTrees(now: GoosePlay<PlaySwarm>): DeadTree[]
  /** Where the dead trees sway the wood of `tree` at `at` to, into `out`, for its gosling to ride its branch; none, it never sways. */
  swayTree?: (tree: DeadTree, at: Vector3, out: Vector3) => Vector3
  /** The hollow log's look, every log's. Read live. */
  log: LogLook
  /**
   * Where each hollow log burns once struck, by log in the scenes' order, as last drawn, m: first the top of its roots,
   * where its strike lands, then along the top of its trunk, LOG_BURNS.
   */
  readonly logFires: readonly (readonly Vector3[])[]
  /** Where the cage's key is carried in her wing. Read live. */
  keyInWing: KeyInWing
  /** How the cage is turned and how big its campfire is. Read live. */
  cage: CageLook
  /** The fire pit, on its brazier's light wherever it stands, for the edit mode to pick; none if no brazier wears it. */
  readonly pit: Object3D | undefined
  /** The fire pit by each well, on its light wherever it stands, in the play's `wellFires` order. */
  readonly wellPits: readonly Object3D[]
  /** Every scene's pieces, for the edit mode, each moving and turning `now`'s scenes with the drawing. */
  pieces(now: GoosePlay<PlaySwarm>): EditPiece[]
  /** The cage's set's colours, one a material of its file, by the material's name: as the panel edits them, `cageChanged` lays them on. */
  cageColours: Record<string, number>
  cageChanged(): void
}

/** The cage's look: how far the cage and its door are turned about its middle, degrees, past its set's turn; and how big its campfire is, times its set's size. */
export interface CageLook {
  turn: number
  campfire: number
}

/**
 * The pieces of `geometry`, each its triangles joined by shared corners, as
 * the index lists them, and its box: its corners welded by where they are, as
 * the file splits a corner by its normals.
 */
function piecesOf(geometry: BufferGeometry): { index: number[]; box: Box3 }[] {
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  const at = (t: number) => (index ? index.getX(t) : t)
  const count = index ? index.count : position.count
  const welded = new Map<string, number>()
  const corner = new Int32Array(position.count)
  for (let i = 0; i < position.count; i++) {
    const key = `${position.getX(i).toFixed(4)},${position.getY(i).toFixed(4)},${position.getZ(i).toFixed(4)}`
    let w = welded.get(key)
    if (w === undefined) welded.set(key, (w = welded.size))
    corner[i] = w
  }
  const parent = Array.from({ length: welded.size }, (_, i) => i)
  const root = (x: number) => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]!]!
    return x
  }
  for (let t = 0; t < count; t += 3) {
    const a = root(corner[at(t)]!)
    parent[root(corner[at(t + 1)]!)] = a
    parent[root(corner[at(t + 2)]!)] = a
  }
  const pieces = new Map<number, { index: number[]; box: Box3 }>()
  const v = new Vector3()
  for (let t = 0; t < count; t += 3) {
    const r = root(corner[at(t)]!)
    let piece = pieces.get(r)
    if (!piece) pieces.set(r, (piece = { index: [], box: new Box3() }))
    for (let k = 0; k < 3; k++) {
      piece.index.push(at(t + k))
      piece.box.expandByPoint(v.fromBufferAttribute(position, at(t + k)))
    }
  }
  return [...pieces.values()]
}

/**
 * The well's pumpkins off `meshes`, its file's, each one mesh in `palette`, in metres at the well's scale, its middle
 * on the origin and its foot on the ground; `meshes` left whole, the pumpkins still on the well.
 */
function pumpkinsOf(meshes: readonly Mesh[], palette: Palette): BufferGeometry[] {
  const middle = new Vector3()
  const nearest = (box: Box3) => {
    box.getCenter(middle)
    let best = -1
    let off = PUMPKIN_REACH
    MODEL_PUMPKINS.forEach((p, k) => {
      const d = Math.hypot(middle.x - p.x, middle.z - p.z)
      if (d < off) [best, off] = [k, d]
    })
    return best
  }
  const pieces = meshes.filter((mesh) => PUMPKIN_MATERIALS.includes((mesh.material as Material).name)).map((mesh) => ({ mesh, pieces: piecesOf(mesh.geometry) }))
  return MODEL_PUMPKINS.map((at, k) => {
    const root = new Group()
    for (const { mesh, pieces: these } of pieces) {
      const index = these.filter((piece) => nearest(piece.box) === k).flatMap((piece) => piece.index)
      if (index.length > 0) root.add(new Mesh(mesh.geometry.clone().setIndex(index), mesh.material))
    }
    const geometry = palette.merge(root, [...root.children] as Mesh[]).geometry
    geometry.computeBoundingBox()
    return geometry.translate(-at.x, -geometry.boundingBox!.min.y, -at.z).scale(SCALE, SCALE, SCALE)
  })
}

/**
 * The well model's winch split off it into a group of its own, `winch`,
 * turning about the axle: every piece of a part inside MODEL_WINCH. The rope
 * hanging from the axle, the rest of MODEL_ROPE, is dropped.
 */
function splitWinch(model: Object3D): void {
  const winch = new Group()
  winch.name = 'winch'
  winch.position.set(MODEL_AXLE.x, MODEL_AXLE.y, 0)
  const meshes: Mesh[] = []
  model.getObjectByName(MODEL_MESH)!.traverse((o) => {
    if ((o as Mesh).isMesh) meshes.push(o as Mesh)
  })
  for (const mesh of meshes) {
    const rope = (mesh.material as Material).name === MODEL_ROPE
    const turning: number[] = []
    const fixed: number[] = []
    for (const piece of piecesOf(mesh.geometry)) {
      if (MODEL_WINCH.containsBox(piece.box)) turning.push(...piece.index)
      else if (!rope) fixed.push(...piece.index)
    }
    if (turning.length === 0 && !rope) continue
    const keep = (index: number[]) => mesh.geometry.clone().setIndex(index)
    if (turning.length > 0) {
      const part = new Mesh(keep(turning), mesh.material)
      part.position.set(-MODEL_AXLE.x, -MODEL_AXLE.y, 0)
      winch.add(part)
    }
    if (fixed.length > 0) mesh.geometry = keep(fixed)
    else mesh.removeFromParent()
  }
  model.getObjectByName(MODEL_MESH)!.add(winch)
}

/** The middle of the roots of a tree in `geometry`, y up: the middle of the box its lowest ROOTS of its height make, at its foot. */
function rootsOf(geometry: BufferGeometry): Vector3 {
  geometry.computeBoundingBox()
  const box = geometry.boundingBox!
  const height = box.max.y - box.min.y
  const roots = new Box3()
  const position = geometry.getAttribute('position')
  const v = new Vector3()
  for (let i = 0; i < position.count; i++) {
    if (v.fromBufferAttribute(position, i).y <= box.min.y + height * ROOTS) roots.expandByPoint(v)
  }
  return roots.getCenter(v).setY(box.min.y)
}

/** The meshes under `name` in `file`, its world matrices up to date. */
function meshesOf(file: Object3D, name: string): Mesh[] {
  const meshes: Mesh[] = []
  file.getObjectByName(name)!.traverse((o) => {
    if ((o as Mesh).isMesh) meshes.push(o as Mesh)
  })
  return meshes
}

/** The tree `name` in `file` as one geometry in metres, y up, stood on the middle of its roots, the box its lowest ROOTS of its height make; and how much it was scaled by to stand TREE_HEIGHT tall. */
function standTree(file: Object3D, name: string): { geometry: BufferGeometry; size: number } {
  const mesh = meshesOf(file, name)[0]!
  const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
  const foot = rootsOf(geometry)
  const size = TREE_HEIGHT / (geometry.boundingBox!.max.y - foot.y)
  geometry.translate(-foot.x, -foot.y, -foot.z).scale(size, size, size)
  return { geometry, size }
}

/**
 * The dead tree's wood as its file has it, its foot on the origin, for the dead trees to draw, and how high its top
 * stands over its foot, in the file's units. Its brazier's pieces at the scale its own file's tree stands TREE_HEIGHT
 * tall at, each in metres round the brazier's own middle, with its material's colour.
 */
async function loadTree(): Promise<{ wood: BufferGeometry; top: number; fire: { geometry: BufferGeometry; color: Color }[] }> {
  const [treeFile, fireFile] = await Promise.all([TREE_MODEL, FIRE_MODEL].map(async (url) => (await new GLTFLoader().loadAsync(url)).scene))
  treeFile!.updateMatrixWorld(true)
  fireFile!.updateMatrixWorld(true)
  const mesh = meshesOf(treeFile!, MODEL_TREE)[0]!
  const wood = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
  wood.computeBoundingBox()
  const { size } = standTree(fireFile!, MODEL_FIRE_TREE)
  const base = fireFile!.getObjectByName(MODEL_FIRE)!.getWorldPosition(new Vector3())
  const fire = meshesOf(fireFile!, MODEL_FIRE).map((piece) => ({
    geometry: piece.geometry.clone().applyMatrix4(piece.matrixWorld).translate(-base.x, -base.y, -base.z).scale(size, size, size),
    color: (piece.material as Material & { color?: Color }).color ?? new Color(0xffffff),
  }))
  return { wood, top: wood.boundingBox!.max.y, fire }
}

/**
 * The hollow log's file as one geometry in metres, `length` m long along x, its roots' end at -x, on the ground, the
 * middle of its length and breadth on the origin; where it burns: the top of its roots, its highest point, where a
 * strike lands, then the top of its trunk at each of LOG_BURNS; and its material's colour and side.
 */
async function loadLog(length: number): Promise<{ geometry: BufferGeometry; fires: Vector3[]; color: Color; side: Material['side'] }> {
  const file = (await new GLTFLoader().loadAsync(LOG_MODEL)).scene
  file.updateMatrixWorld(true)
  let mesh: Mesh | undefined
  file.traverse((o) => {
    if (!mesh && (o as Mesh).isMesh) mesh = o as Mesh
  })
  const geometry = mesh!.geometry.clone().applyMatrix4(mesh!.matrixWorld)
  geometry.computeBoundingBox()
  const box = geometry.boundingBox!
  const middle = box.getCenter(new Vector3())
  const size = length / (box.max.x - box.min.x)
  geometry.translate(-middle.x, -box.min.y, -middle.z).scale(size, size, size)
  // The highest point of all, and the highest within a twentieth of its length of each share along it.
  const position = geometry.getAttribute('position')
  const v = new Vector3()
  const highest = (near: (x: number) => boolean) => {
    const top = new Vector3(0, -Infinity, 0)
    for (let i = 0; i < position.count; i++) if (near(v.fromBufferAttribute(position, i).x) && v.y > top.y) top.copy(v)
    return top
  }
  const fires = [highest(() => true), ...LOG_BURNS.map((share) => highest((x) => Math.abs(x - (share - 0.5) * length) < length / 20))]
  const material = mesh!.material as Material & { color?: Color }
  return { geometry, fires, color: material.color ?? new Color(0xffffff), side: material.side }
}

/**
 * The cage's set's file in toon materials of its own colours, in its own
 * units, each piece to be cloned, scaled and turned: the cage and its cart,
 * round the cage's middle, the door split off the cage into a group of its
 * own, `door`, turning on the hinge, its padlock and the key in it, `locked`,
 * on it, the cage and its door turning together in `cage`; the campfire round
 * its middle; the corpse round its skull's; the key round its own middle,
 * lying flat; and its toon materials, by their file's names.
 */
async function loadCageSet(gradient: Texture): Promise<{ set: Group; cart: Group; campfire: Group; corpse: Group; key: Group; materials: Map<string, MeshToonNodeMaterial> }> {
  const file = (await new GLTFLoader().loadAsync(CAGE_MODEL)).scene
  const materials = new Map<string, MeshToonNodeMaterial>()
  file.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    const material = mesh.material as Material & { color?: Color }
    let toon = materials.get(material.name)
    if (!toon) materials.set(material.name, (toon = new MeshToonNodeMaterial({ color: material.color ?? new Color(0xffffff), side: material.side, gradientMap: gradient })))
    mesh.material = toon
    mesh.castShadow = mesh.receiveShadow = true
  })
  file.updateMatrixWorld(true)
  const named = (name: string) => file.getObjectByName(name)!
  const around = (o: Object3D, x: number, z: number) => {
    o.position.x -= x
    o.position.z -= z
    return new Group().add(o)
  }
  // The door's pieces off the cage, at the cage's place, under the hinge; its padlock and the key in it with them.
  const cage = named(MODEL_SET.cage) as Mesh
  const door: number[] = []
  const bars: number[] = []
  for (const piece of piecesOf(cage.geometry)) (MODEL_DOOR.containsBox(piece.box.applyMatrix4(cage.matrixWorld)) ? door : bars).push(...piece.index)
  const hinged = new Mesh(cage.geometry.clone().setIndex(door), cage.material)
  cage.geometry = cage.geometry.clone().setIndex(bars)
  hinged.position.copy(cage.position)
  hinged.quaternion.copy(cage.quaternion)
  hinged.scale.copy(cage.scale)
  hinged.castShadow = hinged.receiveShadow = true
  const locked = named(MODEL_SET.key).clone()
  locked.name = 'locked'
  const swing = around(hinged, MODEL_HINGE.x, MODEL_HINGE.z)
  swing.add(around(named(MODEL_SET.lock), MODEL_HINGE.x, MODEL_HINGE.z), around(locked, MODEL_HINGE.x, MODEL_HINGE.z))
  swing.name = 'door'
  swing.position.set(MODEL_HINGE.x, 0, MODEL_HINGE.z)
  // The cage and its door in a group of their own, turning about the cage's middle.
  const turned = new Group().add(cage, swing)
  turned.name = 'cage'
  // The cart in a group of its own, still in the set's units round the cage's middle, so the route can stand it apart.
  const set = new Group().add(turned)
  const cart = new Group().add(named(MODEL_SET.cart))
  const fire = { x: CAGE_CAMPFIRE.x / SET_SCALE, z: CAGE_CAMPFIRE.z / SET_SCALE }
  // The key on its side, its bow flat.
  const key = named(MODEL_SET.key)
  const middle = new Box3().setFromObject(key).getCenter(new Vector3())
  key.position.sub(middle)
  const flat = new Group().add(key)
  flat.rotation.z = Math.PI / 2
  return {
    set,
    cart,
    campfire: around(named(MODEL_SET.campfire), fire.x, fire.z),
    corpse: around(named(MODEL_SET.corpse), MODEL_SKULL.x, MODEL_SKULL.z),
    key: new Group().add(flat),
    materials,
  }
}

/** The scenes of `play`, each on the ground at `groundAt`. */
export async function createGooseScenes(
  play: GoosePlay<PlaySwarm>,
  groundAt: (x: number, z: number) => number = () => 0,
): Promise<GooseScenes> {
  const object = new Group()
  const gradient = createToonGradient()
  // The well's model, its bucket taken off it, its lantern dropped and its winch split off it, its
  // materials' colours one texel each of a palette: what stands, the winch and the bucket each one mesh.
  const well = (await new GLTFLoader().loadAsync(WELL_MODEL)).scene
  const bucketModel = well.getObjectByName(MODEL_BUCKET)!
  bucketModel.removeFromParent()
  bucketModel.position.set(0, 0, 0)
  for (const name of MODEL_COLLIDERS) well.getObjectByName(name)?.removeFromParent()
  well.getObjectByName(MODEL_LAMP_POST)?.removeFromParent()
  splitWinch(well)
  const strokes = createStrokes()
  const shells: ShellToonMaterial[] = []
  const fileColours = new Map<string, number>()
  const meshesUnder = (root: Object3D, skip?: Object3D) => {
    const meshes: Mesh[] = []
    root.traverse((o) => {
      const mesh = o as Mesh
      if (!mesh.isMesh || (skip && mesh.parent === skip)) return
      const material = mesh.material as Material & { color?: Color }
      if (!fileColours.has(material.name)) fileColours.set(material.name, material.color?.getHex() ?? 0xffffff)
      meshes.push(mesh)
    })
    return meshes
  }
  const winchModel = well.getObjectByName('winch')!
  const standing = meshesUnder(well, winchModel)
  const winding = meshesUnder(winchModel)
  const bucketMeshes = meshesUnder(bucketModel)
  const palette = createPalette([...fileColours.keys()], gradient)
  const pumpkinKinds = pumpkinsOf(standing, palette)
  palette.merge(well, standing)
  palette.merge(winchModel, winding)
  palette.merge(bucketModel, bucketMeshes)
  // The rope down to the bucket, a cylinder of its own, in the rope's colour.
  const ropeMaterial = new MeshToonNodeMaterial({ gradientMap: gradient })
  const wellColours = Object.fromEntries([...fileColours].map(([name, colour]) => [name, WELL_COLOURS[name] ?? colour]))
  const wellGlows = Object.fromEntries(MODEL_GLOWS.filter((name) => fileColours.has(name)).map((name) => [name, WELL_GLOWS[name] ?? 0]))
  const wellChanged = () => {
    for (const [name, colour] of Object.entries(wellColours)) palette.set(name, colour, wellGlows[name] ?? 0)
    ropeMaterial.color.setHex(wellColours[MODEL_ROPE] ?? 0xffffff)
  }
  wellChanged()
  // The dead tree's file, its gosling on top of a branch.
  const treeFile = await loadTree()
  // Set from the panel on 2026-10-27: a taller tree, its gosling's perch on a lower fork; its pumpkins where the first
  // scatter of them stood, turned and picked again.
  const tree: TreeLook = {
    height: 6.85,
    y: -0.02,
    turn: -103,
    perch: { x: 0.32, y: 0.88, z: 0.02 },
    goslingTurn: 34,
    jumpHeight: 0.25,
    pumpkins: [
      { x: -1.24, z: -0.43, turn: -180, kind: 1 },
      { x: 0.76, z: -1.13, turn: -64, kind: 2 },
      { x: 0.38, z: 1.22, turn: -44, kind: 1 },
      { x: -0.76, z: 0.89, turn: -35, kind: 0 },
    ],
  }
  const cageSet = await loadCageSet(gradient)
  // The hollow log's file, as long as the play's log end to end.
  const firstLog = play.scenes.find((s) => s.kind === 'log')
  const logFile = await loadLog(firstLog?.kind === 'log' ? Math.hypot(firstLog.ends.far.x - firstLog.ends.near.x, firstLog.ends.far.z - firstLog.ends.near.z) : 1)
  // Set from the panel on 2026-10-23. How it lies, turned and sized, is the play's (`logTurn`, `logSize`): its gosling runs out along it.
  const log: LogLook = { wood: 0xa5664e, tilt: 0, gosling: { x: 0.37, y: 0.19, z: 0.01 }, firstFlame: { x: 0.1, y: -0.61, z: 0 } }
  const charred = new Color(CHARRED)
  // The fire pit, on the spawn's brazier, in the shell in its iron.
  // And by each well, the same.
  const pitAt = spawnPit(play.plain)
  const pitCount = (pitAt < 0 ? 0 : 1) + play.wellFires.length
  const pitFile = pitCount > 0 ? (await new GLTFLoader().loadAsync(PIT_MODEL)).scene : undefined
  const iron = new ShellToonMaterial({ color: PIT_IRON, painted: { strokes, extent: STROKE_BODY } })
  if (pitFile) shells.push(iron)
  pitFile?.updateMatrixWorld(true)
  const newPit = () => {
    const group = new Group()
    pitFile!.traverse((o) => {
      const mesh = o as Mesh
      if (!mesh.isMesh) return
      const piece = new Mesh(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld).scale(PIT_SCALE, PIT_SCALE, PIT_SCALE), iron)
      piece.castShadow = piece.receiveShadow = true
      group.add(piece)
    })
    object.add(group)
    return group
  }
  const pit = pitAt < 0 ? undefined : newPit()
  const wellPits = play.wellFires.map(() => newPit())
  const shaft = new MeshBasicNodeMaterial({ color: SHAFT })
  const add = (parent: Group, mesh: Mesh, at: Vector3) => {
    mesh.position.copy(at)
    mesh.castShadow = mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  /** Where the dead trees draw the dead tree of `scene`, as its look and `part`'s turn have it. */
  const treeOf = (scene: SceneState, part: TreePart): DeadTree => ({
    x: scene.x,
    z: scene.z,
    variant: 0,
    turn: ((part.turn ?? tree.turn) * Math.PI) / 180,
    height: tree.height,
    width: 1,
    lift: tree.y,
  })
  const branch = new Vector3()
  const swayed = new Vector3()
  /**
   * The pumpkins round the dead tree of `scene`, each where and as the folder sets it, on the ground there; laid again
   * when the folder or the tree's place changes.
   */
  const layPumpkins = (part: TreePart, scene: Tree) => {
    const y = part.group.position.y
    const key = JSON.stringify([tree.pumpkins, scene.x, scene.z, y])
    if (key === part.pumpkinsKey) return
    part.pumpkinsKey = key
    const placed = tree.pumpkins.map(({ x, z, turn, kind }) => {
      const pumpkin = pumpkinKinds[Math.min(pumpkinKinds.length - 1, Math.max(0, Math.round(kind)))]!
      return pumpkin.clone().rotateY((turn * Math.PI) / 180).translate(x, groundAt(scene.x + x, scene.z + z) - y, z)
    })
    part.pumpkins.geometry.dispose()
    part.pumpkins.geometry = placed.length > 0 ? mergeGeometries(placed) : new BufferGeometry()
  }
  // Each scene's pieces: the well's bucket and rope, and how high the bucket's rim is drawn, m, easing after the play; the tree's bark.
  const parts = play.scenes.map((scene: SceneState): Part => {
    const group = new Group()
    group.position.set(scene.x, groundAt(scene.x, scene.z), scene.z)
    object.add(group)
    if (scene.kind === 'well') {
      // Turned as the route has it.
      group.rotation.y = scene.turn
      // Its ring on the scene's middle, side on to the camera, which looks up the plain (-z).
      const model = well.clone() as Object3D
      model.scale.setScalar(SCALE)
      model.position.set(-MODEL_RING.x * SCALE, 0, -MODEL_RING.z * SCALE)
      const turned = new Group().add(model)
      turned.rotation.y = -Math.PI / 2
      group.add(turned)
      add(group, new Mesh(new CylinderGeometry(WELL_RADIUS * 0.75, WELL_RADIUS * 0.75, 0.02, 16), shaft), new Vector3(0, 0.02, 0)).castShadow = false
      // The bucket and its rope, from the winch down to its rim.
      const bucket = bucketModel.clone()
      bucket.scale.setScalar(SCALE)
      bucket.rotation.y = turned.rotation.y
      group.add(bucket)
      const rope = add(group, new Mesh(new CylinderGeometry(0.015, 0.015, 1, 4), ropeMaterial), new Vector3())
      return { kind: 'well', group, winch: model.getObjectByName('winch')!, bucket, rope, rim: DEPTH }
    }
    if (scene.kind === 'cage') {
      // Its set on the scene's middle, its campfire on the brazier and its corpse's skull on the play's skull, all turned alike.
      const placed = (piece: Group, x: number, z: number) => {
        const copy = piece.clone()
        copy.scale.setScalar(SET_SCALE)
        copy.rotation.y = scene.turn
        copy.position.set(x, groundAt(x, z), z)
        object.add(copy)
        return copy
      }
      const set = placed(cageSet.set, scene.x, scene.z)
      // Its cart where the route stands it: the set's own place for it, moved by the play's `cart`.
      const cart = placed(cageSet.cart, scene.x + scene.cart.x, scene.z + scene.cart.z)
      const fire = play.plain.braziers[scene.brazier]!
      const campfire = placed(cageSet.campfire, fire.x, fire.z)
      const { skull } = scene
      const corpse = placed(cageSet.corpse, skull.x, skull.z)
      const key = placed(cageSet.key, scene.key.x, scene.key.z)
      return { kind: 'cage', group, turned: set.getObjectByName('cage')!, campfire, door: set.getObjectByName('door')!, key, locked: set.getObjectByName('locked')!, lock: set.getObjectByName(MODEL_SET.lock)!, drop: null, set, cart, corpse }
    }
    if (scene.kind === 'log') {
      // The fallen trunk on the ground along the play's line, through its middle, its roots at the near end: its +x the way to the far end.
      const { far } = scene.ends
      const bark = new ShellToonMaterial({ color: log.wood, side: logFile.side, painted: { strokes, extent: STROKE_BODY } })
      shells.push(bark)
      const model = add(group, new Mesh(logFile.geometry, bark), new Vector3())
      const along = Math.atan2(-(far.z - scene.z), far.x - scene.x)
      // Where it burns, moved with it.
      const fires = logFile.fires.map((at) => {
        const fire = new Object3D()
        fire.position.copy(at)
        model.add(fire)
        return fire
      })
      return { kind: 'log', group, model, bark, along, fires }
    }
    // The tree itself the dead trees draw (`ownTrees`): here, its wood unseen, for the edit mode to pick and box.
    const model = add(group, new Mesh(treeFile.wood, shaft), new Vector3())
    model.visible = false
    const pumpkins = add(group, new Mesh(new BufferGeometry(), palette.material), new Vector3())
    // Its brazier where the play stands it, on the ground there, turned with the tree.
    const fire = new Group()
    for (const piece of treeFile.fire) {
      const shell = new ShellToonMaterial({ color: piece.color, painted: { strokes, extent: STROKE_BODY } })
      shells.push(shell)
      add(fire, new Mesh(piece.geometry, shell), new Vector3())
    }
    fire.position.set(scene.fire.x - scene.x, groundAt(scene.fire.x, scene.fire.z) - group.position.y, scene.fire.z - scene.z)
    group.add(fire)
    return { kind: 'tree', group, model, fire, turn: play.plain.braziers[scene.brazier]!.turn ?? null, pumpkins, pumpkinsKey: '' }
  })
  // Each log's part, and the top of its roots, by log.
  const logs = parts.filter((part) => part.kind === 'log')
  const logFires = logs.map((part) => part.fires.map((fire) => fire.getWorldPosition(new Vector3())))
  const at = new Vector3()
  let time = 0
  // Set from the panel on 2026-10-22.
  const bucketOffset = { x: 0.03, y: 0.05, z: 0.23 }
  // Set from the panel on 2026-10-23.
  const keyInWing: KeyInWing = { bone: RIGHT_WING[1], size: 1, x: -0.11, y: 0.18, z: 0.015, turnX: 66, turnY: 66, turnZ: 0 }
  // Set from the panel on 2026-10-22: the campfire a little smaller than its file's.
  const cage: CageLook = { turn: 0, campfire: 0.8 }
  const cageColours = Object.fromEntries([...cageSet.materials].map(([name, toon]) => [name, toon.color.getHex()]))
  const cageChanged = () => {
    for (const [name, colour] of Object.entries(cageColours)) cageSet.materials.get(name)?.color.setHex(colour)
  }
  const turn = new Quaternion()
  const tip = new Vector3()
  const euler = new Euler()
  /**
   * `part`'s padlock and the key in it, `since` s after the cage came unlocked:
   * off the door into a group of their own, as one block, falling out from the
   * door to the ground LOCK_OUT m in front of it and tipping forward onto
   * their face as they fall; NaN, hung back on the door. Whether they are down.
   */
  const dropLock = (part: Extract<Part, { kind: 'cage' }>, since: number): boolean => {
    if (Number.isNaN(since)) {
      if (part.drop) {
        for (const { piece, parent, position, quaternion, scale } of part.drop.home) {
          parent.add(piece)
          piece.position.copy(position)
          piece.quaternion.copy(quaternion)
          piece.scale.copy(scale)
        }
        part.drop.group.removeFromParent()
        part.drop = null
      }
      return false
    }
    if (!part.drop) {
      const pieces = [part.lock, part.locked]
      const home = pieces.map((piece) => ({ piece, parent: piece.parent!, position: piece.position.clone(), quaternion: piece.quaternion.clone(), scale: piece.scale.clone() }))
      object.updateMatrixWorld(true)
      const middle = new Box3().setFromObject(part.lock).getCenter(new Vector3())
      // Out of the door: from the cage's middle through the padlock, along the ground.
      const cage = part.turned.getWorldPosition(new Vector3())
      const out = new Vector3(middle.x - cage.x, 0, middle.z - cage.z).normalize()
      const group = new Group()
      group.position.copy(middle)
      object.add(group)
      group.updateMatrixWorld(true)
      for (const piece of pieces) group.attach(piece)
      const to = middle.clone().addScaledVector(out, LOCK_OUT)
      to.y = groundAt(to.x, to.z) + LOCK_LIES
      part.drop = { group, from: middle, to, out, home }
    }
    const { group, from, to, out } = part.drop
    const fallen = (LOCK_FALL * Math.max(0, since) ** 2) / 2
    const share = from.y > to.y ? Math.min(1, fallen / (from.y - to.y)) : 1
    group.position.lerpVectors(from, to, share)
    group.position.y = from.y - (from.y - to.y) * share
    // Tipping forward, its top out of the door: about the level way across it.
    group.quaternion.setFromAxisAngle(tip.set(out.z, 0, -out.x), (share * Math.PI) / 2)
    return share >= 1
  }
  const scenes: GooseScenes = {
    object,
    wellColours,
    wellGlows,
    bucketOffset,
    tree,
    treeWood: [treeFile.wood],
    ownTrees(now) {
      return parts.flatMap((part, index) => (part.kind === 'tree' ? [treeOf(now.scenes[index]!, part)] : []))
    },
    log,
    logFires,
    setShell(look) {
      for (const shell of shells) {
        shell.set(look)
        shell.setPaint(look.paint)
        shell.setToon(look.toon)
      }
    },
    wellChanged,
    keyInWing,
    cage,
    cageColours,
    cageChanged,
    pit,
    wellPits,
    pieces(now) {
      const shift = (p: Point, dx: number, dz: number) => {
        p.x += dx
        p.z += dz
      }
      /** `p` turned `by` about `about`, in place. */
      const spin = (p: Point, about: Point, by: number) => {
        const q = turnedBy({ x: p.x - about.x, z: p.z - about.z }, by)
        p.x = about.x + q.x
        p.z = about.z + q.z
      }
      const onGround = (o: Object3D, dx: number, dz: number) => o.position.set(o.position.x + dx, groundAt(o.position.x + dx, o.position.z + dz), o.position.z + dz)
      const degrees = (radians: number) => Math.round(((radians * 180) / Math.PI) * 10) / 10
      const at = (p: Point): Point => ({ x: p.x, z: p.z })
      return parts.flatMap((part, index): EditPiece[] => {
        const scene = now.scenes[index]!
        const k = scene.brazier
        const light = now.level.lights[k]!
        // The scene's own place, its waiting gosling with it, and its group drawn there.
        const moveScene = (dx: number, dz: number) => {
          shift(scene, dx, dz)
          const g = now.goslings[k]!
          if (g.state === 'waiting') shift(g, dx, dz)
          onGround(part.group, dx, dz)
        }
        // Where the route had the scene, from where the play has it now: the brazier's own place moved as far.
        const placeOf = (b: Brazier) => {
          b.x += scene.x - b.gosling!.x
          b.z += scene.z - b.gosling!.z
          b.gosling = at(scene)
        }
        if (scene.kind === 'well' && part.kind === 'well') {
          return [
            {
              name: 'well',
              object: part.group,
              move(dx, dz) {
                moveScene(dx, dz)
                shift(light, dx, dz)
              },
              turn(by) {
                scene.turn += by
                part.group.rotation.y = scene.turn
                spin(light, scene, by)
              },
              save(braziers) {
                const b = braziers[k]!
                b.gosling = at(scene)
                // Its brazier's place, where the play's light for it, unlit, now is.
                b.x = light.x
                b.z = light.z
                b.turn = degrees(scene.turn)
              },
            },
          ]
        }
        if (scene.kind === 'tree' && part.kind === 'tree') {
          const fireLight = now.level.lights[scene.fireLight]!
          return [
            {
              name: 'dead tree',
              object: part.model,
              move(dx, dz) {
                moveScene(dx, dz)
                shift(light, dx, dz)
              },
              turn(by) {
                part.turn = (part.turn ?? tree.turn) + (by * 180) / Math.PI
              },
              save(braziers) {
                const b = braziers[k]!
                placeOf(b)
                b.fire = { x: scene.fire.x - now.settings.treeFire.x, z: scene.fire.z - now.settings.treeFire.z }
                if (part.turn !== null) b.turn = Math.round(part.turn * 10) / 10
              },
            },
            {
              name: "dead tree's brazier",
              object: part.fire,
              move(dx, dz) {
                shift(scene.fire, dx, dz)
                shift(scene.place, dx, dz)
                shift(fireLight, dx, dz)
              },
            },
          ]
        }
        if (scene.kind === 'cage' && part.kind === 'cage') {
          const turnSet = (by: number) => {
            scene.turn += by
            for (const piece of [part.set, part.cart, part.corpse, part.campfire]) piece.rotation.y = scene.turn
            const beside = turnedBy(now.settings.keyBeside, scene.turn)
            scene.key = { x: scene.skull.x + beside.x, z: scene.skull.z + beside.z }
          }
          return [
            {
              name: 'cage',
              object: part.set,
              move(dx, dz) {
                shift(scene, dx, dz)
                const g = now.goslings[k]!
                if (g.state === 'waiting') shift(g, dx, dz)
                onGround(part.set, dx, dz)
                // The cart keeps its own place: its offset from the cage the other way.
                shift(scene.cart, -dx, -dz)
              },
              turn: turnSet,
              save(braziers) {
                const b = braziers[k]!
                b.gosling = at(scene)
                b.x = light.x
                b.z = light.z
                b.turn = degrees(scene.turn)
                b.skull = at(scene.skull)
                const middle = turnedBy(CART_MIDDLE, scene.turn)
                b.cart = { x: part.cart.position.x + middle.x, z: part.cart.position.z + middle.z }
              },
            },
            {
              name: "cage's cart",
              object: part.cart,
              move(dx, dz) {
                onGround(part.cart, dx, dz)
                shift(scene.cart, dx, dz)
              },
              turn: turnSet,
            },
            {
              name: "cage's campfire",
              object: part.campfire,
              // Drawn where the play's light for it is, every frame.
              move(dx, dz) {
                shift(light, dx, dz)
              },
              turn: turnSet,
            },
            {
              name: 'dead body',
              object: part.corpse,
              move(dx, dz) {
                onGround(part.corpse, dx, dz)
                shift(scene.skull, dx, dz)
                shift(scene.key, dx, dz)
              },
              turn: turnSet,
            },
          ]
        }
        if (scene.kind === 'log' && part.kind === 'log') {
          return [
            {
              name: 'hollow log',
              object: part.group,
              move(dx, dz) {
                moveScene(dx, dz)
                shift(scene.ends.near, dx, dz)
                shift(scene.ends.far, dx, dz)
                shift(light, dx, dz)
              },
              turn(by) {
                spin(scene.ends.near, scene, by)
                spin(scene.ends.far, scene, by)
                part.along += by
                light.x = scene.ends.far.x
                light.z = scene.ends.far.z
              },
              save(braziers) {
                const b = braziers[k]!
                placeOf(b)
                b.log = { near: at(scene.ends.near), far: at(scene.ends.far) }
              },
            },
          ]
        }
        return []
      })
    },
    update(now, dt, bone) {
      time += dt
      if (pit) {
        const at = now.level.lights[pitAt]!
        pit.position.set(at.x, groundAt(at.x, at.z), at.z)
      }
      now.wellFires.forEach(({ light }, w) => {
        const at = now.level.lights[light]!
        wellPits[w]!.position.set(at.x, groundAt(at.x, at.z), at.z)
      })
      parts.forEach((part, index) => {
        const scene = now.scenes[index]!
        if (scene.kind === 'well' && part.kind === 'well') {
          // Wound up with the hold; let go, it drops back down the shaft.
          const top = BUCKET_TOP
          const wanted = DEPTH + (top - DEPTH) * scene.wound
          part.rim = wanted >= part.rim ? wanted : Math.max(wanted, part.rim - DROP * dt)
          part.bucket.position.set(bucketOffset.x, part.rim - BUCKET_RIM + bucketOffset.y, bucketOffset.z)
          const ropeLength = WINCH - part.rim
          part.rope.scale.y = Math.max(0.01, ropeLength)
          part.rope.position.y = part.rim + ropeLength / 2
          // The crank turns as the bucket rises, and spins back as it drops.
          part.winch.rotation.z = (-TURNS * 2 * Math.PI * (part.rim - DEPTH)) / (top - DEPTH)
        } else if (scene.kind === 'tree' && part.kind === 'tree') {
          // Its wood unseen where the dead trees draw it.
          part.model.scale.setScalar(tree.height / treeFile.top)
          part.model.position.y = tree.y
          part.model.rotation.y = part.fire.rotation.y = ((part.turn ?? tree.turn) * Math.PI) / 180
          layPumpkins(part, scene)
          // Its brazier where the play has it now, on the ground there.
          const { x, z } = scene.fire
          part.fire.position.set(x - scene.x, groundAt(x, z) - part.model.parent!.position.y, z - scene.z)
        } else if (scene.kind === 'cage' && part.kind === 'cage') {
          // Unlocked, its padlock drops to the ground with the key in it, and once down its door swings open outward; set
          // again, the padlock hangs back on the shut door.
          part.turned.rotation.y = (cage.turn * Math.PI) / 180
          part.campfire.scale.setScalar(SET_SCALE * cage.campfire)
          // Its campfire where the play has its light now, on the ground there.
          const fire = now.level.lights[scene.brazier]!
          part.campfire.position.set(fire.x, groundAt(fire.x, fire.z), fire.z)
          const down = dropLock(part, scene.open ? now.t - scene.unlockedAt : Number.NaN)
          const wanted = scene.open && down ? -DOOR_OPEN : 0
          const door = part.door.rotation
          door.y += Math.sign(wanted - door.y) * Math.min(Math.abs(wanted - door.y), DOOR_SWING * dt)
          // Its key on the ground by the body, then in her right wing, until it unlocks the cage, and in its padlock since.
          part.key.visible = !scene.open
          part.locked.visible = scene.open
          const wing = scene.carried ? bone?.(keyInWing.bone) : undefined
          part.key.scale.setScalar(SET_SCALE * (wing ? keyInWing.size : 1))
          if (wing) {
            wing.updateWorldMatrix(true, false)
            wing.getWorldQuaternion(part.key.quaternion)
            wing.getWorldPosition(part.key.position).add(at.set(keyInWing.x, keyInWing.y, keyInWing.z).applyQuaternion(part.key.quaternion))
            part.key.quaternion.multiply(turn.setFromEuler(euler.set((keyInWing.turnX * Math.PI) / 180, (keyInWing.turnY * Math.PI) / 180, (keyInWing.turnZ * Math.PI) / 180)))
          } else {
            // On the ground beside the body, where the play lays it.
            part.key.position.set(scene.key.x, groundAt(scene.key.x, scene.key.z) + KEY_LIES, scene.key.z)
            part.key.quaternion.setFromEuler(euler.set(0, scene.turn, 0))
          }
        } else if (scene.kind === 'log' && part.kind === 'log') {
          part.model.scale.setScalar(play.settings.logSize)
          part.model.rotation.set(0, part.along + (play.settings.logTurn * Math.PI) / 180, (log.tilt * Math.PI) / 180)
          // Struck, its bark chars.
          const since = now.t - scene.litAt
          part.bark.color.setHex(log.wood).lerp(charred, since >= 0 ? Math.min(1, since / CHAR) : 0)
          // Its first flame, and the strike with it, where the folder moves it, off the file's place, in the log's own frame.
          const { x, y, z } = log.firstFlame
          part.fires[0]!.position.copy(logFile.fires[0]!).add(at.set(x, y, z))
          const fires = logFires[logs.indexOf(part)]!
          part.fires.forEach((fire, j) => fire.getWorldPosition(fires[j]!))
        }
      })
    },
    lift(now, k) {
      const up = (y: number, across = 0) => ({ x: bucketOffset.x * across, y, z: bucketOffset.z * across })
      const index = now.scenes.findIndex((s) => s.brazier === k)
      if (index < 0) return up(0)
      const g = now.goslings[k]!
      if (g.state !== 'waiting' && g.state !== 'circle') return up(0)
      const part = parts[index]!
      // In the cage, on the ground.
      if (part.kind === 'cage') return up(0)
      if (part.kind === 'log') {
        // Hidden in the trunk, off its middle as the folder sets it, along the play's line and across it; easing off over
        // its first metre out.
        const scene = now.scenes[index]!
        if (g.state !== 'waiting') return up(0)
        const hidden = Math.max(0, 1 - Math.hypot(g.x - scene.x, g.z - scene.z) / LOG_HIDE)
        const { x, y, z } = log.gosling
        const c = Math.cos(part.along)
        const s = Math.sin(part.along)
        return { x: (x * c + z * s) * hidden, y: y * hidden, z: (z * c - x * s) * hidden }
      }
      if (part.kind === 'tree') {
        // Perched on its branch, wherever the tree's size, turn and lift put it, riding it as the wind sways it, facing
        // its own way.
        const size = tree.height / TREE_HEIGHT
        const turn = ((part.turn ?? tree.turn) * Math.PI) / 180
        const { x, y, z } = tree.perch
        const perch = { x: (x * Math.cos(turn) + z * Math.sin(turn)) * size, y: tree.y + y * size, z: (z * Math.cos(turn) - x * Math.sin(turn)) * size }
        const scene = now.scenes[index]!
        if (scenes.swayTree) {
          branch.set(scene.x + perch.x, groundAt(scene.x, scene.z) + perch.y, scene.z + perch.z)
          scenes.swayTree(treeOf(scene, part), branch, swayed)
          perch.x += swayed.x - branch.x
          perch.y += swayed.y - branch.y
          perch.z += swayed.z - branch.z
        }
        // Lit, it jumps from the branch to the ground where the play lands it, facing the way it jumps, the play moving it
        // from the trunk's middle to there and the perch eased off as it does.
        const hop = now.hopOf(k)
        if (hop === null) return g.state === 'waiting' ? { ...perch, yaw: (tree.goslingTurn * Math.PI) / 180 } : up(0)
        // Up off the branch to jumpHeight over it and down to the ground, as a thrown body falls: from the branch's height
        // at the take-off, rising at `v`, falling by `fall`, so it tops out jumpHeight over the branch and lands at the end.
        const air = airOf(hop.share)
        const yaw = Math.atan2(hop.to.x - hop.from.x - perch.x, hop.to.z - hop.from.z - perch.z)
        const rise = Math.max(0, tree.jumpHeight)
        const v = 2 * rise + 2 * Math.sqrt(rise * rise + rise * perch.y)
        const fall = v + perch.y
        return { x: perch.x * (1 - air), y: perch.y + v * air - fall * air * air, z: perch.z * (1 - air), yaw }
      }
      // Down in the bucket, its head over the rim; out of the well in two hops: from the bucket up onto the ring, leaving the bucket's offset, and from the ring down to the ground.
      const sits = part.rim + bucketOffset.y - SEAT
      if (g.state === 'waiting') return up(sits, 1)
      const hop = now.hopOf(k)
      if (hop === null) return up(0)
      const [from, to] = hop.hop === 0 ? [sits, RING_TOP] : [RING_TOP, 0]
      const air = airOf(hop.share)
      return up(from + (to - from) * air + ARC[hop.hop] * 4 * air * (1 - air), hop.hop === 0 ? 1 - air : 0)
    },
  }
  return scenes
}
