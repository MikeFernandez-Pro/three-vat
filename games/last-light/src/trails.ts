// The eyes' trails: a ribbon an eye a rat, the path that eye travelled over
// the last moment, laid flat on the ground at the eye's height, full width at
// the eye and drawn to a point at its tail, swaying a little along its length.
// So a trail bends where the rat swerved, and the rats' own weaving gives it
// its line; nothing of it comes from the camera.
//
// One ribbon is drawn an instance a seen eye: POINTS places, laid as a
// smooth curve through them, CUTS rows to each gap between two places, two
// vertices a row, in a strip. The places are a history each eye keeps, moved
// along as time passes and the eye moves; the vertex stage lays the strip
// from them, so the page only keeps the history. Each row carries its share
// of every place, on the curve and along its slope, so the curve is a sum and
// no place is looked up. Each frame the seen eyes' ribbons are packed from
// the first instance and sent up, with where the trail's age cuts the path:
// an eye out of sight costs nothing, and its ribbon starts over at the eye
// when it is seen again. Smooth, a wiggle runs down every ribbon, each in its
// own phase: a trail that stands still between beats would read as a stick.
import {
  AdditiveBlending,
  BufferAttribute,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
} from 'three/webgpu'
import { attribute, dot, Fn, max, mix, oneMinus, positionGeometry, sin, step, uniform, vec2, vec3, vec4 } from 'three/tsl'

/** A colour uniform, as `uniform(new Color())` makes it. */
const colourUniform = () => uniform(new Color())
type ColourUniform = ReturnType<typeof colourUniform>

/** Places a ribbon remembers, the eye's own first. */
export const POINTS = 8
/** The rows a gap between two places is laid in, and the rows a ribbon has: the loop cuts that let its sway and its wiggle bend. */
export const CUTS = 3
export const ROWS = (POINTS - 1) * CUTS + 1
/** An eye that moves this far between two frames, m, was moved rather than ran: its ribbon starts over there. */
const JUMP = 1
/** The wiggle's two waves: how many lie along a ribbon, how fast each runs down it against the folder's speed, and the second's share. */
const WAVES = 1.25
const SECOND_WAVES = 2.1
const SECOND_SPEED = 0.63
const SECOND_SHARE = 0.5
const TAU = Math.PI * 2

/**
 * Row `j`'s share of each of the POINTS places: where it lies on the
 * Catmull-Rom curve through them, and the curve's slope there, each a sum of
 * the places by these weights.
 */
export function rowWeights(j: number): { place: Float32Array; slope: Float32Array } {
  const k = Math.min(POINTS - 2, Math.floor(j / CUTS))
  const u = j / CUTS - k
  const place = new Float32Array(POINTS)
  const slope = new Float32Array(POINTS)
  // The four places round the row's gap, the ends held where the history runs out.
  const around = [Math.max(0, k - 1), k, k + 1, Math.min(POINTS - 1, k + 2)]
  const onCurve = [-0.5 * u + u * u - 0.5 * u ** 3, 1 - 2.5 * u * u + 1.5 * u ** 3, 0.5 * u + 2 * u * u - 1.5 * u ** 3, -0.5 * u * u + 0.5 * u ** 3]
  const along = [-1 + 4 * u - 3 * u * u, -10 * u + 9 * u * u, 1 + 8 * u - 9 * u * u, -2 * u + 3 * u * u]
  for (let i = 0; i < 4; i++) {
    place[around[i]] += onCurve[i]
    slope[around[i]] += along[i]
  }
  return { place, slope }
}

/** Where a trail's age cuts its path: the first place drawn at the cut, POINTS for none, and the cut's place. */
export interface Cut {
  first: number
  x: number
  z: number
}

/**
 * Ribbon `r`'s cut at `now`: a place older than `seconds` is drawn where the
 * path was at exactly that age, and every place past it there too, so the
 * trail is as long as its seconds say and no longer, and 0 is no trail.
 */
export function cutAt(history: Float32Array, ages: Float32Array, r: number, now: number, seconds: number, out: Cut = { first: 0, x: 0, z: 0 }): Cut {
  const h = r * POINTS * 2
  const a = r * POINTS
  for (let k = 1; k < POINTS; k++) {
    if (now - ages[a + k] <= seconds) continue
    // The path crossed the trail's age between the last place and this one: where it was then.
    const younger = now - ages[a + k - 1]
    const older = now - ages[a + k]
    const t = older > younger ? Math.min(1, Math.max(0, (seconds - younger) / (older - younger))) : 0
    out.first = k
    out.x = history[h + (k - 1) * 2] + (history[h + k * 2] - history[h + (k - 1) * 2]) * t
    out.z = history[h + (k - 1) * 2 + 1] + (history[h + k * 2 + 1] - history[h + (k - 1) * 2 + 1]) * t
    return out
  }
  out.first = POINTS
  return out
}

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

/**
 * One ribbon's strip, its rows along it and the two sides across, each row
 * with its share of every place: one buffer, as WebGPU allows a draw only
 * eight, and the ribbons' own take six more. Those are one attribute each:
 * three updates every attribute on its own, and a second on a shared buffer
 * would send the whole of it up again.
 */
function strip(): { position: InterleavedBufferAttribute; weights: InterleavedBufferAttribute[]; index: BufferAttribute } {
  const stride = 3 + 4 * 4
  const data = new Float32Array(ROWS * 2 * stride)
  const index: number[] = []
  for (let j = 0; j < ROWS; j++) {
    const { place, slope } = rowWeights(j)
    for (let side = 0; side < 2; side++) {
      const v = (j * 2 + side) * stride
      // Along the ribbon, 0 at the eye; across it, +1 one side and -1 the other.
      data[v] = j / (ROWS - 1)
      data[v + 1] = side === 0 ? 1 : -1
      data.set(place, v + 3)
      data.set(slope, v + 3 + POINTS)
    }
    if (j < ROWS - 1) {
      const v = j * 2
      index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2)
    }
  }
  const buffer = new InterleavedBuffer(data, stride)
  return {
    position: new InterleavedBufferAttribute(buffer, 3, 0),
    weights: [0, 1, 2, 3].map((i) => new InterleavedBufferAttribute(buffer, 4, 3 + i * 4)),
    index: new BufferAttribute(new Uint16Array(index), 1),
  }
}

/** `size` floats a ribbon drawn, nothing in them yet. */
const perRibbon = (ribbons: number, size: number) => new InstancedBufferAttribute(new Float32Array(ribbons * size), size)

export class Trails {
  readonly mesh: Mesh
  readonly material: MeshBasicNodeMaterial
  /** The eyes' colour, which the trail is added in. */
  readonly colour: ColourUniform
  private readonly strength = uniform(0)
  private readonly fade = uniform(2)
  private readonly width = uniform(0.04)
  private readonly taper = uniform(1)
  private readonly wave = uniform(0.3)
  private readonly wiggle = uniform(0)
  private readonly wiggleSpeed = uniform(3)
  /** The page's clock, s, which the wiggle runs on. */
  private readonly time = uniform(0)
  /** The eyes' colour as last told, for when the trails take it. */
  private eyeHex = 0xffffff
  private geometry = new InstancedBufferGeometry()
  /** Each ribbon's places, x and z, the eye's own first, then older; when each was taken; and when it last took one, 0 to start over at the eye. */
  private history = new Float32Array(0)
  private ages = new Float32Array(0)
  private sampledAt = new Float32Array(0)
  /** The time the frame's ribbons are placed at, s. */
  private now = 0
  /**
   * The frame's ribbons, one a seen eye, packed from the first instance: the
   * eye's place and height and the first place at the cut; the cut's place
   * and the ribbon's own number; its older places, the second to the eighth,
   * two to a slot.
   */
  private head = perRibbon(0, 4)
  private cut = perRibbon(0, 4)
  private past = [0, 1, 2, 3].map(() => perRibbon(0, 4))
  /** How many ribbons the frame has drawn so far. */
  private shown = 0
  private readonly cutting: Cut = { first: 0, x: 0, z: 0 }
  private ribbons = 0
  private look: TrailLook = { enabled: false, seconds: 0.3, width: 0.04, strength: 1.5, wave: 0.3, taper: 1, fade: 2, wiggle: 0, wiggleSpeed: 3, color: 0xffffff, eyeColour: true }

  constructor(colour: ColourUniform) {
    this.colour = colour
    this.material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide })
    const along = positionGeometry.x
    this.material.positionNode = Fn(() => {
      const across = positionGeometry.y
      const head = attribute('trailHead', 'vec4')
      const cut = attribute('trailCut', 'vec4')
      const [a, b, c, d] = [0, 1, 2, 3].map((i) => attribute(`trailPast${i}`, 'vec4'))
      // The places' x and z, the eye's first, four to a vector; from the first at the cut on, the cut's place.
      const atCut0 = step(head.w, vec4(0, 1, 2, 3))
      const atCut1 = step(head.w, vec4(4, 5, 6, 7))
      const x0 = mix(vec4(head.x, a.x, a.z, b.x), vec4(cut.x), atCut0)
      const z0 = mix(vec4(head.z, a.y, a.w, b.y), vec4(cut.y), atCut0)
      const x1 = mix(vec4(b.z, c.x, c.z, d.x), vec4(cut.x), atCut1)
      const z1 = mix(vec4(b.w, c.y, c.w, d.y), vec4(cut.y), atCut1)
      const [onA, onB, alongA, alongB] = [0, 1, 2, 3].map((i) => attribute(`trailWeights${i}`, 'vec4'))
      const x = dot(onA, x0).add(dot(onB, x1))
      const z = dot(onA, z0).add(dot(onB, z1))
      const dx = dot(alongA, x0).add(dot(alongB, x1))
      const dz = dot(alongA, z0).add(dot(alongB, z1))
      // Across the ribbon: the perpendicular of the curve here, none where the path stands still.
      const length = vec2(dx, dz).length()
      const normal = vec2(dz, dx.negate()).div(max(length, 1e-5)).mul(step(1e-5, length))
      // Full width at the eye, a point at the tail; the sway a wave along the length that is nothing at either end.
      const half = this.width.mul(max(oneMinus(along), 1e-6).pow(this.taper)).mul(0.5)
      const sway = this.width.mul(this.wave).mul(sin(along.mul(TAU))).mul(oneMinus(along))
      // The wiggle's two waves running down the ribbon from the eye, nothing at the eye; each ribbon in its
      // own phase, by its own number rather than its place in the frame, a golden angle from the last.
      const ribbon = cut.z
      const phase = vec2(ribbon.mul(2.39996 / TAU), ribbon.mul(1.3247 / 2)).fract().mul(TAU)
      const first = sin(along.mul(WAVES).sub(this.wiggleSpeed.mul(this.time)).mul(TAU).add(phase.x))
      const second = sin(along.mul(SECOND_WAVES).sub(this.wiggleSpeed.mul(SECOND_SPEED).mul(this.time)).mul(TAU).add(phase.y))
      const wiggle = this.wiggle.mul(along).mul(first.add(second.mul(SECOND_SHARE))).div(1 + SECOND_SHARE)
      const off = sway.add(wiggle).add(across.mul(half))
      return vec3(x.add(normal.x.mul(off)), head.y, z.add(normal.y.mul(off)))
    })()
    // Brightest at the eye, gone at the point.
    this.material.colorNode = colour.mul(this.strength).mul(oneMinus(along).pow(this.fade))
    this.mesh = new Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
  }

  /** Room for `ribbons` ribbons, every one to start over at its eye when first seen. */
  resize(ribbons: number): void {
    this.ribbons = ribbons
    this.history = new Float32Array(ribbons * POINTS * 2)
    this.ages = new Float32Array(ribbons * POINTS)
    this.sampledAt = new Float32Array(ribbons)
    this.head = perRibbon(ribbons, 4)
    this.cut = perRibbon(ribbons, 4)
    this.past = [0, 1, 2, 3].map(() => perRibbon(ribbons, 4))
    const geometry = new InstancedBufferGeometry()
    // The strip anew with each geometry: disposing the last one destroys its buffers, shared or not.
    const { index, position, weights } = strip()
    geometry.setIndex(index)
    geometry.setAttribute('position', position)
    weights.forEach((w, i) => geometry.setAttribute(`trailWeights${i}`, w))
    geometry.setAttribute('trailHead', this.head)
    geometry.setAttribute('trailCut', this.cut)
    this.past.forEach((p, i) => geometry.setAttribute(`trailPast${i}`, p))
    // Nothing drawn until a ribbon is laid.
    geometry.instanceCount = 0
    this.shown = 0
    this.geometry.dispose()
    this.geometry = geometry
    this.mesh.geometry = geometry
  }

  /** Take the folder's values; a new length cuts the ribbons as the next frame places them. */
  set(look: TrailLook): void {
    this.look = look
    this.strength.value = look.strength
    this.fade.value = Math.max(0.1, look.fade)
    this.width.value = look.width
    this.taper.value = look.taper
    this.wave.value = look.wave
    this.wiggle.value = look.wiggle
    this.wiggleSpeed.value = look.wiggleSpeed
    this.colour.value.set(look.eyeColour ? this.eyeHex : look.color)
    this.mesh.visible = look.enabled
  }

  /** The eyes' colour, which the trails take when the folder says so. */
  setEyeColour(hex: number): void {
    this.eyeHex = hex
    if (this.look.eyeColour) this.colour.value.set(hex)
  }

  /** A frame's ribbons are placed as of `now` seconds, none drawn yet. */
  begin(now: number): void {
    this.now = now
    this.time.value = now
    this.shown = 0
  }

  /** Ribbon `r`'s eye is out of sight: nothing of it is worked out or drawn, and it starts over at the eye when seen again. */
  fold(r: number): void {
    this.sampledAt[r] = 0
  }

  /**
   * Ribbon `r`'s eye stands at (x, y, z) as the frame begun has it, and the
   * ribbon is drawn. A new place is taken once a share of the trail's
   * seconds has passed and the eye has moved; a still eye keeps its places,
   * which then age out of the trail's reach as it is drawn.
   */
  place(r: number, x: number, y: number, z: number): void {
    const now = this.now
    const h = r * POINTS * 2
    const a = r * POINTS
    const history = this.history
    const ages = this.ages
    const dx = x - history[h]
    const dz = z - history[h + 1]
    const moved = Math.sqrt(dx * dx + dz * dz)
    if (this.sampledAt[r] === 0 || moved > JUMP) {
      // A ribbon never placed, out of sight since, or whose eye was moved rather than ran, starts over at the eye: every place
      // there, taken now, so the strip has no area. Never a strip from elsewhere.
      for (let k = 0; k < POINTS; k++) {
        history[h + k * 2] = x
        history[h + k * 2 + 1] = z
        ages[a + k] = now
      }
      this.sampledAt[r] = now
    } else {
      if (now - this.sampledAt[r] >= this.look.seconds / (POINTS - 1) && moved > 0.005) {
        // Everyone a place older; the eye takes the first.
        for (let k = POINTS - 1; k > 0; k--) {
          history[h + k * 2] = history[h + k * 2 - 2]
          history[h + k * 2 + 1] = history[h + k * 2 - 1]
          ages[a + k] = ages[a + k - 1]
        }
        this.sampledAt[r] = now
      }
      history[h] = x
      history[h + 1] = z
      ages[a] = now
    }
    this.draw(r, y)
  }

  /** Ribbon `r` into the frame's next instance: its eye at height `y`, its cut, its older places and its number. */
  private draw(r: number, y: number): void {
    const s = this.shown++
    const h = r * POINTS * 2
    const history = this.history
    const cut = cutAt(history, this.ages, r, this.now, this.look.seconds, this.cutting)
    const head = this.head.array as Float32Array
    head[s * 4] = history[h]
    head[s * 4 + 1] = y
    head[s * 4 + 2] = history[h + 1]
    head[s * 4 + 3] = cut.first
    const cutPlace = this.cut.array as Float32Array
    cutPlace[s * 4] = cut.x
    cutPlace[s * 4 + 1] = cut.z
    cutPlace[s * 4 + 2] = r
    // The older places by hand: a view or a copy a slot cost more than the copying, a few thousand ribbons a frame.
    const [pa, pb, pc, pd] = this.past.map((slot) => slot.array as Float32Array)
    const p = h + 2
    const at = s * 4
    for (let i = 0; i < 4; i++) {
      pa[at + i] = history[p + i]
      pb[at + i] = history[p + 4 + i]
      pc[at + i] = history[p + 8 + i]
    }
    // The last slot holds the eighth place alone.
    pd[at] = history[p + 12]
    pd[at + 1] = history[p + 13]
  }

  /** After every seen eye of the frame is placed: its ribbons, and only those, go to the GPU and are drawn. */
  commit(): void {
    const count = Math.min(this.shown, this.ribbons)
    this.geometry.instanceCount = count
    if (count === 0) return
    for (const attribute of [this.head, this.cut, ...this.past]) {
      attribute.clearUpdateRanges()
      attribute.addUpdateRange(0, count * attribute.itemSize)
      attribute.needsUpdate = true
    }
  }
}
