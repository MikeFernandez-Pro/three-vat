// The torch's embers: a few sparks that leave the flame, rise, sway and burn
// out, cooling from the flame's core to a deep red as they shrink to nothing.
// Each is a small diamond stretched along its way, so it reads as a streak.
// Every spark is a slot that is born again each life, where the flame is
// then, and is a function of its age after: posed at the run's held time, the
// stop motion holds them on the beat with the rest. Born where the flame was,
// they stay behind it in the world as the light walks on, and trail it.
import { Color, InstancedMesh, MeshBasicNodeMaterial, Object3D, OctahedronGeometry, Quaternion, Vector3 } from 'three/webgpu'

/** What the embers' controls edit, in the torch flame folder. */
export interface EmberLook {
  enabled: boolean
  /** How many are alight at once, up to MAX_EMBERS. */
  count: number
  /** How long one burns, s; how fast it rises, m/s; how fast it goes out sideways, m/s. */
  life: number
  rise: number
  spread: number
  /** How long one is at its birth, m: it shrinks to nothing as it burns out. */
  size: number
  /** Its colour at its birth, and as it goes out. */
  hot: number
  cold: number
}

export const defaultEmbers = (): EmberLook => ({
  enabled: true,
  count: 12,
  life: 0.7,
  rise: 0.45,
  spread: 0.12,
  size: 0.018,
  hot: 0xffd36b,
  cold: 0xc2300f,
})

export const MAX_EMBERS = 32

/** How many times a life one sways from side to side, and how far, m. */
const SWAY_TIMES = 1.5
const SWAY = 0.02
/** How thin a spark is, to its length. */
const THIN = 0.35

/** A draw from -1 to 1, the same for the same slot and life. */
function draw(slot: number, life: number, channel: number): number {
  let t = (slot * 2654435761 + life * 40503 + channel * 7919 + 0x6d2b79f5) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1
}

export interface Embers {
  readonly object: InstancedMesh
  /** Take the embers' controls. */
  set(look: EmberLook): void
  /** Pose them at `time` seconds, the flame's light at `from`, world space: where the sparks born now start. */
  update(time: number, from: Vector3): void
}

export function createEmbers(): Embers {
  const material = new MeshBasicNodeMaterial()
  material.fog = false
  const mesh = new InstancedMesh(new OctahedronGeometry(0.5, 0), material, MAX_EMBERS)
  mesh.frustumCulled = false
  mesh.renderOrder = 1
  // Each slot's life it is in, and where that life began.
  const lives = new Int32Array(MAX_EMBERS).fill(-1)
  const births = Array.from({ length: MAX_EMBERS }, () => new Vector3())
  const place = new Object3D()
  const way = new Vector3()
  const UP = new Vector3(0, 1, 0)
  const turn = new Quaternion()
  const hot = new Color()
  const cold = new Color()
  const color = new Color()
  let look = defaultEmbers()
  // Coloured from the start, so the material is built reading the instances' colours.
  for (let i = 0; i < MAX_EMBERS; i++) mesh.setColorAt(i, hot.set(look.hot))

  return {
    object: mesh,
    set(next) {
      look = next
      mesh.visible = look.enabled
      mesh.count = Math.min(MAX_EMBERS, Math.max(0, Math.round(look.count)))
      hot.set(look.hot)
      cold.set(look.cold)
    },
    update(time, from) {
      const lifeS = Math.max(0.05, look.life)
      for (let i = 0; i < mesh.count; i++) {
        // The slots' lives are staggered evenly, so one is born every life over count.
        const t = time / lifeS + i / mesh.count
        const life = Math.floor(t)
        const age = t - life
        if (life !== lives[i]) {
          lives[i] = life
          births[i].copy(from)
        }
        const sideX = draw(i, life, 0) * look.spread
        const sideZ = draw(i, life, 1) * look.spread
        const rise = look.rise * (0.7 + 0.3 * draw(i, life, 2))
        const s = age * lifeS
        const sway = Math.sin((age * SWAY_TIMES + draw(i, life, 3)) * Math.PI * 2) * SWAY
        place.position.set(births[i].x + sideX * s + sway, births[i].y + rise * s, births[i].z + sideZ * s - sway * 0.5)
        // Stretched along its way: its rise and its spread.
        way.set(sideX, rise, sideZ).normalize()
        place.quaternion.copy(turn.setFromUnitVectors(UP, way))
        const size = look.size * (1 - age)
        place.scale.set(size * THIN, size, size * THIN)
        place.updateMatrix()
        mesh.setMatrixAt(i, place.matrix)
        mesh.setColorAt(i, color.copy(hot).lerp(cold, age))
      }
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true
    },
  }
}
