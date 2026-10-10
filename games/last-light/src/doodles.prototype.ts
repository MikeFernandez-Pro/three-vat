// PROTOTYPE, throwaway (branch prototype/last-light-doodles): which doodles
// suit the sketchy look? Four variants on the open arena, `?doodle=0|A|B|C`,
// switched from the bar at the bottom (or [ and ], the arrows walk the holder):
//
//   0  the look as it is, for comparison.
//   A  Living ink: the picture is redrawn every beat. The frame boils a pixel
//      or two, the outlines come on as a doubled, wobbling pencil line, and
//      the hatching bends, breaks and changes pressure, line by line.
//   B  Drawn light: graphic marks for the light itself. A chalk circle
//      scribbled on the ground at the torch's hard radius, shrinking with it,
//      and comic rays round the flame, both redrawn on the beat.
//   C  Sketchbook: the dark is a page of margin doodles pinned to the ground,
//      spirals, stars, crosses, circles, squiggles in pale chalk, boiling on
//      the beat; and a hand-drawn frame round the screen.
//
// Everything is drawn in the post, after the depth of field, so the marks
// stay sharp; the ground under a pixel comes back from the scene's depth.
import { Matrix4, Vector2, Vector3, type PerspectiveCamera, type Node } from 'three/webgpu'
import {
  abs,
  atan,
  float,
  fract,
  fwidth,
  getViewPosition,
  length,
  max,
  min,
  mix,
  mx_noise_float,
  screenSize,
  screenUV,
  sin,
  smoothstep,
  step,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'

// Prototype: the node types stay loose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any

export type DoodleVariant = '0' | 'A' | 'B' | 'C'
const VARIANTS: DoodleVariant[] = ['0', 'A', 'B', 'C']
const NAMES: Record<DoodleVariant, string> = { '0': 'the look as it is', A: 'living ink', B: 'drawn light', C: 'sketchbook' }

const asked = new URLSearchParams(location.search).get('doodle') as DoodleVariant | null
export const doodleVariant: DoodleVariant = asked !== null && VARIANTS.includes(asked) ? asked : 'A'

const TAU = Math.PI * 2

/** A hash of a vec2, 0 to 1. */
const hash = (p: N): N => fract(sin(p.dot(vec2(12.9898, 78.233))).mul(43758.5453))
/** Noise, -1 to 1 or near it. */
const noise = (p: N): N => mx_noise_float(p)
/** A stroke `width` px wide at `distance` px from its line, antialiased. */
const ink = (distance: N, width: N): N => float(1).sub(smoothstep(width.sub(0.75), width.add(0.75), distance))
/** Distance from `p` to the segment a-b. */
const segment = (p: N, a: N, b: N): N => {
  const pa = p.sub(a)
  const ba = b.sub(a)
  const h = pa.dot(ba).div(ba.dot(ba)).clamp(0, 1)
  return length(pa.sub(ba.mul(h)))
}

export interface DoodleFrame {
  camera: PerspectiveCamera
  /** The stop motion's beat, or a count at its rate when it is off. */
  beat: number
  torch: { x: number; z: number; radius: number }
  flame: Vector3
  flameOn: boolean
}

export function createDoodles() {
  const variant = doodleVariant
  const seed = uniform(0)
  const projectionInverse = uniform(new Matrix4())
  const cameraWorld = uniform(new Matrix4())
  const torch = uniform(new Vector3())
  const flameUV = uniform(new Vector2())
  /** Pixels a metre at the flame's distance; 0 hides the rays. */
  const flameScale = uniform(0)
  const projected = new Vector3()

  /** A's boil: an offset to a screen uv, a couple of pixels, new every beat. */
  const wobble = (uv: N, amount: number, channel: number): Node<'vec2'> => {
    const at = vec3(uv.mul(screenSize).div(70), seed.mul(1.7).add(channel * 13.1))
    const px = vec2(noise(at), noise(at.add(vec3(31.4, 17.2, 5.3))))
    return px.mul(amount).div(screenSize)
  }

  /**
   * A's hatch line: `u` lines across, `s` px along them. Not ruled lines but short strokes, as a hand lays
   * them: each line cut into dashes of its own length, some left out, each dash nudged off the line and
   * bent a little, thinning at its ends; all of it drawn again every beat.
   */
  const hatchLine = (u: N, s: N, width: N, channel: number): N => {
    const line = u.floor()
    const DASH = 46
    const along = s.div(DASH).add(hash(vec2(line, seed.add(channel))).mul(3))
    const dash = along.floor()
    const id = vec2(line.add(channel * 101), dash.add(seed.mul(17)))
    const kept = step(0.3, hash(id))
    const t = fract(along)
    const shift = hash(id.add(3.3)).sub(0.5).mul(0.5)
    const bend = t.sub(0.5).mul(t.sub(0.5)).mul(hash(id.add(7.7)).sub(0.5)).mul(1.2)
    const v = fract(u.add(shift).add(bend))
    const ends = smoothstep(0, 0.15, t).mul(smoothstep(1, 0.8, t))
    return step(float(1).sub(width.mul(ends)), v).mul(kept)
  }

  /** The ground under the pixel, world xz, and 1 where the pixel is the ground. */
  const ground = (depthTexture: N): { xz: N; on: N } => {
    const depth = depthTexture.sample(screenUV).r
    const view = getViewPosition(screenUV, depth, projectionInverse)
    const world = cameraWorld.mul(vec4(view, 1)).xyz
    return { xz: world.xz, on: step(world.y, 0.04).mul(step(depth, 0.99999)) }
  }

  /** B: the chalk circle at the torch's hard radius, three loops, each a little off and open at its own place. */
  const ring = (xz: N): N => {
    const rel = xz.sub(torch.xy)
    const d = length(rel)
    const dir = rel.div(max(d, 1e-4))
    const metresAPixel = max(fwidth(d), 1e-5)
    const around = atan(dir.y, dir.x).div(TAU).add(0.5)
    let lines: N = float(0)
    for (let k = 0; k < 3; k++) {
      const r = torch.z.mul(noise(vec3(dir.mul(1.1).add(k * 5.1), seed.mul(0.9).add(k))).mul(0.06).add(1 + (k - 1) * 0.03))
      const along = fract(around.add(hash(vec2(seed, k * 3.7))))
      const taper = smoothstep(0, 0.06, along).mul(smoothstep(1, 0.93, along))
      const pressure = noise(vec3(dir.mul(3).add(k * 9.3), seed)).mul(0.35).add(1)
      lines = max(lines, ink(abs(d.sub(r)).div(metresAPixel), taper.mul(pressure).mul(k === 0 ? 1.8 : 1.1)))
    }
    return lines.mul(step(0.01, torch.z))
  }

  /** B: comic rays round the flame, nine, none straight down along the torch. */
  const rays = (): N => {
    const p = screenUV.sub(flameUV).mul(screenSize).mul(vec2(1, -1))
    const RAYS = 9
    const sector = atan(p.y, p.x).div(TAU).mul(RAYS).add(0.5).floor()
    const h = hash(vec2(sector, seed))
    const angle = sector.add(h.sub(0.5).mul(0.35)).mul(TAU / RAYS)
    const dir = vec2(angle.cos(), angle.sin())
    const r0 = flameScale.mul(hash(vec2(sector.add(7), seed)).mul(0.06).add(0.2))
    const r1 = r0.add(flameScale.mul(hash(vec2(sector.add(13), seed)).mul(0.1).add(0.1)))
    const d = segment(p, dir.mul(r0), dir.mul(r1))
    const t = p.dot(dir).sub(r0).div(r1.sub(r0)).clamp(0, 1)
    const down = smoothstep(0.75, 0.9, dir.y.negate())
    return ink(d, float(2.2).mul(float(1).sub(t.mul(0.7)))).mul(down.oneMinus()).mul(step(1, flameScale))
  }

  /** C: a doodle a cell of the ground, or none; in pale chalk where the fog is thick. */
  const margins = (xz: N): N => {
    const CELL = 1.4
    const g = xz.div(CELL)
    const cell = g.floor()
    const type = hash(cell).mul(7).floor()
    const jitter = vec2(hash(cell.add(1.3)), hash(cell.add(2.7))).sub(0.5).mul(0.3)
    const size = hash(cell.add(4.1)).mul(0.12).add(0.2)
    const turn = hash(cell.add(5.9)).mul(TAU)
    const f: N = fract(g).sub(0.5).sub(jitter)
    const c: N = turn.cos()
    const s: N = turn.sin()
    let q: N = (vec2(f.x.mul(c).sub(f.y.mul(s)), f.x.mul(s).add(f.y.mul(c))) as N).div(size)
    q = q.add(vec2(noise(vec3(q.mul(1.6), seed.add(cell.x))), noise(vec3(q.mul(1.6).add(9.1), seed.add(cell.y)))).mul(0.07))
    const r = length(q)
    const circle = abs(r.sub(0.75))
    const cross = min(segment(q, vec2(-0.7, -0.7), vec2(0.7, 0.7)), segment(q, vec2(-0.7, 0.7), vec2(0.7, -0.7)))
    let star: N = float(1e3)
    const point = (i: number) => vec2(Math.cos(Math.PI / 2 + (i * 4 * Math.PI) / 5) * 0.85, Math.sin(Math.PI / 2 + (i * 4 * Math.PI) / 5) * 0.85)
    for (let i = 0; i < 5; i++) star = min(star, segment(q, point(i), point(i + 1)))
    const spacing = 0.2
    const turned = atan(q.y, q.x).div(TAU).add(0.5)
    const spiral = abs(fract(r.div(spacing).sub(turned).add(0.5)).sub(0.5)).mul(spacing).add(step(0.9, r).mul(1e3))
    const squiggle = abs(q.y.sub(sin(q.x.mul(7)).mul(0.28))).mul(0.7).add(step(0.85, abs(q.x)).mul(1e3))
    const is = (t: number) => step(abs(type.sub(t)), 0.5)
    let d: N = float(1e3)
    d = mix(d, spiral, is(2))
    d = mix(d, star, is(3))
    d = mix(d, cross, is(4))
    d = mix(d, circle, is(5))
    d = mix(d, squiggle, is(6))
    // Local units to pixels: a unit is `size` cells of CELL metres.
    const metresAPixel = max(length(fwidth(xz)), 1e-5)
    return ink(d.mul(size).mul(CELL).div(metresAPixel), float(1.3))
  }

  /** C: a frame drawn by hand round the screen, each side twice, overshooting its corners. */
  const frame = (): { lines: N; outside: N } => {
    const p = screenUV.mul(screenSize)
    const size = screenSize
    const INSET = 26
    let lines: N = float(0)
    for (let k = 0; k < 2; k++) {
      const over = hash(vec2(seed, k + 0.5)).mul(18).add(4)
      const side = (along: N, across: N, at: N, length: N, channel: number) => {
        const line = at.add(noise(vec3(along.div(140), seed.mul(1.1).add(k * 4 + channel), 0)).mul(3))
        const within = step(INSET - 1, along.add(over)).mul(step(along, length.sub(INSET - 1).add(over)))
        return ink(abs(across.sub(line)), float(k === 0 ? 1.3 : 0.8)).mul(within)
      }
      lines = max(lines, side(p.x, p.y, float(INSET), size.x, 0))
      lines = max(lines, side(p.x, p.y, size.y.sub(INSET), size.x, 1))
      lines = max(lines, side(p.y, p.x, float(INSET), size.y, 2))
      lines = max(lines, side(p.y, p.x, size.x.sub(INSET), size.y, 3))
    }
    const inside = step(INSET, p.x).mul(step(p.x, size.x.sub(INSET))).mul(step(INSET, p.y)).mul(step(p.y, size.y.sub(INSET)))
    return { lines, outside: inside.oneMinus() }
  }

  /** B and C, over the finished frame: `fogged` is the fog amount a pixel, `fogColour` the dark's colour. */
  const overlay = (c: N, depthTexture: N, fogged: N, fogColour: N): N => {
    if (variant === 'B') {
      const { xz, on } = ground(depthTexture)
      const chalk = vec3(1, 0.72, 0.42)
      let out = mix(c.rgb, chalk, ring(xz).mul(on).mul(0.75))
      out = mix(out, vec3(1, 0.8, 0.5), rays().mul(0.85))
      return vec4(out, 1)
    }
    if (variant === 'C') {
      const { xz, on } = ground(depthTexture)
      const chalk = vec3(0.62, 0.52, 0.85)
      const { lines, outside } = frame()
      let out = mix(c.rgb, chalk, margins(xz).mul(on).mul(smoothstep(0.45, 0.85, fogged)).mul(0.4))
      out = mix(out, fogColour, outside.mul(0.6))
      out = mix(out, chalk, lines.mul(0.7))
      return vec4(out, 1)
    }
    return c
  }

  function update({ camera, beat, torch: t, flame, flameOn }: DoodleFrame) {
    seed.value = beat % 997
    projectionInverse.value.copy(camera.projectionMatrixInverse)
    cameraWorld.value.copy(camera.matrixWorld)
    torch.value.set(t.x, t.z, t.radius)
    projected.copy(flame).project(camera)
    flameUV.value.set(projected.x * 0.5 + 0.5, 0.5 - projected.y * 0.5)
    const distance = flame.distanceTo(camera.position)
    const focal = innerHeight / 2 / Math.tan((camera.fov * Math.PI) / 360)
    flameScale.value = flameOn && projected.z < 1 ? focal / distance : 0
  }

  return { variant, wobble, hatchLine, overlay, update }
}

export type Doodles = ReturnType<typeof createDoodles>

/** The bar at the bottom: the variant, and arrows either side that load the page on the next. */
export function mountDoodleSwitcher() {
  if (!import.meta.env.DEV) return
  const go = (step: number) => {
    const next = VARIANTS[(VARIANTS.indexOf(doodleVariant) + step + VARIANTS.length) % VARIANTS.length]!
    const url = new URL(location.href)
    url.searchParams.set('doodle', next)
    location.href = url.toString()
  }
  const bar = document.createElement('div')
  bar.style.cssText =
    'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:1000;display:flex;gap:12px;align-items:center;' +
    'padding:6px 14px;border-radius:999px;background:#fff;color:#111;font:600 13px system-ui;box-shadow:0 4px 16px #0008;user-select:none'
  const arrow = (label: string, step: number) => {
    const button = document.createElement('button')
    button.textContent = label
    button.style.cssText = 'border:0;background:#111;color:#fff;border-radius:999px;width:26px;height:26px;cursor:pointer;font:700 14px system-ui'
    button.onclick = () => go(step)
    return button
  }
  const label = document.createElement('span')
  label.textContent = `doodle ${doodleVariant} (${NAMES[doodleVariant]})`
  bar.append(arrow('‹', -1), label, arrow('›', 1))
  document.body.append(bar)
  addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) return
    if (event.code === 'BracketLeft') go(-1)
    if (event.code === 'BracketRight') go(1)
  })
}
