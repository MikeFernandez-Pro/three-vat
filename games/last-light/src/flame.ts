// The flame at the light, painted and in the round: a teardrop of a mesh
// whose surface licks with a cellular noise rising on a clock the page gives,
// so the stop motion can hold the flame on its beat like the rats; and, drawn
// on that surface, flat colour bands laid in the view plane round the flame's
// heart, their edges wobbled by the brush's strokes the rats and the floor are
// painted with, blended a little at the boundaries, inked round the outside.
// So the silhouette is three-dimensional from any angle, and the paint on it
// is the paint everything else wears. A glow sprite sits behind it, additive,
// the halo a painted flame has. The cellular noise is three's own texture,
// from its TSL flames example.
//
// The body is opaque with an alpha test, so it takes and gives depth against
// the rats; the glow is transparent. Both are on a layer of their own that
// the frame's pre-pass leaves out: an occlusion or an outline on a flame
// would be wrong.
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  RepeatWrapping,
  Sprite,
  SpriteNodeMaterial,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  type Node,
} from 'three/webgpu'
import {
  atan,
  float,
  Fn,
  mix,
  modelViewMatrix,
  normalLocal,
  positionLocal,
  positionView,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { createStrokes } from './strokes'

/** The layer the flame draws on, and the pre-pass leaves out. */
export const FLAME_LAYER = 1

/** What the flame folder edits. */
export interface FlameLook {
  enabled: boolean
  /** The body's height and width, m, and how far off the ground it stands. */
  height: number
  width: number
  lift: number
  /** The body's colours, from its outside in to its heart; `bands` of them are used, evenly along. */
  colors: [number, number, number, number, number]
  /** Flat bands from the edge to the heart. */
  bands: number
  /** How far one band blends into the next, 0 a hard step, 1 all the way. */
  softness: number
  /** How far the body sways, how big its noise's cells are, how far the surface licks out, m. */
  sway: number
  cells: number
  licks: number
  /** How far the brush's strokes push the band edges about, and how many strokes across the body. */
  brush: number
  brushScale: number
  /** An ink line round the outside: on or off, how wide as a share of the shape, its colour. */
  outline: boolean
  outlineWidth: number
  outlineColor: number
  /** The glow behind: how bright, 0 none, and how wide as a multiple of the body. */
  glow: number
  glowSize: number
}

/** A painted flame, a metre high, off the ground: three bands of the lamp's orange to a pale heart, brushed, inked, with a glow. */
export const defaultFlame = (): FlameLook => ({
  enabled: true,
  height: 1,
  width: 0.5,
  lift: 0.55,
  colors: [0xd9440f, 0xf07a14, 0xffb02e, 0xffd960, 0xfff3b8],
  bands: 3,
  softness: 0.15,
  sway: 0.08,
  cells: 1.5,
  licks: 0.08,
  brush: 0.12,
  brushScale: 2,
  outline: true,
  outlineWidth: 0.06,
  outlineColor: 0x3a0f05,
  glow: 0.5,
  glowSize: 2.2,
})

export interface Flame {
  /** What the scene adds; move it to the light. */
  readonly object: Group
  /** Take the flame folder's values. */
  set(look: FlameLook): void
}

/** A float uniform, as `uniform(0)` makes it: the page's clock for the flame. */
type Clock = ReturnType<typeof uniform<'float'>>

/** Where the heart of the flame sits up its height, 0 the root, 1 the tip: the bands are round it. */
const HEART = 0.35

/** The body's profile, a teardrop a unit high and half a unit wide, round at the foot and drawn to a point. */
function teardrop(): LatheGeometry {
  const points: Vector2[] = []
  const steps = 32
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    // Full at a third of the height, a point at the top, a little open at the foot.
    const radius = 0.5 * Math.sin(Math.PI * Math.pow(t, 0.75)) * (1 - 0.15 * t)
    points.push(new Vector2(i === steps ? 0 : Math.max(radius, 0.02), t))
  }
  return new LatheGeometry(points, 32)
}

export async function createFlame(clock: Clock): Promise<Flame> {
  const cellular = await new TextureLoader().loadAsync('./textures/noise-cellular.png')
  cellular.wrapS = cellular.wrapT = RepeatWrapping
  const strokes = createStrokes()

  // The gradient, outside in, drawn into a strip the shader reads by band.
  const strip = document.createElement('canvas')
  strip.width = 128
  strip.height = 1
  const context = strip.getContext('2d')!
  const gradient = new CanvasTexture(strip)
  gradient.colorSpace = SRGBColorSpace
  const paint = (colors: number[]) => {
    const fill = context.createLinearGradient(0, 0, strip.width, 0)
    colors.forEach((color, i) => fill.addColorStop(i / (colors.length - 1), `#${color.toString(16).padStart(6, '0')}`))
    context.fillStyle = fill
    context.fillRect(0, 0, strip.width, strip.height)
    gradient.needsUpdate = true
  }

  const bands = uniform(3)
  const softness = uniform(0.15)
  const sway = uniform(0.08)
  const cells = uniform(1.5)
  const licks = uniform(0.08)
  const brush = uniform(0.12)
  const brushScale = uniform(2)
  const outlineWidth = uniform(0)
  const outlineColor = uniform(new Color(0x000000))
  /** The body's size, m: width and height, so the shader works in metres whatever the mesh's scale. */
  const size = uniform(new Vector2(0.5, 1))
  const glowColor = uniform(new Color(0xd9440f))
  const glowStrength = uniform(0.5)

  /**
   * The shape: 1 at the heart, 0 a body's width or two thirds of its height
   * away, in the view plane, less where the brush's strokes dig in. Read on
   * the body's surface, so the bands are concentric to the eye and the
   * silhouette is the mesh's.
   */
  const shape = Fn(() => {
    const heart = modelViewMatrix.mul(vec4(0, HEART, 0, 1)).xyz
    const off = positionView.sub(heart)
    const at = vec2(off.x.div(size.x.mul(0.5)), off.y.div(size.y.mul(0.65)))
    const strokeUv = at.mul(brushScale).mul(0.25).add(vec2(0, clock.negate().mul(0.1)))
    return float(1).sub(at.length()).add(texture(strokes.texture, strokeUv).r.sub(0.5).mul(brush))
  })

  // The body.
  const body = new MeshBasicNodeMaterial()
  body.alphaTest = 0.5
  // The surface licks: pushed out along its normal by the noise, read round the axis and up the height, rising; and sways toward the tip.
  body.positionNode = Fn(() => {
    const p = positionLocal.toVar()
    const around = atan(p.z, p.x).div(Math.PI * 2)
    const noise = texture(cellular, vec2(around.mul(2), p.y.mul(cells).sub(clock.mul(0.6)))).r
    const lick = noise.sub(0.5).mul(licks).mul(p.y.smoothstep(0, 0.4)).div(size.x)
    const lean = sin(clock.mul(6).sub(p.y.mul(8))).mul(sway).mul(p.y.mul(p.y)).div(size.x)
    return p.add(normalLocal.mul(lick)).add(vec3(lean, 0, 0))
  })()
  body.colorNode = Fn(() => {
    const s = shape().toVar()
    // The bands, outside in, each the gradient's colour at its middle, blended a little at the boundary.
    const scaled = s.clamp(0, 0.999).mul(bands)
    const band = scaled.floor()
    const colourAt = (b: Node<'float'>) => texture(gradient, vec2(b.add(0.5).div(bands), 0)).rgb
    const blend = smoothstep(float(1).sub(softness.mul(0.5)), float(1), scaled.fract())
    const color = mix(colourAt(band), colourAt(band.add(1).min(bands.sub(1))), blend).toVar()
    // The ink: the outermost sliver of the shape, when asked for.
    color.assign(mix(color, outlineColor, step(s, outlineWidth)))
    return vec4(color, 1)
  })()
  // Where the shape is spent, the surface is not there: a lick's hollow, a tear at the tip.
  body.opacityNode = step(0, shape())

  const mesh = new Mesh(teardrop(), body)
  mesh.layers.set(FLAME_LAYER)

  // The glow: a soft disc facing the camera, added over the scene.
  const halo = new SpriteNodeMaterial({ blending: AdditiveBlending, depthWrite: false, transparent: true })
  halo.colorNode = Fn(() => {
    const fall = float(1).sub(uv().sub(0.5).length().mul(2)).clamp().pow(2.5)
    return vec4(glowColor.mul(fall).mul(glowStrength), fall.mul(glowStrength))
  })()
  const glow = new Sprite(halo)
  glow.layers.set(FLAME_LAYER)

  const object = new Group()
  object.add(mesh, glow)

  return {
    object,
    set(look) {
      object.visible = look.enabled
      mesh.scale.set(look.width, look.height, look.width)
      mesh.position.y = look.lift
      size.value.set(look.width, look.height)
      glow.visible = look.glow > 0
      glow.scale.set(look.width * look.glowSize, look.width * look.glowSize, 1)
      glow.position.y = look.lift + look.height * HEART
      glowColor.value.set(look.colors[0])
      glowStrength.value = look.glow
      paint(look.colors)
      bands.value = Math.max(1, Math.round(look.bands))
      softness.value = look.softness
      sway.value = look.sway
      cells.value = look.cells
      licks.value = look.licks
      brush.value = look.brush
      brushScale.value = look.brushScale
      outlineWidth.value = look.outline ? look.outlineWidth : 0
      outlineColor.value.set(look.outlineColor)
    },
  }
}
