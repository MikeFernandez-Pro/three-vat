// Lamps that are not three's lights: the braziers' and the ghosts', as many as there are, in one loop of every lit
// material's shader.
//
// Three writes a point light into every lit material's shader once over, its whole lighting a light: nine lamps made
// each toon shader 62 KB, 43 of them the lamps, and the goose game's start a GPU-process compile of all of it
// (2026-10-27). Here the lamps are a list: each a place in the scene, a colour, a strength and a reach, gathered
// every frame into uniform arrays, and one light in the scene, `FakeLamps`, that three hands to every lit material
// as it would any light. Its node runs the material's own lighting, the shell's toon steps, highlight and rim or
// three's toon and Lambert, in a loop over the lamps lit: one body in the shader however many lamps there are, and
// a lamp lit, put out or moved is a uniform, nothing recompiled. The old candles of the Portfolio2024 islands,
// pointLights.js, are lit the same way.
//
// What they lack beside three's: a shadow map. A lamp cut to its lit area by a shadow node (lights.ts `litMask`) stays
// a point light. One of them, the fire the goose stands in, is shadowed by her and her goslings on the ground alone
// (`FakeLamps.shadow`): a projector's mask of them, drawn by fireshadow.ts, read by the materials it falls on, each
// fragment found in the projector's view and that fire's light taken away where they cover it, a few taps round it
// softening the edge the further it falls from them.
import { AnalyticLightNode, Color, Light, Matrix4, Object3D, Vector3, type Material, type Node, type NodeBuilder, type Texture, type WebGPURenderer } from 'three/webgpu'
import { Break, cameraViewMatrix, cameraWorldMatrix, float, getDistanceAttenuation, If, Loop, max, mix, positionView, select, texture, uniform, uniformArray, vec2, vec3, vec4 } from 'three/tsl'

/** How many lamps light at once, the loop's length: past it the furthest down the list are left dark. */
export const MAX_FAKE_LAMPS = 32

/** A lamp: where it stands is its own place in the scene, a point light's colour, strength, reach and falloff. */
export class FakeLamp extends Object3D {
  readonly isFakeLamp = true
  color: Color
  /** As a point light's: 0 out. */
  intensity: number
  /** How far it reaches, m, its light falling to nothing there; 0 no end. */
  distance: number
  /** How its light falls with distance: 0 not at all, inside its reach; 2 as light does. */
  decay: number

  constructor(color: number = 0xffffff, intensity = 1, distance = 0, decay = 2) {
    super()
    this.color = new Color(color)
    this.intensity = intensity
    this.distance = distance
    this.decay = decay
  }
}

/** The one light three sees for all the lamps: add it to the scene, and `track` each lamp. */
export class FakeLamps extends Light {
  readonly isFakeLamps = true
  readonly lamps: FakeLamp[] = []
  /**
   * The one lamp shadowed, none if null, laid every frame by fireshadow.ts: its projector's view (world to clip) and
   * place, how far off what it draws stands, how dark, 0 none to 1 the lamp's light all `colour`, what its light is in
   * it, a filter, black none of it, and how soft, 0 hard; its mask, and the materials it falls on, both set before any
   * is drawn.
   */
  readonly shadow = {
    lamp: null as FakeLamp | null,
    view: new Matrix4(),
    at: new Vector3(),
    blocker: 1,
    strength: 1,
    colour: new Color(0x000000),
    softness: 0.1,
    mask: null as Texture | null,
    receivers: new Set<Material>(),
  }

  constructor() {
    super(0xffffff, 1)
  }

  /** Light the scene with `lamp`, wherever it is added. */
  track(lamp: FakeLamp): FakeLamp {
    this.lamps.push(lamp)
    return lamp
  }
}

const place = new Vector3()
/** The mask's taps round the centre's, a disc of eight, as a share of the spread. */
const TAPS: readonly (readonly [number, number])[] = [
  [-0.94, -0.4],
  [0.95, -0.77],
  [-0.09, -0.93],
  [0.34, 0.29],
  [-0.92, 0.46],
  [-0.38, -0.26],
  [0.54, 0.84],
  [-0.2, 0.79],
]

/** The lamps in the shader: their arrays, filled every frame with the lamps lit, packed to the front. */
class FakeLampsNode extends AnalyticLightNode<FakeLamps> {
  private readonly places = uniformArray(Array.from({ length: MAX_FAKE_LAMPS }, () => new Vector3()), 'vec3')
  private readonly colours = uniformArray(Array.from({ length: MAX_FAKE_LAMPS }, () => new Color()), 'color')
  private readonly reaches = uniformArray(new Array<number>(MAX_FAKE_LAMPS).fill(0), 'float')
  private readonly decays = uniformArray(new Array<number>(MAX_FAKE_LAMPS).fill(0), 'float')
  private readonly lit = uniform(0, 'int')
  /** Which of the lamps lit is shadowed, -1 none. */
  private readonly shadowed = uniform(-1, 'int')
  private readonly view = uniform(new Matrix4())
  private readonly projector = uniform(new Vector3())
  private readonly blocker = uniform(1)
  private readonly strength = uniform(1)
  private readonly colour = uniform(new Color(0x000000))
  private readonly softness = uniform(0.1)

  static get type(): string {
    return 'FakeLampsNode'
  }

  override update(): undefined {
    const { shadow } = this.light!
    let n = 0
    this.shadowed.value = -1
    for (const lamp of this.light!.lamps) {
      if (n === MAX_FAKE_LAMPS) break
      if (!(lamp.intensity > 0) || !shown(lamp)) continue
      lamp.getWorldPosition(place)
      ;(this.places.array[n] as Vector3).copy(place)
      ;(this.colours.array[n] as Color).copy(lamp.color).multiplyScalar(lamp.intensity)
      ;(this.reaches.array as number[])[n] = lamp.distance
      ;(this.decays.array as number[])[n] = lamp.decay
      if (lamp === shadow.lamp && shadow.strength > 0) this.shadowed.value = n
      n++
    }
    this.lit.value = n
    this.view.value.copy(shadow.view)
    this.projector.value.copy(shadow.at)
    this.blocker.value = shadow.blocker
    this.strength.value = shadow.strength
    this.colour.value.copy(shadow.colour)
    this.softness.value = shadow.softness
    return undefined
  }

  override setup(builder: NodeBuilder): null {
    const lightsNode = (builder as unknown as { lightsNode: { setupDirectLight(builder: NodeBuilder, node: unknown, data: unknown): void } }).lightsNode
    const here = (builder.context as { positionView?: typeof positionView }).positionView ?? positionView
    const { mask, receivers } = this.light!.shadow
    // On what the shadowed lamp's shadow falls, what of its light gets by: where the mask is covered at the fragment's
    // place in the projector's view, its light through the shadow's colour, its taps spread wider the further the
    // fragment stands past what casts.
    let lets: Node<'vec3'> | undefined
    if (mask && receivers.has(builder.material as Material)) {
      const world = cameraWorldMatrix.mul(vec4(here, 1)).xyz
      const past = vec3(1).toVar()
      const clip = this.view.mul(vec4(world, 1))
      const ndc = clip.xy.div(clip.w)
      If(this.shadowed.greaterThanEqual(0).and(clip.w.greaterThan(0)).and(ndc.x.abs().lessThan(1)).and(ndc.y.abs().lessThan(1)), () => {
        const uv = vec2(ndc.x.mul(0.5).add(0.5), ndc.y.mul(-0.5).add(0.5))
        const far = world.distance(this.projector)
        const spread = max(far.sub(this.blocker), 0).div(far).mul(this.softness)
        // Read at its one level: a sample in a branch the fragments take apart has no derivatives to choose one by.
        let covered = texture(mask, uv, 0).r
        for (const [x, y] of TAPS) covered = covered.add(texture(mask, uv.add(vec2(x, y).mul(spread)), 0).r)
        past.assign(mix(vec3(1), this.colour, covered.div(TAPS.length + 1).mul(this.strength)))
      })
      lets = past
    }
    Loop(MAX_FAKE_LAMPS, ({ i }) => {
      If(i.greaterThanEqual(this.lit), () => {
        Break()
      })
      // The arrays' elements typed as what they hold: three's types leave them untyped.
      const at = this.places.element(i) as unknown as Node<'vec3'>
      const colour = this.colours.element(i) as unknown as Node<'vec3'>
      const reach = this.reaches.element(i) as unknown as Node<'float'>
      const decay = this.decays.element(i) as unknown as Node<'float'>
      const vector = cameraViewMatrix.mul(vec4(at, 1)).xyz.sub(here)
      const lightDistance = vector.length()
      // Past its reach it lights nothing: the rest of its work skipped, as the lamps far off are for most of the screen.
      If(reach.equal(0).or(lightDistance.lessThan(reach)), () => {
        const attenuation = getDistanceAttenuation({ lightDistance, cutoffDistance: reach, decayExponent: decay })
        const light = colour.mul(float(attenuation))
        const lightColor = lets ? light.mul(select(i.equal(this.shadowed), lets, vec3(1))) : light
        lightsNode.setupDirectLight(builder, this, { lightDirection: vector.normalize(), lightColor })
      })
    })
    return null
  }
}

/** Whether `object` is drawn: it and every parent up to the scene shown. */
export function shown(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (!o.visible) return false
  return true
}

/** The lamps' one light, three taught to light every material by it; add it to the scene. */
export function createFakeLamps(renderer: WebGPURenderer): FakeLamps {
  renderer.library.addLight(FakeLampsNode as never, FakeLamps as never)
  return new FakeLamps()
}
