// The flame at the light: two sprites that face the camera, drawn by three's
// TSL flames (examples/webgpu_tsl_vfx_flames): a coloured body shaped by a
// cellular noise and a gradient, and white wisps shaped by perlin and cellular
// noise, both rising on a clock the page gives, so the stop motion can hold
// the flame on its beat like the rats. The noises are three's own textures.
// On a layer of its own, so the frame's pre-pass can leave it out: a sprite
// has no depth of its own worth an ambient occlusion or an outline.
import { CanvasTexture, Group, Sprite, SpriteNodeMaterial, SRGBColorSpace, TextureLoader } from 'three/webgpu'
import { billboarding, Fn, mix, oneMinus, sin, spherizeUV, step, texture, TWO_PI, uniform, uv, vec2, vec3, vec4 } from 'three/tsl'

/** The layer the flame draws on, and the pre-pass leaves out. */
export const FLAME_LAYER = 1

/** What the flame folder edits. */
export interface FlameLook {
  enabled: boolean
  /** The body's height and width on the ground, m, and how far off the ground it stands. */
  height: number
  width: number
  lift: number
  /** The white wisps over the body. */
  wisps: boolean
  /** The body's colours, from its root to its tip. */
  colors: [number, number, number, number, number]
}

/** The example's flame, a metre high, on the ground. */
export const defaultFlame = (): FlameLook => ({
  enabled: true,
  height: 1,
  width: 0.5,
  lift: 0,
  wisps: true,
  colors: [0x090033, 0x5f1f93, 0xe02e96, 0xffbd80, 0xfff0db],
})

export interface Flame {
  /** What the scene adds; move it to the light. */
  readonly object: Group
  /** Take the flame folder's values. */
  set(look: FlameLook): void
}

/** A float uniform, as `uniform(0)` makes it: the page's clock for the flame. */
type Clock = ReturnType<typeof uniform<'float'>>

export async function createFlame(clock: Clock): Promise<Flame> {
  const loader = new TextureLoader()
  const [cellular, perlin] = await Promise.all([loader.loadAsync('./textures/noise-cellular.png'), loader.loadAsync('./textures/noise-perlin.png')])

  // The body's gradient, root to tip, drawn into a strip the shader reads by shape.
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

  const body = new SpriteNodeMaterial()
  body.colorNode = Fn(() => {
    const mainUv = uv().toVar()
    mainUv.assign(spherizeUV(mainUv, 10).mul(0.6).add(0.2))
    mainUv.assign(mainUv.pow(vec2(1, 2)))
    mainUv.assign(mainUv.mul(2, 1).sub(vec2(0.5, 0)))
    const gradient1 = sin(clock.mul(10).sub(mainUv.y.mul(TWO_PI).mul(2))).toVar()
    const gradient2 = mainUv.y.smoothstep(0, 1).toVar()
    mainUv.x.addAssign(gradient1.mul(gradient2).mul(0.2))
    const cellularUv = mainUv.mul(0.5).add(vec2(0, clock.negate().mul(0.5))).mod(1)
    const cellularNoise = texture(cellular, cellularUv, 0).r.oneMinus().smoothstep(0, 0.5).oneMinus()
    cellularNoise.mulAssign(gradient2)
    const shape = mainUv.sub(0.5).mul(vec2(3, 2)).length().oneMinus().toVar()
    shape.assign(shape.sub(cellularNoise))
    const gradientColor = texture(gradient, vec2(shape.remap(0, 1, 0, 1), 0))
    const color = mix(gradientColor, vec3(1), shape.step(0.8))
    const alpha = shape.smoothstep(0, 0.3)
    return vec4(color.rgb, alpha)
  })()
  body.vertexNode = billboarding({ horizontalRotation: true })

  const wisps = new SpriteNodeMaterial()
  wisps.colorNode = Fn(() => {
    const mainUv = uv().toVar()
    mainUv.assign(spherizeUV(mainUv, 10).mul(0.6).add(0.2))
    mainUv.assign(mainUv.abs().pow(vec2(1, 3)).mul(mainUv.sign()))
    mainUv.assign(mainUv.mul(2, 1).sub(vec2(0.5, 0)))
    const perlinUv = mainUv.add(vec2(0, clock.negate().mul(1))).mod(1)
    const perlinNoise = texture(perlin, perlinUv, 0).sub(0.5).mul(1)
    mainUv.x.addAssign(perlinNoise.x.mul(0.5))
    const gradient1 = sin(clock.mul(10).sub(mainUv.y.mul(TWO_PI).mul(2)))
    const gradient2 = mainUv.y.smoothstep(0, 1)
    const gradient3 = oneMinus(mainUv.y).smoothstep(0, 0.3)
    mainUv.x.addAssign(gradient1.mul(gradient2).mul(0.2))
    const displacementPerlinUv = mainUv.mul(0.5).add(vec2(0, clock.negate().mul(0.25))).mod(1)
    const displacementPerlinNoise = texture(perlin, displacementPerlinUv, 0).sub(0.5).mul(1)
    const displacedPerlinUv = mainUv.add(vec2(0, clock.negate().mul(0.5))).add(displacementPerlinNoise).mod(1)
    const displacedPerlinNoise = texture(perlin, displacedPerlinUv, 0).sub(0.5).mul(1)
    mainUv.x.addAssign(displacedPerlinNoise.mul(0.5))
    const cellularUv = mainUv.add(vec2(0, clock.negate().mul(1.5))).mod(1)
    const cellularNoise = texture(cellular, cellularUv, 0).r.oneMinus().smoothstep(0.25, 1)
    const shape = step(mainUv.sub(0.5).mul(vec2(6, 1)).length(), 0.5).toVar()
    shape.assign(shape.mul(cellularNoise))
    shape.mulAssign(gradient3)
    shape.assign(step(0.01, shape))
    return vec4(vec3(1), shape)
  })()
  wisps.vertexNode = billboarding({ horizontalRotation: true })

  const object = new Group()
  const bodySprite = new Sprite(body)
  const wispSprite = new Sprite(wisps)
  for (const sprite of [bodySprite, wispSprite]) {
    // Rooted at the ground, growing up.
    sprite.center.set(0.5, 0)
    sprite.layers.set(FLAME_LAYER)
    object.add(sprite)
  }

  return {
    object,
    set(look) {
      object.visible = look.enabled
      wispSprite.visible = look.wisps
      bodySprite.scale.set(look.width, look.height, 1)
      wispSprite.scale.set(look.width, look.height, 1)
      bodySprite.position.y = wispSprite.position.y = look.lift
      paint(look.colors)
    },
  }
}
