// The pond's water: the old platform-typing water, ported to TSL. Its noise
// came with it, in public/textures/water: a Perlin texture that wobbles the
// refraction.
//
// It shines on its own, unlit, as the old one did: a tint from a shallow cyan
// to a deep blue by how far the ground is under it, a green at a slant, and
// the ground under it showing through where it is shallow and seen from above.
// Its voronoi foam and its glints off two drifting ripple maps are left out.
//
// The old water drew the whole scene a second time to read what lay under it.
// This one reads the frame as it stands once the opaque scene is drawn, its
// colour and depth copied (`viewportSharedTexture`, `viewportDepthTexture`):
// one copy a frame while the pond is on screen, and a handful of texture reads
// a pixel of water. So what is under the water, the goose's legs and body as
// she wades, shows through it, tinted and wavering as the ground does; what
// stands above it is never pulled into it, the wobble looking straight down
// wherever it lands on something higher than the water.
//
// Left out too: the old water's height and x limits on the refraction, which
// its own level needed; the refraction fades with the ground's depth as it did.
import { Color, MeshBasicNodeMaterial, NoColorSpace, RepeatWrapping, TextureLoader, type Node, type Texture } from 'three/webgpu'
import {
  cameraPosition,
  cameraProjectionMatrixInverse,
  cameraWorldMatrix,
  clamp,
  dot,
  float,
  getViewPosition,
  max,
  mix,
  positionWorld,
  pow,
  renderGroup,
  screenUV,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
  viewportDepthTexture,
  viewportSharedTexture,
} from 'three/tsl'

/** What the pond folder's water edits. */
export interface WaterLook {
  /** The colour where it is deepest, and where it is shallow. */
  deep: number
  shallow: number
  /** How deep the water must be to show the deep colour alone, m; and how fast it turns deep: under 1 sooner. */
  depthMax: number
  depthExponent: number
  /** The colour it takes at a slant, and how close to flat it must be seen for it: more, flatter. */
  horizon: number
  horizonPower: number
  /** How far the ground under it is pushed about, a share of the screen; how wide the wobble is, per metre; and how fast it drifts. */
  refraction: number
  refractionScale: number
  refractionSpeed: number
  /** How deep under the floor the ground still shows through, m: deeper ground fades out. */
  refractionDepth: number
  /** How clearly the ground under it shows, as a multiplier of the old water's: 1 as it was, more clearer. */
  clarity: number
  /** How opaque the water is, the same at any depth: 1 its colour alone, 0 clear, all of what is under it showing. */
  opacity: number
}

/**
 * The forest pond set from the panel on 2026-10-21, its colours and depth set again on 2026-10-27: a light blue that
 * deepens at once, toward a navy past the pond's depth, a violet horizon; a slow, wide wobble, and the ground showing
 * through by the opacity alone, a little of it, the old water's way of showing it by depth all but turned off.
 */
export function defaultWaterLook(): WaterLook {
  return {
    deep: 0x124463,
    shallow: 0x5b96d2,
    depthMax: 3.23,
    depthExponent: 0.05,
    horizon: 0x7b68c4,
    horizonPower: 2.3,
    refraction: 0.0105,
    refractionScale: 0.54,
    refractionSpeed: 0.092,
    refractionDepth: 0.01,
    clarity: 4.76,
    opacity: 0.85,
  }
}

/**
 * Lake looks to try (2026-10-27), `?water=1` to `?water=5` on the goose page: a shallow, bluish lake that reads as a
 * safe place for geese, each over the default. The pond is 0.41 m deep at most, so each deepens over that much.
 */
export const WATER_LOOKS: readonly { name: string; look: Partial<WaterLook> }[] = [
  // Clear blue shallows over the sand, deepening to a lake blue in the middle.
  { name: 'clear lake', look: { deep: 0x163f8c, shallow: 0x3a7fcc, depthMax: 0.45, depthExponent: 1, horizon: 0x6a9ad8, horizonPower: 4.5, refraction: 0.006, refractionDepth: 0.5, clarity: 2.5, opacity: 0.72 } },
  // A night lake: deep blue, a faint moonlit sheen only where it is seen flat.
  { name: 'moonlit', look: { deep: 0x0e2a5a, shallow: 0x22548c, depthMax: 0.45, depthExponent: 0.8, horizon: 0x5a86b8, horizonPower: 6, refraction: 0.005, refractionDepth: 0.4, clarity: 1.6, opacity: 0.82 } },
  // Turquoise shallows, a teal-blue middle: warmer and friendlier.
  { name: 'turquoise', look: { deep: 0x1b6488, shallow: 0x46aeb6, depthMax: 0.42, depthExponent: 1.2, horizon: 0x93d6da, horizonPower: 3.5, refraction: 0.007, refractionDepth: 0.5, clarity: 2.2, opacity: 0.75 } },
  // Calm and still: a soft deep blue, barely any wobble, mostly its own colour.
  { name: 'calm blue', look: { deep: 0x123462, shallow: 0x2a5f94, depthMax: 0.42, depthExponent: 1, horizon: 0x6894c4, horizonPower: 4, refraction: 0.002, refractionSpeed: 0.04, refractionDepth: 0.3, clarity: 1.2, opacity: 0.9 } },
  // Glass: very clear, the sandy bed showing all the way in, a light blue tint over it.
  { name: 'glass', look: { deep: 0x2c76a8, shallow: 0x6cbcdc, depthMax: 0.45, depthExponent: 1, horizon: 0x9cd0ea, horizonPower: 5, refraction: 0.008, refractionDepth: 0.6, clarity: 4, opacity: 0.55 } },
]

export interface Water {
  material: MeshBasicNodeMaterial
  /** Take the folder's values. */
  set(look: WaterLook): void
  /** Move it on to `time`, the page's held time, s, so it holds on the beat as the rest does. */
  update(time: number): void
}

/** The water, its noise loaded from public/textures/water. */
export async function createWater(look: WaterLook = defaultWaterLook()): Promise<Water> {
  const perlin = await new TextureLoader().loadAsync('./textures/water/perlin.png')
  return waterOf({ perlin }, look)
}

/** The water on its noise, which wobbles the refraction. */
export function waterOf(textures: { perlin: Texture }, look: WaterLook = defaultWaterLook()): Water {
  const perlin = textures.perlin
  perlin.wrapS = perlin.wrapT = RepeatWrapping
  perlin.colorSpace = NoColorSpace

  // Every value a uniform of the render's group: the water is a still mesh, whose own uniforms would keep their first value.
  const number = (value: number) => uniform(value).setGroup(renderGroup)
  const colour = () => uniform(new Color()).setGroup(renderGroup)
  const time = number(0)
  const deep = colour()
  const shallow = colour()
  const depthMax = number(1)
  const depthExponent = number(1)
  const horizon = colour()
  const horizonPower = number(1)
  const refraction = number(0)
  const refractionScale = number(1)
  const refractionSpeed = number(0)
  const refractionDepth = number(1)
  const clarity = number(1)
  const opacity = number(1)

  /** The ground under the screen's `uv`, in the world, from the depth drawn there. */
  const groundAt = (uv: Node<'vec2'>, depth: Node<'float'>) =>
    cameraWorldMatrix.mul(vec4(getViewPosition(uv, depth, cameraProjectionMatrixInverse), 1)).xyz

  // The ground under it, looked up a little off where it is, by the noise drifting across the water. The noise is
  // grey, its channels alike, so each way is read from its own place, the second turned and drifted apart: read once,
  // as the old water did, both ways would move together and the ground would only slide along a diagonal.
  const drift = time.mul(refractionSpeed)
  const wobbleAt = positionWorld.xz.mul(refractionScale)
  const wobble = vec2(
    texture(perlin, wobbleAt.add(vec2(drift.negate(), drift))).r,
    texture(perlin, vec2(wobbleAt.y.negate(), wobbleAt.x).add(vec2(0.37, 0.71)).add(vec2(drift, drift.mul(0.6)))).r,
  )
    .mul(2)
    .sub(1)
  const refracted = clamp(screenUV.add(wobble.mul(refraction)), 0.001, 0.999)
  const refractedGround = groundAt(refracted, viewportDepthTexture(refracted).x)
  const straightGround = groundAt(screenUV, viewportDepthTexture(screenUV).x)
  // Where the wobble lands on something in front of the water, a bird on its bank, it looks straight down instead.
  const inFront = float(refractedGround.y.greaterThanEqual(positionWorld.y))
  const under = mix(refracted, screenUV, inFront)
  const groundY = mix(refractedGround.y, straightGround.y, inFront)
  const depth = max(positionWorld.y.sub(groundY), 0)
  const shallowness = pow(clamp(depth.div(depthMax), 0, 1), depthExponent).oneMinus()

  // Seen at a slant it takes the horizon's colour.
  const toCamera = cameraPosition.sub(positionWorld).normalize()
  const slant = clamp(pow(max(dot(toCamera, vec3(0, 1, 0)), 0).oneMinus(), horizonPower), 0, 1)

  let colourNode: Node<'vec3'> = mix(mix(deep, shallow, shallowness), horizon, slant)
  // The ground under it, where it is shallow, seen from above, and no deeper than the refraction reaches.
  const showsThrough = shallowness.mul(slant.oneMinus()).mul(smoothstep(refractionDepth.negate(), 0, groundY)).mul(clarity)
  colourNode = mix(colourNode, viewportSharedTexture(under).rgb, clamp(showsThrough, 0, 1))
  // And the whole of it as opaque as the folder says, over what is under it, wobbled.
  colourNode = mix(viewportSharedTexture(under).rgb, colourNode, opacity)

  const material = new MeshBasicNodeMaterial()
  material.colorNode = colourNode
  // Drawn after the opaque scene, so the frame it reads holds everything under it.
  material.transparent = true

  const water: Water = {
    material,
    set(look) {
      deep.value.set(look.deep)
      shallow.value.set(look.shallow)
      depthMax.value = Math.max(0.01, look.depthMax)
      depthExponent.value = look.depthExponent
      horizon.value.set(look.horizon)
      horizonPower.value = look.horizonPower
      refraction.value = look.refraction
      refractionScale.value = look.refractionScale
      refractionSpeed.value = look.refractionSpeed
      refractionDepth.value = Math.max(0.01, look.refractionDepth)
      clarity.value = look.clarity
      opacity.value = look.opacity
    },
    update(t) {
      time.value = t
    },
  }
  water.set(look)
  return water
}
