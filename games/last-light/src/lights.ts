// The lights the level places, drawn as grey boxes (#173): a brazier is a
// grey stand with a flame on it, a window a grey wall-piece with a lit pane,
// turned to face where the holder starts.
//
// Each lights the ground it can see within its reach, and nothing else
// (#175, ADR-0054): its lamp's light is cut, through the lamp's shadow, to its
// lit area, read from the same table the swarm keeps rats out by
// (litareas.ts), the same way, its flame leaning as the swarm's does at the
// swarm's own time. What looks lit is what the rats avoid. The torch is drawn
// as a live light, and its lamp's light is cut to what it sees the same way,
// by `litMask`.
//
// The flame and the pane are unlit and unfogged, with a soft halo round them
// drawn over the fog, so a light reads through the dark from across the level
// as a point to head for; the depth of whatever stands before it hides it, so
// a wall between it and the eye hides it.
import {
  AdditiveBlending,
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  MeshToonNodeMaterial,
  PlaneGeometry,
  PointLight,
  Sprite,
  SpriteNodeMaterial,
  Vector2,
  type Node,
  type Texture,
} from 'three/webgpu'
import { atan, float, int, ivec2, min, positionWorld, select, smoothstep, textureLoad, uniform, uv, vec2 } from 'three/tsl'
import { leaveUnshaded } from './post'
import { createToonGradient } from './toon'
import { ANGLES, MAX_LIGHTS } from './litareas'
import { flickerAt } from './gpuswarm'
import type { FixedLight } from './swarm'
import type { PlacedLight } from './run'

/** How far a placed light's lamp pools past the reach it holds rats off by: the torch's lamp at full strength, 6.9 m over its 3 m. Its lit area cuts it at the reach. */
const POOL = 2.3
/** A brazier's lamp and flame, and a window's: warm and orange, and a paler lamplight. */
const FLAME = { lamp: 0xff7a28, glow: 0xffa040, intensity: 12, height: 0.95 }
const WINDOW = { lamp: 0xffd890, glow: 0xffe6a8, intensity: 8, height: 1.2 }
const GREY = 0x6b6670
/** The halo round a flame or a pane, m across, and how strongly it glows. */
const HALO = 1.4
const HALO_STRENGTH = 0.9

/**
 * 1 where a light at `centre` lights the ground under the fragment, 0
 * elsewhere: within what row `row` of the lit areas' table `seen` sees, read
 * as litareas.ts reads it, the nearer of the two directions either side; and
 * within `reach` that way, its flame leaning as the swarm's does at `time`,
 * unless `reach` is 0, when the lamp's own falloff ends it and only the walls
 * cut it.
 */
export function litMask(seen: Texture, row: Node<'int'>, centre: Node<'vec2'>, reach: Node<'float'>, time: Node<'float'>): Node<'float'> {
  const d = positionWorld.xz.sub(centre)
  const theta = atan(d.y, d.x)
  const fb = theta.add(Math.PI).div(Math.PI * 2).mul(ANGLES)
  const i0 = int(fb)
  const b0 = select(i0.greaterThan(int(ANGLES - 1)), int(ANGLES - 1), i0)
  const b1 = select(b0.equal(int(ANGLES - 1)), int(0), b0.add(1))
  const sees = min(textureLoad(seen, ivec2(b0, row)).x, textureLoad(seen, ivec2(b1, row)).x)
  const edge = select(reach.greaterThan(0), min(reach.mul(flickerAt(theta, time)), sees), sees)
  return float(d.length().lessThan(edge))
}

export interface Lights {
  object: Group
  /** Each light as it stands: lit or out, reaching as far as it does. In the order the level places them. */
  update(lights: readonly FixedLight[]): void
}

/**
 * The level's lights, drawn: in `placed`'s order, as `update` reads them, each
 * lamp cut to its lit area in `seen`, its flame leaning at the swarm's `time`.
 * A window faces `facing`.
 */
export function createLights(placed: readonly PlacedLight[], seen: Texture, time: Node<'float'>, facing: { x: number; z: number }): Lights {
  const object = new Group()
  const gradient = createToonGradient()
  const grey = new MeshToonNodeMaterial({ color: GREY, gradientMap: gradient })
  const glowOf = (color: number) => {
    const material = new MeshBasicNodeMaterial({ color })
    material.fog = false
    leaveUnshaded(material)
    return material
  }
  // The halo: soft from its middle out, added over whatever is behind it, fog and all.
  const haloOf = (color: number) => {
    const material = new SpriteNodeMaterial({ color, transparent: true, depthWrite: false, blending: AdditiveBlending })
    material.opacityNode = smoothstep(0.5, 0, uv().sub(vec2(0.5)).length()).mul(HALO_STRENGTH)
    material.fog = false
    leaveUnshaded(material)
    return material
  }
  const stand = new CylinderGeometry(0.22, 0.3, 0.7, 12)
  const flame = new ConeGeometry(0.17, 0.42, 10)
  const wall = new BoxGeometry(1.6, 2, 0.25)
  const pane = new PlaneGeometry(0.7, 0.9)
  const parts = placed.map((light) => {
    const kind = light.flame ? FLAME : WINDOW
    const group = new Group()
    group.position.set(light.x, 0, light.z)
    const glow = new Mesh(light.flame ? flame : pane, glowOf(kind.glow))
    const halo = new Sprite(haloOf(kind.glow))
    halo.scale.setScalar(HALO)
    if (light.flame) {
      const base = new Mesh(stand, grey)
      base.position.y = 0.35
      base.castShadow = base.receiveShadow = true
      glow.position.y = 0.7 + 0.21
      halo.position.y = glow.position.y
      group.add(base)
    } else {
      const piece = new Mesh(wall, grey)
      piece.position.y = 1
      piece.castShadow = piece.receiveShadow = true
      glow.position.set(0, 1.2, 0.13)
      halo.position.set(0, 1.2, 0.3)
      group.add(piece)
      group.lookAt(facing.x, 0, facing.z)
    }
    glow.castShadow = halo.castShadow = false
    // Lit, in the lit lights' order, its row of the lit areas, and its reach: what its lamp's shadow cuts it to.
    const row = uniform(0, 'int')
    const reach = uniform(light.reach)
    const lamp = new PointLight(kind.lamp, kind.intensity, 1, 0)
    lamp.position.set(0, kind.height, light.flame ? 0 : 0.6)
    lamp.castShadow = true
    lamp.shadow.shadowNode = litMask(seen, row, uniform(new Vector2(light.x, light.z)), reach, time)
    group.add(glow, halo, lamp)
    object.add(group)
    return { glow, halo, lamp, row, reach, intensity: kind.intensity }
  })
  return {
    object,
    update(lights) {
      // The rows as the swarm takes them: the lit ones, in order, from 1, MAX_LIGHTS at most.
      let row = 1
      lights.forEach((light, k) => {
        const part = parts[k]
        if (part === undefined) return
        const on = light.on && light.reach > 0 && row <= MAX_LIGHTS
        // Out, its lamp is dimmed rather than hidden: a light hidden or shown recompiles every lit material.
        part.glow.visible = part.halo.visible = on
        part.lamp.intensity = on ? part.intensity : 0
        part.lamp.distance = light.reach * POOL
        part.reach.value = light.reach
        part.row.value = on ? row++ : 0
      })
    },
  }
}
