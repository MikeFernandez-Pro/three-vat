// PROTOTYPE, throwaway (branch prototype/last-light-doodles): which doodles
// suit the look? Round three, what the player kept of the first two: the
// animated lines round the light (round one), the hatching laid stroke by
// stroke but no outlines (round one's living ink, less comic), and the eyes
// (round two), but small, far off in the fog, in one pale colour, and cut
// cleanly. On the open arena, three pieces that combine, each on a switch:
// `?doodle=eyes,light,hatch` (all three, the default), `?doodle=0` none; the
// bar at the bottom toggles them.
//
//   eyes   small drawn eyes hang in the fog round the holder, from its far
//          edge on, upright to the camera, drifting and bobbing; shut where
//          the fog is thin, open deeper in, blinking; the pupil follows the
//          holder. One pale colour, no glow, sinking into the fog's colour
//          the deeper they hang.
//   light  chalk round the light, in the torch's own pale orange, with a dry
//          brush's broken edge, redrawn every beat: at the torch's hard
//          radius on the ground one long loop open at a travelling gap, and
//          two dashed loops turning against each other; over the flame,
//          short strokes that rise beat by beat and go out, as its embers do.
//   hatch  the frame boils a pixel or two each beat, and the hatching is laid
//          round the light, as a hand shades round a lamp: arcs about it in
//          the shade, rays from it in the deepest; short strokes, broken,
//          nudged and bent, drawn again every beat.
//
// The eyes are sprites in the scene, out of the fog's own shading; the light's
// lines are drawn in the post after the depth of field, so they stay sharp;
// the hatching is the post's own, redrawn.
import { InstancedMesh, Matrix4, MeshBasicNodeMaterial, PlaneGeometry, Vector2, Vector3, type PerspectiveCamera, type Node } from 'three/webgpu'
import {
  abs,
  atan,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  float,
  fract,
  fwidth,
  getViewPosition,
  instanceIndex,
  length,
  max,
  min,
  mix,
  mrt,
  mx_noise_float,
  output,
  positionLocal,
  screenSize,
  screenUV,
  smoothstep,
  step,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'

// Prototype: the node types stay loose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any

export type DoodlePiece = 'eyes' | 'light' | 'hatch'
const PIECES: DoodlePiece[] = ['eyes', 'light', 'hatch']

const asked = new URLSearchParams(location.search).get('doodle')
/** The pieces on: all three without `?doodle=`, none with `?doodle=0`, else those named. */
export const doodle: Record<DoodlePiece, boolean> = {
  eyes: asked === null || asked.split(',').includes('eyes'),
  light: asked === null || asked.split(',').includes('light'),
  hatch: asked === null || asked.split(',').includes('hatch'),
}

const TAU = Math.PI * 2
/** The light's chalk: the lamp's pumpkin orange (0xff6418) lightened to a pale peach. */
const CHALK = vec3(1, 0.76, 0.52)
/** The eyes' one colour: a candle white. */
const CANDLE = vec3(1, 0.94, 0.8)

/** The beat, for the boil, and the time on the beat, s, for the travelling gaps and the drift. */
const seed = uniform(0)
const beatTime = uniform(0)

/** A hash of a vec2, 0 to 1. */
const hash = (p: N): N => fract(p.dot(vec2(12.9898, 78.233)).sin().mul(43758.5453))
/** Noise, -1 to 1 or near it. */
const noise = (p: N): N => mx_noise_float(p)
/** Distance from `p` to the segment a-b. */
const segment = (p: N, a: N, b: N): N => {
  const pa = p.sub(a)
  const ba = b.sub(a)
  const h = pa.dot(ba).div(max(ba.dot(ba), 1e-8)).clamp(0, 1)
  return length(pa.sub(ba.mul(h)))
}
/** A stroke `width` px wide at `distance` px from its line, antialiased. */
const ink = (distance: N, width: N): N => float(1).sub(smoothstep(float(width).sub(0.75), float(width).add(0.75), distance))

export interface DoodleFrame {
  camera: PerspectiveCamera
  /** The stop motion's beat, or a count at its rate when it is off; and the rate. */
  beat: number
  fps: number
  torch: { x: number; z: number; radius: number }
  flame: Vector3
  flameOn: boolean
}

/** The scene's fog, as main.ts has it: its near and far, m from its centre on the ground. */
export interface DoodleFog {
  near: N
  far: N
  centre: N
  color: N
}

export function createDoodles(fog: DoodleFog) {
  const projectionInverse = uniform(new Matrix4())
  const cameraWorld = uniform(new Matrix4())
  /** The torch: x, z, and its hard radius, m. */
  const torch = uniform(new Vector3())
  const flameUV = uniform(new Vector2())
  /** Where the holder stands on screen, uv: the hatching turns about it. */
  const holderUV = uniform(new Vector2())
  /** Pixels a metre at the flame's distance; 0 hides the ticks. */
  const flameScale = uniform(0)
  const projected = new Vector3()

  // ------------------------------------------------------------------ hatch

  /** The boil: an offset to a screen uv, a couple of pixels, new every beat. */
  const wobble = (uv: N, amount: number, channel: number): Node<'vec2'> => {
    const at = vec3(uv.mul(screenSize).div(70), seed.mul(1.7).add(channel * 13.1))
    const px = vec2(noise(at), noise(at.add(vec3(31.4, 17.2, 5.3))))
    return px.mul(amount).div(screenSize)
  }

  /**
   * A hatch line: `u` lines across, `s` px along them. Not ruled lines but short strokes, as a hand lays
   * them: each line cut into dashes of its own length, some left out, each dash nudged off the line and
   * bent a little, thinning at its ends; all of it drawn again every beat.
   */
  const hatchLine = (u: N, s: N, width: N, channel: number): N => {
    const line = u.floor()
    const DASH = 70
    const along = s.div(DASH).add(hash(vec2(line, seed.add(channel))).mul(3))
    const dash = along.floor()
    const id = vec2(line.add(channel * 101), dash.add(seed.mul(17)))
    const kept = step(0.6, hash(id))
    const t = fract(along)
    const shift = hash(id.add(3.3)).sub(0.5).mul(0.6)
    const bend = t.sub(0.5).mul(t.sub(0.5)).mul(hash(id.add(7.7)).sub(0.5)).mul(1.2)
    // A slant of its own, up to half a spacing over the dash's length; and a length of its own, a third to all of it.
    const slant = t.sub(0.5).mul(hash(id.add(11.1)).sub(0.5)).mul(1.1)
    const v = fract(u.add(shift).add(bend).add(slant))
    const span = hash(id.add(5.5)).mul(0.65).add(0.35)
    const ends = smoothstep(0, 0.12, t).mul(smoothstep(span, span.sub(0.2), t))
    return step(float(1).sub(width.mul(ends)), v).mul(kept)
  }

  /**
   * The hatching's frame, from the pixel `coord` (px): as a hand shades round
   * a lamp, the first set of strokes runs in arcs about the holder on screen,
   * the second in rays from it. `along` is the distance along a stroke,
   * `across` the distance across them, both px, so the same spacing serves.
   */
  const hatchFrame = (coord: N): { arcs: { along: N; across: N }; rays: { along: N; across: N } } => {
    const rel = coord.sub(holderUV.mul(screenSize))
    const r = max(length(rel), 1)
    const angle = atan(rel.y, rel.x)
    const arc = angle.mul(r)
    return { arcs: { along: arc, across: r }, rays: { along: r, across: arc } }
  }

  // ------------------------------------------------------------------ light

  /** The ground under the pixel by the scene's depth, world xz, and 1 where the pixel is the ground. */
  const ground = (depthTexture: N): { xz: N; on: N } => {
    const depth = depthTexture.sample(screenUV).r
    const view = getViewPosition(screenUV, depth, projectionInverse)
    const world = cameraWorld.mul(vec4(view, 1)).xyz
    return { xz: world.xz, on: step(world.y, 0.04).mul(step(depth, 0.99999)) }
  }

  /**
   * The circle at the torch's hard radius: three loops, each a little off the
   * radius and wobbling on the beat, each open over a part of its round, the
   * gaps travelling round at their own pace and way. Thin, the first loop a
   * little heavier.
   */
  const ring = (xz: N): N => {
    const rel = xz.sub(torch.xy)
    const d = length(rel)
    const dir = rel.div(max(d, 1e-4))
    const metresAPixel = max(fwidth(d), 1e-5)
    const around = atan(dir.y, dir.x).div(TAU).add(0.5)
    // The dry brush: the chalk breaks up along the stroke where the ground's grain shows through.
    const grain = noise(vec3(xz.mul(14), seed.mul(0.3)))
    const dry = smoothstep(-0.7, -0.1, grain).mul(grain.mul(0.25).add(0.9))
    let lines: N = float(0)
    // The long loop: a little off the radius, wobbling on the beat, open over a fifth of its round, the gap travelling.
    {
      const r = torch.z.mul(noise(vec3(dir.mul(1.1), seed.mul(0.9))).mul(0.035).add(0.985))
      const along = fract(around.add(beatTime.mul(0.06)))
      const taper = smoothstep(0.18, 0.3, along).mul(smoothstep(1, 0.92, along))
      const pressure = noise(vec3(dir.mul(3), seed)).mul(0.35).add(1)
      lines = max(lines, ink(abs(d.sub(r)).div(metresAPixel), taper.mul(pressure).mul(1.5)))
    }
    // Two dashed loops, one inside and one out, turning against each other, each dash a dab with soft ends.
    for (const [k, off, count, pace] of [
      [1, 1.035, 13, -0.09],
      [2, 0.95, 9, 0.12],
    ] as const) {
      const r = torch.z.mul(noise(vec3(dir.mul(1.4).add(k * 5.1), seed.mul(0.9).add(k))).mul(0.03).add(off))
      const t = fract(around.add(beatTime.mul(pace)).add(k * 0.37).mul(count))
      const dash = smoothstep(0, 0.2, t).mul(smoothstep(0.65, 0.45, t))
      lines = max(lines, ink(abs(d.sub(r)).div(metresAPixel), dash.mul(1.1)).mul(0.85))
    }
    return lines.mul(dry).mul(step(0.01, torch.z))
  }

  /**
   * Ticks round the flame: of eleven places round it, a few each beat take a
   * short thin stroke pointing out, as hand-drawn fire has its sparks; none
   * straight down along the torch.
   */
  const ticks = (): N => {
    const p = screenUV.sub(flameUV).mul(screenSize).mul(vec2(1, -1))
    // Seven lanes over the flame's upper half; in each, a stroke rises from near the flame and goes out
    // at the top of its climb, then another starts, on its own clock, a beat at a time.
    const LANES = 7
    const SPREAD = 0.42 * TAU
    const lane = p.x.div(p.length().max(1)).acos().mul(p.y.sign()).add(SPREAD / 2).div(SPREAD).mul(LANES).floor().clamp(0, LANES - 1)
    const h = (k: number) => hash(vec2(lane.add(k * 3.1), k))
    const rise = fract(beatTime.mul(h(1).mul(0.5).add(0.7)).add(h(2)))
    const angle = lane.add(0.5).add(h(3).sub(0.5).mul(0.5)).div(LANES).mul(SPREAD).sub(SPREAD / 2).add(Math.PI / 2)
    const dir = vec2(angle.cos(), angle.sin())
    const r0 = flameScale.mul(rise.mul(0.5).add(0.2))
    const r1 = r0.add(flameScale.mul(h(4).mul(0.04).add(0.04)).mul(float(1).sub(rise.mul(0.5))))
    const d = segment(p, dir.mul(r0), dir.mul(r1))
    const fade = smoothstep(0, 0.1, rise).mul(smoothstep(1, 0.6, rise))
    return ink(d, float(1.7)).mul(fade).mul(step(1, flameScale))
  }

  /** The light's lines over the finished frame, in the chalk. */
  const overlay = (c: N, depthTexture: N): N => {
    if (!doodle.light) return c
    const { xz, on } = ground(depthTexture)
    let out = mix(c.rgb, CHALK, ring(xz).mul(on).mul(0.8))
    out = mix(out, CHALK, ticks().mul(0.85))
    return vec4(out, 1)
  }

  // ------------------------------------------------------------------- eyes

  /**
   * The eyes: sprites hung in the fog round the holder, upright to the camera,
   * out of the fog's shading. Each is a quad its own, placed by its index in a
   * square round the holder that wraps as the holder walks, drifting and
   * bobbing; shown from near the fog's far edge on and faded out a few metres
   * past it, never within reach of the camera. Shut at the fog's edge, open
   * deeper in, blinking now and then; the pupil follows the holder. One
   * colour, thin lines, and the quad cut to the drawing.
   */
  const EYES = 480
  const BOX = 20
  const eyes = (): InstancedMesh => {
    // Drawn over whatever stands in the fog: a doodle in the air, not a thing among the rats for a body to hide.
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false })
    material.fog = false
    // The scene pass's other targets take no blending, so the quad is cut to the drawing: there it is out
    // of the shading, the AO passing over it; through the rest the rats keep their own.
    material.alphaTest = 0.3
    material.mrtNode = mrt({ output, unshaded: vec4(1), normal: vec4(0) })
    const index = float(instanceIndex)
    const keyed = (i: N) => (k: number) => hash(vec2(i.mul(0.618).add(k * 1.37), k * 2.71 + 0.5))
    const h = keyed(index)
    const drift = vec2(h(10), h(11)).sub(0.5).mul(0.25)
    const rel = fract(vec2(h(1), h(2)).mul(BOX).add(drift.mul(beatTime)).sub(torch.xy).div(BOX)).sub(0.5).mul(BOX)
    const bob = beatTime.mul(h(8).mul(0.8).add(0.6)).add(h(9).mul(TAU)).sin().mul(0.06)
    const height: N = h(3).mul(0.5).add(0.3).add(bob)
    const centre = vec3(torch.x.add(rel.x), height, torch.y.add(rel.y))
    // In the fog's band as the camera sees it, the corners and the sides of the view: from a step past
    // the torch's hard radius to a little past the fog's far edge; and never within reach of the camera.
    const out = length(rel)
    const shown = smoothstep(torch.z.add(0.6), torch.z.add(1.6), out)
      .mul(smoothstep(fog.far.add(2.5), fog.far.add(1), out))
      .mul(smoothstep(3.8, 5, length(centre.sub(cameraPosition))))
      .mul(step(h(0), 0.75))
    const awake = step(0.12, hash(vec2(index.mul(0.29), seed.div(4).floor().mul(0.731))))
    const open = smoothstep(torch.z.add(1), fog.far, out).mul(awake)
    const halfWidth = h(4).mul(0.04).add(0.07)
    const view = cameraViewMatrix.mul(vec4(centre, 1))
    const holder = cameraViewMatrix.mul(vec4(torch.x, 0.8, torch.y, 1))
    const look = holder.xy.sub(view.xy)
    material.vertexNode = cameraProjectionMatrix.mul(
      vec4(view.xyz.add(vec3((positionLocal.xy as N).mul(halfWidth.mul(2.6)).mul(step(0.001, shown)), 0)), 1),
    )
    const id = varying(index)
    const shownHere = varying(shown)
    const openHere = varying(open)
    const lookHere = varying(look.div(max(length(look), 1e-3)))
    const f = keyed(id)

    const tilt: N = f(6).sub(0.5).mul(0.4)
    const flat: N = uv().mul(2).sub(1).mul(1.3)
    let q: N = vec2(flat.x.mul(tilt.cos()).add(flat.y.mul(tilt.sin())), flat.y.mul(tilt.cos()).sub(flat.x.mul(tilt.sin())))
    q = q.add(vec2(noise(vec3(q.mul(1.3), seed.add(f(7).mul(50)))), noise(vec3(q.mul(1.3).add(4.1), seed))).mul(0.025))
    const top = f(5).mul(0.2).add(0.35).mul(openHere).add(0.015)
    const bottom = top.mul(0.7)
    // Almond lids, each drawn twice a little apart, as a quick hand does.
    const curve = (y0: N, k: number) => {
      const y = y0.mul(1 + (k - 0.5) * 0.14)
      const x = q.x.add((k - 0.5) * 0.06)
      return abs(q.y.sub(y.mul(float(1).sub(x.mul(x)))))
        .div(float(1).add(y.mul(2).mul(x).pow(2)).sqrt())
        .add(step(1.1, abs(x)).mul(1e3))
    }
    const lids = min(min(curve(top, 0), curve(top, 1)), min(curve(bottom.negate(), 0), curve(bottom.negate(), 1)))
    const unitsAPixel = max(length(fwidth(q)), 1e-5)
    const line = ink(lids.div(unitsAPixel), 1.1)
    // The pupil: a filled dot toward the holder, inside the lids, gone as they shut.
    const span = float(1).sub(q.x.mul(q.x)).max(0)
    const inside = step(abs(q.x), 1).mul(mix(step(q.y.negate(), bottom.mul(span)), step(q.y, top.mul(span)), step(0, q.y)))
    const pupilAt = lookHere.mul(vec2(0.3, top.mul(0.35)))
    const pupil = step(length(q.sub(pupilAt).mul(vec2(1, 1.3))), float(0.27).mul(openHere)).mul(inside)
    // Deeper in the fog, dimmer, toward its colour: the eye is in the fog, not in front of it.
    const sunk = varying(smoothstep(fog.far.sub(1.5), fog.far.add(2), out))
    material.colorNode = mix(CANDLE.mul(0.9), fog.color, sunk.mul(0.6))
    // Shut, the eye is a faint line; it is the opening that shows it.
    material.opacityNode = max(line, pupil).mul(shownHere).mul(openHere.mul(0.75).add(0.25))
    const mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, EYES)
    mesh.frustumCulled = false
    mesh.renderOrder = 10
    return mesh
  }

  function update({ camera, beat, fps, torch: t, flame, flameOn }: DoodleFrame) {
    seed.value = beat % 997
    beatTime.value = beat / fps
    projectionInverse.value.copy(camera.projectionMatrixInverse)
    cameraWorld.value.copy(camera.matrixWorld)
    torch.value.set(t.x, t.z, t.radius)
    projected.copy(flame).project(camera)
    flameUV.value.set(projected.x * 0.5 + 0.5, 0.5 - projected.y * 0.5)
    projected.set(t.x, 0.6, t.z).project(camera)
    holderUV.value.set(projected.x * 0.5 + 0.5, 0.5 - projected.y * 0.5)
    const focal = innerHeight / 2 / Math.tan((camera.fov * Math.PI) / 360)
    flameScale.value = flameOn && projected.z < 1 ? focal / flame.distanceTo(camera.position) : 0
  }

  return { wobble, hatchLine, hatchFrame, overlay, eyes, update }
}

export type Doodles = ReturnType<typeof createDoodles>

/** The bar at the bottom: a toggle a piece; each loads the page again with the pieces as set. */
export function mountDoodleSwitcher() {
  if (!import.meta.env.DEV) return
  const bar = document.createElement('div')
  bar.style.cssText =
    'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:1000;display:flex;gap:8px;align-items:center;' +
    'padding:6px 10px;border-radius:999px;background:#fff;color:#111;font:600 13px system-ui;box-shadow:0 4px 16px #0008;user-select:none'
  const label = document.createElement('span')
  label.textContent = 'doodles'
  label.style.marginRight = '4px'
  bar.append(label)
  for (const piece of PIECES) {
    const button = document.createElement('button')
    button.textContent = piece
    const on = doodle[piece]
    button.style.cssText = `border:0;border-radius:999px;padding:4px 10px;cursor:pointer;font:600 13px system-ui;background:${on ? '#111' : '#ddd'};color:${on ? '#fff' : '#555'}`
    button.onclick = () => {
      const next = PIECES.filter((p) => (p === piece ? !doodle[p] : doodle[p]))
      const url = new URL(location.href)
      url.searchParams.set('doodle', next.length === 0 ? '0' : next.join(','))
      location.href = url.toString()
    }
    bar.append(button)
  }
  document.body.append(bar)
}
