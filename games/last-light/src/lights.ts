// The lights the level places, drawn as grey boxes (#173): a brazier is a
// grey stand with a flame on it, a window a grey wall-piece with a lit pane.
// The flame and the pane are unlit and unfogged, so a light reads through the
// dark from anywhere in the arena as a point to head for; each pools its own
// lamp on the ground round it, no shadows, as far as it holds rats off. Walls
// will hide them, and their lit ground will be drawn from what they can see
// (#175); until then nothing stands between a light and the eye.
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  MeshToonNodeMaterial,
  PlaneGeometry,
  PointLight,
} from 'three/webgpu'
import { leaveUnshaded } from './post'
import { createToonGradient } from './toon'
import type { FixedLight } from './swarm'
import type { PlacedLight } from './run'

/** How far a placed light's lamp pools past the reach it holds rats off by: the torch's lamp at full strength, 6.9 m over its 3 m. */
const POOL = 2.3
/** A brazier's lamp and flame, and a window's: warm and orange, and a paler lamplight. */
const FLAME = { lamp: 0xff7a28, glow: 0xffa040, intensity: 12, height: 0.95 }
const WINDOW = { lamp: 0xffd890, glow: 0xffe6a8, intensity: 8, height: 1.2 }
const GREY = 0x6b6670

export interface Lights {
  object: Group
  /** Each light as it stands: lit or out, reaching as far as it does. */
  update(lights: readonly FixedLight[]): void
}

/** The level's lights, drawn: in `placed`'s order, as `update` reads them. */
export function createLights(placed: readonly PlacedLight[]): Lights {
  const object = new Group()
  const gradient = createToonGradient()
  const grey = new MeshToonNodeMaterial({ color: GREY, gradientMap: gradient })
  const glowOf = (color: number) => {
    const material = new MeshBasicNodeMaterial({ color })
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
    if (light.flame) {
      const base = new Mesh(stand, grey)
      base.position.y = 0.35
      base.castShadow = base.receiveShadow = true
      glow.position.y = 0.7 + 0.21
      group.add(base)
    } else {
      // The window faces the middle of the arena, where the holder starts.
      const piece = new Mesh(wall, grey)
      piece.position.y = 1
      piece.castShadow = piece.receiveShadow = true
      glow.position.set(0, 1.2, 0.13)
      group.add(piece)
      group.lookAt(0, 0, 0)
    }
    glow.castShadow = false
    const lamp = new PointLight(kind.lamp, kind.intensity, 1, 0)
    lamp.position.set(0, kind.height, light.flame ? 0 : 0.6)
    group.add(glow, lamp)
    object.add(group)
    return { glow, lamp, intensity: kind.intensity }
  })
  return {
    object,
    update(lights) {
      lights.forEach((light, k) => {
        const part = parts[k]
        if (part === undefined) return
        // Out, its lamp is dimmed rather than hidden: a light hidden or shown recompiles every lit material.
        part.glow.visible = light.on
        part.lamp.intensity = light.on ? part.intensity : 0
        part.lamp.distance = light.reach * POOL
      })
    },
  }
}
