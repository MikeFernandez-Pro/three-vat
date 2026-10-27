// PROTOTYPE, throwaway (2026-10-27): the graveyard's graves (public/models/graves.glb, seven stones and crosses,
// untextured), scattered along both sides of every ghost's path so the ghosts walk among them: one each so far along,
// a little in or out of the way, turned to face the path, leaning as old stones lean, all at one scale, so each keeps
// its size beside the others as the file has them. None reaches a ghost's way (its own width and a ghost's half off
// every path), nor stands where two paths cross, in the water, or on another. How many, how far apart, and how far
// off the paths are the graves folder's, which lays them again.
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
  DataTexture,
  Euler,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  NoColorSpace,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
  type Object3D,
  type Texture,
} from 'three/webgpu'
import { dFdx, dFdy, hue, materialColor, max, mix, normalView, positionView, renderGroup, saturation, texture, uniform, uv, vec2 } from 'three/tsl'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js'
import { ShellToonMaterial, type ShellLook, type PaintLook } from './shell'
import { createStrokes } from './strokes'
import { random } from './swarm'
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
  /** One every so far along a path, m; the share of those places a grave stands in, 0 none, 1 every one; how far its
   * edge stays off any ghost's path, m (a ghost's half width); how much further off it may stand, m; the scatter's seed. */
  every: number
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

/** As set from the panel on 2026-10-27: big lilac stones, few and close by the paths, desert_rocks_01's relief on them, a lilac rim. */
export const defaultGraveStoneLook = (): GraveLook => ({
  colour: 0xc7b8ff,
  size: 1.38,
  lean: 0.05,
  every: 2,
  amount: 1,
  clear: 0.65,
  spread: 0,
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

/** How far apart two graves' edges stand at the least, m. */
const APART = 0.15
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
}

/** What stands in for `none`'s maps: no colour of its own, no relief. */
function pixel(r: number, g: number, b: number): Texture {
  const map = new DataTexture(new Uint8Array([r, g, b, 255]), 1, 1)
  map.colorSpace = NoColorSpace
  map.needsUpdate = true
  return map
}
const noStone: [Texture, Texture] = [pixel(255, 255, 255), pixel(128, 128, 255)]

/** Each set's colour and normal map, loaded once asked for, kept after. */
const sets = new Map<StoneName, Promise<[Texture, Texture]>>()
function loadStone(name: StoneName): Promise<[Texture, Texture]> {
  if (name === 'none') return Promise.resolve(noStone)
  let pair = sets.get(name)
  if (!pair) {
    const loader = new TextureLoader()
    const tile = (map: Texture, colour: boolean) => {
      map.wrapS = map.wrapT = RepeatWrapping
      map.minFilter = LinearMipmapLinearFilter
      map.anisotropy = 8
      map.colorSpace = colour ? SRGBColorSpace : NoColorSpace
      return map
    }
    pair = Promise.all([loader.loadAsync(`./textures/stone/${name}/color.jpg`), loader.loadAsync(`./textures/stone/${name}/normal.jpg`)]).then(([map, normals]): [Texture, Texture] => [tile(map, true), tile(normals, false)])
    sets.set(name, pair)
  }
  return pair
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

/**
 * The graves along `paths` (each closed, its points in order), none within its radius of any of `keepClear` nor where
 * `wet` says there is water, on the ground `groundAt` has under them.
 */
export async function createGraves(
  paths: readonly (readonly P[])[],
  keepClear: readonly (P & { radius: number })[],
  wet: (x: number, z: number) => boolean,
  groundAt: (x: number, z: number) => number,
): Promise<Graves> {
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
    kinds.push({ geometry: boxUvs(geometry), height, foot: Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) / 2, low })
  })
  // The middling stone's height in the file's units: what the folder's size scales to.
  const heights = kinds.map((k) => k.height).sort((a, b) => a - b)
  const middling = heights[Math.floor(heights.length / 2)] ?? 1

  /**
   * Where each stands, which it is, which way it faces and how it leans, as the folder has them now: along each path,
   * one every `every` m, the other side from the last, its edge `clear` m off it and up to `spread` m further; kept
   * only if it reaches no path at all by that much, nor another grave.
   */
  type Stone = { at: P; kind: number; face: number; leanX: number; leanZ: number; foot: number }
  let stones: Stone[] = []
  const scatter = () => {
    const roll = random(look.seed)
    const size = look.size / middling
    stones = []
    for (const path of paths) {
      const n = path.length
      const at = [0]
      for (let i = 1; i <= n; i++) at.push(at[i - 1]! + Math.hypot(path[i % n]!.x - path[i - 1]!.x, path[i % n]!.z - path[i - 1]!.z))
      const length = at[n]!
      const every = Math.max(0.2, look.every)
      let side = roll() < 0.5 ? 1 : -1
      for (let s = roll() * every; s < length; s += every * (0.75 + roll() * 0.5)) {
        let i = 0
        while (i < n - 1 && at[i + 1]! < s) i++
        const a = path[i]!
        const b = path[(i + 1) % n]!
        const span = Math.hypot(b.x - a.x, b.z - a.z) || 1
        const tx = (b.x - a.x) / span
        const tz = (b.z - a.z) / span
        const f = (s - at[i]!) / span
        side = -side
        // Every draw made whatever is kept, so a change to one setting moves no other grave.
        const kind = Math.floor(roll() * kinds.length)
        const foot = kinds[kind]!.foot * size
        const off = (look.clear + foot + roll() * look.spread) * side
        const face = Math.atan2(tz * side, -tx * side) + (roll() - 0.5) * 0.5
        const leanX = roll() * 2 - 1
        const leanZ = roll() * 2 - 1
        const kept = roll() < look.amount
        const p = { x: a.x + (b.x - a.x) * f - tz * off, z: a.z + (b.z - a.z) * f + tx * off }
        if (!kept) continue
        if (keepClear.some((c) => Math.hypot(p.x - c.x, p.z - c.z) < c.radius + foot)) continue
        if (wet(p.x, p.z)) continue
        if (stones.some((q) => Math.hypot(p.x - q.at.x, p.z - q.at.z) < q.foot + foot + APART)) continue
        // Off every path, its own or another's, by its footprint and a ghost's half width.
        const room = look.clear + foot
        if (paths.some((other) => other.some((q) => Math.hypot(p.x - q.x, p.z - q.z) < room))) continue
        stones.push({ at: p, kind, face, leanX, leanZ, foot })
      }
    }
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
  const [noColour, noNormals] = noStone
  const colourTexel = texture(noColour, at)
  const normalTexel = texture(noNormals, at)
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

  const material = new ShellToonMaterial({ color: new Color(look.colour), painted: { strokes: createStrokes(), extent: STROKE_BODY, base: viewNormal } })
  // The plain stone colour, or the set's, lit, darkened and turned, or the stone colour again over it as much as the
  // folder has it, the set's relief still on it.
  material.colorNode = mix(materialColor, saturation(hue(colourTexel.rgb, turned), saturated).mul(lightness), textured.mul(plain.oneMinus()))
  const object = new Mesh(new BufferGeometry(), material)
  object.castShadow = object.receiveShadow = true
  let asked: StoneName | undefined
  const recolour = () => {
    material.color.set(look.colour)
    lightness.value = look.lightness
    plain.value = look.plain
    saturated.value = look.saturation
    turned.value = (look.hue * Math.PI) / 180
    tile.value = Math.max(0.05, look.scale)
    relief.value = look.relief
    const angle = (look.rotation * Math.PI) / 180
    turn.value.set(Math.cos(angle), Math.sin(angle))
    // Another set: its maps swapped into the same nodes once loaded; a newer ask while one loads wins.
    if (look.texture === asked) return
    const name = (asked = look.texture)
    void loadStone(name).then(([map, normals]) => {
      if (asked !== name) return
      colourTexel.value = map
      normalTexel.value = normals
      textured.value = name === 'none' ? 0 : 1
    })
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
  folder.add(look, 'every', 0.3, 4, 0.05).name('one every m of path').onFinishChange(scattered)
  folder.add(look, 'amount', 0, 1, 0.01).name('share of places filled').onFinishChange(scattered)
  folder.add(look, 'clear', 0, 2, 0.01).name('kept off the paths m').onFinishChange(scattered)
  folder.add(look, 'spread', 0, 3, 0.01).name('further off, up to m').onFinishChange(scattered)
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
