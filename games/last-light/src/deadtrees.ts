// The goose game's dead trees: the plain's own trees, dead long since, drawn
// only, for the look. They stand either side of the old road, never on it:
// none near its middle, none in a brazier's light, none by a scene's pieces,
// the well, the dead tree's fire, the cage's cart and skull, the log, nor by an
// arch. They gather in groves and thin out into the dark away from the road,
// the odd one standing alone, so the road between them reads as a clearing.
//
// The road's broken walls (roadwalls.ts) stand between the road and its trees:
// a tree near a wall stands behind it, further from the road than the wall's
// back face, never between the wall and the road nor in the wall. The same
// road, the same walls, the same trees.
//
// Their bark is the plain wood colour, or one of the bark sets the bark folder
// picks, laid as the floor is (ground.ts): a tile `scale` m wide, turned, its
// colour lightened, saturated and its hue turned, its normal map's relief
// deepened, through uniforms, so a slider recompiles nothing. They are laid by
// the file's uvs, unwrapped again for the bark (scripts/generators/
// deadtrees_uv.py): each island's v up its branch, as a bark set's grain runs,
// a metre of the file a uv unit, so every island takes the bark at one size.
//
// A file may carry its tree's leaves too, as justASimpleTree exports them
// (glb.js): cards cut out by its leaf texture, their vertex colours
// the shade baked on each, the crown's sun-side gradient times its occlusion,
// tinted a little clump to clump. They are drawn in the same shell, coloured as
// justASimpleTree colours its leaves, through three colours, shadow, mid and
// light, hard-edged, here by that baked shade: the game's own lights light
// them after. The texture is justASimpleTree's own, white leaves on black, as
// it paints it (scripts/generators/leaves_texture.mjs), not the file's copy.
// Their glow, their own colour shown as light, is kept out of the bloom.
import { BufferAttribute, BufferGeometry, Color, DataTexture, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, LinearMipmapLinearFilter, Matrix4, NoColorSpace, Quaternion, RepeatWrapping, Sphere, TextureLoader, Vector2, Vector3, type Material, SRGBColorSpace, type Texture } from 'three/webgpu'
import { attribute, dFdx, dFdy, dot, float, fract, hue, materialColor, max, mix, mx_noise_float, normalView, normalViewGeometry, positionGeometry, positionView, renderGroup, saturation, select, texture, uniform, uv, vec2, vec3 } from 'three/tsl'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Frustum, Mesh, Node } from 'three/webgpu'
import type { Plain, Point } from './plain'
import type { StoneBlock } from './roadwalls'
import { leaveOutOfBloom } from './post'
import { ShellToonMaterial, type PaintLook, type ShellLook } from './shell'
import { createStrokes } from './strokes'
import { random } from './swarm'
import type { ToonLook } from './toon'
import { cardCentres, createTreeWind, type TreeWindLook } from './treesway'

/**
 * A dead tree where the plain has it: its variant, one of the file's trees, how far it is turned, rad, how tall it
 * stands, m, and how much wider than that makes it (DeadTreeShape.width); and how far over the ground its foot stands,
 * m, none if not given.
 */
export interface DeadTree extends Point {
  variant: number
  turn: number
  height: number
  width: number
  lift?: number
}

/** How the dead trees are scattered, as the dead trees folder edits it. */
export interface DeadTreeShape {
  /** How close to the road's middle a tree may stand, m, and how far out from it they reach, m. */
  clear: number
  band: number
  /** How much they thin out toward the band's far edge, 0 not at all to 1 none left there. */
  thin: number
  /** How close to a brazier's light a tree may stand, m past its reach; and to a scene's piece or an arch, m. */
  light: number
  piece: number
  /** How close two stand at the closest, m, trunk to trunk. */
  spacing: number
  /** The shortest and tallest one stands, m: their y scale. */
  shortest: number
  tallest: number
  /** How much wider than their height scales them, the same for every one: 1 scaled evenly, as the file has them. */
  width: number
  /** How many groves along the road, and how wide each is, m; and how thick they stand between the groves, 0 none to 1 as in one. */
  groves: number
  grove: number
  between: number
  /** How near a wall a tree counts as by it, m, and how far behind its back face a tree by it stands at the least, m. */
  byWall: number
  behindWall: number
  /** The seed their places are drawn from. */
  seed: number
}

/** The dead trees as set from the panel on 2026-10-25, near the road now the walls stand between: thick by it, thinning out far into the dark, 5 m apart at the closest (2026-10-26); as tall and wide as the file laid starts them. */
export function defaultDeadTreeShape(): DeadTreeShape {
  const { shortest, tallest, width } = TREES
  return { clear: 3.1, band: 33, thin: 0.6, light: 3, piece: 3, spacing: 5, shortest, tallest, width, groves: 18, grove: 6, between: 0.3, byWall: 4, behindWall: 0.5, seed: 1 }
}

/** How many darts are thrown for every square metre the trees could stand on. */
const DARTS = 0.3

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z)

/** The nearest point to `p` on the line through `points`, and how far it is, m. */
function nearestOn(points: readonly Point[], p: Point): { at: Point; off: number } {
  if (points.length === 1) return { at: points[0]!, off: distance(points[0]!, p) }
  let best = { at: p, off: Infinity }
  for (let k = 0; k + 1 < points.length; k++) {
    const a = points[k]!
    const b = points[k + 1]!
    const abx = b.x - a.x
    const abz = b.z - a.z
    const span = abx * abx + abz * abz
    const t = span > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.z - a.z) * abz) / span)) : 0
    const at = { x: a.x + abx * t, z: a.z + abz * t }
    const off = distance(at, p)
    if (off < best.off) best = { at, off }
  }
  return best
}

/** How far `p` is from the line through `points`, m. */
export const offWay = (points: readonly Point[], p: Point): number => nearestOn(points, p).off

/** Every scene piece on `plain` a tree keeps off: each brazier's gosling, the dead tree's fire, the cage's skull and cart, the log's ends. */
function piecesOf(plain: Plain): Point[] {
  return plain.braziers.flatMap((b) => [b.gosling, b.fire, b.skull, b.cart, b.log?.near, b.log?.far].filter((p) => p !== undefined))
}

/**
 * Whether `p`, `off` m from the road's middle `road`, keeps `shape`'s rule for `walls`: by none of them, or behind the
 * nearest one, further from the road than its back face by `shape.behindWall`.
 */
export function behindWalls(road: readonly Point[], walls: readonly StoneBlock[], shape: DeadTreeShape, p: Point, off = offWay(road, p)): boolean {
  let nearest: { at: Point; off: number; thick: number } | undefined
  for (const wall of walls) {
    const on = nearestOn(wall.line, p)
    if (on.off < shape.byWall && (!nearest || on.off < nearest.off)) nearest = { ...on, thick: wall.thick }
  }
  if (!nearest) return true
  return off >= offWay(road, nearest.at) + nearest.thick / 2 + shape.behindWall
}

/**
 * The dead trees either side of `road`, the old road's middle through `plain`, as `shape` scatters them, `variants`
 * kinds of tree to pick from, behind `walls` where by one, clear of `pieces` besides the plain's own (the arches);
 * `clear` says where else one may stand, as the pond's water and bank and the floor's edge rule out.
 */
export function deadTrees(
  plain: Plain,
  road: readonly Point[],
  variants: number,
  shape = defaultDeadTreeShape(),
  walls: readonly StoneBlock[] = [],
  pieces: readonly Point[] = [],
  clear: (x: number, z: number) => boolean = () => true,
): DeadTree[] {
  if (road.length === 0) return []
  const next = random(shape.seed)
  const keepOff = [...piecesOf(plain), ...pieces]
  const band = Math.max(shape.band, shape.clear + 0.1)
  const xs = road.map((p) => p.x)
  const zs = road.map((p) => p.z)
  const minX = Math.min(...xs) - band
  const minZ = Math.min(...zs) - band
  const width = Math.max(...xs) + band - minX
  const depth = Math.max(...zs) + band - minZ
  // The groves, each by the road, either side of it, somewhere out in the band.
  const groves = Array.from({ length: shape.groves }, () => {
    const leg = Math.floor(next() * Math.max(1, road.length - 1))
    const a = road[leg]!
    const b = road[Math.min(leg + 1, road.length - 1)]!
    const t = next()
    const along = Math.hypot(b.x - a.x, b.z - a.z) || 1
    const side = (next() < 0.5 ? -1 : 1) * (shape.clear + next() * (band - shape.clear))
    return { x: a.x + (b.x - a.x) * t - ((b.z - a.z) / along) * side, z: a.z + (b.z - a.z) * t + ((b.x - a.x) / along) * side }
  })
  const trees: DeadTree[] = []
  const darts = Math.ceil(width * depth * DARTS)
  for (let k = 0; k < darts; k++) {
    const p = { x: minX + next() * width, z: minZ + next() * depth }
    // Drawn whatever happens to the dart, so a change to one rule leaves the others' trees where they were.
    const keep = next()
    const variant = Math.floor(next() * variants)
    const turn = next() * Math.PI * 2
    const height = shape.shortest + next() * (shape.tallest - shape.shortest)
    const off = offWay(road, p)
    if (off < shape.clear || off > band) continue
    // Thick in the groves, sparse between them; thinning out away from the road.
    const inGrove = Math.max(0, ...groves.map((g) => Math.exp(-((distance(g, p) / shape.grove) ** 2))))
    const out = (off - shape.clear) / (band - shape.clear)
    if (keep > (shape.between + (1 - shape.between) * inGrove) * (1 - shape.thin * out)) continue
    if (plain.braziers.some((b) => distance(b, p) < b.reach + shape.light)) continue
    if (keepOff.some((q) => distance(q, p) < shape.piece)) continue
    if (trees.some((t) => distance(t, p) < shape.spacing)) continue
    if (!clear(p.x, p.z)) continue
    if (!behindWalls(road, walls, shape, p, off)) continue
    trees.push({ ...p, variant, turn, height, width: shape.width })
  }
  return trees
}

/**
 * Files of trees, each mesh in them one kind, and how they are laid: `laid` m tall in their geometry before they are
 * sized; how far round its middle a trunk stands at x and z scale 1, m, `trunk`; and the shortest and tallest they
 * stand, m, and their x and z scale, as the shape starts; how far out from its middle a crown reaches, as laid, m,
 * `crown`, its branches swinging in the wind the more the farther out. `leaves` names the mesh of a tree's leaves, where
 * the files have them: such a file holds one tree, its leaves its wood's.
 */
interface TreeFile {
  files: string[]
  laid: number
  trunk: number
  crown: number
  shortest: number
  tallest: number
  width: number
  leaves?: string
}
/**
 * The dead trees: five side by side, laid about as tall as they stand, so the strokes are the size of hers; their
 * trunks measured 0.13 to 0.19 m out, 0.2 to 0.9 m up (2026-10-25).
 */
const DEAD_TREES: TreeFile = { files: ['./models/deadTrees.glb'], laid: 2.6, trunk: 0.18, crown: 1.2, shortest: 3, tallest: 3.5, width: 1.25 }
/**
 * The giant trees, under test (2026-10-26): four curled trees in leaf, the first 9.4 m tall, its foot about 0.55 m round
 * on the ground; each laid as tall as the first, and standing 8 m tall, as set from the panel on 2026-10-26. justASimpleTree's spooky trees (night theme, seeds 6964, 1759, 4843 and
 * 5197), as its own export writes them (scripts/generators/giant_tree.mjs), nothing between: their leaves each one cell
 * of the leaf atlas (LEAF_TEXTURE), as it draws them; their wood's uvs its own too, a metre round each branch and a metre
 * along the wood a unit, a seam down each branch (2026-10-26). The Blender cut before them had unwrapped the leaves with
 * the wood, and its cards showed whole.
 */
const GIANT_TREE: TreeFile = {
  files: [6964, 1759, 4843, 5197].map((seed) => `./models/spookyTrees/spooky-${seed}.glb`),
  laid: 9.36,
  trunk: 0.55,
  crown: 3,
  shortest: 8,
  tallest: 8,
  width: 1,
  leaves: 'leaves',
}
/**
 * The leaves' texture: justASimpleTree's pointed cluster, a 2 x 2 atlas of four clusters, white leaves on black, painted
 * by its own code (scripts/generators/leaves_texture.mjs); the way up its canvas is, as the cards' uvs read it.
 */
const LEAF_TEXTURE = './textures/leaves/pointed-cluster.png'
/** The trees laid: the giant one, for the test; the dead trees under `?deadtrees`. */
const TREES = typeof location !== 'undefined' && new URLSearchParams(location.search).has('deadtrees') ? DEAD_TREES : GIANT_TREE
/** How long a body the shell's painted strokes count along, m: the goose's, as the scenes' (goosescenes.ts). */
const STROKE_BODY = 0.9

/** `tree`'s x and z scale: its height's, so a tree is scaled evenly, never stretched, times its width. */
const across = (tree: DeadTree): number => (tree.width * tree.height) / TREES.laid

/** `trees` as their stretches lay them: each as wide as it is scaled across, not as its width alone. */
const evenly = (trees: readonly DeadTree[]): DeadTree[] => trees.map((t) => ({ ...t, width: across(t) }))

/** How far round its middle `tree`'s trunk stands, m, as wide as it stands: what she and her goslings keep out of. */
export const trunkRadius = (tree: DeadTree): number => TREES.trunk * across(tree)

/**
 * How wide a stretch of the dead trees is, m, a square of the plain: each kind's trees in one are culled whole, so the
 * stretches behind the camera and down the road are never drawn. One mesh a kind for the whole road drew all 469
 * trees every frame (2026-10-25).
 */
export const TREE_STRETCH = 20

/** `trees` as they are drawn: grouped by their kind, and by the TREE_STRETCH square of the plain they stand in. */
export function treeStretches(trees: readonly DeadTree[]): DeadTree[][] {
  const stretches = new Map<string, DeadTree[]>()
  for (const t of trees) {
    const key = `${t.variant} ${Math.floor(t.x / TREE_STRETCH)} ${Math.floor(t.z / TREE_STRETCH)}`
    const these = stretches.get(key)
    if (these) these.push(t)
    else stretches.set(key, [t])
  }
  return [...stretches.values()]
}

/** Whether a stretch, its bound `radius` m round (x, z) on the ground, comes within `reach` m of (fromX, fromZ). */
export function stretchInReach(x: number, z: number, radius: number, fromX: number, fromZ: number, reach: number): boolean {
  return Math.hypot(x - fromX, z - fromZ) - radius <= reach
}

/**
 * The bark sets, from the woodTexture download of 2026-10-26: each its colour and OpenGL normal map, in
 * public/textures/bark/`set`/, cut to jpg; `none` the plain wood colour. bark_05 the one kept, the rest dropped
 * (2026-10-26).
 */
export const BARKS = ['none', 'bark_05'] as const
export type BarkName = (typeof BARKS)[number]

/** What the dead trees' bark folder edits, as the floor folder edits the floor's (ground.ts). */
export interface BarkLook {
  /** Which set is laid, or `none`, the plain wood colour. */
  texture: BarkName
  /** Brightness, as a multiplier: 1 the map's own. */
  lightness: number
  /** How much of the plain wood colour shows in place of the map's, 0 none, 1 all of it, the map's relief kept. */
  wood: number
  /** Colour strength: 1 the map's own, 0 grey. */
  saturation: number
  /** How far round the colour wheel its colours turn, degrees. */
  hue: number
  /** How wide one tile is on the tree, m. */
  scale: number
  /** How far the tiles are turned, degrees: 0 as painted, its up along the branch. */
  rotation: number
  /** How deep the relief: 1 the normal map as painted, 0 flat. */
  relief: number
}

/** bark_05, as set from the panel on 2026-10-26: its relief deep on the plain wood colour, its tiles wide and turned. */
export function defaultBarkLook(): BarkLook {
  return { texture: 'bark_05', lightness: 3, wood: 1, saturation: 0, hue: 0, scale: 4.6, rotation: 22, relief: 3 }
}

/** What stands in for `none`'s maps: no colour of its own, no relief. */
function pixel(r: number, g: number, b: number): Texture {
  const map = new DataTexture(new Uint8Array([r, g, b, 255]), 1, 1)
  map.colorSpace = NoColorSpace
  map.needsUpdate = true
  return map
}
const noBark: [Texture, Texture] = [pixel(255, 255, 255), pixel(128, 128, 255)]

/** Each set's colour and normal map, loaded once asked for, kept after. */
const barks = new Map<BarkName, Promise<[Texture, Texture]>>()
function loadBark(name: BarkName): Promise<[Texture, Texture]> {
  if (name === 'none') return Promise.resolve(noBark)
  let pair = barks.get(name)
  if (!pair) {
    const loader = new TextureLoader()
    const tile = (map: Texture, colour: boolean) => {
      map.wrapS = map.wrapT = RepeatWrapping
      map.minFilter = LinearMipmapLinearFilter
      map.anisotropy = 8
      map.colorSpace = colour ? SRGBColorSpace : NoColorSpace
      return map
    }
    pair = Promise.all([loader.loadAsync(`./textures/bark/${name}/color.jpg`), loader.loadAsync(`./textures/bark/${name}/normal.jpg`)]).then(([map, normals]): [Texture, Texture] => [tile(map, true), tile(normals, false)])
    barks.set(name, pair)
  }
  return pair
}

/** What the dead trees' leaves folder edits, after justASimpleTree's leaves section. */
export interface LeafLook {
  show: boolean
  /** The cards cut out by the leaf texture, or whole, to see them; and the texture's alpha below which they are cut. */
  textured: boolean
  cutout: number
  /** The three colours, sRGB: a card's baked shade below `shadowTo` the shadow, from `lightFrom` the light, the mid between. */
  shadow: number
  mid: number
  light: number
  shadowTo: number
  lightFrom: number
  /** How much the baked shade darkens each card within its colour, 0 none, 1 all of it. */
  shading: number
  /** How much of the clumps' own tints, baked in their colours, shows, 0 none, 1 as baked. */
  variation: number
  /**
   * How much of their own colour they show whatever the light falls on them, 0 none, lit by the game's lights alone, 1
   * all of it: justASimpleTree's leaves show their colours as their own light, which the night's dim light lost.
   */
  glow: number
}

/** The leaves to start, as set from the panel on 2026-10-26: three reds, most of the shade the mid, a little of it light. */
export function defaultLeafLook(): LeafLook {
  return { show: true, textured: true, cutout: 0.5, shadow: 0x872c2c, mid: 0xd04343, light: 0xdd4b4b, shadowTo: 0.59, lightFrom: 0.95, shading: 0.55, variation: 1, glow: 0.48 }
}

/** How light a colour is, by the eye's weights. */
const LUMA = vec3(0.2126, 0.7152, 0.0722)

/** Leaf cards as justASimpleTree exports them, in a shell, coloured as a LeafLook has them: the trees', or the bushes'. */
export interface LeafMaterial {
  material: ShellToonMaterial
  /** Take a leaves folder's values, but `show`, which is the caller's; nothing recompiled. */
  set(look: LeafLook): void
}

/**
 * The leaves' shell, cut out by `leaf`, the leaf texture's mask, 1 a leaf: each card's colour one of the three by its
 * baked shade, darkened by as much of that shade as `shading` keeps, tinted as its clump; lit by its clump's normal on
 * both sides; as much of its colour its own light as `glow` has, kept out of the bloom.
 */
export function createLeafMaterial(leaf: Node<'float'>): LeafMaterial {
  const colours = { shadow: uniform(new Color()).setGroup(renderGroup), mid: uniform(new Color()).setGroup(renderGroup), light: uniform(new Color()).setGroup(renderGroup) }
  const shadowTo = uniform(0.55).setGroup(renderGroup)
  const lightFrom = uniform(0.8).setGroup(renderGroup)
  const shading = uniform(0.5).setGroup(renderGroup)
  const variation = uniform(1).setGroup(renderGroup)
  const cut = uniform(1).setGroup(renderGroup)
  const glow = uniform(0.7).setGroup(renderGroup)
  const material = new ShellToonMaterial({ side: DoubleSide, alphaTest: 0.5 })
  leaveOutOfBloom(material)
  const baked = attribute('color', 'vec4').rgb
  const shade = dot(baked, LUMA)
  const band = select(shade.lessThan(shadowTo), colours.shadow, select(shade.lessThan(lightFrom), colours.mid, colours.light))
  const tint = baked.div(shade.max(1e-4))
  const own = band.mul(mix(float(1), shade, shading)).mul(mix(vec3(1), tint, variation))
  material.colorNode = own
  // Lit by the clump's normal on both sides, as justASimpleTree lights them: three turns a card's normal round on its
  // back, into the clump, and a card seen from behind went black.
  material.normalNode = normalViewGeometry
  // Typed on the standard node material but not on the toon one; three's node material reads it on both.
  ;(material as unknown as { emissiveNode: Node }).emissiveNode = own.mul(glow)
  material.opacityNode = mix(float(1), leaf, cut)
  return {
    material,
    set(look) {
      cut.value = look.textured ? 1 : 0
      material.alphaTest = Math.max(0.01, look.cutout)
      colours.shadow.value.setHex(look.shadow)
      colours.mid.value.setHex(look.mid)
      colours.light.value.setHex(look.light)
      shadowTo.value = look.shadowTo
      lightFrom.value = look.lightFrom
      shading.value = look.shading
      variation.value = look.variation
      glow.value = look.glow
    },
  }
}

/** Trees, or bushes, drawn a stretch at a time: laid where `lay` has them, only the stretches near enough drawn. */
export interface Stretches {
  object: Group
  lay(trees: readonly DeadTree[]): void
  /**
   * Draw only the stretches within `reach` m of (x, z) on the ground, past the fog's solid edge a tree draws as the fog,
   * and, given the camera's `view`, only those in it.
   */
  cullPast(x: number, z: number, reach: number, view?: Frustum): void
}

/** One kind's trees, all its stretches in one instanced mesh, and where each stretch's lie in the laid matrices. */
interface KindDrawn {
  mesh: InstancedMesh
  /** Every tree of the kind, stretch after stretch, as `lay` laid them. */
  laid: Float32Array
  stretches: { from: number; count: number; bound: Sphere; shown: boolean }[]
}

/**
 * `kinds`, each laid `laid` m tall on its own foot, drawn in `material` by stretches (treeStretches), each tree turned,
 * made as tall and as wide as `lay` has it, standing on the ground `groundAt` has under it.
 *
 * One instanced mesh a kind, the stretches drawn packed to its front. three's WebGPU renderer builds a shader, and
 * the GPU compiles a pipeline, for each instanced mesh apart, and a mesh a kind a stretch made 56 to 210 of them:
 * most of the goose game's start, a minute and more with nothing drawn (2026-10-26).
 */
export function createStretches(kinds: readonly BufferGeometry[], material: Material, laid: number, groundAt: (x: number, z: number) => number, shadows = false): Stretches {
  const object = new Group()
  let drawn: KindDrawn[] = []
  const matrix = new Matrix4()
  const turn = new Quaternion()
  const up = new Vector3(0, 1, 0)
  const at = new Vector3()
  const scale = new Vector3()
  const tree = new Sphere()
  const seen = new Sphere()
  return {
    object,
    lay(trees) {
      for (const { mesh } of drawn) {
        mesh.removeFromParent()
        mesh.dispose()
      }
      const byKind = new Map<number, DeadTree[][]>()
      for (const these of treeStretches(trees)) {
        const variant = these[0]!.variant
        byKind.set(variant, [...(byKind.get(variant) ?? []), these])
      }
      drawn = [...byKind].map(([variant, stretches]) => {
        const geometry = kinds[variant]!
        geometry.boundingSphere ?? geometry.computeBoundingSphere()
        const total = stretches.reduce((sum, these) => sum + these.length, 0)
        const mesh = new InstancedMesh(geometry, material, total)
        const matrices = new Float32Array(total * 16)
        let from = 0
        const kind: KindDrawn = {
          mesh,
          laid: matrices,
          stretches: stretches.map((these) => {
            const bound = new Sphere()
            these.forEach((t, i) => {
              matrix.compose(at.set(t.x, groundAt(t.x, t.z) + (t.lift ?? 0), t.z), turn.setFromAxisAngle(up, t.turn), scale.set(t.width, t.height / laid, t.width))
              matrix.toArray(matrices, (from + i) * 16)
              bound.union(tree.copy(geometry.boundingSphere!).applyMatrix4(matrix))
            })
            const stretch = { from, count: these.length, bound, shown: true }
            from += these.length
            return stretch
          }),
        }
        mesh.instanceMatrix.array.set(matrices)
        mesh.instanceMatrix.needsUpdate = true
        // Bound round every stretch, while all are drawn: three's own culling of the kind as a whole.
        mesh.computeBoundingSphere()
        // Out in the dark, past every light: no shadow worth its pass, but where asked for.
        mesh.castShadow = shadows
        mesh.receiveShadow = true
        object.add(mesh)
        return kind
      })
    },
    cullPast(x, z, reach, view) {
      object.updateWorldMatrix(true, false)
      for (const { mesh, laid, stretches } of drawn) {
        let changed = false
        for (const stretch of stretches) {
          const { center, radius } = stretch.bound
          const shown = stretchInReach(center.x, center.z, radius, x, z, reach) && (!view || view.intersectsSphere(seen.copy(stretch.bound).applyMatrix4(object.matrixWorld)))
          changed ||= shown !== stretch.shown
          stretch.shown = shown
        }
        if (!changed) continue
        // The stretches shown, packed to the front, and only they drawn.
        const matrices = mesh.instanceMatrix.array as Float32Array
        let count = 0
        for (const { from, count: these, shown } of stretches) {
          if (!shown) continue
          matrices.set(laid.subarray(from * 16, (from + these) * 16), count * 16)
          count += these
        }
        mesh.count = count
        mesh.visible = count > 0
        mesh.instanceMatrix.clearUpdateRanges()
        mesh.instanceMatrix.addUpdateRange(0, count * 16)
        mesh.instanceMatrix.needsUpdate = true
      }
    },
  }
}

/**
 * The cross-section of `wood` at `height` m up it, as laid, flat and facing up: each piece of wood the plane cuts
 * through, a trunk or a branch, filled as a fan from its middle. Its uv runs out from that middle to 1 at the piece's
 * edge, all the way round, for the rings. None where the plane cuts nothing.
 */
export function trunkCap(wood: BufferGeometry, height: number): BufferGeometry | undefined {
  const position = wood.getAttribute('position')
  const index = wood.index
  // A vertex by where it is, to the millimetre: the wood repeats its vertices along its seams, and a ring cut in two
  // there would be two pieces, each filled from a middle of its own.
  const welded = new Map<string, number>()
  const at = (k: number) => {
    const key = `${Math.round(position.getX(k) * 1000)} ${Math.round(position.getY(k) * 1000)} ${Math.round(position.getZ(k) * 1000)}`
    let id = welded.get(key)
    if (id === undefined) welded.set(key, (id = welded.size))
    return id
  }
  const vertexOf = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k)
  const triangles = (index ? index.count : position.count) / 3
  // The vertices of the triangles the plane cuts, joined where they share one, so each piece of wood is one set.
  const parent = new Map<number, number>()
  const find = (v: number): number => {
    let root = v
    while (parent.get(root) !== root) root = parent.get(root)!
    parent.set(v, root)
    return root
  }
  const cuts: { a: Vector3; b: Vector3; vertex: number }[] = []
  const p = [new Vector3(), new Vector3(), new Vector3()]
  for (let t = 0; t < triangles; t++) {
    const corners = [vertexOf(t, 0), vertexOf(t, 1), vertexOf(t, 2)]
    corners.forEach((k, i) => p[i]!.fromBufferAttribute(position, k))
    const v = corners.map(at)
    const crossed: Vector3[] = []
    for (const [i, j] of [[0, 1], [1, 2], [2, 0]] as const) {
      const a = p[i]!
      const b = p[j]!
      if ((a.y - height) * (b.y - height) >= 0) continue
      crossed.push(a.clone().lerp(b, (height - a.y) / (b.y - a.y)))
    }
    if (crossed.length !== 2) continue
    for (const k of v) if (!parent.has(k)) parent.set(k, k)
    for (const k of v.slice(1)) parent.set(find(k), find(v[0]!))
    cuts.push({ a: crossed[0]!, b: crossed[1]!, vertex: v[0]! })
  }
  if (cuts.length === 0) return undefined
  const pieces = new Map<number, typeof cuts>()
  for (const cut of cuts) {
    const root = find(cut.vertex)
    const these = pieces.get(root)
    if (these) these.push(cut)
    else pieces.set(root, [cut])
  }
  const positions: number[] = []
  const uvs: number[] = []
  for (const these of pieces.values()) {
    const middle = new Vector3()
    for (const { a, b } of these) middle.add(a).add(b)
    middle.divideScalar(these.length * 2)
    const out = (q: Vector3) => {
      const x = q.x - middle.x
      const z = q.z - middle.z
      const r = Math.hypot(x, z) || 1
      return [x / r, z / r]
    }
    for (const cut of these) {
      // Its corners turned to face up, whichever way round the wood's triangle had them: a triangle facing down is
      // drawn as a back face, its normal turned down, and shaded unlike its neighbours.
      const facesUp = (cut.a.x - middle.x) * (cut.b.z - middle.z) - (cut.a.z - middle.z) * (cut.b.x - middle.x) < 0
      const [a, b] = facesUp ? [cut.a, cut.b] : [cut.b, cut.a]
      positions.push(middle.x, height, middle.z, a.x, height, a.z, b.x, height, b.z)
      uvs.push(0, 0, ...out(a), ...out(b))
    }
  }
  const cap = new BufferGeometry()
  cap.setAttribute('position', new Float32BufferAttribute(positions, 3))
  cap.setAttribute('normal', new Float32BufferAttribute(positions.map((_, k) => (k % 3 === 1 ? 1 : 0)), 3))
  cap.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  return cap
}

/** The dead trees drawn: laid where `lay` has them, in the wood `setWood` paints them, in the shell `setShell` has. */
export interface DeadTreesMesh extends Stretches {
  /** How many kinds of tree there are to pick from. */
  variants: number
  /** Paint them `colour`, its saturation `saturation` times its own: 0 grey, 1 as it is. */
  setWood(colour: number, saturation?: number): void
  setShell(look: ShellLook & { paint: PaintLook; toon: ToonLook }): void
  /** Take the bark folder's values: a new set is loaded and swapped in, nothing recompiled. */
  setBark(look: BarkLook): void
  /** Whether the trees carry leaves, for the leaves folder. */
  leaves: boolean
  /** Take the leaves folder's values; nothing where the trees have none. */
  setLeaves(look: LeafLook): void
  /**
   * The trunk the see-through leaves whole: the wood's material, and where on it a fragment is kept, up to the share of
   * each tree's height `setTrunk` has; so a tree's trunk shows whatever is dithered away above it. `whole`, the trunk's
   * cross-section where it is kept to, filling the hole the dither leaves over it, is never cut.
   */
  trunk: { material: Material; kept: Node<'bool'>; whole: Material }
  setTrunk(share: number): void
  /** How many rings the trunk's cross-section shows, heart to bark; nothing recompiled. */
  setRings(count: number): void
  /** Take the wind folder's values: how the wood and the leaves sway, as justASimpleTree's trees do; nothing recompiled. */
  setWind(look: TreeWindLook): void
  /**
   * The scenes' own trees, `createDeadTrees`'s `own` files, drawn as these are, in the same bark, shell, wind and
   * see-through, but in a group of their own, never culled nor moved with `object`, and casting shadows. Each own file a
   * variant of its own, 0 the first; laid again only when they change.
   */
  own: Group
  placeOwn(trees: readonly DeadTree[]): void
  /** Where the wood of own tree `tree` at `at`, on the plain, sways to as last drawn, into `out`: for what sits on its branch. */
  swayOwn(tree: DeadTree, at: Vector3, out: Vector3): Vector3
}

/**
 * The dead trees, none laid yet, each of the file's trees an instanced mesh a stretch, in one shell of `wood`, standing
 * on the ground `groundAt` has under it; and the scenes' `own` trees, each the wood of a file of justASimpleTree's, its
 * foot on its origin, its uvs a metre of the file a unit, laid as the files' are.
 */
export async function createDeadTrees(wood: number, groundAt: (x: number, z: number) => number = () => 0, own: readonly BufferGeometry[] = []): Promise<DeadTreesMesh> {
  const files = await Promise.all(TREES.files.map((file) => new GLTFLoader().loadAsync(file)))
  // Each tree on its own foot, laid as tall as the file has them; its leaves, where it has them, sized with it, a
  // kind of leaves for each kind of tree.
  const kinds: BufferGeometry[] = []
  /** A tree's wood laid TREES.laid tall, its uv, a metre of the file a unit, scaled with it; none, all at the tile's corner. */
  const layWood = (geometry: BufferGeometry) => {
    geometry.computeBoundingBox()
    const size = TREES.laid / geometry.boundingBox!.max.y
    geometry.scale(size, size, size)
    const uvs = geometry.getAttribute('uv') ?? new BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 2), 2)
    for (let k = 0; k < uvs.count; k++) uvs.setXY(k, uvs.getX(k) * size, uvs.getY(k) * size)
    geometry.setAttribute('uv', uvs)
    return geometry
  }
  const crowns: BufferGeometry[] = []
  for (const { scene: file } of files) {
    let size = 1
    let crown: Mesh | undefined
    file.traverse((o) => {
      const mesh = o as Mesh
      if (!mesh.isMesh) return
      if (mesh.name === TREES.leaves) {
        crown = mesh
        return
      }
      const geometry = mesh.geometry.clone()
      geometry.computeBoundingBox()
      size = TREES.laid / geometry.boundingBox!.max.y
      kinds.push(layWood(geometry))
    })
    const leafy = crown as Mesh | undefined
    if (leafy) {
      const leaves = leafy.geometry.clone().scale(size, size, size)
      cardCentres(leaves)
      crowns.push(leaves)
    }
  }
  const variants = kinds.length
  for (const wood of own) kinds.push(layWood(wood.clone()))
  const wind = createTreeWind(TREES.laid, TREES.trunk, TREES.crown)

  // The bark's values, a uniform of the render's group each, since the trees are still meshes.
  const textured = uniform(0).setGroup(renderGroup)
  const lightness = uniform(1).setGroup(renderGroup)
  const plain = uniform(0).setGroup(renderGroup)
  const saturated = uniform(1).setGroup(renderGroup)
  const turned = uniform(0).setGroup(renderGroup)
  const tile = uniform(1).setGroup(renderGroup)
  const relief = uniform(1).setGroup(renderGroup)
  /** The tiles' turn's cosine and sine. */
  const turn = uniform(new Vector2(1, 0)).setGroup(renderGroup)

  // Where on the tile: the file's uv, a metre of the tree as laid a unit, turned, scaled to the tile.
  const laidUv = uv()
  const at = vec2(laidUv.x.mul(turn.x).sub(laidUv.y.mul(turn.y)), laidUv.x.mul(turn.y).add(laidUv.y.mul(turn.x))).div(tile)
  const [noColour, noNormals] = noBark
  const colourTexel = texture(noColour, at)
  const normalTexel = texture(noNormals, at)
  // The map's lean laid on the face along the ways its tile's u and v run across the screen, as three lays a normal
  // map with no tangents (perturbNormal2Arb); the relief its depth, none with no set.
  const face = normalView
  const q0 = dFdx(positionView)
  const q1 = dFdy(positionView)
  const st0 = dFdx(at)
  const st1 = dFdy(at)
  const q1perp = q1.cross(face)
  const q0perp = face.cross(q0)
  const alongU = q1perp.mul(st0.x).add(q0perp.mul(st1.x))
  const alongV = q1perp.mul(st0.y).add(q0perp.mul(st1.y))
  const across = max(alongU.dot(alongU), alongV.dot(alongV)).max(1e-12).inverseSqrt()
  const m = normalTexel.xyz.mul(2).sub(1)
  const lean = relief.mul(textured).mul(across)
  const viewNormal = alongU.mul(m.x.mul(lean)).add(alongV.mul(m.y.mul(lean))).add(face.mul(m.z)).normalize()

  const bark = new ShellToonMaterial({ color: wood, side: DoubleSide, painted: { strokes: createStrokes(), extent: STROKE_BODY, base: viewNormal } })
  // The plain wood colour, or the set's, as the floor's is lit, darkened and turned, or the wood colour again over it
  // as much as the bark folder has it, the set's relief still on it.
  bark.colorNode = mix(materialColor, saturation(hue(colourTexel.rgb, turned), saturated).mul(lightness), textured.mul(plain.oneMinus()))
  bark.positionNode = wind.wood
  const stretches = createStretches(kinds, bark as Material, TREES.laid, groundAt)
  const ownStretches = createStretches(kinds, bark as Material, TREES.laid, groundAt, true)
  // The trunk: the wood up to a share of the tree's height, as laid, before its own height scales it.
  const trunkShare = uniform(0.09).setGroup(renderGroup)
  // Its cross-section there, a cut log's: a pale heart in darker rings, wobbling a little round it, a dark pith at its
  // middle, the bark's own colour round its edge. Inside the trunk, it shows only where the dither cuts the wood over it.
  const sawn = uniform(new Color(wood)).setGroup(renderGroup)
  const rings = uniform(6).setGroup(renderGroup)
  const out = uv().length()
  const wobbled = out.add(mx_noise_float(vec3(uv().mul(2.5), 0.5)).mul(0.07))
  const ring = fract(wobbled.mul(rings)).greaterThan(0.8).or(out.lessThan(0.07))
  const sawnColour = sawn as unknown as Node<'vec3'>
  const heart = mix(sawnColour, vec3(1), 0.45)
  const capMaterial = new ShellToonMaterial({ side: DoubleSide })
  capMaterial.positionNode = wind.wood
  capMaterial.colorNode = select(out.greaterThan(0.88), sawnColour, select(ring, sawnColour.mul(0.55), heart))
  const trunk = { material: bark as Material, kept: positionGeometry.y.lessThan(trunkShare.mul(TREES.laid)), whole: capMaterial as Material }
  const caps = new Group()
  const ownCaps = new Group()
  let capStretches: Stretches | undefined
  let ownCapStretches: Stretches | undefined
  let capKinds: BufferGeometry[] = []
  let laidTrees: DeadTree[] = []
  let laidOwn: DeadTree[] = []
  /** The caps cut again at `share` of the trees' height, and laid where the trees, and the scenes' own, are. */
  const cutCaps = (share: number) => {
    capStretches?.lay([])
    ownCapStretches?.lay([])
    caps.clear()
    ownCaps.clear()
    for (const kind of capKinds) kind.dispose()
    const cut = kinds.map((kind) => (share > 0 ? trunkCap(kind, share * TREES.laid) : undefined))
    capKinds = cut.filter((kind) => kind !== undefined)
    const whole = cut.every((kind) => kind !== undefined)
    capStretches = whole ? createStretches(capKinds, capMaterial as Material, TREES.laid, groundAt) : undefined
    ownCapStretches = whole ? createStretches(capKinds, capMaterial as Material, TREES.laid, groundAt) : undefined
    if (!capStretches || !ownCapStretches) return
    caps.add(capStretches.object)
    ownCaps.add(ownCapStretches.object)
    capStretches.lay(laidTrees)
    ownCapStretches.lay(laidOwn)
  }

  // The leaves, where the files have them, cut out by the leaf texture as justASimpleTree reads it: its red, the leaves
  // white on black.
  let leafy: LeafMaterial | undefined
  if (crowns.length > 0 && crowns.length === variants) {
    const map = await new TextureLoader().loadAsync(LEAF_TEXTURE)
    map.colorSpace = NoColorSpace
    leafy = createLeafMaterial(texture(map, uv()).r)
  }
  const leafMaterial = leafy?.material
  if (leafMaterial) {
    leafMaterial.positionNode = wind.leaves
    wind.flutter(leafMaterial)
  }
  const leaves = leafMaterial && createStretches(crowns, leafMaterial as Material, TREES.laid, groundAt)
  const object = new Group()
  object.add(stretches.object, caps)
  if (leaves) object.add(leaves.object)
  const ownObject = new Group().add(ownStretches.object, ownCaps)
  cutCaps(trunkShare.value)
  let ownKey = ''
  const unturn = new Quaternion()
  const upright = new Vector3(0, 1, 0)
  const inTree = new Vector3()

  const hsl = { h: 0, s: 0, l: 0 }
  let asked: BarkName = 'none'
  return {
    object,
    own: ownObject,
    placeOwn(trees) {
      const key = JSON.stringify(trees)
      if (key === ownKey) return
      ownKey = key
      laidOwn = evenly(trees.map((t) => ({ ...t, variant: variants + t.variant })))
      ownStretches.lay(laidOwn)
      ownCapStretches?.lay(laidOwn)
    },
    swayOwn(tree, at, out) {
      // Where `at` stands in the tree as laid: back off its foot, unturned, unscaled.
      const [laid] = evenly([tree])
      inTree.set(at.x - laid!.x, at.y - groundAt(laid!.x, laid!.z) - (laid!.lift ?? 0), at.z - laid!.z).applyQuaternion(unturn.setFromAxisAngle(upright, -laid!.turn))
      inTree.set(inTree.x / laid!.width, (inTree.y * TREES.laid) / laid!.height, inTree.z / laid!.width)
      return wind.swayAt(at, inTree, out)
    },
    lay(trees) {
      const laid = evenly(trees)
      laidTrees = laid
      stretches.lay(laid)
      capStretches?.lay(laid)
      leaves?.lay(laid)
    },
    cullPast(x, z, reach, view) {
      stretches.cullPast(x, z, reach, view)
      capStretches?.cullPast(x, z, reach, view)
      leaves?.cullPast(x, z, reach, view)
    },
    variants,
    leaves: leaves !== undefined,
    trunk,
    setTrunk(share) {
      if (share === trunkShare.value && capStretches) return
      trunkShare.value = share
      cutCaps(share)
    },
    setRings(count) {
      rings.value = count
    },
    setWind: wind.set,
    setLeaves(look) {
      if (!leaves || !leafy) return
      leaves.object.visible = look.show
      leafy.set(look)
    },
    setWood(colour, saturation = 1) {
      new Color(colour).getHSL(hsl, SRGBColorSpace)
      bark.color.setHSL(hsl.h, Math.min(1, hsl.s * saturation), hsl.l, SRGBColorSpace)
      sawn.value.copy(bark.color)
    },
    setShell(look) {
      bark.set(look)
      bark.setPaint(look.paint)
      bark.setToon(look.toon)
      capMaterial.set(look)
      capMaterial.setToon(look.toon)
      leafMaterial?.set(look)
      leafMaterial?.setToon(look.toon)
    },
    setBark(look) {
      lightness.value = look.lightness
      plain.value = look.wood
      saturated.value = look.saturation
      turned.value = (look.hue * Math.PI) / 180
      tile.value = Math.max(0.05, look.scale)
      relief.value = look.relief
      const angle = (look.rotation * Math.PI) / 180
      turn.value.set(Math.cos(angle), Math.sin(angle))
      // Another set: its maps swapped into the same nodes once loaded; a newer ask while one loads wins.
      if (look.texture === asked) return
      const name = (asked = look.texture)
      void loadBark(name).then(([map, normals]) => {
        if (asked !== name) return
        colourTexel.value = map
        normalTexel.value = normals
        textured.value = name === 'none' ? 0 : 1
      })
    },
  }
}
