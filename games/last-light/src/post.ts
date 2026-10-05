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
// its four neighbours a few pixels off, read from the same pre-pass, and faded
// by the fog like the AO. The hatching lays screen-space lines where the
// frame is dark, crossed where it is darker, and not in the fog. The palette
// quantizes the colour, in a gamma space so its steps look even, to a few
// levels a channel. Paper multiplies a fibrous noise in; grain adds a fine
// noise over everything, new every frame or only on the stop motion's beat;
// the vignette closes the corners toward the fog's colour.
//
// Depth, normals and `f` come from a pre-pass of the frame's own, drawn
// without multisampling, because the AO gathers depth texels and WGSL has no
// gather over a multisampled depth; the scene pass keeps its antialiasing. So
// the scene is drawn twice while the AO or the outlines are on; with both off,
// the pre-pass is not in the graph and is not drawn. `show` puts on screen
// what the AO takes from the frame, white where it takes nothing.
import { Color, RenderPipeline, Vector2, type Camera, type Node, type Scene, type WebGPURenderer } from 'three/webgpu'
import {
  abs,
  cameraFar,
  cameraNear,
  emissive,
  float,
  fract,
  max,
  mix,
  mrt,
  mx_noise_float,
  normalView,
  output,
  pass,
  perspectiveDepthToViewZ,
  pow,
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
import { dof } from 'three/examples/jsm/tsl/display/DepthOfFieldNode.js'
import { afterImage } from 'three/examples/jsm/tsl/display/AfterImageNode.js'

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
}

/** What the eye trails folder edits: an afterimage of what glows, the emission alone, fed back frame to frame. */
export interface TrailLook {
  enabled: boolean
  /** How much of the last frame's trail survives into this one, 0 to 1: longer nearer 1. */
  length: number
  /** How bright the trail is added, 0 none. */
  strength: number
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
  trails: TrailLook
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

export function createPost(renderer: WebGPURenderer, scene: Scene, camera: Camera, fog: FogNodes): Post {
  const pipeline = new RenderPipeline(renderer)
  // The pre-pass: the normal in rgb, which is all the AO reads of it, and the fog amount in alpha.
  const prePass = pass(scene, camera, { samples: 0 })
  const fogAmount = fog.amount as unknown as Node<'float'>
  prePass.setMRT(mrt({ output: vec4(normalView, fogAmount) }))
  const depthTexture = prePass.getTextureNode('depth')
  const normalTexture = prePass.getTextureNode()
  const aoPass = ao(depthTexture, normalTexture, camera)
  // The scene pass writes its colour and, beside it, what glows, under the fog as the colour is: the trails read that alone.
  const scenePass = pass(scene, camera)
  scenePass.setMRT(mrt({ output, emissive: emissive.mul(fogAmount.oneMinus()) }))
  const colour = scenePass.getTextureNode('output')
  const fogged = normalTexture.a
  const fogColour = fog.color as unknown as Node<'vec3'>

  // The ambient occlusion, as a factor a channel: open is white, occluded the tint, by the strength.
  const aoStrength = uniform(1)
  const aoTint = uniform(new Color(0x000000))
  const occlusion = mix(aoTint, vec3(1), mix(float(1), aoPass.getTextureNode().r, aoStrength))
  const shaded = mix(vec4(fogColour.mul(fogged), 1), colour, vec4(occlusion, 1))

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
  const edge = max(step(depthThreshold, depthBreak), step(normalThreshold, normalBreak)).mul(fogged.oneMinus()).mul(outlineOn)
  const lined = mix(shaded, vec4(outlineColour, 1), edge)

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

  // The depth of field: the lined frame blurred by its distance from the focus, read off the pre-pass; the ink and grain stay sharp over it.
  const focus = uniform(4)
  const focal = uniform(3)
  const bokeh = uniform(2)
  const focused = dof(lined, prePass.getViewZNode(), focus, focal, bokeh)

  // The trails: the glow's afterimage, fading by `trailLength` a frame, added over the frame.
  const trailLength = uniform(0.9)
  const trailStrength = uniform(1)
  const trail = afterImage(scenePass.getTextureNode('emissive'), trailLength) as unknown as Node<'vec4'>
  const withTrails = (c: Node<'vec4'>) => vec4(c.rgb.add(trail.rgb.mul(trailStrength)), 1)

  // The outputs, with and without the trails; swapping one in rebuilds the pipeline, so only a change does.
  const sharp = focused as unknown as Node<'vec4'>
  const outputs = {
    // Neither the AO nor the outlines: the pre-pass is not in the graph and is not drawn, and nothing knows the fog.
    light: finish(colour, float(0)),
    full: finish(lined, fogged),
    deep: finish(sharp, fogged),
    lightTrails: finish(withTrails(colour), float(0)),
    fullTrails: finish(withTrails(lined), fogged),
    deepTrails: finish(withTrails(sharp), fogged),
    ao: vec4(mix(vec3(1), occlusion, fogged.oneMinus()), 1),
  }
  let current: keyof typeof outputs | undefined
  const choose = (which: keyof typeof outputs) => {
    if (which === current) return
    current = which
    pipeline.outputNode = outputs[which]
    pipeline.needsUpdate = true
  }
  choose('full')

  return {
    render() {
      pipeline.render()
    },
    set(look) {
      const base = look.dof.enabled ? 'deep' : look.ao.enabled || look.outline.enabled ? 'full' : 'light'
      choose(look.ao.show ? 'ao' : look.trails.enabled ? `${base}Trails` : base)
      trailLength.value = Math.min(0.995, Math.max(0, look.trails.length))
      trailStrength.value = look.trails.strength
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
