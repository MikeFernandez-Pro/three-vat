// The torch's smoke: a trail of the flame's path, as the eyes' trails are the
// rats'. A ribbon of places the flame's tip has been, the newest at the tip,
// each rising and swaying as it ages, so standing still the smoke is a wavy
// column off the flame, and walking it is laid behind the light, lifting as
// it goes. In the flame's hand: one flat colour, thin at the flame, swelling,
// then thinning and breaking into a few dashes at its end, as smoke is drawn
// in animation. Nothing of it fades. The places are taken on the run's held
// time, so the stop motion holds them on the beat and steps them with the
// rest; the ribbon faces the camera, its width across the view.
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicNodeMaterial, Vector3 } from 'three/webgpu'

/** What the smoke's controls edit, in the torch flame folder. */
export interface SmokeLook {
  enabled: boolean
  /** How long the trail is, as seconds of smoke: a place older than this is off its end. */
  seconds: number
  /** How wide it is at its widest, m. */
  width: number
  /** How fast a place rises as it ages, m/s. */
  rise: number
  /** How far a place sways across the view as it ages, m, and how many times over the trail. */
  sway: number
  waves: number
  /** How many dashes it breaks into at its end. */
  breaks: number
  /** How much of it shows, 0 to 1. */
  opacity: number
  color: number
}

export const defaultSmoke = (): SmokeLook => ({
  enabled: true,
  seconds: 0.75,
  width: 0.16,
  rise: 0.35,
  sway: 0.04,
  waves: 1.5,
  breaks: 2,
  // A faint trace: set from the panel on 2026-10-08.
  opacity: 0.2,
  color: 0x6a5a7c,
})

/** Places the trail remembers, the flame's tip first. */
const POINTS = 16
/** Rows drawn between two places, so a dash can end between them. */
const BETWEEN = 3
const ROWS = (POINTS - 1) * BETWEEN
/** A tip that moves this far between two frames, m, was moved rather than carried: the trail starts over there. */
const JUMP = 1
/** Where along it the ribbon breaks into dashes, as a share of its length, and how much of each dash's period is dash. */
const BREAK_FROM = 0.55
const DASH = 0.6

/** A draw from -1 to 1, the same for the same place. */
function draw(place: number, channel: number): number {
  let t = (place * 2654435761 + channel * 7919 + 0x6d2b79f5) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1
}

export interface Smoke {
  readonly object: Mesh
  /** Take the smoke's controls. */
  set(look: SmokeLook): void
  /** Lay the trail at `time` seconds, the flame's tip at `tip` and the camera at `eye`, world space. */
  update(time: number, tip: Vector3, eye: Vector3): void
}

export function createSmoke(): Smoke {
  // Drawn after the opaque scene, and writing its depth: a card that wrote none would be painted over by whatever came after it.
  const material = new MeshBasicNodeMaterial({ side: DoubleSide, transparent: true })
  const geometry = new BufferGeometry()
  const positions = new BufferAttribute(new Float32Array((ROWS + 1) * 2 * 3), 3)
  geometry.setAttribute('position', positions)
  const index: number[] = []
  for (let i = 0; i < ROWS; i++) {
    const l = i * 2
    index.push(l, l + 1, l + 3, l, l + 3, l + 2)
  }
  geometry.setIndex(index)
  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = false
  /** Where each place was born, the tip's first, and when; which birth each is, for its own draws. */
  const births = Array.from({ length: POINTS }, () => new Vector3())
  const bornAt = new Float64Array(POINTS)
  const birth = new Int32Array(POINTS)
  let lastSample = Number.NaN
  let born = 0
  /** Each place as it stands now: born, risen and swayed. */
  const places = Array.from({ length: POINTS }, () => new Vector3())
  const along = new Vector3()
  const view = new Vector3()
  const across = new Vector3()
  const at = new Vector3()
  let look = defaultSmoke()

  /** Every place at the tip, born now. */
  function gather(tip: Vector3, time: number) {
    for (let k = 0; k < POINTS; k++) {
      births[k].copy(tip)
      bornAt[k] = time
      birth[k] = born++
    }
    lastSample = time
  }

  return {
    object: mesh,
    set(next) {
      look = next
      mesh.visible = look.enabled
      material.color.set(look.color)
      material.opacity = look.opacity
    },
    update(time, tip, eye) {
      const seconds = Math.max(0.05, look.seconds)
      const interval = seconds / (POINTS - 1)
      // Never placed, moved rather than carried, or the clock turned back: the trail starts over at the tip.
      if (Number.isNaN(lastSample) || time < lastSample || births[0].distanceTo(tip) > JUMP) gather(tip, time)
      else if (time - lastSample >= interval) {
        // Everyone a place older; the tip takes the first.
        for (let k = POINTS - 1; k > 0; k--) {
          births[k].copy(births[k - 1])
          bornAt[k] = bornAt[k - 1]
          birth[k] = birth[k - 1]
        }
        birth[0] = born++
        lastSample = time
      }
      births[0].copy(tip)
      bornAt[0] = time
      // The camera's across, for the sway: the view's right, flat.
      view.subVectors(tip, eye)
      across.set(view.z, 0, -view.x).normalize()
      for (let k = 0; k < POINTS; k++) {
        const age = time - bornAt[k]
        const s = Math.min(1, age / seconds)
        // Risen with age, and swayed across the view, more the older, at a pace and from a phase of its own birth.
        const sway = look.sway * s * Math.sin((s * look.waves + draw(birth[k], 0) * 0.5) * Math.PI * 2)
        places[k].copy(births[k]).addScaledVector(across, sway)
        places[k].y += look.rise * age * (0.85 + 0.15 * draw(birth[k], 1))
      }
      const breaks = Math.max(0, Math.round(look.breaks))
      const period = (1 - BREAK_FROM) / (breaks + 0.5)
      for (let r = 0; r <= ROWS; r++) {
        const k = Math.min(POINTS - 2, Math.floor(r / BETWEEN))
        const t = r / BETWEEN - k
        at.lerpVectors(places[k], places[k + 1], t)
        const s = r / ROWS
        // Thin at the flame, widest a third along, thinning to its end.
        let half = look.width * 0.5 * (0.25 + 0.75 * Math.min(1, s * 3)) * (1 - s) ** 0.8
        // Past the break, dashes: each tapered to both its ends, and nothing in the gaps.
        if (breaks > 0 && s > BREAK_FROM) {
          const u = ((s - BREAK_FROM) % period) / period
          half *= u < DASH ? Math.sqrt(Math.sin((u / DASH) * Math.PI)) : 0
        }
        // Across the ribbon: square to the path and to the view, so its width faces the camera.
        along.subVectors(places[Math.min(POINTS - 1, k + 1)], places[Math.max(0, k === 0 && t === 0 ? 0 : k)])
        if (along.lengthSq() < 1e-10) along.set(0, 1, 0)
        view.subVectors(at, eye)
        across.crossVectors(along, view)
        if (across.lengthSq() < 1e-12) across.set(1, 0, 0)
        across.normalize()
        positions.setXYZ(r * 2, at.x + across.x * half, at.y + across.y * half, at.z + across.z * half)
        positions.setXYZ(r * 2 + 1, at.x - across.x * half, at.y - across.y * half, at.z - across.z * half)
      }
      positions.needsUpdate = true
    },
  }
}
