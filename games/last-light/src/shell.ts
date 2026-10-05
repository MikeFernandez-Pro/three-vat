// The scene's material, the rats' and the floor's: three's toon shading on a
// gradient of its own, with two terms three's toon material lacks, each on a
// uniform a panel folder edits.
//
// A sheen: the light's own colour, in the same toon steps, laid on the shell
// whatever its colour is. Three's toon lighting multiplies the light by the
// colour, so a black shell reflects nothing and reads flat; the sheen is the
// light that a black shell still shows.
//
// A highlight: a cel specular, one hard-edged spot of the light's colour where
// the light glances off the shell toward the camera. Blinn-Phong's lobe, cut
// into a step so it reads as a painted highlight, not a hot spot.
//
// A rim: a hard band of the light's colour along the shell's silhouette, on
// the lit side, as a painted figure is edged to lift it off the ground.
//
// A fresnel: a band of its own colour along the silhouette whatever the
// lights, the night's glow on a black body, so a dark shell on dark ground is
// still drawn by its edge. It takes no light and no shadow; only the fog.
//
// All three reach shadow: the light's colour arrives already shadowed, so a
// shell in another's shadow loses its sheen, its highlight and its rim with
// its light.
//
// A model modelled in several flat colours keeps them as parts: each vertex
// names its part in a `part` attribute, each part has a colour of its own on a
// uniform, and the material's colour tints over all of them.
//
// Painted normals, where asked for: a brush's strokes (strokes.ts), bump-mapped
// over the surface by its rest-pose position so they stick to the body, tilt
// the normal a little and make the toon steps' edges wobble as if painted; and
// the normal can be bent toward up, so the shading reads as lit from above and
// the steps band by height, the way a painted figure is shaded.
import {
  Color,
  type DataTexture,
  LightingModel,
  MeshToonNodeMaterial,
  type LightingModelDirectInput,
  type LightingModelReflectedLight,
  type Node,
  type NodeBuilder,
} from 'three/webgpu'
import {
  attribute,
  BRDF_Lambert,
  cameraViewMatrix,
  dFdx,
  dFdy,
  diffuseColor,
  faceDirection,
  float,
  materialColor,
  mix,
  normalView,
  positionView,
  positionViewDirection,
  select,
  smoothstep,
  step,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import type { Strokes } from './strokes'
import { createToonGradient, writeToon, type ToonLook } from './toon'

/** What the rats folder edits of the shell, beyond its colour. */
export interface ShellLook {
  /** The sheen, 0 to 1: how much of the light's own colour the shell shows whatever its colour. */
  sheen: number
  /** The highlight's strength, 0 none. */
  specular: number
  /** How tight the highlight is: the Blinn-Phong exponent, higher a smaller spot. */
  shininess: number
  /** How soft the highlight's edge is, 0 a hard cel edge, 0.5 a smooth lobe. */
  softness: number
  /** The highlight's colour, over the light's. */
  specularColor: number
  /** The rim: on or off, how bright, how wide a band of the silhouette (0 none, 1 the whole facing side), and its colour over the light's. */
  rim: boolean
  rimStrength: number
  rimWidth: number
  rimColor: number
  /** The fresnel: on or off, how bright, how wide a band of the silhouette, and its own colour, under no light. */
  fresnel: boolean
  fresnelStrength: number
  fresnelWidth: number
  fresnelColor: number
}

/** What a painted-normals folder edits. */
export interface PaintLook {
  /** How far a stroke tilts the normal: 0 none, the bump scale. */
  strength: number
  /** Strokes along one body length. */
  density: number
  /** How long and wide each stroke is, 1 as drawn. */
  size: number
  /** How far the normal is bent toward up, 0 none, 1 flat lit from above. */
  rounding: number
}

/**
 * What painted normals need of the model: the strokes; the length in the
 * model's own units that the density counts strokes along, a body for a rat,
 * a metre for the floor; and the normal they go over, in view space, where
 * the model has one of its own (the floor's map), else the surface's.
 */
export interface Painted {
  strokes: Strokes
  extent: number
  base?: Node
}

/** The shell's uniforms, as the lighting model reads them. */
const shellUniforms = () => ({
  sheen: uniform(0),
  specular: uniform(0),
  shininess: uniform(30),
  softness: uniform(0.05),
  specularColor: uniform(new Color(0xffffff)),
  rimStrength: uniform(0),
  rimWidth: uniform(0.3),
  rimColor: uniform(new Color(0xffffff)),
  fresnelStrength: uniform(0),
  fresnelWidth: uniform(0.4),
  fresnelColor: uniform(new Color(0xffffff)),
})
type ShellUniforms = ReturnType<typeof shellUniforms>

/**
 * A vec3 node as TSL types it, with its operators. The lighting model's
 * inputs arrive typed as bare nodes, though at run time they are TSL nodes
 * already; this names what they are.
 */
type Vec3Node = Node<'vec3'>
const asVec3 = (node: Node) => node as unknown as Vec3Node

/** Lambert's diffuse of `color`, typed as the vec3 it is. */
const lambert = (color: Node) => asVec3(BRDF_Lambert({ diffuseColor: color }))

/** The toon step for a light from `lightDirection`: `gradient` read where the light falls on the surface. */
const toonStep = (gradient: DataTexture, lightDirection: Vec3Node) => {
  const dotNL = normalView.dot(lightDirection)
  return texture(gradient, vec2(dotNL.mul(0.5).add(0.5), 0)).r
}

class ShellLightingModel extends LightingModel {
  constructor(
    private readonly shell: ShellUniforms,
    private readonly gradient: DataTexture,
  ) {
    super()
  }

  override direct({ lightDirection: direction, lightColor: color, reflectedLight }: LightingModelDirectInput): void {
    const { sheen, specular, shininess, softness, specularColor, rimStrength, rimWidth, rimColor } = this.shell
    const lightDirection = asVec3(direction)
    const irradiance = asVec3(color).mul(toonStep(this.gradient, lightDirection))
    const directDiffuse = asVec3(reflectedLight.directDiffuse)
    const directSpecular = asVec3(reflectedLight.directSpecular)

    // Three's toon diffuse: the colour, in steps.
    directDiffuse.addAssign(irradiance.mul(lambert(diffuseColor.rgb)))
    // The sheen: the light itself, in the same steps, as if the shell were that much white.
    directDiffuse.addAssign(irradiance.mul(lambert(vec3(sheen))))

    // The highlight: Blinn-Phong's lobe, cut at its half into a cel spot, on the lit side only.
    const halfway = lightDirection.add(positionViewDirection).normalize()
    const lobe = normalView.dot(halfway).clamp().pow(shininess)
    const spot = smoothstep(float(0.5).sub(softness), float(0.5).add(softness), lobe)
    const lit = step(0, normalView.dot(lightDirection))
    directSpecular.addAssign(irradiance.mul(spot).mul(lit).mul(specularColor).mul(specular).mul(1 / Math.PI))

    // The rim: where the shell turns away from the camera, on the lit side, the light's colour in a hard band.
    const facing = normalView.dot(positionViewDirection).clamp()
    const rim = step(facing, rimWidth).mul(lit)
    directDiffuse.addAssign(asVec3(color).mul(rim).mul(rimColor).mul(rimStrength))
  }

  override indirect(builder: NodeBuilder): void {
    const context = builder.context as { ambientOcclusion: Node; irradiance: Node; reflectedLight: LightingModelReflectedLight }
    const irradiance = asVec3(context.irradiance)
    const indirectDiffuse = asVec3(context.reflectedLight.indirectDiffuse)
    // The fill, on the colour and on the sheen alike.
    indirectDiffuse.addAssign(irradiance.mul(lambert(diffuseColor.rgb)))
    indirectDiffuse.addAssign(irradiance.mul(lambert(vec3(this.shell.sheen))))
    indirectDiffuse.mulAssign(asVec3(context.ambientOcclusion))
    // The fresnel: where the shell turns from the camera, its own colour, in a band with a short soft edge.
    const { fresnelStrength, fresnelWidth, fresnelColor } = this.shell
    const turned = float(1).sub(normalView.dot(positionViewDirection).clamp())
    const band = smoothstep(float(1).sub(fresnelWidth), float(1.08).sub(fresnelWidth), turned)
    indirectDiffuse.addAssign(asVec3(fresnelColor).mul(band).mul(fresnelStrength))
  }
}

/**
 * Three's toon material on a gradient of its own, lit with a sheen and a cel
 * highlight: `set` takes a folder's shell values, `setToon` its toon steps.
 */
export class ShellToonMaterial extends MeshToonNodeMaterial {
  static override get type(): string {
    return 'ShellToonMaterial'
  }

  readonly shell: ShellUniforms = shellUniforms()
  /** The colour of each part, where the model has several; empty for a model of one colour. */
  readonly parts: ShellUniforms['specularColor'][]
  /** Its toon steps, at the default to start. */
  readonly gradient: DataTexture
  /** The painted normals' uniforms; unused on a shell made without them. */
  readonly paint = { strength: uniform(0), density: uniform(6), rounding: uniform(0) }
  private readonly strokes: Strokes | undefined
  /** The stroke size the strokes were last drawn at. */
  private strokeSize = 1

  constructor({
    parts = 0,
    painted,
    ...parameters
  }: ConstructorParameters<typeof MeshToonNodeMaterial>[0] & { parts?: number; painted?: Painted } = {}) {
    const gradient = createToonGradient()
    super({ ...parameters, gradientMap: gradient })
    this.gradient = gradient
    this.strokes = painted?.strokes
    if (painted !== undefined) {
      // Strokes laid over the body by its rest-pose position, slanted so no
      // face sees them edge on; their height's change across a pixel, by
      // forward differences, as three's bump node reads it.
      const rest = attribute('position', 'vec3')
      const slant = rest.x.mul(0.5)
      const over = vec2(rest.z.add(slant), rest.y.add(slant)).mul(this.paint.density).div(painted.extent)
      const height = (at: Node<'vec2'>) => texture(painted.strokes.texture, at).r
      const here = height(over)
      const change = vec2(height(over.add(dFdx(over))).sub(here), height(over.add(dFdy(over))).sub(here)).mul(this.paint.strength)
      // Blinn's bump over the base normal, as three's bump node does it; then bent toward up by the rounding.
      const base = asVec3(painted.base ?? normalView)
      const sigmaX = dFdx(positionView).normalize()
      const sigmaY = dFdy(positionView).normalize()
      const r1 = sigmaY.cross(base)
      const r2 = base.cross(sigmaX)
      const det = sigmaX.dot(r1).mul(faceDirection)
      const grad = det.sign().mul(change.x.mul(r1).add(change.y.mul(r2)))
      const bumped = det.abs().mul(base).sub(grad).normalize()
      const up = cameraViewMatrix.mul(vec4(0, 1, 0, 0)).xyz
      this.normalNode = mix(bumped, up, this.paint.rounding).normalize()
    }
    this.parts = Array.from({ length: parts }, () => uniform(new Color(0xffffff)))
    if (parts > 0) {
      // A vertex's colour is its part's, under the material's colour as a tint.
      const part = attribute('part', 'float')
      let colour: Node = this.parts[parts - 1]
      for (let i = parts - 2; i >= 0; i--) colour = select(part.lessThan(i + 0.5), this.parts[i], colour)
      this.colorNode = asVec3(colour).mul(materialColor)
    }
  }

  override setupLightingModel(): ShellLightingModel {
    return new ShellLightingModel(this.shell, this.gradient)
  }

  /** Take a toon folder's steps; the shader reads them from the next frame. */
  setToon(look: ToonLook): void {
    writeToon(this.gradient, look)
  }

  /** Take a painted-normals folder's values; nothing on a shell made without them. */
  setPaint(look: PaintLook): void {
    this.paint.strength.value = look.strength
    this.paint.density.value = look.density
    this.paint.rounding.value = look.rounding
    if (look.size !== this.strokeSize && this.strokes !== undefined) {
      this.strokeSize = look.size
      this.strokes.draw(look.size)
    }
  }

  /** Take the rats folder's values; the shader reads them from the next frame. */
  set(look: ShellLook): void {
    this.shell.sheen.value = look.sheen
    this.shell.specular.value = look.specular
    this.shell.shininess.value = Math.max(1, look.shininess)
    this.shell.softness.value = look.softness
    this.shell.specularColor.value.set(look.specularColor)
    this.shell.rimStrength.value = look.rim ? look.rimStrength : 0
    this.shell.rimWidth.value = look.rimWidth
    this.shell.rimColor.value.set(look.rimColor)
    this.shell.fresnelStrength.value = look.fresnel ? look.fresnelStrength : 0
    this.shell.fresnelWidth.value = look.fresnelWidth
    this.shell.fresnelColor.value.set(look.fresnelColor)
  }
}
