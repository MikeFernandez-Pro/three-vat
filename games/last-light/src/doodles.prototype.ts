// PROTOTYPE, throwaway (branch prototype/last-light-doodles): which doodles
// suit the look? Round two, after the references: neon Halloween
// doodles, not pencil on paper. Hand-drawn eyes in magenta with cyan slit
// pupils, crowding the dark (a sheet of neon eyes; white sketchy eyes on
// black); a pentagram drawn on stroke by stroke (a summoning-circle
// animation); and Jinx's graffiti in Arcane, brush paint laid on the bodies
// themselves. Doodles may hang in the air and the fog, not only lie on the
// meshes (the player, 2026-10-10). On the open arena, `?doodle=0|A|B|C`,
// switched from the bar at the bottom (or [ and ], the arrows walk the holder):
//
//   0  the look as it is, for comparison.
//   A  Eyes in the fog: doodled eyes hang in the air of the dark, sprites
//      upright to the camera, drifting and bobbing, each drawn twice over in
//      a sketchy line. They open where the dark is deep, close as the light comes,
//      blink now and then, and their pupils follow the holder.
//   B  The pentagram: a circle and its star drawn on the ground in the
//      light's pool, a stroke at a time, a hot point at the pen, then held,
//      and drawn again; a candle flame at each point once it is closed.
//   C  Graffiti: brush paint on the rats, by their rest pose so it stays on
//      the body as it runs: cyan lashes round the eyes, and a pink star, a
//      cross or stripes on the back, dry-brushed and sprayed, half the swarm
//      tagged.
//
// A is sprites in the scene, out of the fog; B is drawn in the post after the
// depth of field, so its marks stay sharp; C in the rats' own shading. All of it boils on the stop motion's beat.
import { InstancedMesh, Matrix4, MeshBasicNodeMaterial, PlaneGeometry, Vector3, type Box3, type PerspectiveCamera } from 'three/webgpu'
import {
  abs,
  cameraProjectionMatrix,
  cameraViewMatrix,
  instanceIndex,
  mrt,
  output,
  positionLocal,
  uv,
  varying,
  atan,
  exp,
  float,
  fract,
  fwidth,
  getViewPosition,
  length,
  max,
  min,
  mix,
  mx_noise_float,
  screenUV,
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
const NAMES: Record<DoodleVariant, string> = { '0': 'the look as it is', A: 'eyes in the fog', B: 'the pentagram', C: 'graffiti' }

const asked = new URLSearchParams(location.search).get('doodle') as DoodleVariant | null
export const doodleVariant: DoodleVariant = asked !== null && VARIANTS.includes(asked) ? asked : 'A'

const TAU = Math.PI * 2
const MAGENTA = vec3(1, 0.17, 0.84)
const MAGENTA_HOT = vec3(1, 0.62, 0.95)
const CYAN = vec3(0.25, 0.95, 1)
const PINK = vec3(1, 0.33, 0.82)

/** The beat, for the boil, and the time on the beat, s, for the pen and the drift. Shared by the post and the rats. */
const seed = uniform(0)
const beatTime = uniform(0)

/** A hash of a vec2, 0 to 1. */
const hash = (p: N): N => fract(p.dot(vec2(12.9898, 78.233)).sin().mul(43758.5453))
/** Distance from `p` to the segment a-b. */
const segment = (p: N, a: N, b: N): N => {
  const pa = p.sub(a)
  const ba = b.sub(a)
  const h = pa.dot(ba).div(max(ba.dot(ba), 1e-8)).clamp(0, 1)
  return length(pa.sub(ba.mul(h)))
}
/** A stroke `width` px wide at `distance` px from its line, antialiased. */
const ink = (distance: N, width: N): N => float(1).sub(smoothstep(float(width).sub(0.75), float(width).add(0.75), distance))
/** A neon line's halo, `reach` px. */
const halo = (distance: N, reach: number): N => exp(distance.div(-reach))
/**
 * A segment drawn twice by a quick hand: each stroke's ends nudged its own way
 * every beat and run on past them, so the strokes cross and overshoot.
 */
const sketchy = (p: N, a: N, b: N, key: N, jitter: number): N => {
  let d: N = float(1e3)
  for (let k = 0; k < 2; k++) {
    const j = (o: number) => hash(key.add(vec2(seed.mul(0.37).add(k * 3.1 + o), o * 1.7))).sub(0.5).mul(jitter)
    const run = b.sub(a).mul(0.12 + k * 0.06)
    d = min(d, segment(p, a.sub(run).add(vec2(j(1), j(2))), b.add(run).add(vec2(j(3), j(4)))))
  }
  return d
}

export interface DoodleFrame {
  camera: PerspectiveCamera
  /** The stop motion's beat, or a count at its rate when it is off; and the rate. */
  beat: number
  fps: number
  torch: { x: number; z: number; radius: number }
}

export function createDoodles() {
  const variant = doodleVariant
  const projectionInverse = uniform(new Matrix4())
  const cameraWorld = uniform(new Matrix4())
  /** The torch: x, z, and its hard radius, m. */
  const torch = uniform(new Vector3())

  /** The ground under the pixel by the scene's depth, and 1 where the pixel is the ground. */
  const ground = (depthTexture: N): { xz: N; on: N } => {
    const depth = depthTexture.sample(screenUV).r
    const view = getViewPosition(screenUV, depth, projectionInverse)
    const world = cameraWorld.mul(vec4(view, 1)).xyz
    return { xz: world.xz, on: step(world.y, 0.04).mul(step(depth, 0.99999)) }
  }

  /**
   * A's eyes: sprites hung in the air round the holder, upright to the camera, out of the fog and out of
   * the shading. Each is a quad its own: placed by its index in a square round the holder, wrapping as the
   * holder walks so the dark round it is always full, drifting and bobbing. Shown from a step past the
   * torch's hard radius, open further out, shut as the light comes, blinking now and then; the pupil
   * follows the holder.
   */
  const EYES = 320
  const BOX = 16
  const eyes = (): InstancedMesh => {
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
    material.fog = false
    const index = float(instanceIndex)
    const keyed = (i: N) => (k: number) => hash(vec2(i.mul(0.618).add(k * 1.37), k * 2.71 + 0.5))
    const h = keyed(index)
    const drift = vec2(h(10), h(11)).sub(0.5).mul(0.3)
    const rel = fract(vec2(h(1), h(2)).mul(BOX).add(drift.mul(beatTime)).sub(torch.xy).div(BOX)).sub(0.5).mul(BOX)
    const bob = beatTime.mul(h(8).mul(0.8).add(0.6)).add(h(9).mul(TAU)).sin().mul(0.08)
    const centre = vec3(torch.x.add(rel.x), h(3).mul(1.4).add(0.3).add(bob), torch.y.add(rel.y))
    const past = length(rel).sub(torch.z)
    const shown = smoothstep(0.2, 1, past).mul(step(h(0), 0.85))
    const awake = step(0.1, hash(vec2(index.mul(0.29), seed.div(5).floor().mul(0.731))))
    const open = smoothstep(0.5, 1.5, past).mul(awake)
    const halfWidth = h(4).mul(0.2).add(0.22)
    const view = cameraViewMatrix.mul(vec4(centre, 1))
    const holder = cameraViewMatrix.mul(vec4(torch.x, 0.8, torch.y, 1))
    const look = holder.xy.sub(view.xy)
    material.vertexNode = cameraProjectionMatrix.mul(
      vec4(view.xyz.add(vec3((positionLocal.xy as N).mul(halfWidth.mul(3.6)).mul(step(0.001, shown)), 0)), 1),
    )
    const id = varying(index)
    const shownHere = varying(shown)
    const openHere = varying(open)
    const lookHere = varying(look.div(max(length(look), 1e-3)))
    const f = keyed(id)

    const tilt: N = f(6).sub(0.5).mul(0.5)
    const flat: N = uv().mul(2).sub(1).mul(1.8)
    let q: N = vec2(flat.x.mul(tilt.cos()).add(flat.y.mul(tilt.sin())), flat.y.mul(tilt.cos()).sub(flat.x.mul(tilt.sin())))
    q = q.add(vec2(mx_noise_float(vec3(q.mul(1.3), seed.add(f(7).mul(50)))), mx_noise_float(vec3(q.mul(1.3).add(4.1), seed))).mul(0.03))
    const top = f(5).mul(0.25).add(0.4).mul(openHere).add(0.02)
    const bottom = top.mul(0.75)
    // Almond lids, each drawn twice, or a diamond's straight ones, as the sketchy sheet has them.
    const diamond = step(0.5, f(12))
    const curve = (y0: N, k: number) => {
      const y = y0.mul(1 + (k - 0.5) * 0.12)
      const x = q.x.add((k - 0.5) * 0.05)
      return abs(q.y.sub(y.mul(float(1).sub(x.mul(x)))))
        .div(float(1).add(y.mul(2).mul(x).pow(2)).sqrt())
        .add(step(1.12, abs(x)).mul(1e3))
    }
    const almond = min(min(curve(top, 0), curve(top, 1)), min(curve(bottom.negate(), 0), curve(bottom.negate(), 1)))
    const key = vec2(id, 9.7)
    const straight = min(
      min(sketchy(q, vec2(-1, 0), vec2(0, top), key, 0.08), sketchy(q, vec2(0, top), vec2(1, 0), key.add(1), 0.08)),
      min(sketchy(q, vec2(1, 0), vec2(0, bottom.negate()), key.add(2), 0.08), sketchy(q, vec2(0, bottom.negate()), vec2(-1, 0), key.add(3), 0.08)),
    )
    // Three spikes off the upper lid, as the neon sheet has them.
    const lidAt = (x: number) => mix(top.mul(1 - x * x), top.mul(1 - Math.abs(x)), diamond)
    let spikes: N = float(1e3)
    for (const x of [-0.55, 0, 0.55]) spikes = min(spikes, segment(q, vec2(x, lidAt(x)), vec2(x * 1.3, lidAt(x).add(0.22))))
    const lines = min(mix(almond, straight, diamond), spikes).div(max(length(fwidth(q)), 1e-5))
    // Inside the lids: dark, and the slit pupil, cyan, toward the holder.
    const span = float(1).sub(mix(q.x.mul(q.x), abs(q.x), diamond)).max(0)
    const inside = step(abs(q.x), 1).mul(mix(step(q.y.negate(), bottom.mul(span)), step(q.y, top.mul(span)), step(0, q.y)))
    const pupil = q.sub(lookHere.mul(vec2(0.35, top.mul(0.4))))
    const slit = step(abs(pupil.x), float(0.13).mul(float(1).sub(pupil.y.div(top.mul(1.15).max(0.01)).pow(2)).max(0)))
      .mul(inside)
      .mul(openHere)
    const line = ink(lines, 1.4)
    let colour: N = mix(MAGENTA, vec3(0.04, 0.01, 0.07), inside)
    colour = mix(colour, CYAN, slit)
    colour = mix(colour, MAGENTA_HOT, line)
    material.colorNode = colour
    const opacity = max(max(halo(lines, 5).mul(0.45), inside.mul(0.9)), max(slit, line)).mul(shownHere)
    material.opacityNode = opacity
    // The scene pass's other targets take no blending: whatever a fragment writes there stands. So the quad
    // is cut to the eye and its glow, and there it is out of the shading, the AO passing over it; through
    // the rest of the quad the rats keep their own.
    material.alphaTest = 0.06
    material.mrtNode = mrt({ output, unshaded: vec4(1), normal: vec4(0) })
    const mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, EYES)
    mesh.frustumCulled = false
    mesh.renderOrder = 10
    return mesh
  }
  /** B: the circle and its star, drawn on in the light's pool. */
  const STROKE = 0.3
  const STROKES = 7
  const HOLD = 6
  const PERIOD = 7
  const pentagram = (c: N, depthTexture: N): N => {
    const { xz, on } = ground(depthTexture)
    const radius = torch.z.mul(0.85)
    const rel = xz.sub(torch.xy).div(max(radius, 0.01))
    const p = vec2(rel.x, rel.y.negate())
    const unitsAPixel = max(length(fwidth(rel)), 1e-5)
    const t = fract(beatTime.div(PERIOD)).mul(PERIOD)
    const progress = (k: number) => t.sub(k * STROKE).div(STROKE).clamp(0, 1)
    const fade = float(1).sub(smoothstep(HOLD, PERIOD - 0.1, t))
    const key = vec2(3.3, 7.1)
    let lines: N = float(1e3)
    let pen: N = float(1e3)
    // The circle, twice round: the second a little out, from its own start.
    const r = length(p)
    const around = atan(p.y, p.x).div(TAU).add(0.5)
    for (const [k, out, start] of [
      [0, 1, 0.1],
      [STROKES - 1, 1.035, 0.6],
    ] as const) {
      const s = fract(around.sub(start))
      const wobble = mx_noise_float(vec3(p.div(max(r, 1e-3)).mul(1.5), seed.mul(0.8).add(k))).mul(0.02)
      const drawn = step(s, progress(k)).mul(step(0.001, progress(k)))
      lines = min(lines, abs(r.sub(wobble.add(out))).add(drawn.oneMinus().mul(1e3)))
      const tip = progress(k).add(start).mul(TAU).sub(Math.PI)
      const head = vec2(tip.cos(), tip.sin()).mul(out)
      pen = min(pen, length(p.sub(head)).add(step(1, progress(k)).mul(1e3)).add(step(progress(k), 0).mul(1e3)))
    }
    // The star, point by point, its lines drawn twice by a quick hand.
    const point = (i: number) => vec2(Math.sin((i * TAU) / 5), Math.cos((i * TAU) / 5))
    for (let k = 0; k < 5; k++) {
      const a = point((k * 2) % 5)
      const b = point((k * 2 + 2) % 5)
      const end = mix(a, b, progress(k + 1))
      const drawn = step(0.001, progress(k + 1))
      lines = min(lines, sketchy(p, a, end, key.add(k), 0.03).add(drawn.oneMinus().mul(1e3)))
      pen = min(pen, length(p.sub(end)).add(step(1, progress(k + 1)).mul(1e3)).add(drawn.oneMinus().mul(1e3)))
    }
    // A candle flame at each point once the star is closed.
    let candles: N = float(1e3)
    for (let i = 0; i < 5; i++) candles = min(candles, length(p.sub(point(i)).mul(vec2(1, 0.55))))
    const lit = step(STROKES * STROKE, t)
    const px = (d: N) => d.div(unitsAPixel)
    const shown = on.mul(fade).mul(step(0.01, torch.z))
    let out: N = c.add(MAGENTA.mul(halo(px(lines), 6)).mul(0.45).mul(shown))
    out = mix(out, MAGENTA_HOT, ink(px(lines), 1.6).mul(shown))
    out = out.add(vec3(1, 0.85, 0.95).mul(halo(px(pen), 5)).mul(shown))
    out = out.add(vec3(1, 0.55, 0.6).mul(halo(px(candles), 4).mul(lit).mul(shown)))
    return out
  }

  /** B, over the finished frame. */
  const overlay = (c: N, depthTexture: N): N => {
    if (variant === 'B') return vec4(pentagram(c.rgb, depthTexture), 1)
    return c
  }

  function update({ camera, beat, fps, torch: t }: DoodleFrame) {
    setDoodleBeat(beat, fps)
    projectionInverse.value.copy(camera.projectionMatrixInverse)
    cameraWorld.value.copy(camera.matrixWorld)
    torch.value.set(t.x, t.z, t.radius)
  }

  return { variant, overlay, eyes, update }
}

export type Doodles = ReturnType<typeof createDoodles>

/** The beat for the boil and the pen. */
export function setDoodleBeat(beat: number, fps: number): void {
  seed.value = beat % 997
  beatTime.value = beat / fps
}

/** An eye of the model, in its rest pose: its centre and how far its vertices reach from it. */
export interface RestEye {
  centre: Vector3
  radius: number
}

/**
 * C: Jinx's graffiti, as a colour and how much of it a fragment takes, by the
 * rest pose (`rest`) so it stays on the body; `id` the rat, `eyes` its eyes,
 * `bounds` the model's. Half the rats are tagged, each its own way.
 */
export function graffiti(rest: N, id: N, eyes: RestEye[], bounds: Box3): { colour: N; alpha: N } {
  const L = bounds.max.z - bounds.min.z
  const u = rest.div(L)
  const tag = (k: number) => hash(vec2(id.mul(0.1234).add(k * 3.7), k * 1.9))
  const tagged = step(tag(0), 0.55)
  // Dry brush: the stroke's edge eaten by a noise across the body, and a spray of specks beside it.
  const brush = (d: N, width: number): N => {
    const dry = mx_noise_float(u.mul(60).add(seed.mul(0.6).add(id.mul(0.37)))).mul(0.35).add(0.85)
    const edge = dry.mul(width)
    const aa = max(fwidth(d), 1e-5)
    const body = float(1).sub(smoothstep(edge.sub(aa), edge.add(aa), d))
    return body
  }

  // Lashes round each eye, on its own side of the head: seven fanned over the eye, and a lid above it.
  let lashes: N = float(0)
  for (const eye of eyes) {
    const e = eye.centre.clone().divideScalar(L)
    const re = eye.radius / L
    const side = Math.sign(e.x) || 1
    const onSide = step(Math.abs(e.x) * 0.5, u.x.mul(side))
    const v = vec2(u.z.sub(e.z), u.y.sub(e.y))
    const r = length(v)
    const angle = atan(v.y, v.x)
    const FROM = 0.1 * Math.PI
    const TO = 0.9 * Math.PI
    const COUNT = 7
    const sector = angle.sub(FROM).div(TO - FROM).mul(COUNT).floor().clamp(0, COUNT - 1)
    const jitter = hash(vec2(sector.add(id), seed.mul(0.31))).sub(0.5).mul(0.25)
    const a = sector.add(0.5).add(jitter).div(COUNT).mul(TO - FROM).add(FROM)
    const dir = vec2(a.cos(), a.sin())
    const long = hash(vec2(sector, id.add(5))).mul(0.8).add(2.4)
    const lash = segment(v, dir.mul(re * 1.6), dir.mul(long.mul(0.025).add(re * 1.6)))
    const lid = abs(r.sub(re * 1.4))
      .add(step(angle, 0.05 * Math.PI).mul(1e3))
      .add(step(0.95 * Math.PI, angle).mul(1e3))
    lashes = max(lashes, brush(min(lash, lid), 0.009).mul(onSide))
  }
  lashes = lashes.mul(step(tag(1), 0.7))

  // On the back, a star, a cross or stripes, as the rat's tag has it.
  const top = smoothstep(0.55, 0.7, u.y.sub(bounds.min.y / L).div((bounds.max.y - bounds.min.y) / L))
  const middle = (bounds.min.z + bounds.max.z) / 2 / L
  const size = tag(3).mul(0.06).add(0.12)
  const w = vec2(u.x, u.z.sub(middle).sub(tag(4).sub(0.5).mul(0.15))).div(size)
  const kind = tag(2).mul(3).floor()
  let star: N = float(1e3)
  const point = (i: number) => vec2(Math.sin((i * 4 * Math.PI) / 5), Math.cos((i * 4 * Math.PI) / 5))
  for (let i = 0; i < 5; i++) star = min(star, segment(w, point(i), point(i + 1)))
  const cross = min(segment(w, vec2(-0.8, -0.8), vec2(0.8, 0.8)), segment(w, vec2(-0.8, 0.8), vec2(0.8, -0.8)))
  const stripes = abs(fract(w.y.mul(1.4).add(abs(w.x).mul(0.9))).sub(0.5)).add(step(1.1, abs(w.y)).mul(1e3))
  const is = (k: number) => step(abs(kind.sub(k)), 0.5)
  const mark = star.mul(is(0)).add(cross.mul(is(1))).add(stripes.mul(is(2)))
  const back = brush(mark.mul(size), 0.012).mul(top).mul(step(0.25, tag(5)))

  const alpha = max(lashes, back).mul(tagged)
  const colour = mix(PINK, CYAN, step(back, lashes))
  return { colour, alpha }
}

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
