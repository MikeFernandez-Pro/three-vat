// Feathers knocked off the goose by a rat's bite (main.ts biteFrame): a few
// puff out of him away from the bite, up and out fast, slow at once in the
// air, then flutter down, swaying and turning, lie a while where they land,
// and shrink away. A small pool, a flat quill-shaped quad each, always drawn
// (a dead one at no size), so its pipeline is built at load with the rest and
// the first bite never stalls. Moved on the time it is given, the run's held
// time, so on the stop motion's beat they hold with everything else.
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, InstancedMesh, MeshLambertNodeMaterial, Object3D, Vector3 } from 'three/webgpu'
import { leaveOutOfBloom } from './post'

/** Feathers at most, alive at once. */
const POOL = 48

/** What the feathers do, in the panel's feel folder. */
export interface FeatherLook {
  /** How many puff off him at the hardest bite; half that at the softest. */
  count: number
  /** How long one is, m. */
  size: number
  /** How fast they leave him, m/s: out, and up. */
  out: number
  up: number
  /** How fast they come down at most, m/s, fluttering; how far they sway either way as they fall, m. */
  fall: number
  sway: number
  /** How long one lies where it lands before it shrinks away, s. */
  lies: number
  /** Their colour, and how much of it shows in the dark, 0 lit alone. */
  colour: number
  glow: number
}

export const defaultFeathers = (): FeatherLook => ({
  count: 5,
  size: 0.09,
  out: 1.4,
  up: 1.6,
  fall: 0.45,
  sway: 0.12,
  lies: 1.4,
  colour: 0xf1ede4,
  glow: 0.25,
})

/** How fast their flight slows in the air, a second; how hard they are pulled down, m/s/s. */
const DRAG = 4
const GRAVITY = 4
/** How often a falling feather sways from side to side, a second. */
const SWAY_RATE = 3.2
/** How long one takes to shrink away, s; and how long one lives at most, s. */
const SHRINKS = 0.35
const LONGEST = 8

export interface Feathers {
  readonly object: InstancedMesh
  readonly look: FeatherLook
  /** Take the look's colours. */
  set(): void
  /**
   * Feathers puff off him at `at`, world space, a bite of `hard` 0 to 1 coming from `from` on the ground (a unit
   * vector, or zero from all round): they fly away from it. Born at the next `update`.
   */
  burst(at: Vector3, from: { x: number; z: number }, hard: number): void
  /** The feathers on at `time` s, the ground's height under (x, z) from `groundAt`. */
  update(time: number, groundAt: (x: number, z: number) => number): void
}

interface Feather {
  alive: boolean
  born: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  /** Its turn about its own axis and its tumble, rad, and how fast each goes, rad/s. */
  spin: number
  tumble: number
  spinRate: number
  tumbleRate: number
  /** Where its sway starts in its round, rad; and when it landed, s, NaN in the air. */
  phase: number
  landed: number
  size: number
}

/** A quill: a long, thin leaf of a shape, its shaft along +x, flat in xz, its root at the origin. */
function quill(): BufferGeometry {
  // Root, two shoulders, the widest pair, and the tip: a vane narrowing to a point.
  const shape = [
    [0, 0],
    [0.15, 0.12],
    [0.55, 0.16],
    [1, 0],
    [0.55, -0.13],
    [0.15, -0.1],
  ]
  const positions: number[] = []
  const normals: number[] = []
  for (const [x, z] of shape) {
    positions.push(x! - 0.5, 0, z!)
    normals.push(0, 1, 0)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setIndex([0, 1, 5, 1, 2, 5, 2, 4, 5, 2, 3, 4])
  return geometry
}

export function createFeathers(look = defaultFeathers()): Feathers {
  const material = new MeshLambertNodeMaterial({ side: DoubleSide })
  leaveOutOfBloom(material)
  const object = new InstancedMesh(quill(), material, POOL)
  object.frustumCulled = false
  object.name = 'feathers'
  const pool: Feather[] = Array.from({ length: POOL }, () => ({ alive: false, born: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, tumble: 0, spinRate: 0, tumbleRate: 0, phase: 0, landed: Number.NaN, size: 0 }))
  const pending: { at: Vector3; from: { x: number; z: number }; hard: number }[] = []
  const pose = new Object3D()
  const colour = new Color()
  let last = Number.NaN

  const hide = (k: number) => {
    pose.position.set(0, -1000, 0)
    pose.scale.setScalar(0)
    pose.updateMatrix()
    object.setMatrixAt(k, pose.matrix)
  }
  for (let k = 0; k < POOL; k++) hide(k)

  const born = (time: number, at: Vector3, from: { x: number; z: number }, hard: number) => {
    const count = Math.round(look.count * (0.5 + 0.5 * hard))
    for (let n = 0; n < count; n++) {
      const feather = pool.find((f) => !f.alive) ?? pool.reduce((a, b) => (a.born <= b.born ? a : b))
      // Away from the bite, spread over a half turn; from all round, any way.
      const away = Math.hypot(from.x, from.z) > 0 ? Math.atan2(-from.z, -from.x) : Math.random() * Math.PI * 2
      const way = away + (Math.random() - 0.5) * Math.PI
      const out = look.out * (0.5 + Math.random() * 0.8) * (0.6 + 0.4 * hard)
      Object.assign(feather, {
        alive: true,
        born: time,
        x: at.x + Math.cos(way) * 0.08,
        y: at.y + (Math.random() - 0.3) * 0.15,
        z: at.z + Math.sin(way) * 0.08,
        vx: Math.cos(way) * out,
        vy: look.up * (0.6 + Math.random() * 0.6),
        vz: Math.sin(way) * out,
        spin: Math.random() * Math.PI * 2,
        tumble: Math.random() * Math.PI * 2,
        spinRate: (Math.random() - 0.5) * 9,
        tumbleRate: (Math.random() - 0.5) * 7,
        phase: Math.random() * Math.PI * 2,
        landed: Number.NaN,
        size: look.size * (0.7 + Math.random() * 0.6),
      })
    }
  }

  const feathers: Feathers = {
    object,
    look,
    set() {
      colour.set(look.colour)
      material.color.copy(colour)
      material.emissive.copy(colour).multiplyScalar(look.glow)
    },
    burst(at, from, hard) {
      pending.push({ at: at.clone(), from: { ...from }, hard })
    },
    update(time, groundAt) {
      const dt = Number.isNaN(last) ? 0 : Math.max(0, Math.min(0.1, time - last))
      last = time
      for (const { at, from, hard } of pending) born(time, at, from, hard)
      pending.length = 0
      pool.forEach((f, k) => {
        if (!f.alive) return
        if (time - f.born > LONGEST) {
          f.alive = false
          hide(k)
          return
        }
        let shrink = 1
        const ground = groundAt(f.x, f.z) + 0.004
        if (Number.isNaN(f.landed)) {
          // In the air: the puff slowed at once, then pulled down, no faster than a flutter, swaying as it comes.
          const slow = Math.exp(-DRAG * dt)
          f.vx *= slow
          f.vz *= slow
          f.vy = Math.max(-look.fall, f.vy * slow - GRAVITY * dt)
          const falling = f.vy < 0 ? 1 : 0
          const sway = Math.cos(f.phase + (time - f.born) * SWAY_RATE) * look.sway * SWAY_RATE * falling
          f.x += (f.vx + Math.cos(f.spin) * sway) * dt
          f.y += f.vy * dt
          f.z += (f.vz + Math.sin(f.spin) * sway) * dt
          f.spin += f.spinRate * dt
          f.tumble += f.tumbleRate * dt
          if (f.y <= ground) {
            f.y = ground
            f.landed = time
          }
        } else {
          // Lying where it landed, flat, then shrinking away.
          f.y = ground
          f.tumble = 0
          const lying = time - f.landed
          if (lying > look.lies) shrink = 1 - (lying - look.lies) / SHRINKS
          if (shrink <= 0) {
            f.alive = false
            hide(k)
            return
          }
        }
        pose.position.set(f.x, f.y, f.z)
        pose.rotation.set(Math.sin(f.tumble) * 0.9, f.spin, Math.cos(f.tumble) * 0.5)
        pose.scale.setScalar(f.size * shrink)
        pose.updateMatrix()
        object.setMatrixAt(k, pose.matrix)
      })
      object.instanceMatrix.needsUpdate = true
    },
  }
  feathers.set()
  return feathers
}
