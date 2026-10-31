// The frame after the scene: ambient occlusion, inked outlines, hatching in
// the shade, a posterized palette, paper and grain, and a vignette, each on
// its own switch and controls, in that order.
//
// The ambient occlusion is three's ground-truth AO, multiplied into the
// scene's colour under its fog, so the creases between bodies and the contact
// with the ground darken where the scene is seen, and not the fog in front of
// it. The scene pass writes `lit * (1 - f) + fogColour * f` for a fog amount
// `f`; what the AO should darken is `lit` alone, and
// `mix(fogColour * f, scene, ao)` is exactly `lit * ao * (1 - f) + fogColour * f`,
// so the AO goes under the fog with `f` known a pixel. Occluded darkens toward
// a colour, black for shadow, else a tint in the creases.
//
// The outlines are a line where depth or the normal breaks between a pixel and
// its four neighbours a few pixels off, read from the same depth and normals, and faded
// by the fog like the AO. The hatching lays screen-space lines where the
// frame is dark, crossed where it is darker, and not in the fog. The palette
// quantizes the colour, in a gamma space so its steps look even, to a few
// levels a channel. Paper multiplies a fibrous noise in; grain adds a fine
// noise over everything, new every frame or only on the stop motion's beat;
// the vignette closes the corners toward the fog's colour; and the whole
// frame, the ink laid over it too, is saturated or washed out last.
//
// The scene is drawn once (ADR-0050), and beside its colour writes the
// normal and `f` a pixel, over a depth the AO, the outlines and the depth of
// field read. It is drawn without multisampling, because the AO gathers depth
// texels and WGSL has no gather over a multisampled depth; FXAA smooths its
// edges after the shading and the ink, before the blur, the hatching and the
// grain. `show` puts on screen what the AO takes from the frame, white where
// it takes nothing.
import { Color, NodeMaterial, QuadMesh, RenderPipeline, RenderTarget, Vector2, type Camera, type Node, type Scene, type WebGPURenderer } from 'three/webgpu'
import {
  abs,
  cameraFar,
  cameraNear,
  convertToTexture,
  rtt,
  emissive,
  float,
  Fn,
  fract,
  If,
  Loop,
  max,
  mix,
  mrt,
  mx_noise_float,
  normalView,
  output,
  pass,
  perspectiveDepthToViewZ,
  pow,
  saturation,
  screenCoordinate,
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
import { ao } from 'three/examples/jsm/tsl/display/GTAONode.js'
import { fxaa } from 'three/examples/jsm/tsl/display/FXAANode.js'
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js'
import { TILT_TAPS, type TiltShift } from './tiltshift'

/** The depth of field's taps a pixel, and the turn between one and the next. */
const TAPS = 16
/** The cheap halo's taps (`BloomLook.cheap`). */
const HALO_TAPS = 12
/** How far the cheap halo reaches at a radius of 1, a share of the frame's height. */
const HALO_REACH = 0.1
/** The cheap halo's copy of the glow, a share of the frame's size each way. */
const HALO_RESOLUTION = 0.25
const GOLDEN_ANGLE = 2.39996323

/** What the ambient occlusion folder edits. */
export interface AOLook {
  enabled: boolean
  /** The AO alone on screen, white open and black occluded. */
  show: boolean
  /** How much of it darkens the frame, 0 none, 1 all of it. */
  strength: number
  /** What the occluded darken toward: black for shadow, a colour for a tint in the creases. */
  color: number
  /** How far an occluder reaches, m. */
  radius: number
  /** How thick a surface is taken to be behind its depth, m: higher occludes more. */
  thickness: number
  /** How the occlusion falls with distance from the point: 1 linear, higher nearer. */
  distanceExponent: number
  distanceFallOff: number
  /** Samples a pixel: 16 is three's default. */
  samples: number
  /** The AO's resolution as a share of the frame's: cheaper under 1, softer. */
  resolution: number
}

/** On to start, at three's own values, at half the frame's resolution. */
export const defaultAO = (): AOLook => ({
  enabled: true,
  show: false,
  strength: 1,
  color: 0x000000,
  radius: 0.25,
  thickness: 1,
  distanceExponent: 1,
  distanceFallOff: 1,
  samples: 16,
  resolution: 0.5,
})

/** What the outlines folder edits. */
export interface OutlineLook {
  enabled: boolean
  color: number
  /** How far off a pixel its neighbours are read, px: about the line's width. */
  thickness: number
  /** How much nearer or further a neighbour must be, as a share of the distance, to draw a line. */
  depth: number
  /** How far a neighbour's normal must turn, 0 to 1 as one minus the cosine, to draw a line. */
  normal: number
}

/** What the palette folder edits. */
export interface PaletteLook {
  enabled: boolean
  /** Steps a channel is quantized to, above black. */
  levels: number
}

/** What the hatching folder edits. */
export interface HatchLook {
  enabled: boolean
  color: number
  /** Lines appear where the frame's luminance falls under this, 0 to 1. */
  below: number
  /** A second set of lines across the first, where the luminance falls under half of `below`. */
  cross: boolean
  /** Pixels from one line to the next. */
  spacing: number
  /** The lines' direction, degrees from horizontal. */
  angle: number
  /** How much of the spacing a line fills, 0 to 1. */
  width: number
  /** How dark a line draws, 0 none, 1 the colour outright. */
  strength: number
}

/** What the grain and paper folder edits. */
export interface GrainLook {
  grain: boolean
  /** How far the grain moves a pixel, as a share of its brightness. */
  grainStrength: number
  /** A grain's size, px. */
  grainSize: number
  /** Whether the grain changes only on the stop motion's beat, else `grainSpeed` times a second. */
  grainOnBeat: boolean
  /** How many times a second the grain changes, when not on the beat; 0 holds it still. */
  grainSpeed: number
  paper: boolean
  /** How much the paper's fibres show, 0 none. */
  paperStrength: number
  /** A fibre's size, px. */
  paperScale: number
}

/** What the depth of field folder edits. */
export interface DofLook {
  enabled: boolean
  /** Whether the focus follows the light, else `focus` stands. */
  onLight: boolean
  /** The distance in focus, m, and how far from it a point goes fully soft, m. */
  focus: number
  focal: number
  /** How big the blur gets, unitless. */
  bokeh: number
  /** How far a bright point spreads into a lit disc in the blur, 0 to 1: 0 an even average, 1 a full max filter. */
  glow: number
}

/** What the bloom folder edits: a halo round what glows, the eyes (see `createPost`). */
export interface BloomLook {
  enabled: boolean
  /** How bright the halo is, 0 none. */
  strength: number
  /** How wide it spreads, 0 to 1. */
  radius: number
  /** The halo's resolution as a share of the frame's: cheaper under 1, softer. Three's bloom only. */
  resolution: number
  /**
   * The cheap halo in place of three's bloom: the glow gathered over a disc in the frame's last pass, HALO_TAPS taps,
   * no passes of its own; and the tilt's blur spreading bright points into lit discs by `blurGlow`, as the depth of
   * field's glow does.
   */
  cheap: boolean
  /** With the cheap halo, how far a bright point spreads in the tilt's blur, 0 to 1, as the depth of field's `glow`. */
  blurGlow: number
}

/** What the vignette folder edits. */
export interface VignetteLook {
  enabled: boolean
  /** How dark the corners go toward the fog's colour, 0 none, 1 all the way. */
  strength: number
  /** Where it starts from the centre, as a share of the half-diagonal, and where it is full. */
  inner: number
  outer: number
  /** Toward a colour of its own instead of the fog's, and that colour. */
  own: boolean
  colour: number
}

/** What the screen folder edits: the finished frame's saturation, 0 grey, 1 as drawn, over 1 richer. */
export interface ScreenLook {
  saturation: number
}

export interface PostLook {
  ao: AOLook
  outline: OutlineLook
  hatch: HatchLook
  palette: PaletteLook
  grain: GrainLook
  vignette: VignetteLook
  /** None, and the frame as drawn. */
  screen?: ScreenLook
  dof: DofLook
  bloom: BloomLook
}

export interface Post {
  /** Draw the frame: the scene, and the effects over it that are on. */
  render(): void
  /**
   * Build the scene pass's pipelines for what `scene` draws as it stands now, many at once and off the frame (three
   * r187's compileAsync, in the pass's own target and outputs), `onProgress` told each one built. The scene is read at
   * the call, so what was shown for it can be hidden again as soon as this returns. No shadow pass is among them.
   */
  compileScene(onProgress: (built: number, of: number) => void): Promise<void>
  /** Take the folders' values. */
  set(look: PostLook): void
  /** The grain's and the paper's seeds for this frame: a new number moves the one it is for. */
  seed(grain: number, paper: number): void
  /** The distance in focus this frame, m, when the depth of field follows the light. */
  focusAt(distance: number): void
  /** How much of the screen folder's saturation the frame keeps this frame, 0 grey to 1 all of it: the goose's life. */
  colour(share: number): void
  /**
   * Her death's dark over the frame this frame, `share` 0 none to 1 all of it black, as `look` has it: a swirled
   * noise round (x, y) on the screen, 0 to 1 from its top left, where she is; turning and churning with `time`, s.
   */
  dark(share: number, x: number, y: number, time: number, look: DarkLook): void
  /** A bite's edge over the frame this frame, `share` 0 none to 1 its edges all `colour`, closing in from the corners. */
  hurt(share: number, colour: number): void
}

/**
 * What the dark folder edits, her death's dark (after the swirled wipe in Mike Fernandez's portfolio showcase): a
 * progress to see it at, 0 to 1, or -1 to play it only as she dies; how long it waits as he dies before it starts
 * closing, s, his death played in the open first; how long it takes to go black then, s; its
 * Perlin noise's scale, and how much longer it is across the screen than up it (stretch), for streaks; how far
 * it swirls round her, radians at her, falling off over `swirlRadius` screen heights from her; how fast it turns,
 * radians a second, and how fast the noise changes (churn); how soft the black's edge is, a share of the noise;
 * and how much sooner it comes in far from her than near (radial), 0 alike everywhere.
 */
export interface DarkLook {
  progress: number
  after: number
  finish: number
  scale: number
  stretch: number
  twist: number
  swirlRadius: number
  spin: number
  churn: number
  edge: number
  radial: number
}

/** Her death's dark as set from the panel on 2026-10-30: a still, hard-edged swirl closing in on her from the screen's edges, black in a second. */
export const defaultDark = (): DarkLook => ({
  progress: -1,
  after: 0,
  finish: 1,
  scale: 5,
  stretch: 4,
  twist: 4,
  swirlRadius: 0.35,
  spin: 0,
  churn: 0,
  edge: 0.01,
  radial: 0.63,
})

/** The scene's fog, as the effects need it: its colour, and how much of it is in front of a point, 0 to 1. */
export interface FogNodes {
  color: Node
  amount: Node
}

/**
 * Mark `material` as taking no occlusion and no outline: the torch's flame,
 * its embers and its smoke, which are light and not surfaces. The scene pass
 * carries the mark beside its colour, and the shading passes over it; and
 * they add nothing to the normals (see `leaveOutOfShading`).
 */
export function leaveUnshaded(material: NodeMaterial): void {
  material.mrtNode = mrt({ output, unshaded: vec4(1), normal: vec4(0), glow: vec4(0) })
}

/**
 * Mark `material` as unshaded, as `leaveUnshaded` does, and glowing `glow`:
 * the lightning's bolt and sparks, light the bloom haloes as it does the eyes.
 */
export function leaveGlowing(material: NodeMaterial, glow: Node<'vec3'>): void {
  material.mrtNode = mrt({ output, unshaded: vec4(1), normal: vec4(0), glow: vec4(glow, 1) })
}

/**
 * Mark `material` as glowing nothing the bloom reads, whatever its emission:
 * the dead trees' leaves, which show their own colour as light, but are not
 * lights to halo.
 */
export function leaveOutOfBloom(material: NodeMaterial): void {
  material.mrtNode = mrt({ output, glow: vec4(0) })
}

/**
 * Mark `material` as adding nothing to the normals and the fog amount the
 * shading reads: the eyes' trails, light laid over the ground. Drawn
 * additively, a trail would otherwise add its own normal to the one beneath,
 * and the AO and the outlines would read a surface that is not there.
 */
export function leaveOutOfShading(material: NodeMaterial): void {
  material.mrtNode = mrt({ output, normal: vec4(0), glow: vec4(0) })
}

/**
 * The frame's effects over `scene` as `camera` sees it.
 */
export function createPost(renderer: WebGPURenderer, scene: Scene, camera: Camera, fog: FogNodes, tilt?: TiltShift): Post {
  // The scene, drawn once and unsampled: its colour, the unshaded mark (`leaveUnshaded`), nowhere unless a
  // material says so, the normal in rgb, which is all the AO reads of it, with the fog amount in alpha, and
  // what glows: a material's emission, the eyes' (shell.ts), as far as the fog lets it through, which is all
  // the bloom reads, so the halo is the eyes' and no other bright pixel's.
  const scenePass = pass(scene, camera, { samples: 0 })
  const fogAmount = fog.amount as unknown as Node<'float'>
  scenePass.setMRT(mrt({ output, unshaded: vec4(0), normal: vec4(normalView, fogAmount), glow: vec4(emissive.mul(fogAmount.oneMinus()), 1) }))
  const depthTexture = scenePass.getTextureNode('depth')
  const normalTexture = scenePass.getTextureNode('normal')
  const aoPass = ao(depthTexture, normalTexture, camera)
  const colour = scenePass.getTextureNode()
  // The scene drawn first each frame, by one pixel that reads it, before any output can. three keys the scene's shaders
  // by how deep in a render the scene pass is drawn, and the depth of field reads the frame through a
  // texture of its own, a render deeper: drawn first by whichever output came first, the scene's every material was
  // built and compiled again for each, three times over at the start (2026-10-26). Drawn here, at one depth, once.
  const pullMaterial = new NodeMaterial()
  pullMaterial.fragmentNode = vec4(colour.sample(vec2(0.5)).rgb, 1)
  const pull = new QuadMesh(pullMaterial)
  const pulled = new RenderTarget(1, 1, { depthBuffer: false })
  const unshaded = scenePass.getTextureNode('unshaded').r
  const fogged = normalTexture.a
  const fogColour = fog.color as unknown as Node<'vec3'>

  // The ambient occlusion, as a factor a channel: open is white, occluded the tint, by the strength.
  const aoStrength = uniform(1)
  const aoTint = uniform(new Color(0x000000))
  const occlusion = mix(mix(aoTint, vec3(1), mix(float(1), aoPass.getTextureNode().r, aoStrength)), vec3(1), unshaded)
  const shadeOf = (c: Node<'vec4'>) => mix(vec4(fogColour.mul(fogged), 1), c, vec4(occlusion, 1))

  // The outlines: the pixel against its four neighbours `thickness` px off, in distance and in normal.
  const outlineOn = uniform(1)
  const outlineColour = uniform(new Color(0x000000))
  const thickness = uniform(1.5)
  const depthThreshold = uniform(0.05)
  const normalThreshold = uniform(0.6)
  const distanceAt = (offset: Node<'vec2'>) =>
    perspectiveDepthToViewZ(depthTexture.sample(screenUV.add(offset)).r, cameraNear, cameraFar).negate()
  const normalAt = (offset: Node<'vec2'>) => normalTexture.sample(screenUV.add(offset)).xyz
  const px = thickness.div(screenSize)
  const here = distanceAt(vec2(0))
  const facing = normalAt(vec2(0))
  let depthBreak: Node<'float'> = float(0)
  let normalBreak: Node<'float'> = float(0)
  for (const [x, y] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const offset = px.mul(vec2(x, y))
    depthBreak = max(depthBreak, abs(distanceAt(offset).sub(here)).div(here))
    normalBreak = max(normalBreak, float(1).sub(normalAt(offset).dot(facing)))
  }
  const edge = max(step(depthThreshold, depthBreak), step(normalThreshold, normalBreak)).mul(fogged.oneMinus()).mul(unshaded.oneMinus()).mul(outlineOn)
  const lined = mix(shadeOf(colour as unknown as Node<'vec4'>), vec4(outlineColour, 1), edge)
  // The edges smoothed after the shading and the ink, before the blur, the hatching and the grain.
  const smooth = fxaa(lined) as unknown as Node<'vec4'>

  const coord = screenUV.mul(screenSize)

  // The hatching: lines across the screen where the frame is dark, a second set across them where it is darker.
  const hatchOn = uniform(1)
  const hatchColour = uniform(new Color(0x000000))
  const hatchBelow = uniform(0.2)
  const hatchCross = uniform(1)
  const hatchSpacing = uniform(6)
  const hatchDirection = uniform(new Vector2(1, 1).normalize())
  const hatchWidth = uniform(0.4)
  const hatchStrength = uniform(0.8)
  const hatch = (c: Node<'vec4'>, inFog: Node<'float'>) => {
    const luminance = c.rgb.dot(vec3(0.2126, 0.7152, 0.0722))
    const dark = smoothstep(hatchBelow, hatchBelow.mul(0.5), luminance)
    const darker = smoothstep(hatchBelow.mul(0.5), hatchBelow.mul(0.25), luminance).mul(hatchCross)
    const along = coord.x.mul(hatchDirection.x).add(coord.y.mul(hatchDirection.y))
    const across = coord.x.mul(hatchDirection.y).sub(coord.y.mul(hatchDirection.x))
    const line = (t: Node<'float'>) => step(float(1).sub(hatchWidth), fract(t.div(hatchSpacing)))
    const lines = max(line(along).mul(dark), line(across).mul(darker))
    return mix(c, vec4(hatchColour, 1), lines.mul(hatchStrength).mul(inFog.oneMinus()).mul(hatchOn))
  }

  // The palette: the colour quantized in a gamma space, where equal steps look equal.
  const paletteOn = uniform(1)
  const levels = uniform(8)
  const posterize = (c: Node<'vec4'>) => {
    const gamma = pow(c.rgb.max(0), 1 / 2.2)
    const stepped = gamma.mul(levels).add(0.5).floor().div(levels)
    return vec4(mix(c.rgb, pow(stepped, 2.2), paletteOn), 1)
  }

  // Paper and grain: a fibrous noise multiplied in, and a hash of the pixel and the seed added over everything.
  const paperOn = uniform(1)
  const paperStrength = uniform(0.3)
  const paperScale = uniform(3)
  const grainOn = uniform(1)
  const grainStrength = uniform(0.08)
  const grainSize = uniform(1)
  const grainSeed = uniform(0)
  const paperSeed = uniform(0)
  const texture = (c: Node<'vec4'>) => {
    const fibres = mx_noise_float(vec3(coord.div(paperScale), paperSeed.mul(7.31))).mul(0.5).add(0.5)
    const paper = mix(float(1), fibres.mul(0.5).add(0.75), paperStrength.mul(paperOn))
    const cell = coord.div(grainSize).floor().add(grainSeed)
    const hash = fract(sin(cell.dot(vec2(12.9898, 78.233))).mul(43758.5453)).sub(0.5)
    const grain = float(1).add(hash.mul(grainStrength).mul(grainOn))
    return vec4(c.rgb.mul(paper).mul(grain), 1)
  }

  // The vignette: the corners toward the fog's colour, or its own, by distance from the centre over the half-diagonal.
  const vignetteOn = uniform(1)
  const vignetteOwn = uniform(0)
  const vignetteColour = uniform(new Color(0x000000))
  const vignetteStrength = uniform(0.6)
  const vignetteInner = uniform(0.5)
  const vignetteOuter = uniform(1.1)
  // A bite's edge (`hurt`): over the vignette, its own colour closing in from the corners, as far as its share.
  const hurtShare = uniform(0)
  const hurtColour = uniform(new Color(0x000000))
  const vignette = (c: Node<'vec4'>) => {
    const fromCentre = screenUV.sub(0.5).mul(2).length().div(Math.SQRT2)
    const dark = smoothstep(vignetteInner, vignetteOuter, fromCentre).mul(vignetteStrength).mul(vignetteOn)
    const hurt = smoothstep(float(1).sub(hurtShare.mul(0.75)), 1.15, fromCentre).mul(hurtShare.min(1))
    return vec4(mix(mix(c.rgb, mix(fogColour, vignetteColour, vignetteOwn), dark), hurtColour, hurt), 1)
  }

  // The bloom: the glow blurred down a chain of mips, three's, added over the palette so its halo keeps its
  // gradient, and under the paper and the grain so it is printed with the rest.
  const bloomPass = bloom(scenePass.getTextureNode('glow'), 1, 0.5, 0)
  const bloomed = (c: Node<'vec4'>) => vec4(c.rgb.add(bloomPass.rgb), 1)
  // The cheap halo in its place (`BloomLook.cheap`): the glow gathered in this pass over a disc, HALO_TAPS taps on a
  // golden-angle spiral turned a pixel's own way, as the depth of field's, the nearer taps counting more, so the halo
  // fades out from the eye; a grain in it where three's mips are smooth. Gathered off a copy of the glow at
  // HALO_RESOLUTION, one pass of its own: off the whole frame's, the taps' scattered reads cost the GPU three times
  // three's bloom (2026-10-30). Each texel of the copy the mean of the four filtered reads round it, so a small eye
  // between its texels is kept.
  const fullGlow = scenePass.getTextureNode('glow')
  const glowTexture = rtt(
    Fn(() => {
      const px = vec2(1).div(vec2(fullGlow.size(float(0)) as unknown as Node<'ivec2'>))
      const sum = vec4(0).toVar()
      for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) sum.addAssign(fullGlow.sample(screenUV.add(px.mul(vec2(x, y)))))
      return sum.mul(0.25)
    })(),
    null,
    null,
    { resolutionScale: HALO_RESOLUTION },
  )
  const haloStrength = uniform(1)
  const haloReach = uniform(0.5 * HALO_REACH)
  const haloed = (c: Node<'vec4'>) =>
    Fn(() => {
      const spin = fract(sin(screenCoordinate.xy.dot(vec2(12.9898, 78.233))).mul(43758.5453)).mul(Math.PI * 2)
      const reach = vec2(haloReach.mul(screenSize.y).div(screenSize.x), haloReach)
      const sum = vec3(0).toVar()
      Loop(HALO_TAPS, ({ i }) => {
        const k = float(i)
        const angle = k.mul(GOLDEN_ANGLE).add(spin)
        const along = k.add(0.5).div(HALO_TAPS).sqrt()
        const tap = glowTexture.sample(screenUV.add(vec2(angle.cos(), angle.sin()).mul(along).mul(reach)))
        sum.addAssign(tap.rgb.mul(along.oneMinus()))
      })
      // The weights' mean, a third: the sum over it, so the strength reads alike at any count of taps.
      return vec4(c.rgb.add(sum.mul(3 / HALO_TAPS).mul(haloStrength)), 1)
    })() as unknown as Node<'vec4'>

  // The screen's saturation over the whole of it, the lines too.
  const screenSaturation = uniform(1)
  const colourShare = uniform(1)
  // The tilt's toy grade after it, with `?tilt`.
  const saturated = (c: Node<'vec4'>) => {
    const rich = saturation(c.rgb, screenSaturation.mul(colourShare)) as unknown as Node<'vec3'>
    return vec4(tilt ? tilt.grade(rich) : rich, 1)
  }
  // Her death's dark, last, over the whole frame (`dark`): black where a Perlin noise rises over a level that falls
  // with the share, so it comes in as a wipe of blots and streaks; the noise read in a frame swirled round her,
  // most at her and falling off away from her, turning with time, and stretched across the screen, so its blots
  // pull out into streaks that curl round her. Nothing while it is none, the branch the same for every pixel.
  const darkShare = uniform(0)
  const darkAt = uniform(new Vector2(0.5, 0.5))
  const darkTime = uniform(0)
  const darkScale = uniform(2.5)
  const darkStretch = uniform(4)
  const darkTwist = uniform(4)
  const darkSwirl = uniform(0.35)
  const darkSpin = uniform(1.5)
  const darkChurn = uniform(0.4)
  const darkEdge = uniform(0.01)
  const darkRadial = uniform(0.3)
  const darkened = (c: Node<'vec4'>) =>
    Fn(() => {
      const out = c.rgb.toVar()
      If(darkShare.greaterThan(0), () => {
        const aspect = screenSize.x.div(screenSize.y)
        const off = screenUV.sub(darkAt).mul(vec2(aspect, 1)).toVar()
        const r = off.length().toVar()
        const turn = darkTwist.mul(r.div(darkSwirl.max(1e-3)).negate().exp()).add(darkTime.mul(darkSpin)).toVar()
        const swirled = vec2(off.x.mul(turn.cos()).sub(off.y.mul(turn.sin())), off.x.mul(turn.sin()).add(off.y.mul(turn.cos())))
        const at = swirled.mul(vec2(darkScale.div(darkStretch.max(0.1)), darkScale))
        // Two octaves, the finer for the splatter and the thin streaks between the blots.
        const z = darkTime.mul(darkChurn)
        const noise = mx_noise_float(vec3(at, z)).add(mx_noise_float(vec3(at.mul(2.3), z.mul(1.3).add(5.1))).mul(0.35)).mul(0.4).add(0.5)
        // Far from her it rises sooner, by the radial; the level falls from over the noise's highest to under its
        // lowest, which keep near 0.2 and 0.8, rising past the first blots soon after it starts.
        const level = mix(darkRadial.mul(1.2).add(0.74), float(0.18), darkShare)
        const covered = smoothstep(level.sub(darkEdge), level.add(darkEdge.max(1e-4)), noise.add(r.mul(darkRadial)))
        out.assign(out.mul(covered.oneMinus()))
      })
      return vec4(out, 1)
    })() as unknown as Node<'vec4'>
  const finish = (c: Node<'vec4'>, inFog: Node<'float'>, halo: 'none' | 'bloom' | 'cheap') => {
    const printed = posterize(hatch(c, inFog))
    return darkened(saturated(vignette(texture(halo === 'bloom' ? bloomed(printed) : halo === 'cheap' ? haloed(printed) : printed))))
  }

  // The depth of field: the lined frame blurred by its distance from the focus, read off the scene's depth; the
  // ink and the grain stay sharp over it. One pass, after the cheap one in Bruno Simon's folio-2025, where
  // three's draws eight: the frame gathered over a disc as wide as its point is out of focus, by three's
  // circle of confusion and as far as three's blur reached, twice the bokeh in pixels. TAPS taps on a
  // golden-angle spiral, turned a pixel's own way, so the pattern reads as grain rather than rings.
  const focus = uniform(4)
  const focal = uniform(3)
  const bokeh = uniform(2)
  const glow = uniform(0)
  const frame = convertToTexture(smooth)
  const taps = tilt ? TILT_TAPS : TAPS
  const softened = Fn(() => {
    const deep = smoothstep(0, focal, scenePass.getViewZNode().negate().sub(focus).abs())
    // With `?tilt` (tiltshift.ts), the band's blur in place of the depth's while the tilt is on.
    const coc = tilt ? mix(deep, tilt.coc, tilt.on) : deep
    const reach = tilt ? mix(bokeh.mul(2), tilt.blur, tilt.on) : bokeh.mul(2)
    const radius = coc.mul(reach).div(screenSize)
    const spin = fract(sin(screenCoordinate.xy.dot(vec2(12.9898, 78.233))).mul(43758.5453)).mul(Math.PI * 2)
    const sum = vec4(0).toVar()
    const brightest = vec4(0).toVar()
    Loop(taps, ({ i }) => {
      const k = float(i)
      const angle = k.mul(GOLDEN_ANGLE).add(spin)
      const along = k.add(0.5).div(taps).sqrt()
      const tap = frame.sample(screenUV.add(vec2(angle.cos(), angle.sin()).mul(along).mul(radius)))
      sum.addAssign(tap)
      brightest.assign(max(brightest, tap))
    })
    // The glow, as three's depth of field gave it in its widening pass: the brightest tap over the disc, by the glow, where it is
    // brighter than the average, so a bright point spreads into a lit disc as a lens's highlights do rather
    // than dimming into its dark neighbours. The eyes and their trails glow so; 0 is the average alone.
    return max(sum.div(taps), brightest.mul(glow))
  })() as unknown as Node<'vec4'>

  // The outputs, each a pipeline of its own, built once and kept. Swapping the output of a single pipeline
  // rebuilt it at every change of the quality's step, a frame of 100 to 200 ms each time (2026-10-09). The
  // first frames draw every output but the AO's view once, which halves the first change to each; what is
  // left of it is for whatever the first frames did not draw yet, the rats among them.
  const lightest = fxaa(colour) as unknown as Node<'vec4'>
  const outputs = {
    // Neither the AO nor the outlines: nothing reads the normals, and nothing knows the fog.
    light: finish(lightest, float(0), 'none'),
    full: finish(smooth, fogged, 'none'),
    deep: finish(softened, fogged, 'none'),
    // The same three with the bloom's halo: its passes run only in these.
    'light bloom': finish(lightest, float(0), 'bloom'),
    'full bloom': finish(smooth, fogged, 'bloom'),
    'deep bloom': finish(softened, fogged, 'bloom'),
    // And with the cheap halo, in the last pass.
    'light cheap': finish(lightest, float(0), 'cheap'),
    'full cheap': finish(smooth, fogged, 'cheap'),
    'deep cheap': finish(softened, fogged, 'cheap'),
    ao: vec4(mix(vec3(1), occlusion, fogged.oneMinus()), 1),
  }
  const pipelines = new Map<keyof typeof outputs, RenderPipeline>()
  const pipelineFor = (which: keyof typeof outputs) => {
    let built = pipelines.get(which)
    if (built === undefined) {
      built = new RenderPipeline(renderer, outputs[which])
      pipelines.set(which, built)
    }
    return built
  }
  let pipeline = pipelineFor('full')
  // The three outputs the look can move between, with or without the bloom as the look is first set.
  let unwarmed: (keyof typeof outputs)[] | undefined
  let halo: '' | ' bloom' | ' cheap' = ''

  return {
    compileScene(onProgress) {
      // The target and outputs the pass draws the scene into, as its own compileAsync sets them, which tells no progress.
      const target = renderer.getRenderTarget()
      const outputsWere = renderer.getMRT()
      const size = renderer.getDrawingBufferSize(new Vector2())
      scenePass.renderTarget.samples = 0
      scenePass.setSize(size.width, size.height)
      renderer.setRenderTarget(scenePass.renderTarget)
      renderer.setMRT(scenePass.getMRT())
      const built = renderer.compileAsync(scene, camera, null, (event) => onProgress(event.loaded, event.total))
      renderer.setRenderTarget(target)
      renderer.setMRT(outputsWere)
      // And again once it is done: three r187 puts back what it found at the call after each step of it, ours, and
      // left so the post's own quads would be drawn into the scene's targets, built for them, and fail.
      return built.finally(() => {
        renderer.setRenderTarget(target)
        renderer.setMRT(outputsWere)
      })
    },
    render() {
      // The scene pass first, then one output a frame warmed, its own passes built; the one chosen is drawn over it.
      unwarmed ??= [`light${halo}`, `full${halo}`, `deep${halo}`]
      const target = renderer.getRenderTarget()
      renderer.setRenderTarget(pulled)
      pull.render(renderer)
      renderer.setRenderTarget(target)
      const warming = unwarmed.shift()
      if (warming !== undefined) pipelineFor(warming).render()
      pipeline.render()
    },
    set(look) {
      halo = !look.bloom.enabled ? '' : look.bloom.cheap ? ' cheap' : ' bloom'
      const base = look.dof.enabled ? 'deep' : look.ao.enabled || look.outline.enabled ? 'full' : 'light'
      pipeline = pipelineFor(look.ao.show ? 'ao' : `${base}${halo}`)
      haloStrength.value = look.bloom.strength
      haloReach.value = look.bloom.radius * HALO_REACH
      bloomPass.strength.value = look.bloom.strength
      bloomPass.radius.value = look.bloom.radius
      bloomPass.setResolutionScale(Math.max(0.05, look.bloom.resolution))
      aoStrength.value = look.ao.enabled ? look.ao.strength : 0
      aoTint.value.set(look.ao.color)
      aoPass.radius.value = look.ao.radius
      aoPass.thickness.value = look.ao.thickness
      aoPass.distanceExponent.value = look.ao.distanceExponent
      aoPass.distanceFallOff.value = look.ao.distanceFallOff
      aoPass.samples.value = look.ao.samples
      aoPass.resolutionScale = look.ao.resolution
      outlineOn.value = look.outline.enabled ? 1 : 0
      outlineColour.value.set(look.outline.color)
      thickness.value = look.outline.thickness
      depthThreshold.value = look.outline.depth
      normalThreshold.value = look.outline.normal
      paletteOn.value = look.palette.enabled ? 1 : 0
      levels.value = Math.max(1, Math.round(look.palette.levels))
      hatchOn.value = look.hatch.enabled ? 1 : 0
      hatchColour.value.set(look.hatch.color)
      hatchBelow.value = look.hatch.below
      hatchCross.value = look.hatch.cross ? 1 : 0
      hatchSpacing.value = Math.max(1, look.hatch.spacing)
      const angle = (look.hatch.angle * Math.PI) / 180
      hatchDirection.value.set(Math.cos(angle), Math.sin(angle))
      hatchWidth.value = look.hatch.width
      hatchStrength.value = look.hatch.strength
      paperOn.value = look.grain.paper ? 1 : 0
      paperStrength.value = look.grain.paperStrength
      paperScale.value = Math.max(0.5, look.grain.paperScale)
      grainOn.value = look.grain.grain ? 1 : 0
      grainStrength.value = look.grain.grainStrength
      grainSize.value = Math.max(1, look.grain.grainSize)
      vignetteOn.value = look.vignette.enabled ? 1 : 0
      vignetteStrength.value = look.vignette.strength
      vignetteInner.value = look.vignette.inner
      vignetteOuter.value = Math.max(look.vignette.outer, look.vignette.inner + 0.01)
      vignetteOwn.value = look.vignette.own ? 1 : 0
      vignetteColour.value.set(look.vignette.colour)
      screenSaturation.value = look.screen?.saturation ?? 1
      if (!look.dof.onLight) focus.value = look.dof.focus
      focal.value = Math.max(0.05, look.dof.focal)
      bokeh.value = look.dof.bokeh
      glow.value = look.dof.glow
    },
    focusAt(distance) {
      focus.value = distance
    },
    colour(share) {
      colourShare.value = Math.min(1, Math.max(0, share))
    },
    dark(share, x, y, time, look) {
      darkShare.value = Math.min(1, Math.max(0, share))
      darkAt.value.set(x, y)
      darkTime.value = time
      darkScale.value = look.scale
      darkStretch.value = look.stretch
      darkTwist.value = look.twist
      darkSwirl.value = look.swirlRadius
      darkSpin.value = look.spin
      darkChurn.value = look.churn
      darkEdge.value = look.edge
      darkRadial.value = look.radial
    },
    hurt(share, colour) {
      hurtShare.value = Math.min(1, Math.max(0, share))
      hurtColour.value.set(colour)
    },
    seed(grain, paper) {
      grainSeed.value = grain
      paperSeed.value = paper
    },
  }
}
