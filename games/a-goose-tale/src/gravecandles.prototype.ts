// PROTOTYPE, throwaway (2026-10-31): candles at the graves' feet (public/models/candle.glb, brought in on 2026-10-31:
// one low-poly candle of two flat colours, its wax and its flame, y-up, its foot on the origin, about 0.79 m tall), a
// handful round each of a share of the graves, on every side, none closer to another than the folder lets nor on a
// stone, each turned its own way and a little taller or shorter than the next. Its two colours merged into one draw on a palette (palettemesh.ts), the flame glowing in its
// own, in the scene pieces' shell (the well's, the graves': toon steps, brush strokes); every candle one mesh, laid
// again whenever the graves are. The rats and he walk through them.
import { BufferGeometry, Matrix4, Mesh, Quaternion, Vector3, type Color, type Material } from 'three/webgpu'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js'
import { modelLoader } from './gltf'
import { ShellToonMaterial, type PaintLook, type ShellLook } from './shell'
import { createStrokes } from './strokes'
import { createPalette } from './palettemesh'
import { random } from './swarm'
import type { ToonLook } from './toon'

const MODEL = './models/candle.glb'
/** The file's wax and its flame, by their materials' names. */
const MODEL_WAX = 'Material.001'
const MODEL_FLAME = 'Material.002'
/** The strokes' size over a scene piece, m, as goosescenes.ts lays them. */
const STROKE_BODY = 0.9
/** How far a candle's height strays from the folder's, as a share either way. */
const HEIGHTS = 0.25
/** How many places round a grave are tried for each candle it may have. */
const TRIES = 8
/** How far off a stone's footprint a candle keeps at the least, m. */
const OFF_STONE = 0.05

interface P {
  x: number
  z: number
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

/** What the candles folder sets. */
export interface CandleLook {
  show: boolean
  /** How big each stands over the file's own (0.79 m tall). */
  scale: number
  /** The share of graves with candles, 0 none, 1 all; how many at the most round one; how far out from its footprint they stand at the most, m; how close two may stand at the least, m; the scatter's seed. */
  share: number
  most: number
  out: number
  apart: number
  seed: number
  /** Each of the file's materials' colour, by its name, and how bright it glows, 0 not at all. */
  colours: Record<string, number>
  glows: Record<string, number>
}

/** The candles to start (2026-10-31): a hand tall, up to six round every grave, a good step apart, pale wax, a warm flame glowing. */
export const defaultCandleLook = (): CandleLook => ({
  show: true,
  scale: 0.35,
  share: 1,
  most: 6,
  out: 0.35,
  apart: 0.35,
  seed: 7,
  colours: { [MODEL_WAX]: 0xeadfc8, [MODEL_FLAME]: 0xffa040 },
  glows: { [MODEL_WAX]: 0, [MODEL_FLAME]: 4 },
})

export interface GraveCandles {
  readonly object: Mesh
  readonly look: CandleLook
  /** Lays them again by `graves`, each a grave's middle and its footprint off that (graves.prototype.ts's `footprints`). */
  lay(graves: readonly { at: P; outline: readonly P[] }[]): void
  /** Their colours and glows again, as the folder has them. */
  recolour(): void
  /** The scene pieces' shell, as the look folder sets it. */
  setShell(look: ShellLook & { paint: PaintLook; toon: ToonLook }): void
}

/** The candles, on the ground `groundAt` has under them, none laid till `lay`. */
export async function createGraveCandles(groundAt: (x: number, z: number) => number, look: CandleLook = defaultCandleLook()): Promise<GraveCandles> {
  const file = (await modelLoader().loadAsync(MODEL)).scene
  const meshes: Mesh[] = []
  file.traverse((o) => {
    if ((o as Mesh).isMesh) meshes.push(o as Mesh)
  })
  const names = [...new Set(meshes.map((mesh) => (mesh.material as { name: string }).name))]
  for (const mesh of meshes) {
    const { name, color } = mesh.material as Material & { color: Color }
    look.colours[name] ??= color.getHex()
    look.glows[name] ??= 0
  }
  const material = new ShellToonMaterial({ painted: { strokes: createStrokes(), extent: STROKE_BODY } })
  const palette = createPalette(names, material)
  // One candle, its colours read off the palette, in the file's units, its foot on the origin.
  const candle = palette.merge(file, meshes).geometry
  const object = new Mesh(new BufferGeometry(), material)
  object.castShadow = object.receiveShadow = true
  const place = new Matrix4()
  const spin = new Quaternion()
  const up = new Vector3(0, 1, 0)
  const lay = (graves: readonly { at: P; outline: readonly P[] }[]) => {
    const roll = random(look.seed)
    const most = Math.max(1, Math.round(look.most))
    const apart = Math.max(0, look.apart)
    // Each stone's corners where it stands, and how far round its middle they reach.
    const stones = graves.map(({ at, outline }) => ({ at, corners: outline.map((p) => ({ x: at.x + p.x, z: at.z + p.z })), reach: Math.max(...outline.map((p) => Math.hypot(p.x, p.z))) }))
    const onStone = (p: P) => stones.some(({ at, corners, reach }) => Math.hypot(p.x - at.x, p.z - at.z) < reach + OFF_STONE && outside(corners, p) < OFF_STONE)
    const placed: P[] = []
    const parts: BufferGeometry[] = []
    for (const { at, outline } of graves) {
      // Every grave draws as many numbers whatever comes of it, so a change to the share moves no candle it keeps.
      const lit = roll() < look.share
      const count = 1 + Math.floor(roll() * most)
      const rolls = Array.from({ length: most * TRIES * 5 }, roll)
      if (!lit || !look.show || outline.length < 3) continue
      // Its footprint's edges, each by its length, to pick a place along its outline in proportion.
      const edges = outline.map((a, i) => {
        const b = outline[(i + 1) % outline.length]!
        return { a, b, length: Math.hypot(b.x - a.x, b.z - a.z) }
      })
      const round = edges.reduce((sum, e) => sum + e.length, 0) || 1
      let laid = 0
      for (let k = 0; k < most * TRIES && laid < count; k++) {
        const [along, forth, turn, tall] = rolls.slice(k * 5, k * 5 + 4) as [number, number, number, number]
        // A point along its outline, out from it square to that edge, away from its middle.
        let left = along * round
        const edge = edges.find((e) => (left -= e.length) < 0) ?? edges[edges.length - 1]!
        const t = Math.min(1, Math.max(0, 1 + left / (edge.length || 1)))
        const on = { x: edge.a.x + (edge.b.x - edge.a.x) * t, z: edge.a.z + (edge.b.z - edge.a.z) * t }
        let nx = edge.b.z - edge.a.z
        let nz = -(edge.b.x - edge.a.x)
        if (nx * on.x + nz * on.z < 0) [nx, nz] = [-nx, -nz]
        const n = Math.hypot(nx, nz) || 1
        const off = OFF_STONE + 0.03 + forth * look.out
        const p = { x: at.x + on.x + (nx / n) * off, z: at.z + on.z + (nz / n) * off }
        if (placed.some((q) => Math.hypot(p.x - q.x, p.z - q.z) < apart)) continue
        if (onStone(p)) continue
        placed.push(p)
        laid++
        const size = look.scale * (1 + (tall * 2 - 1) * HEIGHTS)
        spin.setFromAxisAngle(up, turn * Math.PI * 2)
        place.compose(new Vector3(p.x, groundAt(p.x, p.z) - 0.01, p.z), spin, new Vector3(size, size, size))
        parts.push(candle.clone().applyMatrix4(place))
      }
    }
    const old = object.geometry
    object.geometry = parts.length ? mergeGeometries(parts) : new BufferGeometry()
    old.dispose()
  }
  const recolour = () => {
    for (const [name, colour] of Object.entries(look.colours)) palette.set(name, colour, look.glows[name] ?? 0)
  }
  recolour()
  return {
    object,
    look,
    lay,
    recolour,
    setShell(shell) {
      material.set(shell)
      material.setPaint(shell.paint)
      material.setToon(shell.toon)
    },
  }
}

/** The candles folder, in the ghosts' panel: how big they stand, how many by which graves, and each colour and how bright it glows. */
export function mountCandleControls(candles: GraveCandles, gui: GUI, relay: () => void): void {
  const folder = gui.addFolder('grave candles')
  const { look, recolour } = candles
  folder.add(look, 'show').name('show').onChange(relay)
  folder.add(look, 'scale', 0.05, 2, 0.01).name('scale (1 = 0.79 m)').onChange(relay)
  folder.add(look, 'share', 0, 1, 0.01).name('share of graves').onFinishChange(relay)
  folder.add(look, 'most', 1, 16, 1).name('most round one grave').onFinishChange(relay)
  folder.add(look, 'out', 0, 1.5, 0.01).name('out from the stone up to m').onFinishChange(relay)
  folder.add(look, 'apart', 0, 1.5, 0.01).name('apart at least m').onFinishChange(relay)
  folder.add(look, 'seed', 1, 99, 1).name('scatter seed').onFinishChange(relay)
  const named: Record<string, string> = { [MODEL_WAX]: 'wax', [MODEL_FLAME]: 'flame' }
  for (const name of Object.keys(look.colours)) {
    const label = named[name] ?? name
    folder.addColor(look.colours, name).name(`${label} colour`).onChange(recolour)
    folder.add(look.glows, name, 0, 10, 0.1).name(`${label} intensity`).onChange(recolour)
  }
}
