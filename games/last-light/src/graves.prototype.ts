// PROTOTYPE, throwaway (2026-10-27): the graveyard's graves (public/models/graves.glb, seven stones and crosses,
// untextured), scattered at random over the graveyard's ground and a way past it, either side of the old road, so the
// ghosts walk among them, in no rows: each turned to face the nearest path, more or less, leaning as old stones lean,
// all at one scale, so each keeps its size beside the others as the file has them. None reaches a ghost's way (its own
// width and a ghost's half off every path), nor stands where two paths cross, on the old road, in the water, or by
// another closer than the folder lets. How close, how many of what fits, and how far out are the graves folder's,
// which lays them again.
// One mesh in the scene pieces' own shell (the well's and the cage's: toon steps, brush strokes, the shared shine),
// with a stone set's relief over it as the dead trees' bark lays its own (deadtrees.ts), laid again as the graves
// folder sets their size. She and her goslings keep out of each one's footprint low down, under a cross's arms, the
// lean left out (`footprints`); the rats walk through them.
//
// Their uvs are laid again here, the file's own being seven files' worth of scales: each face's from the stone's own
// metres along the two ways it is squarest to, so a tile is as big on every stone, a cross's arm or a slab's face.
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  Euler,
  Matrix4,
  Mesh,
  Quaternion,
  Vector2,
  Vector3,
  type Object3D,
} from 'three/webgpu'
import { dFdx, dFdy, hue, materialColor, max, mix, normalView, positionView, renderGroup, saturation, texture, uniform, uv, vec2 } from 'three/tsl'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js'
import { ShellToonMaterial, type ShellLook, type PaintLook } from './shell'
import { createStrokes } from './strokes'
import { NO_COLOUR, NO_NORMALS, setLayer } from './texturesets'
import { random } from './swarm'
import { createInscriptions, inscribable, inscribe, mountInscriptionControls, type Inscriptions } from './inscriptions.prototype'
import type { ToonLook } from './toon'
import type { ShineLook } from './panel'

const MODEL = './models/graves.glb'
/** The strokes' size over a scene piece, m, as goosescenes.ts lays them. */
const STROKE_BODY = 0.9

/**
 * The stone sets, kept from the stoneTexture download of 2026-10-27: each its colour and OpenGL normal map, in
 * public/textures/stone/`set`/, cut to jpg; `none` the plain stone colour, no relief.
 */
export const STONES = ['none', 'desert_rocks_01'] as const
export type StoneName = (typeof STONES)[number]

interface P {
  x: number
  z: number
}

/** What the graves folder sets. */
export interface GraveLook {
  /** Their stone. */
  colour: number
  /** How tall the file's middling stone stands, m: every grave scaled alike by it. */
  size: number
  /** How far one may lean, radians. */
  lean: number
  /** How close two graves' edges may stand, m; the share of what fits that stands, 0 none, 1 all; how far a grave's
   * edge stays off any ghost's path, m (a ghost's half width); how far past the graveyard's ground they may stand, m;
   * the scatter's seed. */
  apart: number
  amount: number
  clear: number
  spread: number
  seed: number
  /** Their own highlight and rim, over the scene pieces' shell. */
  shine: ShineLook
  /** The stone set laid over them, or `none`, the plain colour. */
  texture: StoneName
  /** Brightness, as a multiplier: 1 the map's own. */
  lightness: number
  /** How much of the plain stone colour shows in place of the map's, 0 none, 1 all of it, the map's relief kept. */
  plain: number
  /** Colour strength: 1 the map's own, 0 grey; and how far round the colour wheel its colours turn, degrees. */
  saturation: number
  hue: number
  /** How wide one tile is on a stone, m; how far the tiles are turned, degrees; how deep the relief, 1 as painted. */
  scale: number
  rotation: number
  relief: number
}

/** As set from the panel on 2026-10-27, scattered over the ground since 2026-10-28: big lilac stones, desert_rocks_01's relief on them, a lilac rim. */
export const defaultGraveStoneLook = (): GraveLook => ({
  colour: 0xc7b8ff,
  size: 1.38,
  lean: 0.05,
  apart: 0.75,
  amount: 1,
  clear: 0.65,
  spread: 1.5,
  seed: 12,
  shine: { specular: 0, shininess: 30, softness: 0.17, specularColor: 0xc0d8f0, rim: true, rimStrength: 0.45, rimWidth: 0.35, rimSoftness: 0.1, rimColor: 0xc6c2ff },
  texture: 'desert_rocks_01',
  lightness: 1,
  plain: 1,
  saturation: 1.27,
  hue: 0,
  scale: 3.1,
  rotation: 90,
  relief: 1.15,
})

/** How far up a stone its footprint is taken, as a share of its height: below a cross's arms. */
const LOW = 0.4

export interface Graves {
  readonly object: Mesh
  readonly look: GraveLook
  /** Scatters them again as the folder has them: how many, where, how big, how they lean. */
  set(): void
  /** How many stand now. */
  readonly count: number
  /** What each stands on, as they stand now: its middle and its outline from that, a box turned as it faces. */
  footprints(): { at: P; outline: P[] }[]
  /** Their stone in the folder's colour and its set, as the folder has them. */
  recolour(): void
  /** The scene pieces' shell, as the look folder sets it, under their own highlight and rim. */
  setShell(look: ShellLook & { paint: PaintLook; toon: ToonLook }): void
  /** Their own highlight and rim again, as the folder has them. */
  shineChanged(): void
  /** The words cut in them. */
  readonly inscriptions: Inscriptions
}

/**
 * `geometry` unshared, each face its own corners, with uvs laid again from its own units: each face's along the two
 * ways it is squarest to, the third its normal's biggest.
 */
function boxUvs(geometry: BufferGeometry): BufferGeometry {
  const flat = geometry.toNonIndexed()
  const position = flat.getAttribute('position')
  const uvs = new Float32Array(position.count * 2)
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  const n = new Vector3()
  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i)
    b.fromBufferAttribute(position, i + 1)
    c.fromBufferAttribute(position, i + 2)
    n.subVectors(b, a).cross(c.clone().sub(a))
    const ax = Math.abs(n.x)
    const ay = Math.abs(n.y)
    const az = Math.abs(n.z)
    for (let k = 0; k < 3; k++) {
      const p = [a, b, c][k]!
      const [u, v] = ax >= ay && ax >= az ? [p.z, p.y] : ay >= az ? [p.x, p.z] : [p.x, p.y]
      uvs[(i + k) * 2] = u
      uvs[(i + k) * 2 + 1] = v
    }
  }
  flat.setAttribute('uv', new BufferAttribute(uvs, 2))
  return flat
}

/** Where the graves may stand. */
export interface GraveGround {
  /** The ghosts' paths, each closed, its points in order. */
  paths: readonly (readonly P[])[]
  /** The graveyard's ground, its corners in order. */
  ground: readonly P[]
  /** None within its radius of any of these. */
  keepClear: readonly (P & { radius: number })[]
  /** Whether there is water at (x, z). */
  wet: (x: number, z: number) => boolean
  /** Whether a footprint `radius` m round (x, z) reaches the road. */
  onRoad: (x: number, z: number, radius: number) => boolean
}

/** One grave as scattered: where it stands, which stone it is, which way it faces, and its lean's two ways, -1 to 1. */
export interface GraveStone {
  at: P
  kind: number
  face: number
  leanX: number
  leanZ: number
}

/** How far `p` is outside `outline`, m, 0 inside it. */
function outside(outline: readonly P[], p: P): number {
  let inside = false
  let nearest = Infinity
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length]!
    if (a.z > p.z !== b.z > p.z && p.x < a.x + ((p.z - a.z) * (b.x - a.x)) / (b.z - a.z)) inside = !inside
    const abx = b.x - a.x
    const abz = b.z - a.z
    const t = Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.z - a.z) * abz) / (abx * abx + abz * abz || 1)))
    nearest = Math.min(nearest, Math.hypot(p.x - a.x - abx * t, p.z - a.z - abz * t))
  })
  return inside ? 0 : nearest
}

/**
 * The graves `look` scatters over `where`, `feet` each stone's footprint radius, m: thrown at random over the ground
 * and up to `spread` m past it, fewer the further out, each kept only if it keeps every rule and stands `apart` m off every one kept before it, till
 * hardly another fits; of those, `amount` of them. Every throw draws as many numbers whatever comes of it, so a change
 * to one rule moves no grave the rule leaves standing.
 */
export function scatterGraves(where: GraveGround, look: Pick<GraveLook, 'apart' | 'amount' | 'clear' | 'spread' | 'seed'>, feet: readonly number[]): GraveStone[] {
  const { paths, ground, keepClear, wet, onRoad } = where
  if (ground.length < 3 || feet.length === 0) return []
  const roll = random(look.seed)
  const spread = Math.max(0, look.spread)
  const apart = Math.max(0.05, look.apart)
  const xs = ground.map((p) => p.x)
  const zs = ground.map((p) => p.z)
  const minX = Math.min(...xs) - spread
  const minZ = Math.min(...zs) - spread
  const wide = Math.max(...xs) + spread - minX
  const deep = Math.max(...zs) + spread - minZ
  // Enough throws to fill it: many for each grave that could fit.
  const foot = feet.reduce((a, b) => a + b, 0) / feet.length
  const throws = Math.min(40000, Math.ceil(((wide * deep) / (2 * foot + apart) ** 2) * 30))
  const stones: (GraveStone & { foot: number; kept: boolean })[] = []
  for (let k = 0; k < throws; k++) {
    const p = { x: minX + roll() * wide, z: minZ + roll() * deep }
    const kind = Math.floor(roll() * feet.length)
    const turn = (roll() - 0.5) * 0.8
    const leanX = roll() * 2 - 1
    const leanZ = roll() * 2 - 1
    const kept = roll() < look.amount
    // Thinning out past the ground, with no line where they stop.
    const out = roll() * spread
    const own = feet[kind]!
    if (outside(ground, p) > out) continue
    if (stones.some((q) => Math.hypot(p.x - q.at.x, p.z - q.at.z) < q.foot + own + apart)) continue
    if (keepClear.some((c) => Math.hypot(p.x - c.x, p.z - c.z) < c.radius + own)) continue
    if (wet(p.x, p.z)) continue
    if (onRoad(p.x, p.z, own)) continue
    // Off every path by its footprint and a ghost's half width; facing the nearest.
    let near: P | undefined
    let off = Infinity
    for (const path of paths)
      for (const q of path) {
        const d = Math.hypot(p.x - q.x, p.z - q.z)
        if (d < off) {
          off = d
          near = q
        }
      }
    if (off < look.clear + own) continue
    const face = near ? Math.atan2(near.x - p.x, near.z - p.z) + turn : turn
    // What would fit, kept or not, holds its place: a share of fewer leaves the rest where they stood.
    stones.push({ at: p, kind, face, leanX, leanZ, foot: own, kept })
  }
  return stones.filter((s) => s.kept).map(({ at, kind, face, leanX, leanZ }) => ({ at, kind, face, leanX, leanZ }))
}

/** How many pumpkins wait in the graveyard, and how far apart they stand at the least, m. */
const PUMPKINS = 6
const PUMPKINS_APART = 3
/** How far off the road's edge they stand at the most, m. */
const PUMPKINS_OFF_ROAD = 3.5
/** How far back down the road from beside each its carved face looks, m: at her coming, not straight across. */
const PUMPKINS_LOOK_BACK = 4

/** One pumpkin in the graveyard: where it stands, which of the well's it is, and the way its carved face looks. */
export interface GravePumpkin {
  at: P
  kind: number
  look: P
}

/**
 * A few pumpkins over the graveyard's ground (2026-10-30), here and there by the road as it runs through: off its edge
 * by up to PUMPKINS_OFF_ROAD m, off the ghosts' paths, the crossings, the water and `stones` (each its middle and how far
 * round), PUMPKINS_APART m off each other, `radius` m round each; each looking at the road PUMPKINS_LOOK_BACK m back
 * along `back`, the way she comes, as if waiting for her. `kinds` the kinds to pick from, `road` the road's middle.
 */
export function scatterGravePumpkins(where: GraveGround, road: readonly P[], back: P, stones: readonly (P & { radius: number })[], kinds: number, radius: number, seed = 31): GravePumpkin[] {
  const { paths, ground, keepClear, wet, onRoad } = where
  if (ground.length < 3 || road.length < 2 || kinds < 1) return []
  const roll = random(seed)
  const xs = ground.map((p) => p.x)
  const zs = ground.map((p) => p.z)
  const minX = Math.min(...xs)
  const minZ = Math.min(...zs)
  const wide = Math.max(...xs) - minX
  const deep = Math.max(...zs) - minZ
  const backLength = Math.hypot(back.x, back.z) || 1
  const pumpkins: GravePumpkin[] = []
  for (let k = 0; k < 4000 && pumpkins.length < PUMPKINS; k++) {
    const p = { x: minX + roll() * wide, z: minZ + roll() * deep }
    const kind = Math.floor(roll() * kinds)
    if (outside(ground, p) > 0) continue
    if (onRoad(p.x, p.z, radius) || !onRoad(p.x, p.z, radius + PUMPKINS_OFF_ROAD)) continue
    if (wet(p.x, p.z)) continue
    if (keepClear.some((c) => Math.hypot(p.x - c.x, p.z - c.z) < c.radius + radius)) continue
    if (stones.some((s) => Math.hypot(p.x - s.x, p.z - s.z) < s.radius + radius + 0.2)) continue
    if (pumpkins.some((q) => Math.hypot(p.x - q.at.x, p.z - q.at.z) < PUMPKINS_APART)) continue
    if (paths.some((path) => path.some((q) => Math.hypot(p.x - q.x, p.z - q.z) < 0.65 + radius))) continue
    // The road's middle nearest it, and the point back along the way she comes from there.
    let near = road[0]!
    let off = Infinity
    road.forEach((a, i) => {
      const b = road[i + 1]
      if (!b) return
      const abx = b.x - a.x
      const abz = b.z - a.z
      const t = Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.z - a.z) * abz) / (abx * abx + abz * abz || 1)))
      const q = { x: a.x + abx * t, z: a.z + abz * t }
      const d = Math.hypot(p.x - q.x, p.z - q.z)
      if (d < off) [near, off] = [q, d]
    })
    const target = { x: near.x + (back.x / backLength) * PUMPKINS_LOOK_BACK, z: near.z + (back.z / backLength) * PUMPKINS_LOOK_BACK }
    pumpkins.push({ at: p, kind, look: { x: target.x - p.x, z: target.z - p.z } })
  }
  return pumpkins
}

/** The graves `where` has room for, on the ground `groundAt` has under them. */
export async function createGraves(where: GraveGround, groundAt: (x: number, z: number) => number): Promise<Graves> {
  const look = defaultGraveStoneLook()
  const gltf = await new GLTFLoader().loadAsync(MODEL)
  gltf.scene.updateMatrixWorld(true)
  // Each stone as the file has it placed and sized, stood on the origin, its height kept; its uvs laid again.
  const kinds: { geometry: BufferGeometry; height: number; foot: number; low: Box3 }[] = []
  gltf.scene.traverse((o: Object3D) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', mesh.geometry.getAttribute('position').clone())
    geometry.setAttribute('normal', mesh.geometry.getAttribute('normal').clone())
    geometry.setIndex(mesh.geometry.getIndex()!.clone())
    geometry.applyMatrix4(mesh.matrixWorld)
    const box = new Box3().setFromBufferAttribute(geometry.getAttribute('position') as never)
    const centre = box.getCenter(new Vector3())
    geometry.translate(-centre.x, -box.min.y, -centre.z)
    // What it stands on: the box round its corners low down, from its middle, in the file's units; the whole box if none are.
    const height = box.max.y - box.min.y
    const position = geometry.getAttribute('position')
    const corner = new Vector3()
    const low = new Box3()
    for (let i = 0; i < position.count; i++) if (corner.fromBufferAttribute(position, i).y <= height * LOW) low.expandByPoint(corner)
    if (low.isEmpty()) low.copy(box).translate(new Vector3(-centre.x, -box.min.y, -centre.z))
    // Its footprint's radius, round its middle, in the file's units.
    kinds.push({ geometry: inscribable(boxUvs(geometry)), height, foot: Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) / 2, low })
  })
  // The middling stone's height in the file's units: what the folder's size scales to.
  const heights = kinds.map((k) => k.height).sort((a, b) => a - b)
  const middling = heights[Math.floor(heights.length / 2)] ?? 1

  type Stone = GraveStone & { foot: number }
  let stones: Stone[] = []
  const scatter = () => {
    const size = look.size / middling
    const feet = kinds.map((k) => k.foot * size)
    stones = scatterGraves(where, look, feet).map((stone) => ({ ...stone, foot: feet[stone.kind]! }))
  }

  // The set's values, a uniform of the render's group each, since the graves are a still mesh.
  const textured = uniform(0).setGroup(renderGroup)
  const lightness = uniform(1).setGroup(renderGroup)
  const plain = uniform(0).setGroup(renderGroup)
  const saturated = uniform(1).setGroup(renderGroup)
  const turned = uniform(0).setGroup(renderGroup)
  const tile = uniform(1).setGroup(renderGroup)
  const relief = uniform(1).setGroup(renderGroup)
  /** The tiles' turn's cosine and sine. */
  const turn = uniform(new Vector2(1, 0)).setGroup(renderGroup)
  // Where on the tile: the stone's metres, as its uvs are laid, turned, scaled to the tile.
  const laidUv = uv()
  const at = vec2(laidUv.x.mul(turn.x).sub(laidUv.y.mul(turn.y)), laidUv.x.mul(turn.y).add(laidUv.y.mul(turn.x))).div(tile)
  const colourTexel = texture(NO_COLOUR, at)
  const normalTexel = texture(NO_NORMALS, at)
  // The map's lean laid on the face along the ways its tile's u and v run across the screen, as three lays a normal
  // map with no tangents (perturbNormal2Arb), as the bark's is; the relief its depth, none with no set.
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

  // The words cut in each, under the brush strokes.
  const inscriptions = createInscriptions()
  const material = new ShellToonMaterial({ color: new Color(look.colour), painted: { strokes: createStrokes(), extent: STROKE_BODY, base: inscriptions.normal(viewNormal) } })
  // The plain stone colour, or the set's, lit, darkened and turned, or the stone colour again over it as much as the
  // folder has it, the set's relief still on it.
  material.colorNode = inscriptions.colour(mix(materialColor, saturation(hue(colourTexel.rgb, turned), saturated).mul(lightness), textured.mul(plain.oneMinus())))
  const object = new Mesh(new BufferGeometry(), material)
  object.castShadow = object.receiveShadow = true
  const lay = setLayer<StoneName>('./textures/stone', { colours: [colourTexel], normals: [normalTexel], textured, plain })
  const recolour = () => {
    material.color.set(look.colour)
    lightness.value = look.lightness
    saturated.value = look.saturation
    turned.value = (look.hue * Math.PI) / 180
    tile.value = Math.max(0.05, look.scale)
    relief.value = look.relief
    const angle = (look.rotation * Math.PI) / 180
    turn.value.set(Math.cos(angle), Math.sin(angle))
    // Another set: its maps swapped into the same nodes once loaded, its colour only once some of it shows.
    lay(look.texture, look.plain)
  }
  const place = new Matrix4()
  const spin = new Quaternion()
  const set = () => {
    recolour()
    scatter()
    const size = look.size / middling
    const parts = stones.map(({ at: where, kind, face: facing, leanX, leanZ }) => {
      spin.setFromEuler(new Euler(leanX * look.lean, facing, leanZ * look.lean, 'YXZ'))
      place.compose(new Vector3(where.x, groundAt(where.x, where.z) - 0.04, where.z), spin, new Vector3(size, size, size))
      const part = kinds[kind]!.geometry.clone()
      // Its uvs in metres, as big as it now stands.
      const uvs = part.getAttribute('uv')
      for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) * size, uvs.getY(i) * size)
      inscribe(part, size, where.x, where.z)
      return part.applyMatrix4(place)
    })
    const old = object.geometry
    object.geometry = parts.length ? mergeGeometries(parts)! : new BufferGeometry()
    old.dispose()
  }
  set()
  /** The shell they share, last handed over: its sheen, strokes and toon steps kept under their own highlight and rim. */
  let shared: (ShellLook & { paint: PaintLook; toon: ToonLook }) | undefined
  const shineChanged = () => {
    if (shared) material.set({ ...shared, ...look.shine })
  }
  return {
    object,
    look,
    set,
    get count() {
      return stones.length
    },
    footprints() {
      const size = look.size / middling
      return stones.map(({ at: where, kind, face: facing }) => {
        const { min, max } = kinds[kind]!.low
        const c = Math.cos(facing)
        const s = Math.sin(facing)
        // Turned about the up axis as the stone is.
        const outline = [
          [min.x, min.z],
          [max.x, min.z],
          [max.x, max.z],
          [min.x, max.z],
        ].map(([x, z]) => ({ x: (x! * c + z! * s) * size, z: (z! * c - x! * s) * size }))
        return { at: where, outline }
      })
    },
    recolour,
    setShell(shell) {
      shared = shell
      shineChanged()
      material.setPaint(shell.paint)
      material.setToon(shell.toon)
    },
    shineChanged,
    inscriptions,
  }
}

/** The graves folder, in the ghosts' panel; `laid` told each time they are scattered again. */
export function mountGraveControls(graves: Graves, gui: GUI, laid: () => void): void {
  const folder = gui.addFolder('graves')
  const { look, set, recolour, shineChanged } = graves
  const shown = { count: graves.count }
  const scattered = () => {
    set()
    laid()
    shown.count = graves.count
    counted.updateDisplay()
  }
  const counted = folder.add(shown, 'count').name('graves standing').disable()
  folder.add(look, 'apart', 0.05, 4, 0.05).name('apart at least m').onFinishChange(scattered)
  folder.add(look, 'amount', 0, 1, 0.01).name('share of what fits').onFinishChange(scattered)
  folder.add(look, 'clear', 0, 2, 0.01).name('kept off the paths m').onFinishChange(scattered)
  folder.add(look, 'spread', 0, 4, 0.05).name('past the ground, up to m').onFinishChange(scattered)
  folder.add(look, 'seed', 1, 99, 1).name('scatter seed').onFinishChange(scattered)
  folder.add(look, 'size', 0.2, 2.5, 0.01).name('size m').onFinishChange(scattered)
  folder.add(look, 'lean', 0, 0.5, 0.01).name('lean rad').onFinishChange(scattered)
  folder.addColor(look, 'colour').name('stone colour').onChange(recolour)
  const stone = folder.addFolder('stone set')
  stone.add(look, 'texture', STONES).name('stone set').onChange(recolour)
  stone.add(look, 'relief', 0, 6, 0.05).name('relief').onChange(recolour)
  stone.add(look, 'scale', 0.1, 4, 0.05).name('tile m').onChange(recolour)
  stone.add(look, 'rotation', 0, 180, 1).name('tile turn deg').onChange(recolour)
  stone.add(look, 'plain', 0, 1, 0.01).name('plain colour share').onChange(recolour)
  stone.add(look, 'lightness', 0, 4, 0.01).name('lightness').onChange(recolour)
  stone.add(look, 'saturation', 0, 2, 0.01).name('saturation').onChange(recolour)
  stone.add(look, 'hue', -180, 180, 1).name('hue deg').onChange(recolour)
  mountInscriptionControls(graves.inscriptions, folder)
  const shine = folder.addFolder('highlight and rim')
  const { shine: own } = look
  shine.add(own, 'specular', 0, 4, 0.01).name('highlight').onChange(shineChanged)
  shine.add(own, 'shininess', 1, 200, 1).name('highlight tightness').onChange(shineChanged)
  shine.add(own, 'softness', 0, 0.5, 0.01).name('highlight softness').onChange(shineChanged)
  shine.addColor(own, 'specularColor').name('highlight colour').onChange(shineChanged)
  shine.add(own, 'rim').name('rim light').onChange(shineChanged)
  shine.add(own, 'rimStrength', 0, 3, 0.01).name('rim strength').onChange(shineChanged)
  shine.add(own, 'rimWidth', 0, 1, 0.01).name('rim width').onChange(shineChanged)
  shine.add(own, 'rimSoftness', 0, 0.5, 0.005).name('rim softness').onChange(shineChanged)
  shine.addColor(own, 'rimColor').name('rim colour').onChange(shineChanged)
}
