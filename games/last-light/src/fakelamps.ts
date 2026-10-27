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
// What they lack beside three's: a shadow. A lamp cut to its lit area by a shadow node (lights.ts `litMask`) stays a
// point light.
import { AnalyticLightNode, Color, Light, Object3D, Vector3, type Node, type NodeBuilder, type WebGPURenderer } from 'three/webgpu'
import { Break, cameraViewMatrix, float, getDistanceAttenuation, If, Loop, positionView, uniform, uniformArray, vec4 } from 'three/tsl'

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

/** The lamps in the shader: their arrays, filled every frame with the lamps lit, packed to the front. */
class FakeLampsNode extends AnalyticLightNode<FakeLamps> {
  private readonly places = uniformArray(Array.from({ length: MAX_FAKE_LAMPS }, () => new Vector3()), 'vec3')
  private readonly colours = uniformArray(Array.from({ length: MAX_FAKE_LAMPS }, () => new Color()), 'color')
  private readonly reaches = uniformArray(new Array<number>(MAX_FAKE_LAMPS).fill(0), 'float')
  private readonly decays = uniformArray(new Array<number>(MAX_FAKE_LAMPS).fill(0), 'float')
  private readonly lit = uniform(0, 'int')

  static get type(): string {
    return 'FakeLampsNode'
  }

  override update(): undefined {
    let n = 0
    for (const lamp of this.light!.lamps) {
      if (n === MAX_FAKE_LAMPS) break
      if (!(lamp.intensity > 0) || !shown(lamp)) continue
      lamp.getWorldPosition(place)
      ;(this.places.array[n] as Vector3).copy(place)
      ;(this.colours.array[n] as Color).copy(lamp.color).multiplyScalar(lamp.intensity)
      ;(this.reaches.array as number[])[n] = lamp.distance
      ;(this.decays.array as number[])[n] = lamp.decay
      n++
    }
    this.lit.value = n
    return undefined
  }

  override setup(builder: NodeBuilder): null {
    const lightsNode = (builder as unknown as { lightsNode: { setupDirectLight(builder: NodeBuilder, node: unknown, data: unknown): void } }).lightsNode
    const here = (builder.context as { positionView?: typeof positionView }).positionView ?? positionView
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
        lightsNode.setupDirectLight(builder, this, { lightDirection: vector.normalize(), lightColor: colour.mul(float(attenuation)) })
      })
    })
    return null
  }
}

/** Whether `object` is drawn: it and every parent up to the scene shown. */
function shown(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (!o.visible) return false
  return true
}

/** The lamps' one light, three taught to light every material by it; add it to the scene. */
export function createFakeLamps(renderer: WebGPURenderer): FakeLamps {
  renderer.library.addLight(FakeLampsNode as never, FakeLamps as never)
  return new FakeLamps()
}
