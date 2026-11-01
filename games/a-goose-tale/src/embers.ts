// The torch's embers: a few sparks that leave the flame, rise, sway and burn
// out, cooling from the flame's core to a deep red as they shrink to nothing.
// Each is a small diamond stretched along its way, so it reads as a streak.
// Every spark is a slot that is born again each life, where the flame is
// then, and is a function of its age after: posed at the run's held time, the
// stop motion holds them on the beat with the rest. Born where the flame was,
// they stay behind it in the world as the light walks on, and trail it.
// A burst, as the torch catches at a fire, throws a spray of them out of the
// flame all at once, fast and every way round, slowing as they rise and go
// out: slots of their own after the steady ones, drawn at no size till then.
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
  life: 0.9,
  rise: 1.05,
  spread: 0.39,
  size: 0.053,
  hot: 0xffd36b,
  cold: 0xc2300f,
})

export const MAX_EMBERS = 32
/** Sparks in a burst at most. */
export const BURST_EMBERS = 24

/** How fast a burst's sparks slow, a second: a share of their speed lost; how long one lives, of a steady spark's life. */
const BURST_DRAG = 4
const BURST_LIFE = 1.2

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
  /** A burst of `count` sparks, BURST_EMBERS at most, out of the flame at `speed` m/s, born on the next `update`. */
  burst(count: number, speed: number): void
}

export function createEmbers(): Embers {
  const material = new MeshBasicNodeMaterial()
  material.fog = false
  const mesh = new InstancedMesh(new OctahedronGeometry(0.5, 0), material, MAX_EMBERS + BURST_EMBERS)
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
  /** The steady sparks' slots, the first `steady` of the mesh's; the burst's follow them. */
  let steady = 0
  // Coloured from the start, so the material is built reading the instances' colours.
  for (let i = 0; i < MAX_EMBERS + BURST_EMBERS; i++) mesh.setColorAt(i, hot.set(look.hot))
  /** The last burst: when it was born, s of the given time (NaN, none yet), where, how many and how fast; one asked for, born on the next update. */
  const burst = { at: Number.NaN, from: new Vector3(), count: 0, speed: 0, asked: false }
  /** Each burst spark's way out, a unit vector, and its share of the burst's speed, drawn as the burst is born. */
  const outs = Array.from({ length: BURST_EMBERS }, () => new Vector3())
  const speeds = new Float32Array(BURST_EMBERS)

  return {
    object: mesh,
    set(next) {
      look = next
      mesh.visible = look.enabled
      steady = Math.min(MAX_EMBERS, Math.max(0, Math.round(look.count)))
      mesh.count = steady + BURST_EMBERS
      hot.set(look.hot)
      cold.set(look.cold)
    },
    update(time, from) {
      const lifeS = Math.max(0.05, look.life)
      for (let i = 0; i < steady; i++) {
        // The slots' lives are staggered evenly, so one is born every life over count.
        const t = time / lifeS + i / steady
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
      if (burst.asked) {
        burst.asked = false
        burst.at = time
        burst.from.copy(from)
        // Every way round and mostly up, none straight down: a spray out of the flame.
        for (let j = 0; j < BURST_EMBERS; j++) {
          const round = Math.random() * Math.PI * 2
          const up = 0.15 + Math.random() * 0.85
          const across = Math.sqrt(1 - up * up)
          outs[j]!.set(Math.cos(round) * across, up, Math.sin(round) * across)
          speeds[j] = 0.5 + Math.random() * 0.5
        }
      }
      const since = time - burst.at
      for (let j = 0; j < BURST_EMBERS; j++) {
        const lives = lifeS * BURST_LIFE * (0.7 + 0.3 * speeds[j]!)
        const age = since / lives
        if (!(j < burst.count && age >= 0 && age < 1)) {
          place.scale.setScalar(0)
          place.updateMatrix()
          mesh.setMatrixAt(steady + j, place.matrix)
          continue
        }
        // Thrown out, slowing as the air takes it, rising the while as a steady spark does.
        const v = burst.speed * speeds[j]!
        const gone = (v * (1 - Math.exp(-BURST_DRAG * since))) / BURST_DRAG
        const out = outs[j]!
        place.position.set(burst.from.x + out.x * gone, burst.from.y + out.y * gone + look.rise * since, burst.from.z + out.z * gone)
        // Along its way as it now goes: its throw, as much as is left of it, and its rise.
        const left = v * Math.exp(-BURST_DRAG * since)
        way.set(out.x * left, out.y * left + look.rise, out.z * left).normalize()
        place.quaternion.copy(turn.setFromUnitVectors(UP, way))
        const size = look.size * (1 - age)
        place.scale.set(size * THIN, size * (1 + left / Math.max(v, 1e-3)), size * THIN)
        place.updateMatrix()
        mesh.setMatrixAt(steady + j, place.matrix)
        mesh.setColorAt(steady + j, color.copy(hot).lerp(cold, age))
      }
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true
    },
    burst(count, speed) {
      burst.asked = true
      burst.count = Math.min(BURST_EMBERS, Math.max(0, Math.round(count)))
      burst.speed = speed
    },
  }
}
