// The level's wind zones, drawn as plainly as the blockout's grey boxes
// (#177): pale streaks laid over the ground the zone covers, drifting the way the wind blows, faint in the
// calm and bright and fast in a gust, so a player can see where the wind is
// and time a crossing between its gusts.
import { AdditiveBlending, Group, Mesh, MeshBasicNodeMaterial, PlaneGeometry } from 'three/webgpu'
import { float, fract, positionWorld, smoothstep, uniform } from 'three/tsl'
import { leaveOutOfShading } from './post'
import type { WindZone } from './run'

const COLOR = 0xb8c4d8
/** How strongly the streaks show, in the calm and in a gust. */
const CALM = 0.06
const GUST = 0.3
/** How fast the streaks drift, m/s, in the calm and in a gust: west, as the wind blows. */
const CALM_SPEED = 0.6
const GUST_SPEED = 6
/** How far apart the streaks are, m, and how wide a share of that each is. */
const SPACING = 0.9
const WIDTH = 0.25
/** How fast the look turns from calm to gust and back, a share a second. */
const EASE = 4

export interface Wind {
  /** Every zone's streaks. */
  readonly object: Group
  /** A frame of `dt`, s: each zone, in the level's order, gusting or not. */
  update(dt: number, gusting: (zone: number) => boolean): void
}

/** The level's wind zones, drawn. */
export function createWind(zones: readonly WindZone[]): Wind {
  const object = new Group()
  const geometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  const parts = zones.map((zone) => {
    const strength = uniform(CALM)
    const drift = uniform(0)
    const material = new MeshBasicNodeMaterial({ color: COLOR, transparent: true, depthWrite: false, blending: AdditiveBlending })
    // Streaks across the ground, slanting a little, drifting west; a faint wash over the whole zone, so its edge shows.
    const along = positionWorld.x.add(positionWorld.z.mul(0.35)).add(drift).div(SPACING)
    const streak = smoothstep(WIDTH, 0, fract(along).sub(0.5).abs().mul(2))
    material.opacityNode = streak.mul(strength).add(float(CALM * 0.3))
    leaveOutOfShading(material)
    const mesh = new Mesh(geometry, material)
    mesh.position.set((zone.minX + zone.maxX) / 2, 0.02, (zone.minZ + zone.maxZ) / 2)
    mesh.scale.set(zone.maxX - zone.minX, 1, zone.maxZ - zone.minZ)
    mesh.castShadow = mesh.receiveShadow = false
    object.add(mesh)
    // How strongly its streaks show, how far they have drifted, m, and how far into a gust its look is, 0 calm to 1.
    return { strength, drift, gust: 0 }
  })
  return {
    object,
    update(dt, gusting) {
      parts.forEach((part, k) => {
        const target = gusting(k) ? 1 : 0
        part.gust += Math.max(-EASE * dt, Math.min(EASE * dt, target - part.gust))
        part.strength.value = CALM + (GUST - CALM) * part.gust
        part.drift.value += (CALM_SPEED + (GUST_SPEED - CALM_SPEED) * part.gust) * dt
      })
    },
  }
}
