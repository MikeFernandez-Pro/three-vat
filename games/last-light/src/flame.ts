// The torch's flame: the bandage round the top of the meat's bone is alight,
// and the lamp burns in it. A painted flame, not a modelled one: a flat card
// held square to the camera, however it looks down, three flat colours one
// inside the other, a dark orange edge, an orange body and a pale core,
// unlit. It is drawn over
// whatever is in front of it, reading no depth and writing none, so the
// bandage it burns on never cuts into it; its layers in order, outside in.
// Its outline is drawn
// again each beat of the stop motion, as a hand draws each frame of a flame:
// a round foot, a tip that curls one way or the other, and tongues that lick
// up off its sides at their own heights; smooth, it redraws every frame on the
// clock, and wavers. The layers share its curl, so they burn as one flame.
// Walking, it leans back from the way the light goes, as far as that way lies
// across the view.
import { BufferAttribute, BufferGeometry, type Camera, DoubleSide, Group, Mesh, MeshBasicNodeMaterial, Quaternion, Vector3 } from 'three/webgpu'
import { defaultEmbers, type EmberLook } from './embers'
import { defaultSmoke, type SmokeLook } from './smoke'

/** What the flame folder edits. */
export interface FlameLook {
  enabled: boolean
  /** How tall it burns, m, and how wide at its round foot. */
  height: number
  width: number
  /** How far its foot stands above the bandage's end, m, straight up whichever way the bone leans; below 0, down into the bandage. */
  lift: number
  /**
   * How far its foot stands from the bandage's end across the ground, m, as
   * the meat faces: x to its left, z ahead of it; so it may burn over the
   * bone's end instead, and turns with the meat. The embers start from it.
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

/** As the panel set it on 2026-10-06: a tall flame, down over the bandage's end, its size flickering and its tip curling hard. */
export const defaultFlame = (): FlameLook => ({
  enabled: true,
  height: 0.37,
  width: 0.165,
  lift: -0.07,
  offsetX: 0,
  offsetZ: 0,
  color: 0xe2502a,
  body: 0xff8a1a,
  core: 0xffd774,
  coreShare: 0.5,
  opacity: 0.86,
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
/** How many rows the outline is drawn in, foot to tip. */
const ROWS = 32
/** The body's size in the flame, and how far up each inner layer's foot stands, as a share of the foot. */
const BODY_SHARE = 0.78
const INNER_RISE = 0.35
/** How long a tongue is up the flame, as a share of its height. */
const TONGUE = 0.2

/** A draw from -1 to 1 by channel: this drawing's. */
export type FlameDraw = (channel: number) => number

/** One layer's outline as rows across the card: a left and a right edge each row, foot to tip. */
function layerGeometry(): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array((ROWS + 1) * 2 * 3), 3))
  const index: number[] = []
  for (let i = 0; i < ROWS; i++) {
    const l = i * 2
    index.push(l, l + 1, l + 3, l, l + 3, l + 2)
  }
  geometry.setIndex(index)
  return geometry
}

/** Where the flame's spine is across the card at `y` up it, 0 to 1: its foot upright, its tip curled by `curl` and turned back on itself by `turn`. */
function spine(y: number, curl: number, turn: number): number {
  return y * y * (curl + turn * Math.sin(y * Math.PI * 1.5))
}

/** A tongue off one side: nothing below it, swelling up to its point at `at`, and gone just past it. */
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
  /** Hold it square to `camera`, leaning in its plane. */
  face(camera: Camera): void
  /** Where its light is, world space: inside it, at its foot's widest. */
  centre(out: Vector3): Vector3
  /** Where its tip is, world space: where its smoke starts. */
  tip(out: Vector3): Vector3
}

export function createFlame(): Flame {
  const materials = [0, 1, 2].map(() => new MeshBasicNodeMaterial({ side: DoubleSide, transparent: true, depthTest: false, depthWrite: false }))
  const layers = materials.map((material, i) => {
    material.fog = false
    const mesh = new Mesh(layerGeometry(), material)
    // Drawn after the scene, outside in, since no depth orders them.
    mesh.renderOrder = 10 + i
    mesh.frustumCulled = false
    return mesh
  })
  /** The card, a unit wide and tall, square to the camera; its size set on its scale. */
  const card = new Group()
  card.add(...layers)
  const object = new Group()
  object.add(card)
  /** Back from the walk, flat on the ground, and how far it leans that way, radians. */
  const back = new Vector3()
  let lean = 0
  const right = new Vector3()
  const tilt = new Quaternion()
  const Z = new Vector3(0, 0, 1)
  /** Where the tip is across the card, this drawing's. */
  let tipX = 0

  let look = defaultFlame()

  /** Draw layer `i` as `share` of the flame, its foot `rise` up it, its tongues by draws from `channel`. */
  function drawLayer(i: number, share: number, rise: number, curl: number, turn: number, draw: FlameDraw, channel: number) {
    const positions = layers[i].geometry.getAttribute('position') as BufferAttribute
    const height = share * (1 - rise)
    const width = 0.5 * share
    // One tongue a side, at a height of its own, the outer layer's longest.
    const leftAt = 0.55 + 0.25 * draw(channel)
    const rightAt = 0.55 + 0.25 * draw(channel + 1)
    const leftSize = look.tongues * share * (0.6 + 0.4 * draw(channel + 2))
    const rightSize = look.tongues * share * (0.6 + 0.4 * draw(channel + 3))
    for (let r = 0; r <= ROWS; r++) {
      const t = r / ROWS
      // Up the flame, as the outer layer's height: so every layer curls on the one spine.
      const y = rise + t * height
      let half: number
      if (t < FOOT) half = width * Math.sqrt(1 - ((FOOT - t) / FOOT) ** 2)
      else half = width * (1 - (t - FOOT) / (1 - FOOT)) ** 1.4
      const x = spine(y, curl, turn)
      positions.setXYZ(r * 2, x - half - tongue(t, leftAt, leftSize), y, 0)
      positions.setXYZ(r * 2 + 1, x + half + tongue(t, rightAt, rightSize), y, 0)
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
      card.scale.set(look.width * (1 + f * 0.5 * draw(0)), look.height * (1 + f * draw(1)), 1)
      // The tip curls one way or the other, and sometimes back on itself, as the references' S.
      const curl = look.curl * draw(2)
      const turn = look.curl * 0.8 * draw(3)
      drawLayer(0, 1, 0, curl, turn, draw, 10)
      drawLayer(1, BODY_SHARE, (1 - BODY_SHARE) * FOOT * INNER_RISE, curl, turn, draw, 20)
      drawLayer(2, look.coreShare, (1 - look.coreShare) * FOOT * INNER_RISE, curl, turn, draw, 30)
      tipX = spine(1, curl, turn)
      // Back from the walk; `face` leans it as far as that lies across the view.
      const speed = Math.hypot(vx, vz)
      lean = Math.min(MAX_LEAN, look.lean * speed)
      if (speed > 1e-3) back.set(-vx / speed, 0, -vz / speed)
      else back.set(0, 0, 0)
    },
    place(at) {
      object.position.copy(at)
      object.updateMatrixWorld(true)
    },
    face(camera) {
      // Square to the camera, whichever way it looks; leaning in its plane, the share of the lean's way that lies along the view's right.
      right.set(1, 0, 0).applyQuaternion(camera.quaternion)
      const across = back.dot(right)
      card.quaternion.copy(camera.quaternion).multiply(tilt.setFromAxisAngle(Z, -lean * across))
      card.updateMatrixWorld(true)
    },
    centre(out) {
      return card.localToWorld(out.set(spine(FOOT, 0, 0), FOOT, 0))
    },
    tip(out) {
      return card.localToWorld(out.set(tipX, 1, 0))
    },
  }
}
