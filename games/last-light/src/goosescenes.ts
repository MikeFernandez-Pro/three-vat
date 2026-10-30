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
// ground with the key in it, and the door swings open. Each scene's fire
// burns as its own `SceneFireLook` has it.
// The fire pit: `public/models/firePit.glb`, an iron bowl of logs (a Tripo
// mesh, untextured), drawn by each well, in the shell in an iron colour,
// where its light stands; its lamp over the bowl (`PIT_LIGHT`), its flame the
// torch's, the page's, on the logs (`PIT_BOWL`).
// The burning tree: on the spawn's brazier (`spawnTree`), struck as the game
// opens (gooseintro.ts), one of the plain's dead trees in leaf, drawn by them
// (deadtrees.ts), justASimpleTree's spooky tree seed 1759 (`BURNING_MODEL`):
// a flame, the page's, on each of BURNING_FLAMES clusters of its leaves,
// swaying with its branch (`burningFlames`); its lamp in its crown
// (`BURNING_LIGHT`). It burns the whole game.
// The goslings in them are goslings.ts's, lifted off the ground by `lift`: in
// the bucket, up the tree, and hopping out of the one and down from the other
// once with her.
import { Box3, Color, CylinderGeometry, DoubleSide, Euler, Group, Quaternion, Mesh, MeshBasicNodeMaterial, MeshToonNodeMaterial, Object3D, Vector3, BufferGeometry, type Material, type Texture } from 'three/webgpu'
import { texture, uv } from 'three/tsl'
import { modelLoader } from './gltf'
import { CAGE_CAMPFIRE, CART_MIDDLE, WELL_RADIUS, airOf, turned as turnedBy, type GoosePlay, type SceneState, type Tree, type Trunk } from './gooseplay'
import { keptShown, shownOf, type Brazier, type Point, type Shown } from './plain'
import type { LightLook } from './lights'
import { ShellToonMaterial, type PaintLook, type ShellLook } from './shell'
import { createStrokes, type Strokes } from './strokes'
import { createCartWood, defaultCartWood, type CartWood, type CartWoodLook } from './cartwood'
import type { ShineLook } from './panel'
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
/** The cage's materials that may glow, and how bright to start: Material.005, its key's (and a cube's), asked for on 2026-10-29. */
const CAGE_GLOWS: Record<string, number> = { 'Material.005': 1.4 }
/** The cage's set's colours, by material, as set from the panel on 2026-10-29: Material.005, the key's, orange. */
const CAGE_COLOURS: Record<string, number> = {
  'Material.005': 0xdf893a,
  'Material.006': 0x2c2c2c,
  'Material.001': 0x837788,
  'Material.009': 0x7e543f,
  'Material.010': 0x8c8278,
  'Material.011': 0xe7daab,
  'Material.008': 0x877164,
  'Material.012': 0x2f2f2f,
  'Material.013': 0x7a747b,
  Skeleton: 0xe7e7e7,
}
/** The cart's and the corpse's own highlight and rim, as set from the panel on 2026-10-29: the cart with no highlight
 * and the faintest orange rim, the skull glinting and rimmed in pale violet. */
const CART_SHINE: ShineLook = {
  specular: 0,
  shininess: 30,
  softness: 0.17,
  specularColor: 0xc0d8f0,
  rim: true,
  rimStrength: 0.04,
  rimWidth: 0.37,
  rimSoftness: 0.1,
  rimColor: 0xffa040,
}
const SKULL_SHINE: ShineLook = {
  specular: 1.29,
  shininess: 30,
  softness: 0.17,
  specularColor: 0xedccff,
  rim: true,
  rimStrength: 1.24,
  rimWidth: 0.37,
  rimSoftness: 0.1,
  rimColor: 0xe7c1fb,
}
/** The fire pit's iron: no highlight, a warm rim, as set from the panel on 2026-10-30. */
const PIT_SHINE: ShineLook = { ...CART_SHINE, specular: 0, rim: true, rimStrength: 0.6 }
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
const SHAFT = 0x050405

/** The well's light, its brazier's place, unlit, as the lights draw it: not at all. */
export const WELL_LIGHT: LightLook = { scenery: true }

/**
 * The dead tree as the dead tree folder edits it, read live: how tall it stands, m, its top over its file's origin, how
 * far over the ground its foot stands, m, and how far it is turned, degrees; where its gosling perches, m, off its foot,
 * as it stands unturned at TREE_HEIGHT, moved with it; which way the gosling faces there, degrees, 0 toward the camera
 * (+z); how high over its branch it jumps before it falls, m, how far ahead of it, the way it faces, it lands, m, and
 * how far to the screen's right (+x), m; and the pumpkins round its foot, each off its trunk's
 * middle, m, along x and z, turned, degrees, and which of the well's three it is, 0 to 2.
 */
export interface TreeLook {
  height: number
  y: number
  turn: number
  perch: { x: number; y: number; z: number }
  goslingTurn: number
  jumpHeight: number
  jumpForward: number
  jumpRight: number
  pumpkins: { x: number; z: number; turn: number; kind: number }[]
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
/**
 * The skeleton laid in place of the set's corpse, `public/models/skeleton.glb` (Tripo, scattered in Blender,
 * 2026-10-28): lying on its back, its skull off its neck toward -z, one mesh of no material of its own, given
 * MODEL_BONE in BONE_COLOUR; drawn SKELETON_SCALE set units a unit of its file, its bones as big as the corpse's were,
 * its skull's middle at SKELETON_SKULL in its file's units, on the set's skull.
 */
const SKELETON_MODEL = './models/skeleton.glb'
const SKELETON_SCALE = 0.63
const SKELETON_SKULL = { x: -0.04, z: -0.49 }
const MODEL_BONE = 'Skeleton'
/** The bone's colour, linear: the grey the first Tripo file had. */
const BONE_COLOUR = new Color(0.8, 0.8, 0.8)
/** The cart's wood, of its three materials: the one planked. */
const MODEL_CART_WOOD = 'Material.009'
/** The fire pit's file: an iron bowl on legs, logs in it, in metres, its foot on the origin. */
const PIT_MODEL = './models/firePit.glb'
/** How big the fire pit is drawn, times its file; and its iron. */
const PIT_SCALE = 0.8
const PIT_IRON = 0x564c48
/** How high the top of the logs in the fire pit stands, m, where its flame burns. */
export const PIT_BOWL = 0.36 * PIT_SCALE
/** The fire pit's light as the lights draw it: its lamp alone, over the bowl, the page burning the torch's flame on the logs. */
export const PIT_LIGHT: LightLook = { lampOnly: true, height: 0.8 }
/** Which brazier the burning tree stands on: the spawn's, the first on the plain, if no scene takes it; -1, none. */
export const spawnTree = (plain: { braziers: readonly Brazier[] }) => (plain.braziers[0] && plain.braziers[0].scene === undefined ? 0 : -1)
/**
 * The burning tree's file, one of the dead trees' (deadtrees.ts): justASimpleTree's spooky tree in leaf, seed 1759, its
 * wood MODEL_TREE, its leaves BURNING_LEAVES; how many flames burn in its crown, each on a cluster of its leaves.
 */
export const BURNING_MODEL = './models/spookyTrees/spooky-1759.glb'
const BURNING_LEAVES = 'leaves'
const BURNING_FLAMES = 26
/** How many flames climb its trunk, and how far up under its crown's lowest cluster they reach, a share. */
const TRUNK_FLAMES = 6
const TRUNK_UP = 0.9
/** The burning tree's light as the lights draw it: its lamp alone, up its trunk, the page burning the torch's flame on each cluster. */
export const BURNING_LIGHT: LightLook = { lampOnly: true, height: 3 }
/** The cage's brazier, its set's campfire, as the lights draw it: its lamp alone, over the logs, the page burning the torch's flame on them. */
export const CAGE_FIRE_LIGHT: LightLook = { lampOnly: true, height: 0.6 }
/**
 * A scene's fire as it burns, the torch's flame (flame.ts) on its brazier or
 * its campfire: how tall and wide, m, and how high its foot stands off the
 * ground, m; how far off its fire it burns, m, along x and z; and how bright
 * its lamp shines. Its colours and glow the torch's, its lamp's colour every
 * fire's.
 */
export interface SceneFireLook {
  height: number
  width: number
  foot: number
  x: number
  z: number
  intensity: number
}
/**
 * The cage's door: how far it swings open, rad, and how fast, rad/s. The key:
 * how high over her it is carried, m, how far it bobs there, m, and how fast,
 * rad/s, and how fast it turns, rad/s.
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
 * there, degrees about the bone's x, y and z; and how big, times its set's
 * size.
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
 * the key lies on the skull.
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
)

/**
 * A piece of a scene as the 3D page's edit mode (gooseedit.ts) moves and turns it: what it picks and boxes, its name,
 * and what moves it on the ground by (dx, dz) m and turns it by radians about its own place, the drawing and the play
 * together; and, for a scene's own piece, the whole scene written into `braziers`, the plain's, as the route will hold it.
 * `shown`, how it is drawn off its place, its brazier's in the play's plain, which the edit mode raises and sizes and
 * the route keeps; and `lay`, what draws it so once changed: none, `layShown` on its object, and none for a piece whose
 * drawing reads `shown` live.
 */
export interface EditPiece {
  name: string
  object: Object3D
  move(dx: number, dz: number): void
  turn?(by: number): void
  save?(braziers: Brazier[]): void
  shown?: Shown
  lay?(): void
}

/** Each object's drawing as `layShown` raises and sizes it: its children, gathered into a group of their own. */
const shownGroups = new WeakMap<Object3D, Group>()
const shownScale = new Vector3()

/**
 * `object` drawn `shown.y` m up and `shown.size` times as big about its own place: its children gathered into a group
 * inside it the first time, so whatever places `object` itself goes on placing it. Drawn as played, it is left alone.
 */
export function layShown(object: Object3D, shown: Readonly<Shown>) {
  let inner = shownGroups.get(object)
  if (!inner) {
    if (shown.y === 0 && shown.size === 1) return
    inner = new Group()
    inner.name = 'shown'
    inner.add(...object.children)
    object.add(inner)
    shownGroups.set(object, inner)
  }
  // Its rise in the object's own units, as it is scaled on the plain.
  object.getWorldScale(shownScale)
  inner.position.y = shown.y / (shownScale.y || 1)
  inner.scale.setScalar(shown.size)
}

export interface GooseScenes {
  object: Group
  /** Each scene as `now` has it, its bucket moved over `dt` of play, s; the cage's key carried on her bone that `bone` finds by its name, if she carries it. */
  update(now: GoosePlay<PlaySwarm>, dt: number, bone?: (name: string) => Object3D | undefined): void
  /** The shells of the dead tree, the fire pits and the cage's pieces, toon steps and painted strokes: the goose's look. */
  setShell(look: ShellLook & { paint: PaintLook; toon: ToonLook }): void
  /**
   * How far off its place gosling `k` is drawn, m: up off the ground in the
   * bucket, up the tree, hopping down from them; and across with the bucket's offset
   * while in it, easing off as it hops out onto the rim. None elsewhere. Up
   * the tree, the way it faces there too, and jumping down, the way it jumps.
   */
  lift(now: GoosePlay<PlaySwarm>, k: number): Lift
  /** A copy of the cage's campfire, its foot on its origin, at the set's size: in the cage's materials, so it takes their colours and shell. */
  campfire(): Object3D
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
  /** Where the cage's key is carried in her wing. Read live. */
  keyInWing: KeyInWing
  /** How the cage is turned and how big its campfire is. Read live. */
  cage: CageLook
  /** The fire pit on the spawn's light, for the edit mode to pick: none, the burning tree stands there. */
  readonly pit: Object3D | undefined
  /**
   * Where each flame in the crown of `tree`, the burning tree as the dead trees lay it, burns now, on the plain, swayed
   * with its branch, into `out`, one Vector3 a flame, BURNING_FLAMES of them; and how high up its crown each is, 0 its
   * lowest to 1 its highest.
   */
  burningFlames(tree: DeadTree, out: Vector3[]): { up: number }[]
  /**
   * Where each flame up the trunk of `tree` burns, on the plain, its trunk's middle there, into `out`, its foot first;
   * and how far round the trunk is there, m.
   */
  burningTrunk(tree: DeadTree, out: Vector3[]): { radius: number }[]
  /** The fire pit by each well, on its light wherever it stands, in the play's `wellFires` order. */
  readonly wellPits: readonly Object3D[]
  /** The fire pits' iron colour, as the well folder edits it: `pitChanged` lays it on. */
  pitLook: { colour: number }
  pitChanged(): void
  /** The fire pits' own highlight and rim, over the shell `setShell` lays: changed, lay the shell again. */
  pitShine: ShineLook
  /**
   * Where the gosling up `tree` lands jumping down, off its trunk's middle, m, along x and z: jumpForward ahead of
   * where it sits as drawn, the way it faces, and jumpRight to the screen's right, the tree's size, turn and edit with
   * it, its sway left out.
   */
  landingOf(now: GoosePlay<PlaySwarm>, tree: Tree): Point | undefined
  /**
   * The pumpkins round each dead tree of `now`'s, where the tree folder lays them, and the loose ones `layLoosePumpkins`
   * last laid, each as round as it stands on the ground: for the play to keep her and her goslings out of.
   */
  pumpkinBodies(now: GoosePlay<PlaySwarm>): Trunk[]
  /** How many kinds of pumpkin there are, the well's. */
  pumpkinKinds: number
  /** Pumpkins standing on their own, each at `at` of kind `kind`, its carved face turned to look along `look`; laid again each call. */
  layLoosePumpkins(pumpkins: readonly { at: Point; kind: number; look: Point }[]): void
  /** Every scene's pieces, for the edit mode, each moving and turning `now`'s scenes with the drawing. */
  pieces(now: GoosePlay<PlaySwarm>): EditPiece[]
  /** The cage's set's colours, one a material of its file, by the material's name: as the panel edits them, `cageChanged` lays them on. */
  cageColours: Record<string, number>
  /** How bright those of them that glow glow, by the material's name, 0 not at all: their own colour added as light. */
  cageGlows: Record<string, number>
  cageChanged(): void
  /** The cart's, the corpse's and the well's own highlight and rim, over the shell `setShell` lays: changed, lay the shell again. */
  cartShine: ShineLook
  skullShine: ShineLook
  wellShine: ShineLook
  /** The cart's planks, as the cart wood folder edits them: `cartWoodChanged` lays them on. */
  cartWood: CartWoodLook
  cartWoodChanged(): void
}

/**
 * The cage's look: how far the cage and its door are turned about its middle, degrees, past its set's turn; how big
 * its campfire and its key on the ground are, times their set's size; and how the padlock with the key in it lies
 * once dropped off the open door, turned about its middle past its tip forward, degrees about x, y and z, turning so
 * as it falls.
 */
export interface CageLook {
  turn: number
  campfire: number
  key: number
  lockTurnX: number
  lockTurnY: number
  lockTurnZ: number
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
  const [treeFile, fireFile] = await Promise.all([TREE_MODEL, FIRE_MODEL].map(async (url) => (await modelLoader().loadAsync(url)).scene))
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
 * The burning tree's wood as its file has it, its foot on the origin, and how high its top stands, in the file's units;
 * and where its flames burn, in the same units: the middles of BURNING_FLAMES clusters of its leaves, spread through
 * its crown, each first a point of its leaves, the topmost first, then each the farthest from those already picked, then
 * drawn into the middle of the leaves nearest it.
 */
async function loadBurningTree(): Promise<{ wood: BufferGeometry; top: number; clusters: Vector3[]; trunk: { at: Vector3; radius: number }[] }> {
  const file = (await modelLoader().loadAsync(BURNING_MODEL)).scene
  file.updateMatrixWorld(true)
  const mesh = meshesOf(file, MODEL_TREE)[0]!
  const wood = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
  wood.computeBoundingBox()
  const cards: Vector3[] = []
  const leaves = file.getObjectByName(BURNING_LEAVES) ? meshesOf(file, BURNING_LEAVES)[0] : undefined
  if (leaves) {
    const positions = leaves.geometry.getAttribute('position')
    for (let k = 0; k < positions.count; k++) cards.push(new Vector3().fromBufferAttribute(positions, k).applyMatrix4(leaves.matrixWorld))
  }
  const clusters: Vector3[] = []
  if (cards.length > 0) {
    const nearest = cards.map(() => Infinity)
    let next = cards.reduce((best, card, k) => (card.y > cards[best]!.y ? k : best), 0)
    while (clusters.length < Math.min(BURNING_FLAMES, cards.length)) {
      const picked = cards[next]!
      clusters.push(picked.clone())
      let far = -1
      cards.forEach((card, k) => {
        nearest[k] = Math.min(nearest[k]!, card.distanceToSquared(picked))
        if (far < 0 || nearest[k]! > nearest[far]!) far = k
      })
      next = far
    }
    // Each drawn into the middle of the leaves nearest it, twice over: into the cluster, not on its edge.
    for (let pass = 0; pass < 2; pass++) {
      const sums = clusters.map(() => ({ at: new Vector3(), count: 0 }))
      for (const card of cards) {
        let best = 0
        clusters.forEach((c, k) => {
          if (c.distanceToSquared(card) < clusters[best]!.distanceToSquared(card)) best = k
        })
        sums[best]!.at.add(card)
        sums[best]!.count++
      }
      sums.forEach(({ at, count }, k) => count > 0 && clusters[k]!.copy(at.multiplyScalar(1 / count)))
    }
  }
  // Up the trunk from its foot to under the crown: in each band of its height, the middle of the wood nearest the band
  // under it, so the line keeps to the trunk as it curls and leaves the branches; and how far round it the wood is.
  const lowest = clusters.length > 0 ? Math.min(...clusters.map((c) => c.y)) : wood.boundingBox!.max.y / 2
  const woodAt = wood.getAttribute('position')
  const trunk: { at: Vector3; radius: number }[] = []
  let under = new Vector3(0, 0, 0)
  let reach = Infinity
  for (let band = 0; band < TRUNK_FLAMES; band++) {
    const y = (lowest * TRUNK_UP * (band + 0.5)) / TRUNK_FLAMES
    const near: Vector3[] = []
    for (let k = 0; k < woodAt.count; k++) {
      const p = new Vector3().fromBufferAttribute(woodAt, k)
      if (Math.abs(p.y - y) < lowest * 0.04 && Math.hypot(p.x - under.x, p.z - under.z) < reach) near.push(p)
    }
    if (near.length === 0) break
    const middle = near.reduce((sum, p) => sum.add(p), new Vector3()).multiplyScalar(1 / near.length)
    const radius = near.reduce((sum, p) => sum + Math.hypot(p.x - middle.x, p.z - middle.z), 0) / near.length
    trunk.push({ at: middle, radius })
    under = middle
    reach = radius * 3
  }
  return { wood, top: wood.boundingBox!.max.y, clusters, trunk }
}

/**
 * The cage's set's file in toon materials of its own colours, in its own
 * units, each piece to be cloned, scaled and turned: the cage and its cart,
 * round the cage's middle, the door split off the cage into a group of its
 * own, `door`, turning on the hinge, its padlock and the key in it, `locked`,
 * on it, the cage and its door turning together in `cage`; the campfire round
 * its middle; the corpse round its skull's; the key round its own middle,
 * lying flat; and its toon materials, by their file's names. The cart and the
 * corpse in the shell, painted with `strokes` as big on the ground as the fire
 * pits' are, their file's scale and the set's undone: their shells, for the
 * goose's look; the cart's wood, MODEL_CART_WOOD, planked (cartwood.ts).
 */
async function loadCageSet(gradient: Texture, strokes: Strokes): Promise<{ set: Group; cart: Group; campfire: Group; corpse: Group; key: Group; materials: Map<string, MeshToonNodeMaterial>; palette: Palette; shells: { cart: ShellToonMaterial[]; corpse: ShellToonMaterial[] }; wood: CartWood }> {
  const [file, skeleton] = await Promise.all([CAGE_MODEL, SKELETON_MODEL].map(async (model) => (await modelLoader().loadAsync(model)).scene))
  // The skeleton in place of the set's corpse, its skull on the corpse's.
  const corpse = file.getObjectByName(MODEL_SET.corpse)!
  const bones = skeleton.getObjectByProperty('isMesh', true) as Mesh
  bones.removeFromParent()
  bones.name = MODEL_SET.corpse
  const bone = new MeshToonNodeMaterial({ color: BONE_COLOUR })
  bone.name = MODEL_BONE
  bones.material = bone
  bones.scale.setScalar(SKELETON_SCALE)
  bones.position.set(MODEL_SKULL.x - SKELETON_SKULL.x * SKELETON_SCALE, 0, MODEL_SKULL.z - SKELETON_SKULL.z * SKELETON_SCALE)
  corpse.parent!.add(bones)
  corpse.removeFromParent()
  file.updateMatrixWorld(true)
  const materials = new Map<string, MeshToonNodeMaterial>()
  const shells = { cart: [] as ShellToonMaterial[], corpse: [] as ShellToonMaterial[] }
  const shelled = new Map<Object3D, ShellToonMaterial[]>()
  file.getObjectByName(MODEL_SET.corpse)?.traverse((o) => shelled.set(o, shells.corpse))
  const scale = new Vector3()
  file.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    const material = mesh.material as Material & { color?: Color }
    let toon = materials.get(material.name)
    if (!toon) {
      const parameters = { color: material.color ?? new Color(0xffffff), side: material.side }
      const under = shelled.get(mesh)
      if (under) {
        const metres = mesh.getWorldScale(scale).x * SET_SCALE
        const shell = new ShellToonMaterial({ ...parameters, painted: { strokes, extent: STROKE_BODY / metres } })
        under.push(shell)
        toon = shell
      } else toon = new MeshToonNodeMaterial({ ...parameters, gradientMap: gradient })
      // Named as the file's, for the palette to find its texel by.
      toon.name = material.name
      materials.set(material.name, toon)
    }
    mesh.material = toon
    mesh.castShadow = mesh.receiveShadow = true
  })
  // The key and the padlock cast no shadow: too small to show one, and a draw each in the moon's shadow pass (2026-10-27).
  for (const name of [MODEL_SET.key, MODEL_SET.lock]) file.getObjectByName(name)?.traverse((o) => (o.castShadow = false))
  const named = (name: string) => file.getObjectByName(name)!
  const around = (o: Object3D, x: number, z: number) => {
    o.position.x -= x
    o.position.z -= z
    return new Group().add(o)
  }
  // The campfire, the padlock and the cart each one draw, not one a material (2026-10-30): their colours texels of one
  // palette by the materials' names, the cage folder's colours laid on it as on the materials. The cart in a shell of
  // its own reading the palette, its planks laid on its planked part alone, found by that part's texel.
  const names = [...materials.keys()]
  const palette = createPalette(names, new MeshToonNodeMaterial({ gradientMap: gradient, side: DoubleSide }))
  const meshesOf = (root: Object3D) => root.children.filter((o): o is Mesh => (o as Mesh).isMesh)
  const campfire = named(MODEL_SET.campfire)
  palette.merge(campfire, meshesOf(campfire))
  const padlock = named(MODEL_SET.lock)
  palette.merge(padlock, meshesOf(padlock)).castShadow = false
  const car = named(MODEL_SET.cart)
  const metres = car.getWorldScale(scale).x * SET_SCALE
  const plankAt = (names.indexOf(MODEL_CART_WOOD) + 0.5) / names.length
  const wood = createCartWood(metres, texture(palette.material.map!, uv()).rgb, uv().x.sub(plankAt).abs().lessThan(0.25 / names.length))
  const cartShell = new ShellToonMaterial({ side: DoubleSide, painted: { strokes, extent: STROKE_BODY / metres, base: wood.normal } })
  cartShell.colorNode = wood.color
  shells.cart.push(cartShell)
  palette.merge(car, meshesOf(car), cartShell)
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
    palette,
    shells,
    wood,
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
  const well = (await modelLoader().loadAsync(WELL_MODEL)).scene
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
  // In the shell, painted with strokes as big on the ground as the pits' are: the well, its winch and its bucket merged
  // in the file's units, the pumpkins in metres.
  const wellShell = new ShellToonMaterial({ painted: { strokes, extent: STROKE_BODY / SCALE } })
  const pumpkinShell = new ShellToonMaterial({ painted: { strokes, extent: STROKE_BODY } })
  const paletteNames = [...fileColours.keys()]
  const palette = createPalette(paletteNames, wellShell, pumpkinShell)
  const pumpkinKinds = pumpkinsOf(standing, palette)
  // A carved face's corners, by the palette's texel their uvs read.
  const faceU = (paletteNames.indexOf(MODEL_GLOWS[0]!) + 0.5) / paletteNames.length
  /**
   * Each kind of pumpkin on the ground: its middle off its place, m, unturned, how far round that it reaches, and which
   * way its carved face looks, unturned, as an angle off +z toward +x.
   */
  const pumpkinRounds = pumpkinKinds.map((geometry) => {
    geometry.computeBoundingBox()
    const { min, max } = geometry.boundingBox!
    const x = (min.x + max.x) / 2
    const z = (min.z + max.z) / 2
    const position = geometry.getAttribute('position')
    const uvs = geometry.getAttribute('uv')
    let faceX = 0
    let faceZ = 0
    for (let i = 0; i < position.count; i++) {
      if (Math.abs(uvs.getX(i) - faceU) > 1e-4) continue
      faceX += position.getX(i) - x
      faceZ += position.getZ(i) - z
    }
    return { x, z, radius: Math.max(max.x - min.x, max.z - min.z) / 2, face: Math.atan2(faceX, faceZ) }
  })
  const pumpkinKind = (kind: number) => Math.min(pumpkinKinds.length - 1, Math.max(0, Math.round(kind)))
  /** Pumpkin `kind` turned `turn` rad about its place (x, z), as round as it stands on the ground. */
  const pumpkinBody = (x: number, z: number, turn: number, kind: number): Trunk => {
    const round = pumpkinRounds[pumpkinKind(kind)]!
    return { at: { x: x + round.x * Math.cos(turn) + round.z * Math.sin(turn), z: z - round.x * Math.sin(turn) + round.z * Math.cos(turn) }, radius: round.radius }
  }
  /** The loose pumpkins as last laid, each turned, rad. */
  let loosePumpkins: { x: number; z: number; turn: number; kind: number }[] = []
  const loose = new Mesh(new BufferGeometry(), pumpkinShell)
  loose.castShadow = loose.receiveShadow = true
  object.add(loose)
  palette.merge(well, standing)
  palette.merge(winchModel, winding)
  palette.merge(bucketModel, bucketMeshes)
  // The rope down to the bucket, a cylinder of its own, in the rope's colour.
  const ropeMaterial = new ShellToonMaterial({ painted: { strokes, extent: STROKE_BODY } })
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
  // scatter of them stood, turned and picked again. Three since 2026-10-30, the third moved.
  const tree: TreeLook = {
    height: 6.85,
    y: -0.02,
    turn: -103,
    perch: { x: 0.32, y: 0.88, z: 0.02 },
    goslingTurn: 34,
    jumpHeight: 0.25,
    jumpForward: 0.8,
    jumpRight: 0.3,
    pumpkins: [
      { x: -1.24, z: -0.43, turn: -180, kind: 1 },
      { x: 0.76, z: -1.13, turn: -64, kind: 2 },
      { x: -0.88, z: 1.4, turn: -93, kind: 1 },
    ],
  }
  const cageSet = await loadCageSet(gradient, strokes)
  // The cart's planks, as the cart wood folder edits them; set from the panel on 2026-10-28.
  // Again on 2026-10-29: the cart's own colour gone, only the planks' relief on it, deep, and bigger planks.
  const cartWood = { ...defaultCartWood(), wood: 1, scale: 2.05, relief: 2.96 }
  const cartWoodChanged = () => cageSet.wood?.set(cartWood)
  cartWoodChanged()
  // The burning tree's crown, the dead trees drawing it.
  const burningFile = await loadBurningTree()
  // The fire pit by each well, in the shell in its iron.
  const pitCount = play.wellFires.length
  const pitFile = pitCount > 0 ? (await modelLoader().loadAsync(PIT_MODEL)).scene : undefined
  const iron = new ShellToonMaterial({ color: PIT_IRON, painted: { strokes, extent: STROKE_BODY } })
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
  const wellPits = play.wellFires.map(() => newPit())
  const pitLook = { colour: PIT_IRON }
  const pitShine: ShineLook = { ...PIT_SHINE }
  const shaft = new MeshBasicNodeMaterial({ color: SHAFT })
  const pit = undefined
  /** A point of the burning tree's file, `c`, where `tree` lays it on the plain, into `out`: as the dead trees scale and turn it. */
  const onTree = (tree: DeadTree, c: Vector3, out: Vector3) => {
    const size = tree.height / burningFile.top
    out.set(c.x * size * tree.width, c.y * size, c.z * size * tree.width).applyAxisAngle(upright, tree.turn)
    return out.set(tree.x + out.x, groundAt(tree.x, tree.z) + (tree.lift ?? 0) + out.y, tree.z + out.z)
  }
  const crownLow = Math.min(...burningFile.clusters.map((c) => c.y))
  const crownHigh = Math.max(...burningFile.clusters.map((c) => c.y))
  const upright = new Vector3(0, 1, 0)
  const burningUp = burningFile.clusters.map((c) => ({ up: crownHigh > crownLow ? (c.y - crownLow) / (crownHigh - crownLow) : 1 }))
  const add = (parent: Group, mesh: Mesh, at: Vector3) => {
    mesh.position.copy(at)
    mesh.castShadow = mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  /** Where the dead trees draw the dead tree of `scene`, as its look and `part`'s turn have it. */
  const treeOf = (scene: SceneState, part: TreePart, shown: Readonly<Shown>): DeadTree => ({
    x: scene.x,
    z: scene.z,
    variant: 0,
    turn: ((part.turn ?? tree.turn) * Math.PI) / 180,
    height: tree.height * shown.size,
    width: shown.size,
    lift: tree.y + shown.y,
  })
  const branch = new Vector3()
  const swayed = new Vector3()
  /** Where the gosling up the tree of `part` sits, off its foot, m, its sway left out: as big, turned and raised as the tree is drawn. */
  const perchOn = (part: TreePart, shown: Readonly<Shown>) => {
    const size = (tree.height * shown.size) / TREE_HEIGHT
    const turn = ((part.turn ?? tree.turn) * Math.PI) / 180
    const { x, y, z } = tree.perch
    return { x: (x * Math.cos(turn) + z * Math.sin(turn)) * size, y: tree.y + shown.y + y * size, z: (z * Math.cos(turn) - x * Math.sin(turn)) * size }
  }
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
      const pumpkin = pumpkinKinds[pumpkinKind(kind)]!
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
      // No shadow from the bucket, as none from the key: its shadow falls down the shaft, out of sight.
      bucket.traverse((o) => (o.castShadow = false))
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
    // The tree itself the dead trees draw (`ownTrees`): here, its wood unseen, for the edit mode to pick and box.
    const model = add(group, new Mesh(treeFile.wood, shaft), new Vector3())
    model.visible = false
    const pumpkins = add(group, new Mesh(new BufferGeometry(), pumpkinShell), new Vector3())
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
  const at = new Vector3()
  let time = 0
  // Set from the panel on 2026-10-22.
  const bucketOffset = { x: 0.03, y: 0.05, z: 0.23 }
  // Set from the panel on 2026-10-23.
  const keyInWing: KeyInWing = { bone: RIGHT_WING[1], size: 1.3, x: -0.11, y: 0.18, z: 0.015, turnX: 66, turnY: 66, turnZ: 0 }
  // Set from the panel on 2026-10-22: the campfire a little smaller than its file's.
  // The key bigger, on the ground and in her wing alike, and the dropped padlock turned, since 2026-10-29.
  const cage: CageLook = { turn: 0, campfire: 0.8, key: 1.3, lockTurnX: -97, lockTurnY: -4, lockTurnZ: 106 }
  // The cart's and the corpse's highlight and rim, over the shell they share with the pits: their own, the panel's to
  // change after.
  const cartShine: ShineLook = { ...CART_SHINE }
  const skullShine: ShineLook = { ...SKULL_SHINE }
  // The well's, on its rope and the dead trees' pumpkins too, as set from the panel on 2026-10-28: no highlight, a
  // thin pink rim; fainter and violet since 2026-10-29.
  const wellShine: ShineLook = {
    specular: 0,
    shininess: 30,
    softness: 0.17,
    specularColor: 0xc0d8f0,
    rim: true,
    rimStrength: 0.12,
    rimWidth: 0.37,
    rimSoftness: 0.1,
    rimColor: 0xaf8efb,
  }
  const cageColours = Object.fromEntries([...cageSet.materials].map(([name, toon]) => [name, CAGE_COLOURS[name] ?? toon.color.getHex()]))
  const cageGlows = Object.fromEntries(Object.entries(CAGE_GLOWS).filter(([name]) => cageSet.materials.has(name)))
  const cageChanged = () => {
    for (const [name, colour] of Object.entries(cageColours)) {
      const toon = cageSet.materials.get(name)
      cageSet.palette.set(name, colour, cageGlows[name] ?? 0)
      toon?.color.setHex(colour)
      if (toon && name in cageGlows) {
        toon.emissive.setHex(colour)
        toon.emissiveIntensity = cageGlows[name]!
      }
    }
  }
  cageChanged()
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
    // And as the cage folder turns it, by as much of that as it has fallen.
    const degrees = (share * Math.PI) / 180
    group.quaternion.multiply(turn.setFromEuler(euler.set(cage.lockTurnX * degrees, cage.lockTurnY * degrees, cage.lockTurnZ * degrees)))
    return share >= 1
  }
  const scenes: GooseScenes = {
    object,
    campfire() {
      const copy = cageSet.campfire.clone()
      copy.scale.setScalar(SET_SCALE)
      return copy
    },
    wellColours,
    wellGlows,
    bucketOffset,
    tree,
    treeWood: [treeFile.wood],
    ownTrees(now) {
      return parts.flatMap((part, index) => {
        const scene = now.scenes[index]!
        return part.kind === 'tree' ? [treeOf(scene, part, shownOf(now.plain.braziers[scene.brazier], 'scene'))] : []
      })
    },
    burningFlames(tree, out) {
      burningFile.clusters.forEach((c, k) => {
        const at = onTree(tree, c, (out[k] ??= new Vector3()))
        scenes.swayTree?.(tree, at, at)
      })
      return burningUp
    },
    burningTrunk(tree, out) {
      const size = (tree.height / burningFile.top) * tree.width
      return burningFile.trunk.map(({ at, radius }, k) => {
        onTree(tree, at, (out[k] ??= new Vector3()))
        return { radius: radius * size }
      })
    },
    setShell(look) {
      const lay = (shell: ShellToonMaterial, shine?: ShineLook) => {
        shell.set(shine ? { ...look, ...shine } : look)
        shell.setPaint(look.paint)
        shell.setToon(look.toon)
      }
      for (const shell of shells) lay(shell)
      for (const shell of cageSet.shells.cart) lay(shell, cartShine)
      for (const shell of cageSet.shells.corpse) lay(shell, skullShine)
      for (const shell of [wellShell, pumpkinShell, ropeMaterial]) lay(shell, wellShine)
      if (pitFile) lay(iron, pitShine)
    },
    wellChanged,
    keyInWing,
    cage,
    cageColours,
    cageGlows,
    cageChanged,
    cartShine,
    wellShine,
    skullShine,
    cartWood,
    cartWoodChanged,
    pit,
    wellPits,
    pitLook,
    pitChanged: () => iron.color.setHex(pitLook.colour),
    pitShine,
    pumpkinBodies(now) {
      // Each turned about its place as it is laid.
      const byTrees = now.scenes.flatMap((scene) =>
        scene.kind !== 'tree' ? [] : tree.pumpkins.map(({ x, z, turn, kind }) => pumpkinBody(scene.x + x, scene.z + z, (turn * Math.PI) / 180, kind)),
      )
      return [...byTrees, ...loosePumpkins.map(({ x, z, turn, kind }) => pumpkinBody(x, z, turn, kind))]
    },
    pumpkinKinds: pumpkinKinds.length,
    layLoosePumpkins(pumpkins) {
      loosePumpkins = pumpkins.map(({ at: { x, z }, kind, look }) => ({ x, z, kind, turn: Math.atan2(look.x, look.z) - pumpkinRounds[pumpkinKind(kind)]!.face }))
      const placed = loosePumpkins.map(({ x, z, turn, kind }) => pumpkinKinds[pumpkinKind(kind)]!.clone().rotateY(turn).translate(x, groundAt(x, z), z))
      loose.geometry.dispose()
      loose.geometry = placed.length > 0 ? mergeGeometries(placed) : new BufferGeometry()
    },
    landingOf(now, at) {
      const index = now.scenes.indexOf(at)
      const part = parts[index]
      if (part?.kind !== 'tree') return undefined
      const { x, z } = perchOn(part, shownOf(now.plain.braziers[at.brazier], 'scene'))
      const faces = (tree.goslingTurn * Math.PI) / 180
      return { x: x + Math.sin(faces) * tree.jumpForward + tree.jumpRight, z: z + Math.cos(faces) * tree.jumpForward }
    },
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
        const brazier = now.plain.braziers[k]!
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
              shown: keptShown(brazier, 'scene'),
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
              // Drawn by the dead trees as it is now, every frame.
              shown: keptShown(brazier, 'scene'),
              lay() {},
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
              shown: keptShown(brazier, 'fire'),
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
              shown: keptShown(brazier, 'scene'),
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
              shown: keptShown(brazier, 'cart'),
              move(dx, dz) {
                onGround(part.cart, dx, dz)
                shift(scene.cart, dx, dz)
              },
              turn: turnSet,
            },
            {
              name: "cage's campfire",
              object: part.campfire,
              shown: keptShown(brazier, 'fire'),
              // Drawn where the play's light for it is, every frame.
              move(dx, dz) {
                shift(light, dx, dz)
              },
              turn: turnSet,
            },
            {
              name: 'dead body',
              object: part.corpse,
              shown: keptShown(brazier, 'body'),
              move(dx, dz) {
                onGround(part.corpse, dx, dz)
                shift(scene.skull, dx, dz)
                shift(scene.key, dx, dz)
              },
              turn: turnSet,
            },
          ]
        }
        return []
      })
    },
    update(now, dt, bone) {
      time += dt
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
          const shown = shownOf(now.plain.braziers[scene.brazier], 'scene')
          part.model.scale.setScalar((tree.height * shown.size) / treeFile.top)
          part.model.position.y = tree.y + shown.y
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
          part.key.scale.setScalar(SET_SCALE * (wing ? keyInWing.size : cage.key))
          if (wing) {
            wing.updateWorldMatrix(true, false)
            wing.getWorldQuaternion(part.key.quaternion)
            wing.getWorldPosition(part.key.position).add(at.set(keyInWing.x, keyInWing.y, keyInWing.z).applyQuaternion(part.key.quaternion))
            part.key.quaternion.multiply(turn.setFromEuler(euler.set((keyInWing.turnX * Math.PI) / 180, (keyInWing.turnY * Math.PI) / 180, (keyInWing.turnZ * Math.PI) / 180)))
          } else {
            // On the ground beside the body, where the play lays it.
            part.key.position.set(scene.key.x, groundAt(scene.key.x, scene.key.z) + KEY_LIES + shownOf(now.plain.braziers[scene.brazier], 'body').y, scene.key.z)
            part.key.quaternion.setFromEuler(euler.set(0, scene.turn, 0))
          }
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
      // Its scene as drawn, raised and sized.
      const shown = shownOf(now.plain.braziers[k], 'scene')
      // In the cage, on its floor.
      if (part.kind === 'cage') return up(shown.y)
      if (part.kind === 'tree') {
        // Perched on its branch, wherever the tree's size, turn and lift put it, riding it as the wind sways it, facing
        // its own way.
        const perch = perchOn(part, shown)
        const scene = now.scenes[index]!
        if (scenes.swayTree) {
          branch.set(scene.x + perch.x, groundAt(scene.x, scene.z) + perch.y, scene.z + perch.z)
          scenes.swayTree(treeOf(scene, part, shown), branch, swayed)
          perch.x += swayed.x - branch.x
          perch.y += swayed.y - branch.y
          perch.z += swayed.z - branch.z
        }
        // Lit, it jumps from the branch to the ground where the play lands it, facing the way it jumps, the play moving it
        // from the trunk's middle to there and the perch eased off as it does.
        const hop = now.hopOf(k)
        const perched = (tree.goslingTurn * Math.PI) / 180
        if (hop === null) return g.state === 'waiting' ? { ...perch, yaw: perched } : up(0)
        // Up off the branch to jumpHeight over it and down to the ground, as a thrown body falls: from the branch's height
        // at the take-off, rising at `v`, falling by `fall`, so it tops out jumpHeight over the branch and lands at the end.
        const air = airOf(hop.share)
        // Straight down from its perch, it keeps the way it sat; ahead of it, it faces the way it jumps, near enough the same.
        const across = { x: hop.to.x - hop.from.x - perch.x, z: hop.to.z - hop.from.z - perch.z }
        const yaw = Math.hypot(across.x, across.z) < 0.05 ? perched : Math.atan2(across.x, across.z)
        const rise = Math.max(0, tree.jumpHeight)
        const v = 2 * rise + 2 * Math.sqrt(rise * rise + rise * perch.y)
        const fall = v + perch.y
        return { x: perch.x * (1 - air), y: perch.y + v * air - fall * air * air, z: perch.z * (1 - air), yaw }
      }
      // Down in the bucket, its head over the rim; out of the well in two hops: from the bucket up onto the ring, leaving the bucket's offset, and from the ring down to the ground.
      const sits = (part.rim + bucketOffset.y) * shown.size + shown.y - SEAT
      const ring = RING_TOP * shown.size + shown.y
      if (g.state === 'waiting') return up(sits, shown.size)
      const hop = now.hopOf(k)
      if (hop === null) return up(0)
      const [from, to] = hop.hop === 0 ? [sits, ring] : [ring, 0]
      const air = airOf(hop.share)
      return up(from + (to - from) * air + ARC[hop.hop] * 4 * air * (1 - air), hop.hop === 0 ? (1 - air) * shown.size : 0)
    },
  }
  return scenes
}
