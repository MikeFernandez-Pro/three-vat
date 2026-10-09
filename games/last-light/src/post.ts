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
// the vignette closes the corners toward the fog's colour.
//
// The scene is drawn once (ADR-0050), and beside its colour writes the
// normal and `f` a pixel, over a depth the AO, the outlines and the depth of
// field read. It is drawn without multisampling, because the AO gathers depth
// texels and WGSL has no gather over a multisampled depth; FXAA smooths its
// edges after the shading and the ink, before the blur, the hatching and the
// grain. `show` puts on screen what the AO takes from the frame, white where
// it takes nothing.
import { Color, RenderPipeline, Vector2, type Camera, type Node, type NodeMaterial, type Scene, type WebGPURenderer } from 'three/webgpu'
import {
  abs,
  cameraFar,
  cameraNear,
  convertToTexture,
  float,
  Fn,
  fract,
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

/** The depth of field's taps a pixel, and the turn between one and the next. */
const TAPS = 16
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

/** What the vignette folder edits. */
export interface VignetteLook {
  enabled: boolean
  /** How dark the corners go toward the fog's colour, 0 none, 1 all the way. */
  strength: number
  /** Where it starts from the centre, as a share of the half-diagonal, and where it is full. */
  inner: number
  outer: number
}

export interface PostLook {
  ao: AOLook
  outline: OutlineLook
  hatch: HatchLook
  palette: PaletteLook
  grain: GrainLook
  vignette: VignetteLook
  dof: DofLook
}

export interface Post {
  /** Draw the frame: the scene, and the effects over it that are on. */
  render(): void
  /** Take the folders' values. */
  set(look: PostLook): void
  /** The grain's and the paper's seeds for this frame: a new number moves the one it is for. */
  seed(grain: number, paper: number): void
  /** The distance in focus this frame, m, when the depth of field follows the light. */
  focusAt(distance: number): void
}

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
  material.mrtNode = mrt({ output, unshaded: vec4(1), normal: vec4(0) })
}

/**
 * Mark `material` as adding nothing to the normals and the fog amount the
 * shading reads: the eyes' trails, light laid over the ground. Drawn
 * additively, a trail would otherwise add its own normal to the one beneath,
 * and the AO and the outlines would read a surface that is not there.
 */
export function leaveOutOfShading(material: NodeMaterial): void {
  material.mrtNode = mrt({ output, normal: vec4(0) })
}

/**
 * The frame's effects over `scene` as `camera` sees it.
 */
export function createPost(renderer: WebGPURenderer, scene: Scene, camera: Camera, fog: FogNodes): Post {
  // The scene, drawn once and unsampled: its colour, the unshaded mark (`leaveUnshaded`), nowhere unless a
  // material says so, and the normal in rgb, which is all the AO reads of it, with the fog amount in alpha.
  const scenePass = pass(scene, camera, { samples: 0 })
  const fogAmount = fog.amount as unknown as Node<'float'>
  scenePass.setMRT(mrt({ output, unshaded: vec4(0), normal: vec4(normalView, fogAmount) }))
  const depthTexture = scenePass.getTextureNode('depth')
  const normalTexture = scenePass.getTextureNode('normal')
  const aoPass = ao(depthTexture, normalTexture, camera)
  const colour = scenePass.getTextureNode()
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
  const lined = mix(shadeOf(colour), vec4(outlineColour, 1), edge)
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

  // The vignette: the corners toward the fog's colour, by distance from the centre over the half-diagonal.
  const vignetteOn = uniform(1)
  const vignetteStrength = uniform(0.6)
  const vignetteInner = uniform(0.5)
  const vignetteOuter = uniform(1.1)
  const vignette = (c: Node<'vec4'>) => {
    const fromCentre = screenUV.sub(0.5).mul(2).length().div(Math.SQRT2)
    const dark = smoothstep(vignetteInner, vignetteOuter, fromCentre).mul(vignetteStrength).mul(vignetteOn)
    return vec4(mix(c.rgb, fogColour, dark), 1)
  }

  const finish = (c: Node<'vec4'>, inFog: Node<'float'>) => vignette(texture(posterize(hatch(c, inFog))))

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
  const softened = Fn(() => {
    const coc = smoothstep(0, focal, scenePass.getViewZNode().negate().sub(focus).abs())
    const radius = coc.mul(bokeh).mul(2).div(screenSize)
    const spin = fract(sin(screenCoordinate.xy.dot(vec2(12.9898, 78.233))).mul(43758.5453)).mul(Math.PI * 2)
    const sum = vec4(0).toVar()
    const brightest = vec4(0).toVar()
    Loop(TAPS, ({ i }) => {
      const k = float(i)
      const angle = k.mul(GOLDEN_ANGLE).add(spin)
      const along = k.add(0.5).div(TAPS).sqrt()
      const tap = frame.sample(screenUV.add(vec2(angle.cos(), angle.sin()).mul(along).mul(radius)))
      sum.addAssign(tap)
      brightest.assign(max(brightest, tap))
    })
    // The glow, as three's depth of field gave it in its widening pass: the brightest tap over the disc, by the glow, where it is
    // brighter than the average, so a bright point spreads into a lit disc as a lens's highlights do rather
    // than dimming into its dark neighbours. The eyes and their trails glow so; 0 is the average alone.
    return max(sum.div(TAPS), brightest.mul(glow))
  })() as unknown as Node<'vec4'>

  // The outputs, each a pipeline of its own, built once and kept. Swapping the output of a single pipeline
  // rebuilt it at every change of the quality's step, a frame of 100 to 200 ms each time (2026-10-09). The
  // first frames draw every output but the AO's view once, which halves the first change to each; what is
  // left of it is for whatever the first frames did not draw yet, the rats among them.
  const outputs = {
    // Neither the AO nor the outlines: nothing reads the normals, and nothing knows the fog.
    light: finish(fxaa(colour) as unknown as Node<'vec4'>, float(0)),
    full: finish(smooth, fogged),
    deep: finish(softened, fogged),
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
  const unwarmed: (keyof typeof outputs)[] = ['light', 'full', 'deep']

  return {
    render() {
      // One output a frame: the scene pass draws once a frame, for the first pipeline to read it, and the
      // scene's materials are built for each pipeline apart. The one chosen is drawn over it.
      const warming = unwarmed.shift()
      if (warming !== undefined) pipelineFor(warming).render()
      pipeline.render()
    },
    set(look) {
      pipeline = pipelineFor(look.ao.show ? 'ao' : look.dof.enabled ? 'deep' : look.ao.enabled || look.outline.enabled ? 'full' : 'light')
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
      if (!look.dof.onLight) focus.value = look.dof.focus
      focal.value = Math.max(0.05, look.dof.focal)
      bokeh.value = look.dof.bokeh
      glow.value = look.dof.glow
    },
    focusAt(distance) {
      focus.value = distance
    },
    seed(grain, paper) {
      grainSeed.value = grain
      paperSeed.value = paper
    },
  }
}
