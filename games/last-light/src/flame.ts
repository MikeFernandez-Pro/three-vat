// The torch's flame: the bandage round the top of the meat's bone is alight,
// and the lamp burns in it. Two flat teardrops, a hot core inside a
// see-through flame, unlit, the way a painted flame is two colours. Each beat
// of the stop motion draws it again, a little taller or squatter and leaning
// another way, so it flickers as photographs do; smooth, it wavers on the
// clock. Walking, it streams back from the way the light goes.
import { Group, LatheGeometry, Mesh, MeshBasicNodeMaterial, Vector2, Vector3 } from 'three/webgpu'
import { defaultEmbers, type EmberLook } from './embers'

/** What the flame folder edits. */
export interface FlameLook {
  enabled: boolean
  /** How tall it burns, m, and how wide at its round foot. */
  height: number
  width: number
  /** How far its foot stands above the bandage's end, m, straight up whichever way the bone leans; below 0, down into the bandage. */
  lift: number
  /** The flame's colour, and its core's; how much of the flame the core is, 0 to 1; how much of the flame shows, 0 to 1. */
  color: number
  core: number
  coreShare: number
  opacity: number
  /** How far it changes between beats, as a share of its size. */
  flicker: number
  /** How far it leans back from the light's walk, radians a m/s. */
  lean: number
  /** The sparks it gives off. */
  embers: EmberLook
}

export const defaultFlame = (): FlameLook => ({
  enabled: true,
  height: 0.14,
  width: 0.06,
  lift: 0,
  color: 0xff7a1c,
  core: 0xffe68a,
  coreShare: 0.55,
  opacity: 0.85,
  flicker: 0.18,
  lean: 0.25,
  embers: defaultEmbers(),
})

/** The lean's top, radians: a flame flat on its side reads as a wind, not a walk. */
const MAX_LEAN = 0.9
/** How much of the flame's height its round foot is: where its light burns, at the foot's widest. */
const FOOT = 0.3

/**
 * A teardrop a unit wide at its round foot and a unit tall, standing on the
 * origin: a half ellipse, FOOT of the height, under a tip that narrows to a
 * point.
 */
function teardrop(): LatheGeometry {
  const points: Vector2[] = []
  const ROUND = 8
  const TIP = 14
  // The round foot, from its bottom up to its widest.
  const r = 0.5
  for (let i = 0; i <= ROUND; i++) {
    const a = (i / ROUND) * (Math.PI / 2)
    points.push(new Vector2(Math.sin(a) * r, FOOT - Math.cos(a) * FOOT))
  }
  // The tip, narrowing faster toward its point.
  for (let i = 1; i <= TIP; i++) {
    const s = i / TIP
    points.push(new Vector2(r * (1 - s) ** 1.6, FOOT + s * (1 - FOOT)))
  }
  return new LatheGeometry(points, 16)
}

export interface Flame {
  readonly object: Group
  /** Take the flame folder's values. */
  set(look: FlameLook): void
  /**
   * Draw it again: `a`, `b`, `c` from -1 to 1 this beat's variation (its
   * height, its width and its sway), and the light walking at (vx, vz) m/s.
   */
  shape(a: number, b: number, c: number, vx: number, vz: number): void
  /** Stand its foot at `at`, world space, lifted by its folder's lift. */
  place(at: Vector3): void
  /** Where its light is, world space: inside it, at its foot's widest. */
  centre(out: Vector3): Vector3
}

export function createFlame(): Flame {
  const geometry = teardrop()
  const outer = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
  const inner = new MeshBasicNodeMaterial()
  outer.fog = inner.fog = false
  const flame = new Mesh(geometry, outer)
  const core = new Mesh(geometry, inner)
  flame.renderOrder = core.renderOrder = 1
  /** The flame, leaning about its foot; its size set on `body`. */
  const leaning = new Group()
  const body = new Group()
  body.add(flame, core)
  leaning.add(body)
  const object = new Group()
  object.add(leaning)

  let look = defaultFlame()

  return {
    object,
    set(next) {
      look = next
      object.visible = look.enabled
      outer.color.set(look.color)
      outer.opacity = look.opacity
      inner.color.set(look.core)
      core.scale.setScalar(look.coreShare)
      // The core sits low in the flame, its foot just above the flame's.
      core.position.y = (1 - look.coreShare) * FOOT * 0.5
    },
    shape(a, b, c, vx, vz) {
      const f = look.flicker
      body.scale.set(look.width * (1 + f * 0.5 * b), look.height * (1 + f * a), look.width * (1 + f * 0.5 * b))
      // Back from the walk, and a sway of its own on top.
      const speed = Math.hypot(vx, vz)
      const back = Math.min(MAX_LEAN, look.lean * speed)
      const sway = f * 0.6 * c
      const ux = speed > 1e-3 ? -vx / speed : 0
      const uz = speed > 1e-3 ? -vz / speed : 0
      // A lean toward +x turns about -z; toward +z, about +x.
      leaning.rotation.set(uz * back + sway * 0.5, 0, -ux * back + sway)
    },
    place(at) {
      object.position.copy(at)
      object.position.y += look.lift
      object.updateMatrixWorld(true)
    },
    centre(out) {
      return body.localToWorld(out.set(0, FOOT, 0))
    },
  }
}
