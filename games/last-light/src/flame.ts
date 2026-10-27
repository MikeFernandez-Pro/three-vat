// The torch's flame: the end of the pumpkin kid's torch is alight,
// and the lamp burns in it. A painted flame in the round: three shells one
// inside the other, each turned about the flame's spine on the outline the
// card had, in three flat colours, a dark orange edge, an orange body and a
// pale core, unlit. Each shows its outer face only, so a shell covers what is
// behind it once, as the card's layer did, and the inner shows through the
// outer however the camera looks down. It reads the depth but writes none, so
// the kid's head hides it where it stands in front; its shells drawn in
// order, outside in.
// Its outline is drawn
// again each beat of the stop motion, as a hand draws each frame of a flame:
// a round foot, a tip that curls one way or another across the ground, and
// tongues that lick up off its sides at their own heights and their own
// ways round; smooth, it redraws every frame on the clock, and wavers. The
// shells share its curl, so they burn as one flame.
// Walking, it leans back from the way the light goes.
import { BufferAttribute, BufferGeometry, FrontSide, Group, Mesh, MeshBasicNodeMaterial, Vector3 } from 'three/webgpu'
import { defaultEmbers, type EmberLook } from './embers'
import { defaultSmoke, type SmokeLook } from './smoke'

/** What the flame folder edits. */
export interface FlameLook {
  enabled: boolean
  /** How tall it burns, m, and how wide at its round foot. */
  height: number
  width: number
  /** How far its foot stands above the torch's end, m, straight up whichever way the meat leans; below 0, down into the meat. */
  lift: number
  /**
   * How far its foot stands from the torch's end across the ground, m, as
   * the meat faces: x to its left, z ahead of it; so it may burn off its
   * top to one side, and turns with the meat. The embers start from it.
   */
  offsetX: number
  offsetZ: number
  /** Its three colours, outside in: its edge, its body, its core; and how big the core is, 0 to 1 of the flame. */
  color: number
  body: number
  core: number
  coreShare: number
  /** How much of each of its layers shows, 0 to 1. */
  opacity: number
  /** How far its size changes between drawings, as a share of it. */
  flicker: number
  /** How far its tip curls, in widths of its foot; and how far its tongues lick out, in widths. */
  curl: number
  tongues: number
  /** How far it leans back from the light's walk, radians a m/s. */
  lean: number
  /** The sparks it gives off. */
  embers: EmberLook
  /** The smoke off its tip, drawn with it. */
  smoke: SmokeLook
}

/** As the panel set it on 2026-10-07: a slim flame, half see-through, its size flickering and its tip curling hard; standing in the mouth of the cup in the pumpkin kid's hand. */
export const defaultFlame = (): FlameLook => ({
  enabled: true,
  height: 0.38,
  width: 0.165,
  lift: 0,
  offsetX: 0,
  offsetZ: 0,
  color: 0xe2502a,
  body: 0xff8a1a,
  core: 0xffd774,
  coreShare: 0.5,
  opacity: 0.58,
  flicker: 0.31,
  curl: 0.66,
  tongues: 0.18,
  lean: 0.25,
  embers: defaultEmbers(),
  smoke: defaultSmoke(),
})

/** The lean's top, radians: a flame flat on its side reads as a wind, not a walk. */
const MAX_LEAN = 0.9
/** How much of the flame's height its round foot is: where its light burns, at the foot's widest. */
const FOOT = 0.3
/** How many rings the outline is drawn in, foot to tip, and how many points round each. */
const ROWS = 32
const AROUND = 16
/** The body's size in the flame, and how far up each inner layer's foot stands, as a share of the foot. */
const BODY_SHARE = 0.78
const INNER_RISE = 0.35
/** How long a tongue is up the flame, as a share of its height. */
const TONGUE = 0.2
/** How many tongues lick off a shell, spread round it; and how sharp each is round the shell: the higher, the narrower its ridge. */
const TONGUES = 3
const TONGUE_EDGE = 6

/** A draw from -1 to 1 by channel: this drawing's. */
export type FlameDraw = (channel: number) => number

/** One shell as rings round the spine, foot to tip, each of AROUND points; its faces wound outwards. */
function shellGeometry(): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array((ROWS + 1) * AROUND * 3), 3))
  const index: number[] = []
  for (let r = 0; r < ROWS; r++) {
    for (let s = 0; s < AROUND; s++) {
      const a = r * AROUND + s
      const b = r * AROUND + ((s + 1) % AROUND)
      index.push(a, a + AROUND, b, b, a + AROUND, b + AROUND)
    }
  }
  geometry.setIndex(index)
  return geometry
}

/** Where the flame's spine is across the ground, one way, at `y` up it, 0 to 1: its foot upright, its tip curled by `curl` and turned back on itself by `turn`. */
function spine(y: number, curl: number, turn: number): number {
  return y * y * (curl + turn * Math.sin(y * Math.PI * 1.5))
}

/** A tongue up the flame: nothing below it, swelling up to its point at `at`, and gone just past it. */
function tongue(y: number, at: number, size: number): number {
  const from = at - TONGUE
  if (y < from || y > at) return 0
  return size * ((y - from) / TONGUE) ** 2
}

export interface Flame {
  readonly object: Group
  /** Take the flame folder's values. */
  set(look: FlameLook): void
  /** Where its foot stands from the torch's end, m, as the meat faces: x to its left, y up, z ahead. */
  offset(out: Vector3): Vector3
  /** Draw it again, by this drawing's draws, the light walking at (vx, vz) m/s. */
  shape(draw: FlameDraw, vx: number, vz: number): void
  /** Stand its foot at `at`, world space: the torch's end, moved by its folder's lift and offsets. */
  place(at: Vector3): void
  /** Where its light is, world space: its centre, halfway up it on its spine. */
  centre(out: Vector3): Vector3
  /** Where its tip is, world space: where its smoke starts. */
  tip(out: Vector3): Vector3
}

export function createFlame(): Flame {
  const materials = [0, 1, 2].map(() => new MeshBasicNodeMaterial({ side: FrontSide, transparent: true, depthWrite: false }))
  const shells = materials.map((material, i) => {
    material.fog = false
    const mesh = new Mesh(shellGeometry(), material)
    // Drawn after the scene, outside in, since no depth orders them.
    mesh.renderOrder = 10 + i
    mesh.frustumCulled = false
    return mesh
  })
  /** The flame, a unit wide and tall, leaning back from the walk; its size set on its scale. */
  const body = new Group()
  body.add(...shells)
  const object = new Group()
  object.add(body)
  const axis = new Vector3()
  /** Where the tip and the middle are across the ground, this drawing's. */
  const tipAt = new Vector3()
  const middleAt = new Vector3()

  let look = defaultFlame()

  /** Draw shell `i` as `share` of the flame, its foot `rise` up it, its tongues by draws from `channel`. */
  function drawShell(i: number, share: number, rise: number, curlX: number, turnX: number, curlZ: number, turnZ: number, draw: FlameDraw, channel: number) {
    const positions = shells[i].geometry.getAttribute('position') as BufferAttribute
    const height = share * (1 - rise)
    const width = 0.5 * share
    // Its tongues, spread round it, each at a height and a size of its own, the outer shell's longest.
    const spin = Math.PI * draw(channel + 9)
    const tongues = Array.from({ length: TONGUES }, (_, k) => ({
      at: 0.55 + 0.25 * draw(channel + k),
      size: look.tongues * share * (0.6 + 0.4 * draw(channel + TONGUES + k)),
      way: spin + (k * 2 * Math.PI) / TONGUES,
    }))
    for (let r = 0; r <= ROWS; r++) {
      const t = r / ROWS
      // Up the flame, as the outer shell's height: so every shell curls on the one spine.
      const y = rise + t * height
      let half: number
      if (t < FOOT) half = width * Math.sqrt(1 - ((FOOT - t) / FOOT) ** 2)
      else half = width * (1 - (t - FOOT) / (1 - FOOT)) ** 1.4
      const x = spine(y, curlX, turnX)
      const z = spine(y, curlZ, turnZ)
      for (let s = 0; s < AROUND; s++) {
        const a = (s / AROUND) * 2 * Math.PI
        let reach = half
        for (const { at, size, way } of tongues) reach += tongue(t, at, size) * Math.max(0, Math.cos(a - way)) ** TONGUE_EDGE
        positions.setXYZ(r * AROUND + s, x + reach * Math.cos(a), y, z + reach * Math.sin(a))
      }
    }
    positions.needsUpdate = true
  }

  return {
    object,
    offset(out) {
      return out.set(look.offsetX, look.lift, look.offsetZ)
    },
    set(next) {
      look = next
      object.visible = look.enabled
      materials[0].color.set(look.color)
      materials[1].color.set(look.body)
      materials[2].color.set(look.core)
      for (const material of materials) material.opacity = look.opacity
    },
    shape(draw, vx, vz) {
      const f = look.flicker
      const across = look.width * (1 + f * 0.5 * draw(0))
      body.scale.set(across, look.height * (1 + f * draw(1)), across)
      // The tip curls one way or another, and sometimes back on itself, as the references' S.
      const curlX = look.curl * draw(2)
      const turnX = look.curl * 0.8 * draw(3)
      const curlZ = look.curl * draw(4)
      const turnZ = look.curl * 0.8 * draw(5)
      drawShell(0, 1, 0, curlX, turnX, curlZ, turnZ, draw, 10)
      drawShell(1, BODY_SHARE, (1 - BODY_SHARE) * FOOT * INNER_RISE, curlX, turnX, curlZ, turnZ, draw, 20)
      drawShell(2, look.coreShare, (1 - look.coreShare) * FOOT * INNER_RISE, curlX, turnX, curlZ, turnZ, draw, 30)
      tipAt.set(spine(1, curlX, turnX), 1, spine(1, curlZ, turnZ))
      middleAt.set(spine(0.5, curlX, turnX), 0.5, spine(0.5, curlZ, turnZ))
      // Back from the walk: about the level line across it, up tipping towards behind.
      const speed = Math.hypot(vx, vz)
      const lean = Math.min(MAX_LEAN, look.lean * speed)
      if (speed > 1e-3 && lean > 0) body.quaternion.setFromAxisAngle(axis.set(-vz / speed, 0, vx / speed), lean)
      else body.quaternion.identity()
      body.updateMatrixWorld(true)
    },
    place(at) {
      object.position.copy(at)
      object.updateMatrixWorld(true)
    },
    centre(out) {
      return body.localToWorld(out.copy(middleAt))
    },
    tip(out) {
      return body.localToWorld(out.copy(tipAt))
    },
  }
}
