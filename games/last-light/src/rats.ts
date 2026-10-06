// The crowd the swarm is drawn as: one `BatchedMesh` over the baked rat, one
// geometry and one material (the rat's flat colours merged at the bake),
// culled rat by rat and drawn in one draw by the collapse. Every rat plays Run,
// looping, from its own moment in the cycle, at the one playback speed the
// panel sets. A rat's row is written when it spawns and when that speed moves;
// never otherwise. Per frame, only the matrices and which rats are in view move.
//
// The batch is sized to the count, not to the capacity: its matrices texture
// is uploaded whole every frame, a fixed cost of the batch's size, so the
// batch is rebuilt a size up as the count outgrows it, on the same material and
// the same playback rows.
import {
  BatchedMesh,
  BufferAttribute,
  type BufferGeometry,
  Color,
  Frustum,
  Group,
  Matrix4,
  Quaternion,
  Sphere,
  Vector3,
  type Camera,
} from 'three/webgpu'
import { createVATPlaybackTexture, setVATInstance, trackVATPoints, type VAT, type VATPlaybackTexture } from 'three-vat'
import { vatNodes, type VATTimeUniform } from 'three-vat/tsl'
import { attribute, mx_noise_vec3, uniform } from 'three/tsl'
import { Trails, type TrailLook } from './trails'
import { ShellToonMaterial } from './shell'
import { createStrokes } from './strokes'

/** Where the swarm has its rats this frame: the first `count` of each array, each rat's facing, and how fast it really moves. */
export interface Placed {
  /** Whether the places are real yet: before the swarm's first word they are zeros, and nothing is drawn. */
  ready: boolean
  /** Counts up when the places change: the same number as last frame, and the ribbons are left as they are. */
  version: number
  count: number
  x: Float32Array
  z: Float32Array
  heading: Float32Array
  vx: Float32Array
  vz: Float32Array
  /** What each rat's feet play, 0 Run, 1 Walk, 2 Idle, as the swarm reads it from how fast the rat really moves. */
  gait: Uint8Array
}

/**
 * Seconds a rat takes to blend from one gait's clip into the next: none, a
 * cut. A blend poses the rat twice in every pass while it lasts, and with
 * rats changing gait some thousand times a second that doubled the GPU's
 * frame; under the stop motion a cut is what the animator does anyway.
 */
const GAIT_FADE = 0

/** The layer the eyes' trails draw on, and the frame's pre-pass leaves out; the torch's flame and embers draw on it too. */
export const TRAIL_LAYER = 1
export type { TrailLook } from './trails'

/** What the swarm is drawn as: a baked model, the clip it runs with, and the way it faces. */
export interface Creature {
  /** The baked file, under public/. */
  url: string
  /** The clip every one plays, as the bake names it; and, where the model has them, the clips it walks and stands in. */
  clip: string
  walk?: string
  idle?: string
  /** Which way the model faces at no turn: the rat runs along +z, the scarab along -z. */
  facing: 1 | -1
  /** The playback speed at which the clip's feet keep to the ground at the usual speeds. */
  playback: number
  /** Whether to shade the model smooth at load: for one exported flat, every face its own facet. */
  smooth: boolean
  /** The tint to start, which the panel's rats folder then edits: white leaves a model its own colours. */
  color: number
  /**
   * The model's parts, where its bake merged several flat colours into one:
   * the part with the most vertices first. Each gets a colour control of its
   * own, starting at `color` where given and at the colour it was modelled in
   * where not. Empty for a model of one colour.
   */
  parts: { name: string; color?: number }[]
}

/**
 * The rat: a thousand vertices in three flat colours, a dusky pink body, grey
 * paws and ears and yellow eyes, merged into vertex colours at the bake. One
 * cycle of Run is 16 frames, a little over half a second at 1; the playback
 * that keeps its feet to the ground at the usual speeds is the first rat's,
 * 1.7, and is not yet checked by eye on this one.
 */
export const RAT: Creature = {
  url: './models/rat.vat.glb',
  clip: 'RatArmature|RatArmature|Rat_Run',
  walk: 'RatArmature|RatArmature|Rat_Walk',
  idle: 'RatArmature|RatArmature|Rat_Idle',
  facing: 1,
  playback: 1.7,
  smooth: false,
  // Untinted: its own three colours.
  color: 0xffffff,
  // A dusky wine skin (belly, paws, ears and tail), the fur near black as
  // modelled, the eyes a sharp yellow: chosen in the panel on 2026-10-05.
  parts: [{ name: 'skin', color: 0x613d43 }, { name: 'fur' }, { name: 'eyes', color: 0xf3ff47 }],
}

/**
 * The scarab: its Run is a second a cycle, so its playback runs ahead to keep
 * its six feet on the ground. Its colour is its material's as modelled, a
 * near-black grey.
 */
export const SCARAB: Creature = {
  url: './models/scarab.vat.glb',
  clip: 'Run',
  facing: -1,
  playback: 3,
  smooth: true,
  color: 0x000000,
  parts: [],
}

/**
 * Shade `geometry` smooth: every vertex takes the mean of the face normals
 * round its position, across the vertices that share it. A mesh exported
 * flat has a vertex a face corner, each with its face's normal; averaging
 * them by position, not by index, is what joins the facets into one shell.
 */
function shadeSmooth(geometry: BufferGeometry): void {
  geometry.computeVertexNormals()
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const sums = new Map<string, Float64Array>()
  const keys: string[] = []
  for (let i = 0; i < position.count; i++) {
    const key = `${position.getX(i).toFixed(5)},${position.getY(i).toFixed(5)},${position.getZ(i).toFixed(5)}`
    keys.push(key)
    let sum = sums.get(key)
    if (sum === undefined) sums.set(key, (sum = new Float64Array(3)))
    sum[0] += normal.getX(i)
    sum[1] += normal.getY(i)
    sum[2] += normal.getZ(i)
  }
  for (let i = 0; i < position.count; i++) {
    const [x, y, z] = sums.get(keys[i])!
    const length = Math.hypot(x, y, z) || 1
    normal.setXYZ(i, x / length, y / length, z / length)
  }
  normal.needsUpdate = true
}

/**
 * The rat's length across every frame of Run, nose to tail, in metres: its
 * body, without the tail, is a little over half of it, about 0.25 m.
 */
const RAT_LENGTH = 0.46

type Clip = VAT['clips'][number]

/** One cycle of `clip`, in seconds at playback speed 1. */
const cycle = (clip: Clip) => clip.frames / clip.fps

const UP = new Vector3(0, 1, 0)

/** A part of a model: its name, and the colour it was modelled in, as hex. */
export interface Part {
  name: string
  color: number
}

/**
 * Split `geometry` into the creature's parts by its baked vertex colours: each
 * distinct colour is a part, the most vertices first, and every vertex is
 * given its part's index in a `part` attribute. Nothing, and the colours left
 * as they are, when the model has none, or more than the creature names.
 */
function partition(geometry: BufferGeometry, names: Creature['parts']): Part[] {
  const colors = geometry.getAttribute('color')
  if (colors === undefined || names.length === 0) return []
  const counts = new Map<number, number>()
  const hexes = new Uint32Array(colors.count)
  const colour = new Color()
  for (let i = 0; i < colors.count; i++) {
    const hex = colour.setRGB(colors.getX(i), colors.getY(i), colors.getZ(i), 'srgb-linear').getHex()
    hexes[i] = hex
    counts.set(hex, (counts.get(hex) ?? 0) + 1)
  }
  if (counts.size > names.length) {
    console.warn(`last-light: the model has ${counts.size} colours, more than the ${names.length} parts named; its colours are left as baked`)
    return []
  }
  const order = [...counts].sort((a, b) => b[1] - a[1]).map(([hex]) => hex)
  const index = new Float32Array(colors.count)
  for (let i = 0; i < colors.count; i++) index[i] = order.indexOf(hexes[i])
  geometry.setAttribute('part', new BufferAttribute(index, 1))
  return order.map((hex, i) => ({ name: names[i].name, color: names[i].color ?? hex }))
}

/**
 * The eyes, as the vertices each is made of: the eye part's vertices split by
 * side of the rest pose into two, one where the part is all on one side, none
 * where the model has no eyes part.
 */
function eyesOf(geometry: BufferGeometry, eyePart: number): number[][] {
  if (eyePart < 0) return []
  const part = geometry.getAttribute('part')
  const position = geometry.getAttribute('position')
  const sides: number[][] = [[], []]
  for (let i = 0; i < part.count; i++) if (part.getX(i) === eyePart) sides[position.getX(i) < 0 ? 0 : 1].push(i)
  return sides.filter((side) => side.length > 0)
}

/**
 * How far past the view a rat is still drawn, in metres: its own length, and
 * the shadow it casts into the view from just outside it.
 */
const CULL_MARGIN = 1

/** The smallest batch built: below this the matrices texture costs nothing worth saving. */
const MIN_BATCH = 1024

/** The batch size for `count` rats: the power of two above it, from MIN_BATCH up to `capacity`. */
const batchSizeFor = (count: number, capacity: number) =>
  Math.min(capacity, Math.max(MIN_BATCH, 2 ** Math.ceil(Math.log2(Math.max(1, count)))))

export class Rats {
  /** What the scene adds: it holds the batch, which is rebuilt as the count grows. */
  readonly object = new Group()
  /** The shell: the tint over the parts' colours, its sheen and highlight, its toon steps. */
  readonly material: ShellToonMaterial
  /** The vertices one rat is drawn with. */
  readonly vertices: number
  /** The model's parts and the colours it was modelled in, where it has several; `setPartColor` recolours one. */
  readonly parts: readonly Part[]
  /** The playback rows, as many as the batch: three re-uploads the whole texture on any row's write, so it is sized to the count, not the capacity. */
  private playback!: VATPlaybackTexture
  private readonly maxTextureSize: number
  private readonly run: Clip
  /** The turn about up at heading zero, so the model faces +x. */
  private readonly about: number
  /** The rat's scale at its usual size, and as drawn this frame. */
  private readonly baseScale: number
  private readonly scale = new Vector3()
  /** How many times its usual size a rat is drawn; the swarm's collision disc is the page's business. */
  private size = 1
  /** When each rat's clip started, at the playback speed. */
  private readonly startTimes: Float64Array
  /** The clip each gait plays, Run, Walk, Idle; a model without Walk or Idle runs in their place. */
  private readonly gaitClips: Clip[]
  /** The gait each rat's row was last written for. */
  private readonly gaits: Uint8Array
  private speed: number
  /** The boil: every vertex moved by a noise of its rest position, re-seeded on the stop motion's beat, in the model's units. */
  private readonly boil = { amount: uniform(0), scale: uniform(1), seed: uniform(0) }
  /** The eyes a rat has: none on a model with no eyes part. */
  private readonly eyes: number
  /**
   * Where each eye is at every baked frame, in the model's units, the centre of
   * its vertices as the decode poses them: eye `e` at row `f` at `(f × eyes + e) × 3`.
   */
  private readonly eyeTrack: Float32Array
  /** The eyes' trails: a ribbon an eye a rat, the path it travelled, flat on the ground. */
  private readonly trails: Trails
  /** The places' version and the run's time the ribbons were last laid for, and whether their look moved since. */
  private trailedVersion = -1
  private trailedTime = Number.NaN
  private trailsDirty = true
  /** The batch, as big as the count has needed so far. */
  private batch!: BatchedMesh
  private batchSize = 0
  private readonly indexCount: number
  /** Rats shown: the first `shown` instances are visible, the rest hidden. */
  private shown = 0
  private readonly matrix = new Matrix4()
  private readonly position = new Vector3()
  private readonly turn = new Quaternion()
  private readonly frustum = new Frustum()
  private readonly viewProjection = new Matrix4()
  private readonly sphere = new Sphere(new Vector3(), CULL_MARGIN)

  constructor(
    private readonly vat: VAT,
    creature: Creature,
    /** The most rats there can be: the playback texture's rows. */
    private readonly capacity: number,
    maxTextureSize: number,
    private readonly time: VATTimeUniform,
    speed: number,
  ) {
    const clip = (name: string) => {
      const found = vat.clips.find((c) => c.name === name)
      if (found === undefined) throw new Error(`last-light: ${creature.url} has no clip named ${name}`)
      return found
    }
    this.run = clip(creature.clip)
    const maybe = (name?: string) => (name === undefined ? undefined : vat.clips.find((c) => c.name === name))
    this.gaitClips = [this.run, maybe(creature.walk) ?? this.run, maybe(creature.idle) ?? this.run]
    this.gaits = new Uint8Array(capacity)
    this.speed = speed
    // A heading turns from +x toward +z; a model facing +z needs no turn of its own, one facing -z a half turn.
    this.about = creature.facing === 1 ? Math.PI / 2 : -Math.PI / 2

    // The creature runs along z; its length across the frames of its run sets its scale.
    const length = vat.bounds.max.z - vat.bounds.min.z
    this.baseScale = RAT_LENGTH / length

    if (creature.smooth) shadeSmooth(vat.geometry)

    this.startTimes = new Float64Array(capacity)
    this.maxTextureSize = maxTextureSize
    // A model baked from several flat materials carries their colours as
    // vertex colours: split into the creature's parts, each on a colour of its
    // own that the panel's rats folder edits, under the material's colour as a
    // tint. A model with no parts named keeps its vertex colours as baked.
    const parts = partition(vat.geometry, creature.parts)
    this.parts = parts
    this.material = new ShellToonMaterial({
      color: creature.color,
      parts: parts.length,
      vertexColors: parts.length === 0 && vat.geometry.hasAttribute('color'),
      painted: { strokes: createStrokes(), extent: length },
    })
    parts.forEach((part, i) => this.material.parts[i].value.set(part.color))
    const eyes = eyesOf(vat.geometry, parts.findIndex((part) => part.name === 'eyes'))
    this.eyes = eyes.length
    this.eyeTrack = trackVATPoints(vat, eyes)
    // The trails, in the eyes' colour; the fog takes them as it takes the rat. On a layer the frame's pre-pass leaves out.
    this.trails = new Trails(uniform(new Color(0xffffff)))
    this.trails.mesh.layers.set(TRAIL_LAYER)
    this.object.add(this.trails.mesh)
    this.vertices = vat.geometry.getAttribute('position').count
    this.indexCount = vat.geometry.getIndex()?.count ?? 0
    this.build(batchSizeFor(0, capacity))
  }

  /**
   * A batch of `size` rats in place of the one before: the same material,
   * its decode rebound to the new batch, every instance hidden until `draw`
   * shows it. Instance `i` is rat `i` in either, so the playback rows stand.
   */
  private build(size: number): void {
    const old = this.batch as BatchedMesh | undefined
    const batch = new BatchedMesh(size, this.vertices, this.indexCount, this.material)
    const geometry = batch.addGeometry(this.vat.geometry)
    for (let i = 0; i < size; i++) batch.setVisibleAt(batch.addInstance(geometry), false)
    // The playback rows, as many as the batch, every rat shown so far written again as it was, cut.
    const oldPlayback = this.playback as VATPlaybackTexture | undefined
    this.playback = createVATPlaybackTexture([], { capacity: size, maxTextureSize: this.maxTextureSize })
    for (let i = 0; i < this.shown; i++) this.writeRow(i, this.startTimes[i], this.gaits[i])
    oldPlayback?.texture.dispose()
    // The decode, and over it the boil: a clay surface re-touched every beat.
    const decode = vatNodes(this.vat, { time: this.time, playback: this.playback, carrier: batch }).positionNode
    const rest = attribute('position', 'vec3')
    this.material.positionNode = decode.add(mx_noise_vec3(rest.mul(this.boil.scale).add(this.boil.seed)).mul(this.boil.amount))
    this.material.needsUpdate = true
    // Its bounds change every step and the swarm fills the view: culled rat by
    // rat, never as a whole. And by `draw`, not by three: on WebGPU, a batch
    // three culls per camera draws the wrong rats once a shadow pass and the
    // view cull differently, so every pass must draw the one list.
    batch.frustumCulled = false
    batch.perObjectFrustumCulled = false
    // One opaque material over one geometry: three's depth sort of the instances buys the GPU nothing here and
    // costs the main thread a pass over every rat, twice a frame with the sun's shadows on.
    batch.sortObjects = false
    // Rats cast on the floor and on each other, and take each other's shadows.
    batch.castShadow = true
    batch.receiveShadow = true
    if (old !== undefined) {
      this.object.remove(old)
      old.dispose()
    }
    this.object.add(batch)
    this.batch = batch
    this.batchSize = size
    // A ribbon an eye on that many rats.
    this.trails.resize(size * this.eyes)
    this.trailsDirty = true
  }

  /**
   * The boil for this beat: `metres` of movement at most, over bumps `cells`
   * to the metre, from draw `seed`. Zero metres and the surface is still.
   */
  setBoil(metres: number, cells: number, seed: number): void {
    const metresPerUnit = this.baseScale * this.size
    this.boil.amount.value = metres / metresPerUnit
    this.boil.scale.value = cells * metresPerUnit
    this.boil.seed.value = seed * 17.17
  }

  /** How long one baked frame of Run lasts at the playback speed, s: the step the poses fall on. */
  get poseStep(): number {
    return 1 / (this.run.fps * this.speed)
  }

  /** Take the eye trails folder's values; a model with no eyes part leaves none. */
  setTrails(look: TrailLook): void {
    this.trails.set({ ...look, enabled: look.enabled && this.eyes > 0 })
    this.trailsDirty = true
  }

  /** The part named `name` glows at `strength` times its colour; a model without it glows nowhere. */
  setGlow(name: string, strength: number): void {
    this.material.setGlow(
      this.parts.findIndex((part) => part.name === name),
      strength,
    )
  }

  /** Colour part `i` `hex`, from the next frame; the eyes' colour is the trails' too. */
  setPartColor(i: number, hex: number): void {
    this.material.parts[i].value.set(hex)
    if (this.parts[i]?.name === 'eyes') this.trails.setEyeColour(hex)
  }

  /**
   * Show `count` rats, in a bigger batch if they need one. Rats just spawned,
   * past what was shown, each start Run at their own moment in the cycle; rats
   * dropped are hidden.
   */
  show(count: number): void {
    if (count > this.batchSize) this.build(batchSizeFor(count, this.capacity))
    const now = this.time.value
    for (let i = this.shown; i < count; i++) this.writeRow(i, now - (Math.random() * cycle(this.run)) / this.speed, 0)
    for (let i = count; i < this.shown; i++) this.batch.setVisibleAt(i, false)
    this.shown = count
  }

  /**
   * Every rat's Run at playback speed `speed`. Each start time moves with it,
   * so every rat carries on from the pose it shows rather than jumping.
   */
  setSpeed(speed: number): void {
    if (speed === this.speed) return
    const now = this.time.value
    for (let i = 0; i < this.shown; i++) this.startTimes[i] = now - ((now - this.startTimes[i]) * this.speed) / speed
    this.speed = speed
    for (let i = 0; i < this.shown; i++) this.writeRow(i, this.startTimes[i], this.gaits[i])
  }

  /** Rats in the last pass drawn: what survived the culling, after a render. */
  get drawn(): number {
    return (this.batch as unknown as { _multiDrawCount: number })._multiDrawCount
  }

  /** Draw every rat `size` times its usual size, from the next frame. */
  setSize(size: number): void {
    this.size = size
  }

  /**
   * Stand every rat where the swarm has it, facing the way it goes, and draw
   * only those within `camera`'s view, give or take CULL_MARGIN. A count that
   * moved is shown first. With `gaited` off every rat runs, whatever the
   * swarm's gait: smooth, a cut between gaits shows, where on the beat it is
   * one photograph after another.
   */
  draw(placed: Placed, camera: Camera, gaited = true): void {
    if (!placed.ready) return
    const { x, z, heading, gait, count } = placed
    if (count !== this.shown) this.show(count)
    // A rat whose gait changed goes into that gait's clip, from now; nothing else rewrites a row.
    // Sent back to Run with the gaits off, each takes its own moment in the cycle, as when shown, not all in step.
    const nowClip = this.time.value
    for (let i = 0; i < count; i++) {
      const want = gaited ? gait[i] : 0
      if (want === this.gaits[i]) continue
      const start = gaited ? nowClip : nowClip - (Math.random() * cycle(this.run)) / this.speed
      this.writeRow(i, start, want, GAIT_FADE)
    }
    const metresPerUnit = this.baseScale * this.size
    this.scale.setScalar(metresPerUnit)
    camera.updateMatrixWorld()
    this.frustum.setFromProjectionMatrix(
      this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    )
    // The ribbons are laid only when the places, the run's time or their look moved: between the stop motion's beats they stand.
    const clock = this.time.value
    const trailing =
      this.trails.mesh.visible && (placed.version !== this.trailedVersion || clock !== this.trailedTime || this.trailsDirty)
    this.trailedVersion = placed.version
    this.trailedTime = clock
    this.trailsDirty = false
    const eyes = this.eyes
    const track = this.eyeTrack
    const now = performance.now() / 1000
    for (let i = 0; i < count; i++) {
      this.sphere.center.set(x[i], 0, z[i])
      const seen = this.frustum.intersectsSphere(this.sphere)
      this.batch.setVisibleAt(i, seen)
      const yaw = this.about - heading[i]
      if (seen) {
        this.turn.setFromAxisAngle(UP, yaw)
        this.batch.setMatrixAt(i, this.matrix.compose(this.position.set(x[i], 0, z[i]), this.turn, this.scale))
      }
      if (!trailing) continue
      // The two baked frames the rat shows and how far between, as the decode reads a looping clip: its eyes' places there.
      const clip = this.gaitClips[this.gaits[i]] ?? this.run
      const spread = (Math.max(0, clock - this.startTimes[i]) * this.speed * clip.fps) % clip.frames
      const f0 = Math.floor(spread)
      const mix = spread - f0
      const row0 = (clip.startFrame + f0) * eyes * 3
      const row1 = (clip.startFrame + (f0 + 1 === clip.frames ? 0 : f0 + 1)) * eyes * 3
      // Each eye's place in the world, where the pose has it, turned by the rat's yaw about up and scaled to metres: its ribbon follows it.
      const cos = Math.cos(yaw)
      const sin = Math.sin(yaw)
      for (let e = 0; e < eyes; e++) {
        const a = row0 + e * 3
        const b = row1 + e * 3
        const lx = track[a] + (track[b] - track[a]) * mix
        const ly = track[a + 1] + (track[b + 1] - track[a + 1]) * mix
        const lz = track[a + 2] + (track[b + 2] - track[a + 2]) * mix
        const ex = (lx * cos + lz * sin) * metresPerUnit
        const ez = (-lx * sin + lz * cos) * metresPerUnit
        this.trails.place(i * eyes + e, x[i] + ex, ly * metresPerUnit, z[i] + ez, seen, now)
      }
    }
    if (trailing) this.trails.commit(count * eyes)
  }

  /**
   * Rat `i`'s playback row: its gait's clip, from `startTime` rounded to a
   * baked frame, at the playback speed, so a held time shows a baked pose;
   * blending out of what it played over `fade` seconds, or cut.
   */
  private writeRow(i: number, startTime: number, gait: number, fade = 0): void {
    startTime = Math.round(startTime / this.poseStep) * this.poseStep
    this.startTimes[i] = startTime
    this.gaits[i] = gait
    setVATInstance(this.playback, i, { clip: this.gaitClips[gait] ?? this.run, startTime, speed: this.speed, fadeDuration: fade })
  }
}
