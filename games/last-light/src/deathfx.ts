// A rat's death, as the portfolio's character dies (Portfolio2024,
// src/shaders/dissolve.js, src/character/deathCycle/): its body melts into a
// glowing voronoi lava, warped by perlin noise, and the lava recedes to
// nothing; meanwhile a burst of glowing motes rises from where it stood,
// swaying, shrinking and fading. The same pattern, timings and colour, the
// motes sized to a rat.
//
// The dissolve is a rat's own, read by its index from a texture of how long
// each rat has left to die (rats.ts); the motes are one pool of bursts, a
// burst set off where a rat dies and played out on the page's clock.
import {
  AdditiveBlending,
  Color,
  InstancedBufferAttribute,
  NoColorSpace,
  PointsNodeMaterial,
  RepeatWrapping,
  Sprite,
  TextureLoader,
  type Box3,
  type Node,
  type Texture,
} from 'three/webgpu'
import {
  abs,
  attribute,
  clamp,
  cos,
  distance,
  float,
  Fn,
  If,
  instancedBufferAttribute,
  length,
  max,
  mix,
  pow,
  select,
  sin,
  smoothstep,
  texture,
  time,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'

/** The portfolio's death, as its folder edits it: the lava's colour, glow and pattern, and the two phases' lengths, s. */
export interface DissolveLook {
  color: number
  intensity: number
  /** The voronoi's scale over the body; 0, as the portfolio has it, and the perlin warp alone draws the cells. */
  repeat: number
  perlinScale: number
  perlinStrength: number
  perlinSpeed: number
  /** How soft the lava's edge is at its widest, mid-death. */
  thickness: number
}

/** The portfolio's character death: green lava, 0.3 s melting in, 0.3 s receding. */
export const defaultDissolve = (): DissolveLook => ({ color: 0x25c447, intensity: 3.6, repeat: 0, perlinScale: 1.5, perlinStrength: 1, perlinSpeed: 0.12, thickness: 0.43 })
/** The melt and the recede, s: a death lasts both, the swarm's DIE. */
export const MELT = 0.3
export const RECEDE = 0.3
/** Fragments under this much lava, the body gone, are discarded. */
const ALPHA_CLIP = 0.01

/** The voronoi cells (red) and perlin noise (green) the lava is drawn from, the portfolio's own. */
export function loadDissolveNoise(): Texture {
  const noise = new TextureLoader().load('./textures/voronoi-perlin.png')
  noise.colorSpace = NoColorSpace
  noise.wrapS = noise.wrapT = RepeatWrapping
  return noise
}

/** The dissolve's uniforms, a folder's values taken by `set`. */
export class Dissolve {
  readonly color = uniform(new Color())
  readonly intensity = uniform(1)
  readonly repeat = uniform(0)
  readonly perlinScale = uniform(1)
  readonly perlinStrength = uniform(1)
  readonly perlinSpeed = uniform(0)
  readonly thickness = uniform(0)

  constructor(readonly noise: Texture) {
    this.set(defaultDissolve())
  }

  set(look: DissolveLook): void {
    this.color.value.set(look.color)
    this.intensity.value = look.intensity
    this.repeat.value = look.repeat
    this.perlinScale.value = look.perlinScale
    this.perlinStrength.value = look.perlinStrength
    this.perlinSpeed.value = look.perlinSpeed
    this.thickness.value = look.thickness
  }

  /**
   * A dying body's nodes, from `left`, how long it has left to die, s, 0 alive: `form`, how much of the body still
   * shows, 1 alive; `lava`, the lava's glow; `shown`, whether a fragment is drawn. The pattern is laid over the rest
   * pose in `bounds`, so it sticks to the body as it runs.
   */
  nodes(left: Node<'float'>, bounds: Box3): { form: Node<'float'>; lava: Node<'vec3'>; shown: Node<'bool'> } {
    const age = float(MELT + RECEDE).sub(left)
    const dying = left.greaterThan(0)
    const melt = age.div(MELT).clamp(0, 1)
    const recede = age.sub(MELT).div(RECEDE).clamp(0, 1)
    const melting = age.lessThan(MELT)
    // The lava grows in (gsap's power1.out) while its edge thickens; then recedes and thins back out.
    const progress = select(dying, select(melting, float(1).sub(melt.oneMinus().mul(melt.oneMinus())), recede.oneMinus()), float(0))
    const edge = select(melting, melt, recede.oneMinus()).mul(this.thickness)
    const form = select(dying, select(melting, melt.oneMinus(), float(0)), float(1))

    const min = vec3(bounds.min.x, bounds.min.y, bounds.min.z)
    const size = max(vec3(bounds.max.x, bounds.max.y, bounds.max.z).sub(min), vec3(1e-5))
    const at = varying(clamp(attribute('position', 'vec3').sub(min).div(size), 0, 1), 'vDissolvePos')
    const normal = varying(attribute('normal', 'vec3'), 'vDissolveNormal')
    const pattern = Fn(() => {
      const out = float(0).toVar()
      // Only a dying rat reads the noise: six fetches a fragment, skipped by the whole crowd alive.
      If(dying, () => {
        // Triplanar, as the portfolio reads it: the normal's length floored, so a cancelled one is no NaN.
        const w0 = pow(abs(normal).div(max(length(normal), 1e-5)), vec3(8)).toVar()
        const w = w0.div(max(w0.x.add(w0.y).add(w0.z), 1e-5)).toVar()
        const triplanar = (repeat: Node<'float'>, offset: Node<'vec2'>) =>
          texture(this.noise, at.zy.mul(repeat).add(offset))
            .mul(w.x)
            .add(texture(this.noise, at.xz.mul(repeat).add(offset)).mul(w.y))
            .add(texture(this.noise, at.xy.mul(repeat).add(offset)).mul(w.z))
        const scroll = vec2(this.perlinSpeed, time.negate().mul(this.perlinSpeed).mul(0.5))
        const perlin = triplanar(this.perlinScale, scroll).g
        const warp = vec2(perlin.sub(0.5)).mul(this.perlinStrength)
        const voronoi = triplanar(this.repeat, warp).r
        const lower = float(1).sub(progress)
        out.assign(smoothstep(lower, lower.add(max(edge, 1e-5)), voronoi))
      })
      return out
    })()
    const lava = this.color.mul(this.intensity).mul(pattern).mul(form.oneMinus())
    // The body mixed into the lava: what is neither is gone.
    const shown = mix(pattern, float(1), form).greaterThanEqual(ALPHA_CLIP)
    return { form, lava, shown }
  }
}

/** The motes, as their folder edits them: how long a burst lasts, how high and big they go, their colour and glow. */
export interface MotesLook {
  enabled: boolean
  duration: number
  rise: number
  size: number
  color: number
  intensity: number
}

/** The portfolio's burst, its rise and size scaled from a person to a rat; its colour the lava's, glowing past the bloom. */
export const defaultMotes = (): MotesLook => ({ enabled: true, duration: 1, rise: 0.3, size: 0.02, color: 0x25c447, intensity: 9.01 })

/** Motes a burst, and bursts at once at most: a death past them takes the oldest burst's place. */
const MOTES = 30
const BURSTS = 96
/** Where a burst's motes start, round a rat's body, m: a disc this wide, this high. */
const BODY_RADIUS = 0.12
const BODY_HEIGHT = 0.12

/**
 * The bursts of motes: one sprite a mote, every burst's in one draw. `burst`
 * sets one off at a point on the page's clock; `update` moves the clock.
 */
export class DeathMotes {
  readonly object: Sprite
  private readonly now = uniform(0)
  private readonly duration = uniform(1)
  private readonly rise = uniform(1)
  private readonly size = uniform(1)
  private readonly color = uniform(new Color())
  private readonly intensity = uniform(1)
  /** Each mote's burst: where it was set off, and when, s; never, far in the past. */
  private readonly bursts: InstancedBufferAttribute
  private next = 0

  constructor() {
    const count = MOTES * BURSTS
    const offsets = new Float32Array(count * 3)
    const scales = new Float32Array(count)
    const randoms = new Float32Array(count * 3)
    const bursts = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) {
      // Evenly over the body's disc, at any height up it.
      const radius = BODY_RADIUS * Math.sqrt(Math.random())
      const angle = Math.random() * Math.PI * 2
      offsets[i * 3] = Math.cos(angle) * radius
      offsets[i * 3 + 1] = Math.random() * BODY_HEIGHT
      offsets[i * 3 + 2] = Math.sin(angle) * radius
      scales[i] = 0.4 + Math.random() * 0.6
      // How fast it rises, when it starts, its sway's phase.
      randoms[i * 3] = 0.6 + Math.random() * 0.8
      randoms[i * 3 + 1] = Math.random() * 0.4
      randoms[i * 3 + 2] = Math.random()
      bursts[i * 4 + 3] = -1e6
    }
    this.bursts = new InstancedBufferAttribute(bursts, 4)
    // Typed as what they hold: TSL types an instanced attribute as a bare node.
    const offset = instancedBufferAttribute(new InstancedBufferAttribute(offsets, 3)) as unknown as Node<'vec3'>
    const scale = instancedBufferAttribute(new InstancedBufferAttribute(scales, 1)) as unknown as Node<'float'>
    const random = instancedBufferAttribute(new InstancedBufferAttribute(randoms, 3)) as unknown as Node<'vec3'>
    const burst = instancedBufferAttribute(this.bursts) as unknown as Node<'vec4'>

    const material = new PointsNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending })
    // Its life: from its own delay, so the burst staggers, to the burst's end; outside it, nothing.
    const progress = this.now.sub(burst.w).div(this.duration)
    const life = clamp(progress.sub(random.y).div(float(1).sub(random.y)), 0, 1)
    const alive = progress.greaterThanEqual(0).and(progress.lessThan(1))
    const phase = random.z.mul(Math.PI * 2)
    material.positionNode = burst.xyz.add(offset).add(
      vec3(sin(life.mul(9).add(phase)).mul(0.05).mul(life), life.mul(this.rise).mul(random.x), cos(life.mul(7).add(phase)).mul(0.05).mul(life)),
    )
    // Shrinking as they rise; none, out of their life.
    material.sizeNode = select(alive, this.size.mul(scale).mul(float(1).sub(life.mul(0.6))).mul(2), float(0))
    // A soft round mote, popping in, fading over the rise, glowing past the bloom.
    const point = vec2(uv().x, uv().y.oneMinus())
    const strength = smoothstep(0.15, 0.5, distance(point, vec2(0.5))).oneMinus()
    const alpha = smoothstep(0, 0.08, life).mul(smoothstep(0.45, 1, life).oneMinus())
    material.colorNode = vec4(this.color.mul(this.intensity), alpha.mul(strength))
    this.object = new Sprite(material)
    this.object.count = count
    this.object.frustumCulled = false
    this.set(defaultMotes())
  }

  set(look: MotesLook): void {
    this.object.visible = look.enabled
    this.duration.value = Math.max(0.05, look.duration)
    this.rise.value = look.rise
    this.size.value = look.size
    this.color.value.set(look.color)
    this.intensity.value = look.intensity
  }

  /** A burst set off at (x, y, z), now on the page's clock, s. */
  burst(x: number, y: number, z: number, now: number): void {
    const array = this.bursts.array as Float32Array
    const first = this.next * MOTES
    for (let m = first; m < first + MOTES; m++) {
      array[m * 4] = x
      array[m * 4 + 1] = y
      array[m * 4 + 2] = z
      array[m * 4 + 3] = now
    }
    this.bursts.addUpdateRange(first * 4, MOTES * 4)
    this.bursts.needsUpdate = true
    this.next = (this.next + 1) % BURSTS
  }

  /** The page's clock, s. */
  update(now: number): void {
    this.now.value = now
  }

  dispose(): void {
    this.object.material.dispose()
  }
}
