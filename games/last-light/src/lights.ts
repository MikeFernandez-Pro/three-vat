// The lights the level places, drawn as grey boxes (#173): a brazier is a
// grey stand with a flame on it, a window a grey wall-piece with a lit pane,
// turned to face where the holder starts. A fragile flame (#177) is
// a small flame on a thin post, so it reads apart from a brazier that never
// dies; put out, its flame and lamp go dark and the post stands.
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
//
// The woods (#182) draw a few flames bare, with no stand: a burning tree,
// a crown burning on the ground, each its own height and size; and every light
// stands on the ground's height where it is. A light that moves, the cart's
// fire (#183), is drawn where the run now has it, its lamp's light cut round
// it there. A light the scenery draws itself, the lanterns on the manor's
// steps (#184), is its lamp alone; one the scenery moves, the goose game's
// well's lantern swinging on its hook, is the scenery's whole, lamp and all.
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
import { atan, float, int, ivec2, min, normalWorldGeometry, positionWorld, select, smoothstep, textureLoad, uniform, uv, vec2 } from 'three/tsl'
import { leaveUnshaded } from './post'
import { FakeLamp, type FakeLamps } from './fakelamps'
import { createToonGradient } from './toon'
import { ANGLES, MAX_LIGHTS } from './litareas'
import { flickerAt } from './gpuswarm'
import type { FixedLight } from './swarm'
import type { PlacedLight } from './run'

/** How far a placed light's lamp pools past the reach it holds rats off by: the torch's lamp at full strength, 6.9 m over its 3 m. Its lit area cuts it at the reach. */
const POOL = 2.3
/**
 * How far a wall's face is read out from itself, m, along its normal, for
 * whether a light sees it: a light's lit area ends at the face, so the face
 * itself stands on the edge, lit or not by a hair. The ground faces up and is
 * read where it is.
 */
const FACE_OFFSET = 0.05
/** A brazier's lamp and flame, and a window's: warm and orange, and a paler lamplight. */
const FLAME = { lamp: 0xff7a28, glow: 0xffa040, intensity: 12, height: 0.95 }
const WINDOW = { lamp: 0xffd890, glow: 0xffe6a8, intensity: 8, height: 1.2 }
const FRAGILE = { lamp: 0xff9a40, glow: 0xffb860, intensity: 8, height: 1.15 }
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
 * cut it. A face is read FACE_OFFSET out along its normal, so a wall's face
 * toward the light is lit.
 */
export function litMask(seen: Texture, row: Node<'int'>, centre: Node<'vec2'>, reach: Node<'float'>, time: Node<'float'>): Node<'float'> {
  // A face read a little out from itself, along its own normal: a wall's out into the light it faces.
  const d = positionWorld.xz.add(normalWorldGeometry.xz.mul(FACE_OFFSET)).sub(centre)
  const theta = atan(d.y, d.x)
  const fb = theta.add(Math.PI).div(Math.PI * 2).mul(ANGLES)
  const i0 = int(fb)
  const b0 = select(i0.greaterThan(int(ANGLES - 1)), int(ANGLES - 1), i0)
  const b1 = select(b0.equal(int(ANGLES - 1)), int(0), b0.add(1))
  const sees = min(textureLoad(seen, ivec2(b0, row)).x, textureLoad(seen, ivec2(b1, row)).x)
  const edge = select(reach.greaterThan(0), min(reach.mul(flickerAt(theta, time)), sees), sees)
  return float(d.length().lessThan(edge))
}

/**
 * How a light is drawn where it is not on a stand: bare, its flame in the open
 * `height` m up, `size` times a brazier's; or its lamp alone, `height` m up,
 * what it lights the scenery's to draw; or nothing, the scenery drawing it
 * whole.
 */
export interface LightLook {
  bare?: boolean
  lampOnly?: boolean
  scenery?: boolean
  height?: number
  size?: number
}

/** How the lights are drawn past the plain stands: each light's own look, by the level's index; and the ground's height where each stands. */
export interface LightsOptions {
  looks?: readonly (LightLook | undefined)[]
  groundAt?: (x: number, z: number) => number
  /** Whether each lamp is cut to its lit area by its shadow node, as by default; false, and its own falloff alone ends it, for nothing a pixel. */
  masked?: boolean
  /**
   * Unmasked, the lamps lit by `lamps` (fakelamps.ts) in place of a point light each: one loop in every lit shader,
   * not a light written out in each. A fake lamp has no shadow node, so a masked lamp stays a point light.
   */
  lamps?: FakeLamps
}

export interface Lights {
  object: Group
  /** Each light as it stands: where it is, lit or out, reaching as far as it does. In the order the level places them. */
  update(lights: readonly FixedLight[]): void
  /** Light `k`'s lamp in `color`, as bright as `intensity` while lit. */
  setLamp(k: number, color: number, intensity: number): void
}

/**
 * The level's lights, drawn: in `placed`'s order, as `update` reads them, each
 * lamp cut to its lit area in `seen`, its flame leaning at the swarm's `time`.
 * A window faces `facing`.
 */
export function createLights(placed: readonly PlacedLight[], seen: Texture, time: Node<'float'>, facing: { x: number; z: number }, options: LightsOptions = {}): Lights {
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
  const post = new CylinderGeometry(0.04, 0.06, 1, 8)
  const small = new ConeGeometry(0.08, 0.22, 8)
  const wall = new BoxGeometry(1.6, 2, 0.25)
  const pane = new PlaneGeometry(0.7, 0.9)
  const parts = placed.map((light, k) => {
    const fragile = light.flame && light.fragile !== undefined
    const kind = fragile ? FRAGILE : light.flame ? FLAME : WINDOW
    const look = options.looks?.[k]
    const group = new Group()
    group.position.set(light.x, options.groundAt?.(light.x, light.z) ?? 0, light.z)
    const glow = new Mesh(fragile ? small : light.flame ? flame : pane, glowOf(kind.glow))
    const halo = new Sprite(haloOf(kind.glow))
    halo.scale.setScalar(fragile ? HALO * 0.7 : HALO)
    let lampHeight = kind.height
    let lampOut = light.flame ? 0 : 0.6
    if (look?.scenery) {
      // The scenery draws it whole, stand and all: nothing of it here.
    } else if (look?.lampOnly) {
      lampHeight = look.height ?? kind.height
      lampOut = 0
    } else if (look?.bare) {
      const size = look.size ?? 1
      glow.scale.setScalar(size)
      halo.scale.multiplyScalar(size)
      glow.position.y = halo.position.y = lampHeight = look.height ?? kind.height
    } else if (fragile) {
      const base = new Mesh(post, grey)
      base.position.y = 0.5
      base.castShadow = base.receiveShadow = true
      glow.position.y = 1 + 0.11
      halo.position.y = glow.position.y
      group.add(base)
    } else if (light.flame) {
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
    const masked = options.masked ?? true
    const centre = uniform(new Vector2(light.x, light.z))
    let lamp: PointLight | FakeLamp
    if (options.lamps && !masked) lamp = options.lamps.track(new FakeLamp(kind.lamp, kind.intensity, 1, 0))
    else {
      const point = new PointLight(kind.lamp, kind.intensity, 1, 0)
      point.castShadow = masked
      point.shadow.shadowNode = litMask(seen, row, centre, reach, time)
      lamp = point
    }
    lamp.position.set(0, lampHeight, lampOut)
    if (!look?.scenery) group.add(lamp)
    if (!look?.lampOnly && !look?.scenery) group.add(glow, halo)
    object.add(group)
    return { group, glow, halo, lamp, row, reach, centre, intensity: kind.intensity }
  })
  return {
    object,
    update(lights) {
      // The rows as the swarm takes them: the lit ones, in order, from 1, MAX_LIGHTS at most.
      let row = 1
      lights.forEach((light, k) => {
        const part = parts[k]
        if (part === undefined) return
        if (part.centre.value.x !== light.x || part.centre.value.y !== light.z) {
          part.centre.value.set(light.x, light.z)
          part.group.position.set(light.x, options.groundAt?.(light.x, light.z) ?? 0, light.z)
        }
        const on = light.on && light.reach > 0 && row <= MAX_LIGHTS
        // Out, its lamp is dimmed rather than hidden: a light hidden or shown recompiles every lit material.
        part.glow.visible = part.halo.visible = on
        part.lamp.intensity = on ? part.intensity : 0
        part.lamp.distance = light.reach * POOL
        part.reach.value = light.reach
        part.row.value = on ? row++ : 0
      })
    },
    setLamp(k, color, intensity) {
      const part = parts[k]
      if (part === undefined) return
      part.lamp.color.setHex(color)
      if (part.lamp.intensity > 0) part.lamp.intensity = intensity
      part.intensity = intensity
    },
  }
}
