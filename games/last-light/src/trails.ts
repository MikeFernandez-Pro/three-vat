// The eyes' trails: a ribbon an eye a rat, the path that eye travelled over
// the last moment, laid flat on the ground at the eye's height, full width at
// the eye and drawn to a point at its tail, swaying a little along its length.
// So a trail bends where the rat swerved, and the rats' own weaving gives it
// its line; nothing of it comes from the camera.
//
// One geometry holds every ribbon: POINTS places a ribbon, two vertices a
// place, in a strip. The places are a history each eye keeps, moved along
// as time passes and the eye moves; the strip is rebuilt from them whenever
// any history changed, so between the stop motion's beats nothing is rebuilt.
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Mesh, MeshBasicNodeMaterial } from 'three/webgpu'
import { attribute, oneMinus, uniform } from 'three/tsl'

/** A colour uniform, as `uniform(new Color())` makes it. */
const colourUniform = () => uniform(new Color())
type ColourUniform = ReturnType<typeof colourUniform>

/** Places a ribbon remembers, the eye's own first. */
const POINTS = 8

/** What the eye trails folder edits. */
export interface TrailLook {
  enabled: boolean
  /** How long a trail is, as seconds of the rat's travel it remembers. */
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
  /** Each ribbon's places, x and z, the eye's own first, then older; and when the last place was taken. */
  private history = new Float32Array(0)
  private sampledAt = new Float32Array(0)
  private ribbons = 0
  private dirty = false
  private look: TrailLook = { enabled: false, seconds: 0.3, width: 0.04, strength: 1.5, wave: 0.3, taper: 1, fade: 2, color: 0xffffff, eyeColour: true }

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
    const vertices = ribbons * POINTS * 2
    this.positions = new Float32Array(vertices * 3)
    const along = new Float32Array(vertices)
    const index = new Uint32Array(ribbons * (POINTS - 1) * 6)
    for (let r = 0; r < ribbons; r++) {
      for (let k = 0; k < POINTS; k++) {
        const v = (r * POINTS + k) * 2
        along[v] = along[v + 1] = k / (POINTS - 1)
        if (k < POINTS - 1) {
          const t = (r * (POINTS - 1) + k) * 6
          index.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], t)
        }
      }
    }
    this.history = new Float32Array(ribbons * POINTS * 2)
    this.sampledAt = new Float32Array(ribbons)
    const geometry = new BufferGeometry()
    const position = new BufferAttribute(this.positions, 3)
    position.setUsage(DynamicDrawUsage)
    geometry.setAttribute('position', position)
    geometry.setAttribute('along', new BufferAttribute(along, 1))
    geometry.setIndex(new BufferAttribute(index, 1))
    this.geometry.dispose()
    this.geometry = geometry
    this.mesh.geometry = geometry
    this.dirty = true
  }

  /** Take the folder's values. */
  set(look: TrailLook): void {
    this.look = look
    this.strength.value = look.strength
    this.fade.value = Math.max(0.1, look.fade)
    this.colour.value.set(look.eyeColour ? this.eyeHex : look.color)
    this.mesh.visible = look.enabled
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
    // A ribbon never placed, or folded away, starts with every place at the eye: never a strip from the origin.
    if (!shown || this.sampledAt[r] === 0) {
      // Folded onto the eye: every place the same, so the strip has no area.
      for (let k = 0; k < POINTS; k++) {
        history[h + k * 2] = x
        history[h + k * 2 + 1] = z
      }
      this.sampledAt[r] = now
      this.write(r, y)
      return
    }
    const interval = this.look.seconds / (POINTS - 1)
    const moved = Math.hypot(x - history[h], z - history[h + 1])
    if (now - this.sampledAt[r] >= interval && moved > 0.005) {
      // Everyone a place older; the eye takes the first.
      history.copyWithin(h + 2, h, h + (POINTS - 1) * 2)
      this.sampledAt[r] = now
    }
    history[h] = x
    history[h + 1] = z
    this.write(r, y)
  }

  /** Lay ribbon `r`'s strip from its places, at height `y`. */
  private write(r: number, y: number): void {
    const { width, wave, taper } = this.look
    const h = r * POINTS * 2
    const history = this.history
    const positions = this.positions
    let nx = 0
    let nz = 0
    for (let k = 0; k < POINTS; k++) {
      const x = history[h + k * 2]
      const z = history[h + k * 2 + 1]
      // Across the ribbon: the perpendicular of the path through this place, the last one's where the path stands still.
      const ax = history[h + Math.max(0, k - 1) * 2] - history[h + Math.min(POINTS - 1, k + 1) * 2]
      const az = history[h + Math.max(0, k - 1) * 2 + 1] - history[h + Math.min(POINTS - 1, k + 1) * 2 + 1]
      const length = Math.hypot(ax, az)
      if (length > 1e-5) {
        nx = -az / length
        nz = ax / length
      }
      const t = k / (POINTS - 1)
      // Full width at the eye, a point at the tail; and the sway, a wave along the length that is nothing at either end.
      const half = (width * Math.pow(1 - t, taper)) / 2
      const sway = width * wave * Math.sin(t * Math.PI * 2) * (1 - t)
      const v = ((r * POINTS + k) * 2) * 3
      positions[v] = x + nx * (half + sway)
      positions[v + 1] = y
      positions[v + 2] = z + nz * (half + sway)
      positions[v + 3] = x + nx * (sway - half)
      positions[v + 4] = y
      positions[v + 5] = z + nz * (sway - half)
    }
    this.dirty = true
  }

  /** After every ribbon of the frame is placed: the strip goes to the GPU if anything moved. */
  commit(ribbons: number): void {
    this.geometry.setDrawRange(0, Math.min(ribbons, this.ribbons) * (POINTS - 1) * 6)
    if (!this.dirty) return
    this.geometry.getAttribute('position').needsUpdate = true
    this.dirty = false
  }
}
