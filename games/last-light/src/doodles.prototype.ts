// PROTOTYPE, throwaway (branch prototype/last-light-doodles): which doodles
// suit the look? Round four, on the verdict of round three: the light's
// lines back round the torch and kept on the floor, nothing drawn on the
// rats; the eyes no longer blinking out at random (it read as culling) but
// playing a line animation of their own, drawn on stroke by stroke as the
// light's lines are; the hatching no longer turning about the holder (the
// rats already turn round us) but laid by lightness, in a choice of
// patterns; and controls for all three, in a panel of their own at the left.
//
//   light  chalk in the lamp's pale orange with a dry brush's broken edge,
//          redrawn every beat: on the ground at the torch's hard radius one
//          long loop open at a gap that travels and two dashed loops turning
//          against each other; and rays round the flame, a few of them each
//          beat, never over a rat that stands in front of the flame.
//   eyes   small drawn eyes hang in the fog round the holder, upright to the
//          camera, drifting and bobbing; each on a cycle of its own, the
//          upper lid drawn across, the lower drawn back, the pupil set, held,
//          then the lines taken away stroke by stroke. One candle colour.
//   hatch  the frame boils a pixel or two each beat; the hatching lies where
//          the frame is dark, as the scene's own does, in one of four
//          patterns: strokes laid by hand, cross-hatching, stipple, scribble.
//          The panel's hatching folder keeps its colour, threshold, spacing,
//          angle, width and strength.
//
// The eyes are sprites in the scene, out of the fog's own shading; the light's
// lines are drawn in the post after the depth of field, so they stay sharp;
// the hatching is the post's own, drawn another way.
import { Color, InstancedMesh, Matrix4, MeshBasicNodeMaterial, PlaneGeometry, Vector2, Vector3, type PerspectiveCamera, type Node } from 'three/webgpu'
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js'
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

const TAU = Math.PI * 2

/** What the doodles panel edits. */
export interface DoodleLook {
  light: {
    enabled: boolean
    /** The loop on the ground at the torch's hard radius, and the rays round the flame. */
    ring: boolean
    rays: boolean
    /** How much of a ray is hidden where something covers it, the pumpkin's head or a rat round the flame: 0 none, 1 all of it, as a fire is. */
    raysHidden: number
    color: number
    /** The lines' width, px, and how strongly they draw, 0 to 1. */
    width: number
    strength: number
    /** How fast the loops' gaps travel, 1 as drawn; and whether the two dashed loops are drawn. */
    speed: number
    dashes: boolean
    /** Rays: how many places round the flame, how long a ray is as a share of the flame's height, and what share of the places take a ray each beat. */
    rayCount: number
    rayLength: number
    rayShare: number
  }
  eyes: {
    enabled: boolean
    /** How many are hung round the holder, of the EYES made. */
    count: number
    /** An eye's half-width, m; how high they hang, m; and how far they bob, m. */
    size: number
    height: number
    bob: number
    /**
     * Where they show: this far from the holder, m, at the torch's full reach, over a band this wide, m, fading at
     * both edges. As the torch's reach shrinks the band comes in by as much, as the loop does: the dark closes in.
     */
    distance: number
    depth: number
    color: number
    width: number
    /** How solidly the lines draw, 0 to 1; and how bright: 1 as coloured, more brighter, and past 1 into the bloom's halo. */
    strength: number
    intensity: number
    /** How far an eye wanders round its own place, m: a slow small circle, never toward or away from the holder. */
    wander: number
    /** How far the lines shake each beat, as a share of the eye's size; 0 holds them still. */
    shake: number
    /** The eyes blink about this often while open, s. */
    blink: number
    /**
     * Every eye plays the one script, each from an offset of its own: open and looking about for `openFor` s,
     * shut for `shutFor` s, open with a cross for `crossFor` s, shut for `shutFor` s again, and round again.
     */
    openFor: number
    shutFor: number
    crossFor: number
    /** The cross's size, 1 the eye's half-width, free to pass the lids. */
    crossSize: number
    /** Whether the eyes test the depth: on, a rat in front hides them; off, they draw over everything. */
    depthTest: boolean
    /** How often an eye glances somewhere new, s; and what share of its glances go to the holder. */
    glance: number
    atHolder: number
  }
  hatch: {
    enabled: boolean
    pattern: 'strokes' | 'cross' | 'stipple' | 'scribble'
    /** The hatching's own colour, over the hatching folder's; and its scale, over the spacing and the stroke length. */
    color: number
    scale: number
    /** How many times a second it is drawn again; 0 holds one drawing. */
    speed: number
    /** A stroke's length, px, and what share of the strokes are laid, 0 to 1. */
    dash: number
    kept: number
    /** How far into the fog the hatching goes, 0 none (the scene's own rule) to 1 all the way. */
    inFog: number
    /** The frame's boil, px, each beat; 0 holds it still. */
    boil: number
  }
}

export const defaultDoodleLook = (): DoodleLook => ({
  light: { enabled: true, ring: true, rays: true, raysHidden: 1, color: 0xffc285, width: 1.3, strength: 0.8, speed: 1, dashes: true, rayCount: 9, rayLength: 0.3, rayShare: 0.5 },
  eyes: { enabled: true, count: 100, size: 0.09, height: 0.5, bob: 0.06, distance: 5.5, depth: 4, color: 0xfff0cc, width: 0.7, strength: 0.9, wander: 0.25, shake: 0.06, blink: 4, openFor: 6, shutFor: 2.5, crossFor: 4, crossSize: 0.9, depthTest: true, glance: 2, atHolder: 0.35, intensity: 1 },
  hatch: { enabled: true, pattern: 'strokes', color: 0x0e0516, scale: 1, speed: 12, dash: 46, kept: 0.7, inFog: 0, boil: 1.6 },
})

/** The beat, for the boil, and the time on the beat, s, for the travelling gaps, the cycles and the drift. */
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
  /** The torch on the ground, under its flame, and its hard radius, now and at full strength: the loop is drawn round it. */
  torch: { x: number; z: number; radius: number; full: number }
  /** The holder on the ground: the eyes gather round them. */
  holder: { x: number; z: number }
  flame: Vector3
  flameOn: boolean
}

/** The scene's fog, as main.ts has it: its colour, its near and far, m from its centre on the ground. */
export interface DoodleFog {
  near: N
  far: N
  centre: N
  color: N
}

/** The hatching as the post has it: the pixel, the two directions, how dark the pixel is for each set, the spacing and the width. */
export interface HatchInputs {
  coord: N
  along: N
  across: N
  dark: N
  darker: N
  spacing: N
  width: N
}

export function createDoodles(fog: DoodleFog) {
  const look = defaultDoodleLook()
  const projectionInverse = uniform(new Matrix4())
  const cameraWorld = uniform(new Matrix4())
  /** Where the scene's camera stands: in the post's pass the camera nodes are the quad's, not the scene's. */
  const cameraAt = uniform(new Vector3())
  /** The torch: x, z, and its hard radius, m. */
  const torch = uniform(new Vector3())
  /** The holder: x, z. */
  const holderAt = uniform(new Vector2())
  const flameUV = uniform(new Vector2())
  /** Pixels a metre at the flame's distance; 0 hides the rays. And how far the flame is from the camera along its view, m. */
  const flameScale = uniform(0)
  const flameZ = uniform(0)
  const projected = new Vector3()
  const viewed = new Vector3()

  // The light's uniforms.
  const lightOn = uniform(1)
  const ringOn = uniform(1)
  const raysOn = uniform(1)
  const raysHidden = uniform(1)
  const lightColour = uniform(new Color())
  const lineWidth = uniform(1.3)
  const lightStrength = uniform(0.8)
  const lightSpeed = uniform(1)
  const dashesOn = uniform(1)
  const rayCount = uniform(9)
  const rayLength = uniform(0.3)
  const rayShare = uniform(0.5)
  // The eyes'.
  const eyeCount = uniform(100)
  const eyeSize = uniform(0.09)
  const eyeHeight = uniform(0.5)
  const eyeBob = uniform(0.06)
  const eyeDistance = uniform(5.5)
  const eyeDepth = uniform(4)
  /** How far the eyes' band has come in, m: the torch's hard radius short of its full, 0 at full strength. */
  const eyeShift = uniform(0)
  /** The lattice's cell, m: just past the band's far edge both ways, so a copy never changes in view and the eyes stay dense. */
  const eyeBox = uniform(17)
  const eyeColour = uniform(new Color())
  const eyeWidth = uniform(1.1)
  const eyeStrength = uniform(0.9)
  const eyeIntensity = uniform(1)
  const eyeWander = uniform(0.25)
  const eyeShake = uniform(0.06)
  const eyeBlink = uniform(4)
  /** The script's times, s: open, shut, crossed; and its whole round. */
  const eyeScript = uniform(new Vector3(6, 2.5, 4))
  const eyeRound = uniform(15)
  const eyeCrossSize = uniform(0.9)
  const eyeGlance = uniform(2)
  const eyeAtHolder = uniform(0.35)
  // The hatching's.
  const pattern = uniform(0)
  const hatchScale = uniform(1)
  const hatchColourOwn = uniform(new Color())
  /** The hatching's own beat: its drawing changes at its own rate, not the stop motion's. */
  const hatchSeed = uniform(0)
  const dashLength = uniform(46)
  const kept = uniform(0.7)
  const inFogShare = uniform(0)
  const boil = uniform(1.6)

  // ------------------------------------------------------------------ hatch

  /** The boil: an offset to a screen uv, a couple of pixels, new every beat. */
  const wobble = (at: N, channel: number): Node<'vec2'> => {
    const p = vec3(at.mul(screenSize).div(70), seed.mul(1.7).add(channel * 13.1))
    const px = vec2(noise(p), noise(p.add(vec3(31.4, 17.2, 5.3))))
    return px.mul(boil).div(screenSize)
  }

  /**
   * A hatch line: `u` lines across, `s` px along them. Not ruled lines but short strokes, as a hand lays
   * them: each line cut into dashes, some left out, each dash nudged off the line and bent a little,
   * thinning at its ends; all of it drawn again every beat.
   */
  const strokes = (u: N, s: N, width: N, channel: number): N => {
    const line = u.floor()
    const along = s.div(dashLength.mul(hatchScale)).add(hash(vec2(line, hatchSeed.add(channel))).mul(3))
    const dash = along.floor()
    const id = vec2(line.add(channel * 101), dash.add(hatchSeed.mul(17)))
    const laid = step(hash(id), kept)
    const t = fract(along)
    const shift = hash(id.add(3.3)).sub(0.5).mul(0.5)
    const bend = t.sub(0.5).mul(t.sub(0.5)).mul(hash(id.add(7.7)).sub(0.5)).mul(1.2)
    const v = fract(u.add(shift).add(bend))
    const ends = smoothstep(0, 0.15, t).mul(smoothstep(1, 0.8, t))
    return step(float(1).sub(width.mul(ends)), v).mul(laid)
  }

  /** Stipple: a dot a cell of the spacing, jittered, bigger and more often the darker the frame. */
  const stipple = (coord: N, spacing: N, width: N, dark: N): N => {
    const g = coord.div(spacing)
    const cell = g.floor()
    const jitter = vec2(hash(cell.add(hatchSeed.mul(0.13))), hash(cell.add(vec2(7.1, 3.3)).add(hatchSeed.mul(0.13)))).sub(0.5).mul(0.6)
    const d = length(fract(g).sub(0.5).sub(jitter)).mul(spacing)
    const radius = width.mul(spacing).mul(0.5).mul(dark.mul(0.7).add(0.3))
    const laid = step(hash(cell.add(hatchSeed.mul(0.31)).add(11.7)), dark.mul(kept))
    return ink(d, radius).mul(laid)
  }

  /** Scribble: the lines pushed about by a noise, so they wander and cross as a quick scribble does. */
  const scribble = (u: N, s: N, width: N, channel: number): N => {
    const wander = noise(vec3(s.div(float(90).mul(hatchScale)), u.div(2), hatchSeed.mul(0.5).add(channel * 9))).mul(1.4)
    const v = fract(u.add(wander))
    const breaks = step(hash(vec2(u.floor().add(channel * 31), s.div(dashLength.mul(hatchScale)).floor().add(hatchSeed))), kept)
    return step(float(1).sub(width), v).mul(breaks)
  }

  /** The hatching in the chosen pattern: dark takes the first set, darker the second where the pattern has one. */
  const hatchLines = ({ coord, along, across, dark, darker, spacing: spacing0, width }: HatchInputs): N => {
    const spacing = spacing0.mul(hatchScale)
    const u1 = across.div(spacing)
    const u2 = along.div(spacing)
    const hand = max(strokes(u1, along, width, 0).mul(dark), strokes(u2, across, width, 1).mul(darker))
    const cross = max(strokes(u1, along, width, 0).mul(dark), strokes(u2, across, width, 1).mul(dark.mul(0.8)))
    const dots = stipple(coord, spacing, width, dark)
    const loose = max(scribble(u1, along, width, 0).mul(dark), scribble(u2, across, width, 1).mul(darker))
    const is = (k: number) => step(abs(pattern.sub(k)), 0.5)
    return hand.mul(is(0)).add(cross.mul(is(1))).add(dots.mul(is(2))).add(loose.mul(is(3)))
  }

  // ------------------------------------------------------------------ light

  /**
   * The ground for the light's lines: where the pixel's ray meets the ground
   * plane, worked out from the camera alone, so a line's width is smooth
   * across the frame; the scene's depth says only whether the ground is what
   * the pixel shows. Read from the depth, the width jumped at every edge, a
   * rat's, the ground's, and drew a faint outline there.
   */
  const ground = (depthTexture: N): { xz: N; on: N; viewZ: N } => {
    const far = cameraWorld.mul(vec4(getViewPosition(screenUV, float(1), projectionInverse), 1)).xyz
    const ray = far.sub(cameraAt)
    const xz = cameraAt.add(ray.mul(cameraAt.y.negate().div(min(ray.y, -1e-4)))).xz
    const depth = depthTexture.sample(screenUV).r
    const view = getViewPosition(screenUV, depth, projectionInverse)
    const world = cameraWorld.mul(vec4(view, 1)).xyz
    // The distance along the view from the scene's own projection: the pass's camera nodes are the quad's.
    const viewZ = view.z.negate()
    return { xz, on: step(world.y, 0.04).mul(step(depth, 0.99999)), viewZ }
  }

  /**
   * The loop at the torch's hard radius: one long loop a little off the
   * radius, wobbling on the beat, open over a fifth of its round at a gap
   * that travels; and two dashed loops, inside and out, turning against each
   * other. A dry brush's broken edge over all of it.
   */
  const ring = (xz: N): N => {
    const rel = xz.sub(torch.xy)
    const d = length(rel)
    const dir = rel.div(max(d, 1e-4))
    const metresAPixel = max(fwidth(d), 1e-5)
    const around = atan(dir.y, dir.x).div(TAU).add(0.5)
    const grain = noise(vec3(xz.mul(14), seed.mul(0.3)))
    const dry = smoothstep(-0.7, -0.1, grain).mul(grain.mul(0.25).add(0.9))
    const t = beatTime.mul(lightSpeed)
    let lines: N = float(0)
    {
      const r = torch.z.mul(noise(vec3(dir.mul(1.1), seed.mul(0.9))).mul(0.035).add(0.985))
      const along = fract(around.add(t.mul(0.06)))
      const taper = smoothstep(0.18, 0.3, along).mul(smoothstep(1, 0.92, along))
      const pressure = noise(vec3(dir.mul(3), seed)).mul(0.35).add(1)
      lines = max(lines, ink(abs(d.sub(r)).div(metresAPixel), taper.mul(pressure).mul(lineWidth)))
    }
    for (const [k, off, count, pace] of [
      [1, 1.035, 13, -0.09],
      [2, 0.95, 9, 0.12],
    ] as const) {
      const r = torch.z.mul(noise(vec3(dir.mul(1.4).add(k * 5.1), seed.mul(0.9).add(k))).mul(0.03).add(off))
      const s = fract(around.add(t.mul(pace)).add(k * 0.37).mul(count))
      const dash = smoothstep(0, 0.2, s).mul(smoothstep(0.65, 0.45, s))
      lines = max(lines, ink(abs(d.sub(r)).div(metresAPixel), dash.mul(lineWidth).mul(0.8)).mul(0.85).mul(dashesOn))
    }
    return lines.mul(dry).mul(step(0.01, torch.z)).mul(ringOn)
  }

  /**
   * Rays round the flame: of `rayCount` places round it, a share each beat
   * take a short stroke pointing out, tapering; none straight down along the
   * torch. Where a rat stands in front of the flame, the ray stops at it,
   * unless the panel lets it over.
   */
  const rays = (viewZ: N, unshaded: N): N => {
    const p = screenUV.sub(flameUV).mul(screenSize).mul(vec2(1, -1))
    const sector = atan(p.y, p.x).div(TAU).mul(rayCount).add(0.5).floor()
    const h = hash(vec2(sector, seed))
    const shown = step(h, rayShare)
    const angle = sector.add(h.sub(0.5).mul(0.35)).mul(TAU).div(rayCount)
    const dir = vec2(angle.cos(), angle.sin())
    const r0 = flameScale.mul(hash(vec2(sector.add(7), seed)).mul(0.06).add(0.2))
    const r1 = r0.add(flameScale.mul(rayLength).mul(hash(vec2(sector.add(13), seed)).mul(0.5).add(0.5)))
    const d = segment(p, dir.mul(r0), dir.mul(r1))
    const t = p.dot(dir).sub(r0).div(max(r1.sub(r0), 1e-3)).clamp(0, 1)
    const down = smoothstep(0.75, 0.9, dir.y.negate())
    // What covers a ray: any surface but the flame's own (its embers and smoke are unshaded too) that stands
    // in front of the flame or within a metre behind it, the pumpkin's head and the rats round it; the ground
    // and the rats far behind the flame leave it be.
    const covered = step(viewZ, flameZ.add(1)).mul(unshaded.oneMinus())
    const behind = float(1).sub(covered.mul(raysHidden))
    return ink(d, lineWidth.mul(1.4).mul(float(1).sub(t.mul(0.6)))).mul(shown).mul(down.oneMinus()).mul(step(1, flameScale)).mul(behind).mul(raysOn)
  }

  /** The light's lines over the finished frame. */
  const overlay = (c: N, depthTexture: N, unshaded: N): N => {
    const { xz, on, viewZ } = ground(depthTexture)
    const marks = max(ring(xz).mul(on), rays(viewZ, unshaded)).mul(lightStrength).mul(lightOn)
    return vec4(mix(c.rgb, lightColour, marks), 1)
  }

  // ------------------------------------------------------------------- eyes

  /**
   * The eyes: sprites hung in the fog round the holder, upright to the
   * camera, each a quad its own, placed by its index in a square round the
   * holder that wraps as the holder walks, drifting and bobbing; shown over a
   * band past the torch's hard radius, faded at both edges, never within
   * reach of the camera. Each plays a cycle of its own: the upper lid drawn
   * across, the lower back, the pupil set, held, then the lines taken away.
   * One colour, the quad cut to the drawing, and the depth tested, as the
   * flame is: a rat, the head or a wall in front hides the eye behind it.
   */
  const EYES = 480
  let eyesMesh: InstancedMesh | undefined
  const eyes = (): InstancedMesh => {
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: true })
    material.fog = false
    // The scene pass's other targets take no blending, so the quad is cut to the drawing: there it is out
    // of the shading, the AO passing over it; through the rest the rats keep their own.
    material.alphaTest = 0.3
    // Past an intensity of 1, the eye's colour goes to the glow the bloom reads, so it wears the halo the rats' eyes do.
    material.mrtNode = mrt({ output, unshaded: vec4(1), normal: vec4(0), glow: vec4(eyeColour.mul(max(eyeIntensity.sub(1), 0)), 1) })
    const index = float(instanceIndex)
    const keyed = (i: N) => (k: number) => hash(vec2(i.mul(0.618).add(k * 1.37), k * 2.71 + 0.5))
    const h = keyed(index)
    // Fixed in the world: a lattice of places, BOX m a side, each eye's own; the copy nearest the holder is the
    // one shown, and the band it shows in lies inside the lattice's cell, so a copy never changes in view. An
    // eye wanders a slow small circle round its place, and bobs; the holder's walk and the torch's reach move
    // nothing of it: it fades in as the holder nears, and out as the holder goes.
    const BOX = eyeBox
    const place = vec2(h(1), h(2)).mul(BOX)
    const turn: N = beatTime.mul(h(10).mul(0.6).add(0.4)).mul(h(11).sub(0.5).sign()).add(h(12).mul(TAU))
    const wander: N = (vec2(turn.cos(), turn.sin()) as N).mul(eyeWander)
    const rel = fract(place.add(wander).sub(holderAt).div(BOX)).sub(0.5).mul(BOX)
    const bob = beatTime.mul(h(8).mul(0.8).add(0.6)).add(h(9).mul(TAU)).sin().mul(eyeBob)
    const height: N = eyeHeight.mul(h(3).mul(0.8).add(0.6)).add(bob)
    const centre = vec3(holderAt.x.add(rel.x), height, holderAt.y.add(rel.y))
    const out = length(rel)
    // The band's middle, in by as much as the torch's reach is short, never nearer than its own half-width and a little.
    const band = max(eyeDistance.add(eyeShift), eyeDepth.mul(0.5).add(0.5))
    const near = band.sub(eyeDepth.mul(0.5))
    const far = band.add(eyeDepth.mul(0.5))
    const shown = smoothstep(near, near.add(1), out)
      .mul(smoothstep(far, far.sub(1), out))
      .mul(smoothstep(3.8, 5, length(centre.sub(cameraPosition))))
      .mul(step(index, eyeCount))
    // The script, each eye from an offset of its own: open and looking, shut, open crossed, shut, and round again.
    const at = fract(beatTime.div(eyeRound).add(h(6))).mul(eyeRound)
    const openEnd = eyeScript.x
    const shutEnd = openEnd.add(eyeScript.y)
    const crossEnd = shutEnd.add(eyeScript.z)
    const lidTime = 0.25
    // The lids: open over the open and the crossed stretches, closing and opening over lidTime at each change.
    const opening = (start: N, end: N) => smoothstep(start, start.add(lidTime), at).mul(smoothstep(end, end.sub(lidTime), at))
    const stretchOpen = max(opening(float(0), openEnd), opening(shutEnd, crossEnd))
    const crossed = smoothstep(shutEnd.sub(lidTime), shutEnd, at).mul(smoothstep(crossEnd.add(lidTime), crossEnd, at))
    // A blink now and then while open, on a clock of its own.
    const clock = beatTime.div(eyeBlink.mul(h(5).mul(0.6).add(0.7))).add(h(6))
    const blinkAt = fract(clock)
    const blink = smoothstep(0, 0.04, blinkAt).mul(smoothstep(0.1, 0.06, blinkAt))
    const openness = stretchOpen.mul(float(1).sub(blink))
    const halfWidth = eyeSize.mul(h(4).mul(0.6).add(0.7))
    const view = cameraViewMatrix.mul(vec4(centre, 1))
    // Where the eye looks: about, in glances. Every so often, on a clock of its own, it picks a new place to
    // look, somewhere at random, now and then the holder; it swings there in a quick saccade and holds.
    const holder = cameraViewMatrix.mul(vec4(holderAt.x, 0.8, holderAt.y, 1))
    const toHolder = holder.xy.sub(view.xy)
    const atHolder = toHolder.div(max(length(toHolder), 1e-3))
    const glanceClock = beatTime.div(eyeGlance.mul(h(16).mul(0.6).add(0.7))).add(h(17))
    const glance = glanceClock.floor()
    const aim = (g: N): N => {
      const r = hash(vec2(g.mul(0.37).add(index.mul(0.013)), 2.3))
      const a = hash(vec2(g.mul(0.71).add(index.mul(0.017)), 5.9)).mul(TAU)
      const about: N = (vec2(a.cos(), a.sin()) as N).mul(r.mul(0.7).add(0.3))
      return mix(about, atHolder, step(hash(vec2(g.mul(0.53).add(index.mul(0.011)), 8.1)), eyeAtHolder))
    }
    const swing = smoothstep(0, 0.12, fract(glanceClock))
    const look: N = mix(aim(glance.sub(1)), aim(glance), swing)
    material.vertexNode = cameraProjectionMatrix.mul(
      vec4(view.xyz.add(vec3((positionLocal.xy as N).mul(halfWidth.mul(2.6)).mul(step(0.001, shown)), 0)), 1),
    )
    const id = varying(index)
    const shownHere = varying(shown)
    const opennessHere = varying(openness)
    const crossedHere = varying(crossed)
    const lookHere: N = varying(look)
    const f = keyed(id)

    // The pupil's kind, as the script has it now: a dot, or a cross.
    const crossPupil = crossedHere
    // Not turned: upright, and the lines shaken each beat by a noise of their own, a hand that does not hold still.
    const flat: N = uv().mul(2).sub(1).mul(1.3)
    const shake = vec2(noise(vec3(flat.mul(1.1), seed.add(f(12).mul(50)))), noise(vec3(flat.mul(1.1).add(4.1), seed.add(f(12).mul(50))))).mul(eyeShake.mul(4))
    const q: N = flat.add(shake)
    const topOpen = f(13).mul(0.2).add(0.38)
    const bottom = topOpen.mul(0.7)
    // The upper lid comes down with the openness, meeting the lower one shut.
    const top: N = mix(bottom.negate().mul(0.92), topOpen, opennessHere)
    // Almond lids, each drawn twice a little apart, as a quick hand does.
    const curve = (y0: N, k: number) => {
      const y = y0.mul(1 + (k - 0.5) * 0.14)
      const x = q.x.add((k - 0.5) * 0.06)
      return abs(q.y.sub(y.mul(float(1).sub(x.mul(x)))))
        .div(float(1).add(y.mul(2).mul(x).pow(2)).sqrt())
        .add(step(1.1, abs(x)).mul(1e3))
    }
    const unitsAPixel = max(length(fwidth(q)), 1e-5)
    const upper = min(curve(top, 0), curve(top, 1)).div(unitsAPixel)
    const lower = min(curve(bottom.negate(), 0), curve(bottom.negate(), 1)).div(unitsAPixel)
    // Inside the lids, the pupil toward the holder: a dot, or a small cross; it goes as the lids close over it.
    const span = float(1).sub(q.x.mul(q.x)).max(0)
    const inside = step(abs(q.x), 1).mul(step(q.y.negate(), bottom.mul(span))).mul(step(q.y, top.mul(span)))
    const pupilAt = lookHere.mul(vec2(0.3, topOpen.mul(0.35)))
    const fromPupil = q.sub(pupilAt)
    const dot = step(length(fromPupil.mul(vec2(1, 1.3))), 0.27)
    // The cross is not clipped to the lids: it may pass them, as a scribbled-out eye does; it goes with the lids all the same.
    const arm = vec2(eyeCrossSize)
    const crossLines = min(segment(fromPupil, arm.negate(), arm), segment(fromPupil, arm.mul(vec2(-1, 1)), arm.mul(vec2(1, -1))))
    const crossMark = ink(crossLines.div(unitsAPixel), eyeWidth.mul(1.1)).mul(smoothstep(0.1, 0.4, opennessHere))
    const pupil = mix(dot.mul(inside), crossMark, crossPupil)
    // Shut, a few lashes down off the lid.
    let lashes: N = float(1e3)
    for (const x of [-0.6, -0.2, 0.2, 0.6]) {
      const y = bottom.negate().mul(1 - x * x)
      lashes = min(lashes, segment(q, vec2(x, y), vec2(x * 1.15, y.sub(0.22))))
    }
    const shutLashes = ink(lashes.div(unitsAPixel), eyeWidth.mul(0.8)).mul(smoothstep(0.2, 0.05, opennessHere))
    const line = max(max(ink(upper, eyeWidth), ink(lower, eyeWidth)), max(pupil, shutLashes))
    // Deeper in the fog, dimmer, toward its colour: the eye is in the fog, not in front of it.
    const sunk = varying(smoothstep(near, far, out))
    material.colorNode = mix(eyeColour, fog.color, sunk.mul(0.5)).mul(eyeIntensity)
    material.opacityNode = line.mul(shownHere).mul(eyeStrength)
    const mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, EYES)
    mesh.frustumCulled = false
    mesh.renderOrder = 1000
    eyesMesh = mesh
    return mesh
  }

  /** Take the panel's values. */
  function set(): void {
    const { light, eyes: e, hatch } = look
    lightOn.value = light.enabled ? 1 : 0
    ringOn.value = light.ring ? 1 : 0
    raysOn.value = light.rays ? 1 : 0
    raysHidden.value = light.raysHidden
    lightColour.value.set(light.color)
    lineWidth.value = light.width
    lightStrength.value = light.strength
    lightSpeed.value = light.speed
    dashesOn.value = light.dashes ? 1 : 0
    rayCount.value = Math.max(3, Math.round(light.rayCount))
    rayLength.value = light.rayLength
    rayShare.value = light.rayShare
    if (eyesMesh) {
      eyesMesh.visible = e.enabled
      const material = eyesMesh.material as MeshBasicNodeMaterial
      if (material.depthTest !== e.depthTest) {
        material.depthTest = e.depthTest
        material.needsUpdate = true
      }
    }
    eyeCount.value = e.count
    eyeSize.value = e.size
    eyeHeight.value = e.height
    eyeBob.value = e.bob
    eyeDistance.value = e.distance
    eyeDepth.value = Math.max(0.5, e.depth)
    eyeBox.value = 2 * (e.distance + eyeDepth.value / 2) + 2
    eyeColour.value.set(e.color)
    eyeWidth.value = e.width
    eyeStrength.value = e.strength
    eyeIntensity.value = e.intensity
    eyeWander.value = e.wander
    eyeShake.value = e.shake
    eyeBlink.value = Math.max(0.5, e.blink)
    eyeScript.value.set(Math.max(0.5, e.openFor), Math.max(0.5, e.shutFor), Math.max(0.5, e.crossFor))
    eyeRound.value = eyeScript.value.x + 2 * eyeScript.value.y + eyeScript.value.z
    eyeCrossSize.value = e.crossSize
    eyeGlance.value = Math.max(0.3, e.glance)
    eyeAtHolder.value = e.atHolder
    pattern.value = ['strokes', 'cross', 'stipple', 'scribble'].indexOf(hatch.pattern)
    hatchScale.value = Math.max(0.2, hatch.scale)
    hatchColourOwn.value.set(hatch.color)
    dashLength.value = Math.max(4, hatch.dash)
    kept.value = hatch.kept
    inFogShare.value = hatch.inFog
    boil.value = hatch.boil
  }
  set()

  function update({ camera, beat, fps, torch: t, holder: at, flame, flameOn }: DoodleFrame) {
    seed.value = beat % 997
    beatTime.value = beat / fps
    // The hatching's own beat: at its speed a second, from the beat's time; 0 holds the first drawing.
    hatchSeed.value = look.hatch.speed > 0 ? Math.floor((beat / fps) * look.hatch.speed) % 997 : 0
    projectionInverse.value.copy(camera.projectionMatrixInverse)
    cameraWorld.value.copy(camera.matrixWorld)
    cameraAt.value.setFromMatrixPosition(camera.matrixWorld)
    torch.value.set(t.x, t.z, t.radius)
    eyeShift.value = t.radius - t.full
    holderAt.value.set(at.x, at.z)
    projected.copy(flame).project(camera)
    flameUV.value.set(projected.x * 0.5 + 0.5, 0.5 - projected.y * 0.5)
    const focal = innerHeight / 2 / Math.tan((camera.fov * Math.PI) / 360)
    flameScale.value = flameOn && projected.z < 1 ? focal / flame.distanceTo(camera.position) : 0
    flameZ.value = -viewed.copy(flame).applyMatrix4(camera.matrixWorldInverse).z
  }

  return { look, wobble, hatchLines, hatchColour: hatchColourOwn, inFogShare, overlay, eyes, set, update }
}

export type Doodles = ReturnType<typeof createDoodles>

/**
 * The doodles' panel, at the left under the readouts, on the same lil-gui as
 * the game's: a folder a piece. `hatchChanged` after the hatch's switch, for
 * the page to set the post again; the rest is uniforms, taken by `set`.
 */
export function mountDoodleControls(doodles: Doodles, hatchChanged: () => void): void {
  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;top:36px;left:8px;z-index:1000'
  document.body.append(container)
  const gui = new GUI({ title: 'doodles', container, width: 280 } as ConstructorParameters<typeof GUI>[0])
  const { light, eyes, hatch } = doodles.look
  const changed = () => doodles.set()

  const l = gui.addFolder('light')
  l.add(light, 'enabled').name('on').onChange(changed)
  l.add(light, 'ring').name('loop on the ground').onChange(changed)
  l.add(light, 'dashes').name('dashed loops').onChange(changed)
  l.add(light, 'speed', 0, 4, 0.1).name('loops turn').onChange(changed)
  l.add(light, 'rays').name('rays round the flame').onChange(changed)
  l.add(light, 'raysHidden', 0, 1, 0.05).name('rays hidden where covered').onChange(changed)
  l.add(light, 'rayCount', 3, 24, 1).name('ray places').onChange(changed)
  l.add(light, 'rayLength', 0.05, 1, 0.01).name('ray length').onChange(changed)
  l.add(light, 'rayShare', 0, 1, 0.05).name('rays a beat').onChange(changed)
  l.addColor(light, 'color').name('colour').onChange(changed)
  l.add(light, 'width', 0, 4, 0.05).name('line width px').onChange(changed)
  l.add(light, 'strength', 0, 1, 0.05).onChange(changed)

  const e = gui.addFolder('eyes')
  e.add(eyes, 'enabled').name('on').onChange(changed)
  e.add(eyes, 'count', 0, 480, 1).onChange(changed)
  e.add(eyes, 'size', 0.03, 0.4, 0.005).name('half-width m').onChange(changed)
  e.add(eyes, 'height', 0, 2.5, 0.05).name('height m').onChange(changed)
  e.add(eyes, 'bob', 0, 0.3, 0.01).name('bob m').onChange(changed)
  e.add(eyes, 'distance', 1, 15, 0.1).name('distance m').onChange(changed)
  e.add(eyes, 'depth', 0.5, 10, 0.1).name('band m').onChange(changed)
  e.add(eyes, 'wander', 0, 1, 0.01).name('wander m').onChange(changed)
  e.add(eyes, 'shake', 0, 0.3, 0.005).name('shake').onChange(changed)
  e.add(eyes, 'blink', 0.5, 12, 0.1).name('blink every s').onChange(changed)
  e.add(eyes, 'openFor', 0.5, 20, 0.5).name('open for s').onChange(changed)
  e.add(eyes, 'shutFor', 0.5, 20, 0.5).name('shut for s').onChange(changed)
  e.add(eyes, 'crossFor', 0.5, 20, 0.5).name('crossed for s').onChange(changed)
  e.add(eyes, 'crossSize', 0.2, 2.5, 0.05).name('cross size').onChange(changed)
  e.add(eyes, 'depthTest').name('depth test').onChange(changed)
  e.add(eyes, 'glance', 0.3, 10, 0.1).name('glances every s').onChange(changed)
  e.add(eyes, 'atHolder', 0, 1, 0.05).name('glances at the holder').onChange(changed)
  e.addColor(eyes, 'color').name('colour').onChange(changed)
  e.add(eyes, 'width', 0, 4, 0.05).name('line width px').onChange(changed)
  e.add(eyes, 'strength', 0, 1, 0.05).onChange(changed)
  e.add(eyes, 'intensity', 0, 8, 0.05).onChange(changed)

  const h = gui.addFolder('hatch')
  h.add(hatch, 'enabled').name('on').onChange(hatchChanged)
  h.add(hatch, 'pattern', ['strokes', 'cross', 'stipple', 'scribble']).onChange(changed)
  h.addColor(hatch, 'color').name('colour').onChange(changed)
  h.add(hatch, 'scale', 0.2, 4, 0.05).onChange(changed)
  h.add(hatch, 'speed', 0, 30, 1).name('redrawn a second').onChange(changed)
  h.add(hatch, 'dash', 8, 160, 1).name('stroke length px').onChange(changed)
  h.add(hatch, 'kept', 0, 1, 0.05).name('strokes laid').onChange(changed)
  h.add(hatch, 'inFog', 0, 1, 0.05).name('into the fog').onChange(changed)
  h.add(hatch, 'boil', 0, 6, 0.1).name('frame boil px').onChange(changed)
  const note = document.createElement('div')
  note.textContent = 'threshold, spacing, angle, width, strength: the hatching folder at the right'
  note.style.cssText = 'padding:4px 8px;font-size:11px;opacity:0.7'
  h.$children.append(note)
}
