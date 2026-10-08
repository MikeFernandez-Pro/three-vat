// The eyes' trails: a ribbon an eye a rat, the path that eye travelled over
// the last moment, laid flat on the ground at the eye's height, full width at
// the eye and drawn to a point at its tail, swaying a little along its length.
// So a trail bends where the rat swerved, and the rats' own weaving gives it
// its line; nothing of it comes from the camera.
//
// One geometry holds every ribbon: POINTS places a ribbon, laid as a smooth
// curve through them, CUTS rows to each gap between two places, two vertices
// a row, in a strip. The places are a history each eye keeps, moved along
// as time passes and the eye moves; the strip is rebuilt from them whenever
// any history changed, so between the stop motion's beats nothing is rebuilt.
// Smooth, a wiggle runs down every ribbon, each in its own phase: a trail
// that stands still between beats would read as a stick.
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Mesh, MeshBasicNodeMaterial } from 'three/webgpu'
import { attribute, oneMinus, uniform } from 'three/tsl'

/** A colour uniform, as `uniform(new Color())` makes it. */
const colourUniform = () => uniform(new Color())
type ColourUniform = ReturnType<typeof colourUniform>

/** Places a ribbon remembers, the eye's own first. */
const POINTS = 8
/** The rows a gap between two places is laid in, and the rows a ribbon has: the loop cuts that let its sway and its wiggle bend. */
const CUTS = 3
const ROWS = (POINTS - 1) * CUTS + 1
/** An eye that moves this far between two frames, m, was moved rather than ran: its ribbon starts over there. */
const JUMP = 1
/** The wiggle's two waves: how many lie along a ribbon, how fast each runs down it against the folder's speed, and the second's share. */
const WAVES = 1.25
const SECOND_WAVES = 2.1
const SECOND_SPEED = 0.63
const SECOND_SHARE = 0.5

/** What the eyes folder's trails edit. */
export interface TrailLook {
  enabled: boolean
  /** How long a trail is, as seconds of the rat's travel: places older than this are cut off. 0 is no trail. */
  seconds: number
  /** How wide a trail is at the eye, m; it narrows to a point. */
  width: number
  /** How brightly it is added, 0 none. */
  strength: number
  /** How far it sways from side to side along its length, as a share of its width. */
  wave: number
  /** How it narrows to its point: 1 straight sides, more a long needle, less a blunt tail. */
  taper: number
  /** How fast it fades toward the tail: 1 evenly, more sooner. */
  fade: number
  /** How far it wiggles from side to side at its tail, m, a wave running down it; nothing at the eye. 0 is none. */
  wiggle: number
  /** How many times a second the wiggle's wave runs down it. */
  wiggleSpeed: number
  /** Its colour, when not the eyes' own. */
  color: number
  eyeColour: boolean
}

export class Trails {
  readonly mesh: Mesh
  readonly material: MeshBasicNodeMaterial
  /** The eyes' colour, which the trail is added in. */
  readonly colour: ColourUniform
  private readonly strength = uniform(0)
  private readonly fade = uniform(2)
  /** The eyes' colour as last told, for when the trails take it. */
  private eyeHex = 0xffffff
  private geometry = new BufferGeometry()
  private positions = new Float32Array(0)
  /** Each ribbon's places, x and z, the eye's own first, then older; when each was taken; and when the last was. */
  private history = new Float32Array(0)
  private ages = new Float32Array(0)
  private sampledAt = new Float32Array(0)
  /** The last time a ribbon was placed, for laying them again at a new shape. */
  private lastNow = 0
  /** Ribbons folded away, so an unseen rat costs nothing after the first frame. */
  private folded = new Uint8Array(0)
  /** Each ribbon's height, the eye's, so a shape change can lay it again from its places. */
  private heights = new Float32Array(0)
  /** Per row along the ribbon: its half width and its sway, each as a share of the width. */
  private readonly halves = new Float32Array(ROWS)
  private readonly sways = new Float32Array(ROWS)
  /** A ribbon's places as drawn, cut at the trail's age. */
  private readonly drawnX = new Float32Array(POINTS)
  private readonly drawnZ = new Float32Array(POINTS)
  /** Each ribbon's own phase in the wiggle's two waves, as their cosines and sines. */
  private phases = new Float32Array(0)
  /** The wiggle's two waves at each row as last worked out, as sines and cosines: the same for every ribbon, but for its phase. */
  private readonly waves = new Float32Array(ROWS * 4)
  private wavedAt = Number.NaN
  private ribbons = 0
  private dirty = false
  private look: TrailLook = { enabled: false, seconds: 0.3, width: 0.04, strength: 1.5, wave: 0.3, taper: 1, fade: 2, wiggle: 0, wiggleSpeed: 3, color: 0xffffff, eyeColour: true }

  constructor(colour: ColourUniform) {
    this.colour = colour
    this.material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide })
    // Brightest at the eye, gone at the point.
    this.material.colorNode = colour.mul(this.strength).mul(oneMinus(attribute('along', 'float')).pow(this.fade))
    this.mesh = new Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
  }

  /** Room for `ribbons` ribbons: the strip's index and its fade are laid once, the places start empty. */
  resize(ribbons: number): void {
    this.ribbons = ribbons
    const vertices = ribbons * ROWS * 2
    this.positions = new Float32Array(vertices * 3)
    const along = new Float32Array(vertices)
    const index = new Uint32Array(ribbons * (ROWS - 1) * 6)
    for (let r = 0; r < ribbons; r++) {
      for (let j = 0; j < ROWS; j++) {
        const v = (r * ROWS + j) * 2
        along[v] = along[v + 1] = j / (ROWS - 1)
        if (j < ROWS - 1) {
          const t = (r * (ROWS - 1) + j) * 6
          index.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], t)
        }
      }
    }
    // Phases a golden angle apart, so neighbours never wiggle together.
    this.phases = new Float32Array(ribbons * 4)
    for (let r = 0; r < ribbons; r++) {
      const first = r * 2.39996
      const second = r * 1.3247 * Math.PI
      this.phases.set([Math.cos(first), Math.sin(first), Math.cos(second), Math.sin(second)], r * 4)
    }
    this.history = new Float32Array(ribbons * POINTS * 2)
    this.ages = new Float32Array(ribbons * POINTS)
    this.sampledAt = new Float32Array(ribbons)
    this.folded = new Uint8Array(ribbons)
    this.heights = new Float32Array(ribbons)
    const geometry = new BufferGeometry()
    const position = new BufferAttribute(this.positions, 3)
    position.setUsage(DynamicDrawUsage)
    geometry.setAttribute('position', position)
    geometry.setAttribute('along', new BufferAttribute(along, 1))
    geometry.setIndex(new BufferAttribute(index, 1))
    this.geometry.dispose()
    this.geometry = geometry
    this.mesh.geometry = geometry
    // Nothing drawn until a ribbon is laid: a fresh geometry's range is everything, all of it at the origin.
    geometry.setDrawRange(0, 0)
    this.dirty = true
  }

  /** Take the folder's values. */
  set(look: TrailLook): void {
    this.look = look
    this.strength.value = look.strength
    this.fade.value = Math.max(0.1, look.fade)
    this.colour.value.set(look.eyeColour ? this.eyeHex : look.color)
    this.mesh.visible = look.enabled
    for (let j = 0; j < ROWS; j++) {
      const t = j / (ROWS - 1)
      // Full width at the eye, a point at the tail; the sway a wave along the length that is nothing at either end.
      this.halves[j] = Math.pow(1 - t, look.taper) / 2
      this.sways[j] = look.wave * Math.sin(t * Math.PI * 2) * (1 - t)
    }
    // Every ribbon laid again at the new shape, from the places it has: the look is set again on every beat, and a reset here would never let a ribbon grow.
    for (let r = 0; r < this.ribbons; r++) if (this.sampledAt[r] !== 0) this.write(r, this.heights[r], POINTS, this.lastNow)
    this.dirty = true
  }

  /** The eyes' colour, which the trails take when the folder says so. */
  setEyeColour(hex: number): void {
    this.eyeHex = hex
    if (this.look.eyeColour) this.colour.value.set(hex)
  }

  /**
   * Ribbon `r`'s eye stands at (x, y, z) at `now` seconds; `shown` false and
   * the ribbon is folded away. A new place is taken once a share of the
   * trail's seconds has passed and the eye has moved; a still eye keeps its
   * places, which then age out of the trail's reach as it is drawn.
   */
  place(r: number, x: number, y: number, z: number, shown: boolean, now: number): void {
    const h = r * POINTS * 2
    const history = this.history
    const ages = this.ages
    this.lastNow = now
    /** Every place at the eye, taken now: the strip has no area. */
    const gather = () => {
      for (let k = 0; k < POINTS; k++) {
        history[h + k * 2] = x
        history[h + k * 2 + 1] = z
      }
      ages.fill(now, r * POINTS, (r + 1) * POINTS)
    }
    if (!shown) {
      // Folded onto the eye, once, and nothing more until it is seen.
      if (this.folded[r]) return
      this.folded[r] = 1
      this.sampledAt[r] = 0
      gather()
      this.write(r, y, POINTS, now)
      return
    }
    this.folded[r] = 0
    const moved = Math.hypot(x - history[h], z - history[h + 1])
    // A ribbon never placed, or whose eye was moved rather than ran, starts over at the eye: never a strip from elsewhere.
    if (this.sampledAt[r] === 0 || moved > JUMP) {
      gather()
      this.sampledAt[r] = now
      this.write(r, y, POINTS, now)
      return
    }
    const interval = this.look.seconds / (POINTS - 1)
    const took = now - this.sampledAt[r] >= interval && moved > 0.005
    if (took) {
      // Everyone a place older; the eye takes the first.
      history.copyWithin(h + 2, h, h + (POINTS - 1) * 2)
      ages.copyWithin(r * POINTS + 1, r * POINTS, (r + 1) * POINTS - 1)
      this.sampledAt[r] = now
    } else if (moved < 1e-4) {
      // Nothing moved: between the stop motion's beats, nothing to lay again.
      return
    }
    history[h] = x
    history[h + 1] = z
    ages[r * POINTS] = now
    // Only the head moved: the first two places change, the rest stand.
    this.write(r, y, took ? POINTS : 2, now)
  }

  /**
   * Lay ribbon `r`'s strip from its first `upTo` places, at height `y`, as of
   * `now`: a place older than the trail's seconds is drawn where the path was
   * at exactly that age, and every place past it there too, so the trail is
   * as long as its seconds say and no longer, and 0 is no trail.
   */
  private write(r: number, y: number, upTo: number, now: number): void {
    const { width, seconds, wiggle } = this.look
    this.heights[r] = y
    const h = r * POINTS * 2
    const history = this.history
    const ages = this.ages
    const positions = this.positions
    const px = this.drawnX
    const pz = this.drawnZ
    let cut = false
    for (let k = 0; k < POINTS; k++) {
      let x = history[h + k * 2]
      let z = history[h + k * 2 + 1]
      if (cut) {
        x = px[k - 1]
        z = pz[k - 1]
      } else if (k > 0 && now - ages[r * POINTS + k] > seconds) {
        // The path crossed the trail's age between the last place and this one: where it was then.
        const younger = now - ages[r * POINTS + k - 1]
        const older = now - ages[r * POINTS + k]
        const t = older > younger ? Math.min(1, Math.max(0, (seconds - younger) / (older - younger))) : 0
        x = history[h + (k - 1) * 2] + (x - history[h + (k - 1) * 2]) * t
        z = history[h + (k - 1) * 2 + 1] + (z - history[h + (k - 1) * 2 + 1]) * t
        cut = true
      }
      px[k] = x
      pz[k] = z
    }
    // A wiggling ribbon moves all along it every frame; a still one only where its first places moved, which bend the curve two gaps down.
    const rows = wiggle > 0 ? ROWS : Math.min(ROWS, upTo * CUTS + 1)
    if (wiggle > 0 && this.wavedAt !== now) this.wave(now)
    const waves = this.waves
    const phases = this.phases
    let nx = 0
    let nz = 0
    for (let j = 0; j < rows; j++) {
      // Catmull-Rom through the places round this row's gap: a curve through every place, its bends spread over the cuts.
      const k = Math.min(POINTS - 2, Math.floor(j / CUTS))
      const u = j / CUTS - k
      const a = Math.max(0, k - 1)
      const d = Math.min(POINTS - 1, k + 2)
      const x0 = px[a], x1 = px[k], x2 = px[k + 1], x3 = px[d]
      const z0 = pz[a], z1 = pz[k], z2 = pz[k + 1], z3 = pz[d]
      const bx = x2 - x0, cx = 2 * x0 - 5 * x1 + 4 * x2 - x3, ex = 3 * (x1 - x2) + x3 - x0
      const bz = z2 - z0, cz = 2 * z0 - 5 * z1 + 4 * z2 - z3, ez = 3 * (z1 - z2) + z3 - z0
      const x = x1 + 0.5 * u * (bx + u * (cx + u * ex))
      const z = z1 + 0.5 * u * (bz + u * (cz + u * ez))
      // Across the ribbon: the perpendicular of the curve here, the last one's where the path stands still.
      const dx = bx + u * (2 * cx + 3 * u * ex)
      const dz = bz + u * (2 * cz + 3 * u * ez)
      const length = Math.hypot(dx, dz)
      if (length > 1e-5) {
        nx = dz / length
        nz = -dx / length
      }
      const half = width * this.halves[j]
      let sway = width * this.sways[j]
      if (wiggle > 0) {
        // Each wave's sine at the row's phase and the ribbon's together, from the sines and cosines of each.
        const w = j * 4
        const p = r * 4
        const first = waves[w] * phases[p] + waves[w + 1] * phases[p + 1]
        const second = waves[w + 2] * phases[p + 2] + waves[w + 3] * phases[p + 3]
        sway += (wiggle * (j / (ROWS - 1)) * (first + SECOND_SHARE * second)) / (1 + SECOND_SHARE)
      }
      const v = (r * ROWS + j) * 2 * 3
      positions[v] = x + nx * (half + sway)
      positions[v + 1] = y
      positions[v + 2] = z + nz * (half + sway)
      positions[v + 3] = x + nx * (sway - half)
      positions[v + 4] = y
      positions[v + 5] = z + nz * (sway - half)
    }
    this.dirty = true
  }

  /** The wiggle's two waves at each row at `now`, running down the ribbon from the eye. */
  private wave(now: number): void {
    this.wavedAt = now
    const speed = this.look.wiggleSpeed
    for (let j = 0; j < ROWS; j++) {
      const t = j / (ROWS - 1)
      const first = Math.PI * 2 * (WAVES * t - speed * now)
      const second = Math.PI * 2 * (SECOND_WAVES * t - SECOND_SPEED * speed * now)
      this.waves.set([Math.sin(first), Math.cos(first), Math.sin(second), Math.cos(second)], j * 4)
    }
  }

  /** After every ribbon of the frame is placed: the strip goes to the GPU if anything moved. */
  commit(ribbons: number): void {
    this.geometry.setDrawRange(0, Math.min(ribbons, this.ribbons) * (ROWS - 1) * 6)
    if (!this.dirty) return
    this.geometry.getAttribute('position').needsUpdate = true
    this.dirty = false
  }
}
