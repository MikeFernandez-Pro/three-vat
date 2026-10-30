// PROTOTYPE, throwaway (2026-10-29): words scratched in the slabs, worn: a few wavering lines, as a hand that could
// barely write cut them, each starting a little in from where the last did, the last one short. No letters, only
// their lines; at the game's distance letters could not be read anyway.
// Where on a stone: the biggest flat rectangle on the plane of its front that most faces the path, found once per kind
// from the file's triangles (`findPanel`), never taller than it is wide; only a slab takes them (`slabPanel`), not a
// cross, a pillar or an obelisk. Each triangle of that plane carries where it lies on the panel in metres, and the
// panel's size, as an attribute; the rest carry nothing and are left uncut.
// How it is cut: all in the shader, each line a wave about its row and a scrawl along it, a groove as far as it is
// thick either side, smoothed over the pixel so it never shimmers; worn away in stretches, shallower the more worn;
// the normal bent by the groove's slope, as three's bump does, at its true depth in metres, and the dirt in it
// darkening it as deep as it goes.
import { BufferAttribute, Color, type BufferGeometry, type Node } from 'three/webgpu'
import { attribute, dFdx, dFdy, float, floor, fwidth, hash, max, mix, mx_noise_float, positionView, renderGroup, select, sin, smoothstep, uniform, vec2 } from 'three/tsl'
import type { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js'
import { random } from './swarm'

/** How much taller than wide a panel may be. */
const TALL = 0.9
/** How deep a cut is at a depth of 1, m. */
const CUT = 0.004

/** What the inscriptions folder sets. */
export interface InscriptionLook {
  show: boolean
  /** How many lines at most, as many as fit; how far apart, m; how thick a stroke, m. */
  lines: number
  spacing: number
  thickness: number
  /** How far a line wanders up and down along it, m; how much it scrawls, shaking at a letter's size, m. */
  wave: number
  scrawl: number
  /** How deep they are cut, 1 a few millimetres. */
  depth: number
  /** How much the dirt in the cuts darkens them, 0 none, 1 its colour at the deepest; its colour. */
  dirt: number
  fill: number
  /** How worn, 0 fresh cut, 1 hardly a line left; each stone more or less than it. */
  wear: number
}

export const defaultInscriptionLook = (): InscriptionLook => ({
  show: true,
  lines: 4,
  spacing: 0.09,
  thickness: 0.012,
  wave: 0.008,
  scrawl: 0.003,
  depth: 1,
  dirt: 0.75,
  fill: 0x3d4636,
  wear: 0.3,
})

interface Positions {
  readonly count: number
  getX(i: number): number
  getY(i: number): number
  getZ(i: number): number
}

/** The panel on a stone's front, in its own units: its edges, and the front's triangles by their first corner. */
export interface Panel {
  left: number
  right: number
  bottom: number
  top: number
  triangles: number[]
}

/**
 * Where a stone stood up along +y, facing +z, unindexed, takes its words: the plane facing +z with the most area,
 * gridded `cells` to its longer side, and of the rectangles its grid fills whole, the biggest counting no more height
 * than `TALL` times its width, the highest of equals; cut to that height from its top, inset a tenth of its shorter side.
 */
export function findPanel(position: Positions, cells = 40): Panel | undefined {
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < position.count; i++) {
    minY = Math.min(minY, position.getY(i))
    maxY = Math.max(maxY, position.getY(i))
  }
  const step = Math.max(1e-6, (maxY - minY) * 0.01)
  const planes = new Map<number, { area: number; triangles: number[] }>()
  for (let i = 0; i + 2 < position.count; i += 3) {
    const ax = position.getX(i), ay = position.getY(i), az = position.getZ(i)
    const ux = position.getX(i + 1) - ax, uy = position.getY(i + 1) - ay, uz = position.getZ(i + 1) - az
    const vx = position.getX(i + 2) - ax, vy = position.getY(i + 2) - ay, vz = position.getZ(i + 2) - az
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const length = Math.hypot(nx, ny, nz)
    if (length === 0 || nz / length < 0.95) continue
    const key = Math.round((az + position.getZ(i + 1) + position.getZ(i + 2)) / 3 / step)
    const plane = planes.get(key) ?? { area: 0, triangles: [] }
    plane.area += length / 2
    plane.triangles.push(i)
    planes.set(key, plane)
  }
  let front: { area: number; triangles: number[] } | undefined
  for (const plane of planes.values()) if (!front || plane.area > front.area) front = plane
  if (!front) return undefined

  const corners = front.triangles.flatMap((i) => [i, i + 1, i + 2])
  const xs = corners.map((i) => position.getX(i))
  const ys = corners.map((i) => position.getY(i))
  const x0 = Math.min(...xs)
  const y1 = Math.max(...ys)
  const size = Math.max(Math.max(...xs) - x0, y1 - Math.min(...ys)) / cells
  const across = Math.max(1, Math.ceil((Math.max(...xs) - x0) / size))
  const down = Math.max(1, Math.ceil((y1 - Math.min(...ys)) / size))
  // Which cells' middles the front covers, row 0 at the top.
  const covered = new Uint8Array(across * down)
  for (const i of front.triangles) {
    const ax = position.getX(i), ay = position.getY(i)
    const bx = position.getX(i + 1), by = position.getY(i + 1)
    const cx = position.getX(i + 2), cy = position.getY(i + 2)
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    for (let r = 0; r < down; r++)
      for (let c = 0; c < across; c++) {
        const px = x0 + (c + 0.5) * size
        const py = y1 - (r + 0.5) * size
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) * area
        const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) * area
        const w2 = ((ax - px) * (by - py) - (ay - py) * (bx - px)) * area
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) covered[r * across + c] = 1
      }
  }
  let best: { score: number; r0: number; c0: number; c1: number; rows: number } | undefined
  const open = new Uint8Array(across)
  for (let r0 = 0; r0 < down; r0++) {
    open.fill(1)
    for (let r1 = r0; r1 < down; r1++) {
      for (let c = 0; c < across; c++) open[c]! &= covered[r1 * across + c]!
      for (let c = 0; c < across; ) {
        if (!open[c]) {
          c++
          continue
        }
        let end = c
        while (end + 1 < across && open[end + 1]) end++
        const wide = end - c + 1
        const score = wide * Math.min(r1 - r0 + 1, wide * TALL)
        if (!best || score > best.score) best = { score, r0, c0: c, c1: end, rows: r1 - r0 + 1 }
        c = end + 1
      }
    }
  }
  if (!best) return undefined
  const width = (best.c1 - best.c0 + 1) * size
  const height = Math.min(best.rows * size, width * TALL)
  const inset = Math.min(width, height) * 0.1
  const top = y1 - best.r0 * size
  return { left: x0 + best.c0 * size + inset, right: x0 + (best.c1 + 1) * size - inset, top: top - inset, bottom: top - height + inset, triangles: front.triangles }
}

/**
 * `findPanel`'s panel, if the stone is a slab: thinner front to back than it is wide, its panel at least half as tall
 * as wide. A cross's panel is its crossbar, too low; a pillar's or an obelisk's stone is as deep as it is wide.
 */
export function slabPanel(position: Positions): Panel | undefined {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (let i = 0; i < position.count; i++) {
    minX = Math.min(minX, position.getX(i))
    maxX = Math.max(maxX, position.getX(i))
    minZ = Math.min(minZ, position.getZ(i))
    maxZ = Math.max(maxZ, position.getZ(i))
  }
  if (maxZ - minZ >= (maxX - minX) * 0.9) return undefined
  const panel = findPanel(position)
  return panel && panel.top - panel.bottom >= (panel.right - panel.left) * 0.5 ? panel : undefined
}

/**
 * `geometry`, a stone unindexed in its own units, with where each corner of its front lies on its panel, from the
 * panel's top left, and the panel's size (`inscription`, nothing off the front or on any stone but a slab), and a seed
 * for its words, 0 till laid.
 */
export function inscribable(geometry: BufferGeometry): BufferGeometry {
  const position = geometry.getAttribute('position')
  const panel = slabPanel(position)
  const on = new Float32Array(position.count * 4)
  if (panel)
    for (const i of panel.triangles)
      for (let k = i; k < i + 3; k++)
        on.set([position.getX(k) - panel.left, panel.top - position.getY(k), panel.right - panel.left, panel.top - panel.bottom], k * 4)
  geometry.setAttribute('inscription', new BufferAttribute(on, 4))
  geometry.setAttribute('inscriptionSeed', new BufferAttribute(new Float32Array(position.count), 1))
  return geometry
}

/** A laid stone's copy of `inscribable`'s attributes put to its size and given its seed, 0 to 4000, from where it stands. */
export function inscribe(part: BufferGeometry, size: number, x: number, z: number): void {
  const on = part.getAttribute('inscription')
  for (let i = 0; i < on.count; i++) on.setXYZW(i, on.getX(i) * size, on.getY(i) * size, on.getZ(i) * size, on.getW(i) * size)
  const seed = Math.floor(random((Math.round(x * 1000) * 73856093) ^ (Math.round(z * 1000) * 19349663))() * 4000)
  const seeds = part.getAttribute('inscriptionSeed')
  for (let i = 0; i < seeds.count; i++) seeds.setX(i, seed)
}

export interface Inscriptions {
  readonly look: InscriptionLook
  /** `base`, a view normal, bent by the cuts. */
  normal(base: Node<'vec3'>): Node<'vec3'>
  /** `colour` with the cuts' dirt in it. */
  colour(colour: Node<'vec3'>): Node<'vec3'>
  /** Takes the folder's values. */
  set(): void
}

/** The cuts on a mesh whose stones are `inscribable` and laid with `inscribe`. */
export function createInscriptions(): Inscriptions {
  const look = defaultInscriptionLook()
  const shown = uniform(1).setGroup(renderGroup)
  const most = uniform(look.lines).setGroup(renderGroup)
  const spacing = uniform(look.spacing).setGroup(renderGroup)
  const thickness = uniform(look.thickness).setGroup(renderGroup)
  const wave = uniform(look.wave).setGroup(renderGroup)
  const scrawl = uniform(look.scrawl).setGroup(renderGroup)
  const depth = uniform(look.depth).setGroup(renderGroup)
  const dirt = uniform(look.dirt).setGroup(renderGroup)
  const fill = uniform(new Color(look.fill)).setGroup(renderGroup)
  const wear = uniform(look.wear).setGroup(renderGroup)

  const on = attribute<'vec4'>('inscription', 'vec4')
  // Rounded: interpolated over a triangle it strays a hair either side of its whole number, and the hash of a hair
  // under is another line's, pixel by pixel.
  const seed = floor(attribute<'float'>('inscriptionSeed', 'float').add(0.5))
  const u = on.x
  const v = on.y
  const width = on.z
  const height = on.w
  // The lines as a block in the middle of the panel: how many, which this is, its seed.
  const lines = max(1, floor(height.div(spacing)).min(most))
  const above = height.sub(lines.mul(spacing)).mul(0.5)
  const row = floor(v.sub(above).div(spacing))
  const rowSeed = seed.mul(97).add(row.max(0))
  const roll = (k: number) => hash(rowSeed.add(k * 1009))
  // Where it starts and how long: the last one short, none quite in the middle.
  const share = select(row.equal(lines.sub(1)).and(lines.greaterThan(1)), mix(0.25, 0.45, roll(1)), mix(0.7, 0.95, roll(2)))
  const long = width.mul(share)
  const start = width.sub(long).mul(mix(0.2, 0.8, roll(3)))
  const along = u.sub(start).div(long)
  // Its middle: the row's, wandering, sloping a little across, shaking as it goes.
  const middle = above
    .add(row.add(0.5).mul(spacing))
    .add(wave.mul(sin(u.mul(mix(18, 30, roll(4))).add(roll(5).mul(6.28))).mul(0.6).add(sin(u.mul(mix(40, 60, roll(6))).add(roll(7).mul(6.28))).mul(0.4))))
    .add(along.sub(0.5).mul(roll(8).sub(0.5)).mul(wave.mul(2)))
    .add(scrawl.mul(sin(u.mul(210).add(roll(9).mul(6.28))).mul(sin(u.mul(37).add(roll(10).mul(6.28))))))
  const off = v.sub(middle).abs()
  // As thick as the hand pressed, thinning to its ends.
  const pressed = mx_noise_float(vec2(u.mul(12), rowSeed)).mul(0.3).add(0.85)
  const ends = smoothstep(0, 0.04, along).mul(smoothstep(0.96, 1, along).oneMinus())
  const half = thickness.mul(0.5).mul(pressed).mul(ends)
  const blur = max(fwidth(off), 1e-5)
  const groove = smoothstep(half.sub(blur).max(0), half.add(blur), off).oneMinus().mul(float(1).sub(off.div(half.add(blur)).clamp(0, 1).pow(2)).mul(0.6).add(0.4))
  const inside = width.greaterThan(0).and(row.greaterThanEqual(0)).and(row.lessThan(lines)).and(along.greaterThan(0)).and(along.lessThan(1))
  // Worn: each stone more or less than the folder's, shallower the more, and gone in stretches.
  const worn = wear.mul(mix(0.5, 1.4, hash(seed.add(77))))
  const kept = smoothstep(worn.sub(0.12), worn.add(0.12), mx_noise_float(vec2(u.mul(7), rowSeed.add(500))).mul(0.5).add(0.5)).mul(worn.mul(0.5).oneMinus())
  const cut = select(inside, groove, 0).mul(kept).mul(shown)

  return {
    look,
    normal(base) {
      // Three's bump at the cut's depth in metres, unscaled by the pixel: a deeper cut leans harder.
      const fall = cut.mul(depth).mul(-CUT)
      const sigmaX = dFdx(positionView)
      const sigmaY = dFdy(positionView)
      const r1 = sigmaY.cross(base)
      const r2 = base.cross(sigmaX)
      const det = sigmaX.dot(r1)
      const grad = det.sign().mul(r1.mul(dFdx(fall)).add(r2.mul(dFdy(fall))))
      return det.abs().mul(base).sub(grad).normalize()
    },
    colour(colour) {
      return mix(colour, fill, cut.mul(dirt))
    },
    set() {
      shown.value = look.show ? 1 : 0
      most.value = Math.max(1, Math.round(look.lines))
      spacing.value = Math.max(0.01, look.spacing)
      thickness.value = Math.max(0.001, look.thickness)
      wave.value = look.wave
      scrawl.value = look.scrawl
      depth.value = look.depth
      dirt.value = look.dirt
      fill.value.set(look.fill)
      wear.value = look.wear
    },
  }
}

/** The inscriptions folder, under `gui`. */
export function mountInscriptionControls(inscriptions: Inscriptions, gui: GUI): void {
  const folder = gui.addFolder('inscriptions')
  const { look, set } = inscriptions
  folder.add(look, 'show').name('cut in').onChange(set)
  folder.add(look, 'lines', 1, 8, 1).name('lines at most').onChange(set)
  folder.add(look, 'spacing', 0.02, 0.3, 0.005).name('line spacing m').onChange(set)
  folder.add(look, 'thickness', 0.002, 0.05, 0.001).name('stroke m').onChange(set)
  folder.add(look, 'wave', 0, 0.04, 0.001).name('wander m').onChange(set)
  folder.add(look, 'scrawl', 0, 0.02, 0.0005).name('scrawl m').onChange(set)
  folder.add(look, 'depth', 0, 4, 0.05).name('depth').onChange(set)
  folder.add(look, 'wear', 0, 1, 0.01).name('wear').onChange(set)
  folder.add(look, 'dirt', 0, 1, 0.01).name('dirt in the cuts').onChange(set)
  folder.addColor(look, 'fill').name('dirt colour').onChange(set)
}
