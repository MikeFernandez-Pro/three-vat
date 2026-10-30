// The crowd the swarm is drawn as: the baked rat, one geometry and one
// material (the rat's flat colours merged at the bake), on one of two
// carriers. On WebGPU the rats are culled on the GPU and drawn in one indirect
// draw a pass (gpucull.ts, ADR-0052), and the page composes no matrices. On
// WebGL 2, or under `?batch`, they are one `BatchedMesh`, culled rat by rat on
// the page and drawn in one draw, three folding the run. Every rat plays Run,
// looping, from its own moment in the cycle, at the one playback speed the
// panel sets. A rat's row is written when it spawns, when that speed moves and
// when its gait changes; never otherwise.
//
// The batch and the playback rows are sized to the count, not to the
// capacity: the batch's matrices texture is uploaded whole every frame, and
// the playback texture on any row's write, a fixed cost of their size. So
// they are rebuilt a size up as the count outgrows them, on the same material.
//
// On WebGPU each level's draw has a depth-only twin, drawn before anything
// else: the packed crowd lies three rats deep on the pixels it covers, and in
// the cull's order a pixel was shaded 1.7 times; after the twins have laid
// the nearest rat's depth, the shaded draw shades each pixel once. At 8,000
// rats on the goose page that is about 1.2 ms of a 7 ms frame at twice the
// pixels, 0.2 ms at the screen's own (2026-10-21). The twin's depth must be
// the shaded draw's to the bit, so it runs the same position node and mask.
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
  Vector2,
  Vector3,
  Mesh,
  MeshBasicNodeMaterial,
  type Camera,
  type Node,
  type WebGPURenderer,
} from 'three/webgpu'
import { createVATPlaybackTexture, setVATInstance, trackVATPoints, type VAT, type VATPlaybackTexture } from 'three-vat'
import { vatNodes, type VATTimeUniform } from 'three-vat/tsl'
import { attribute, batchIndirectIndex, cameraProjectionMatrix, cameraViewMatrix, color, float, mx_noise_vec3, positionWorld, select, uniform, varying, vec4 } from 'three/tsl'
import { Trails, type TrailLook } from './trails'
import { ShellToonMaterial } from './shell'
import { leaveOutOfShading } from './post'
import { createStrokes } from './strokes'
import { DRAW, GpuCull, type Pair } from './gpucull'
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js'
import type { HeightGrid } from './heights'
import { GpuTrails } from './gputrails'
import { RAT_LENGTH } from './gameplay'
import { bandNormal, type TiltLook } from './tiltshift'

/** The tilt-shift's band, as its look has it. */
type Band = Pick<TiltLook, 'centre' | 'width' | 'falloff' | 'angle'>

/** Where the swarm has its rats this frame: the first `count` of each array, each rat's facing, and how fast it really moves. */
export interface Placed {
  /** Whether the places are real yet: before the swarm's first word they are zeros, and nothing is drawn. */
  ready: boolean
  /** Counts up when the places change: the same number as last frame, and the ribbons are left as they are. */
  version: number
  count: number
  x: Float32Array
  z: Float32Array
  /** How high each rat rides on the pile, m. */
  y: Float32Array
  /** Its pitch, radians nose up, and its heading: for a rat in sight, once `orient` has turned it. */
  pitch: Float32Array
  heading: Float32Array
  /** Turn rat `i` the way it faces now: asked only of the rats in sight, so the rest are never turned. */
  orient(i: number): void
  /**
   * The two states every rat was last stood between, and how, for the GPU to
   * blend itself; none when each rat is held on a beat of its own, and the
   * arrays alone say where the rats are.
   */
  pair(): Pair | undefined
  /** What each rat's feet play, 0 Run, 1 Walk, 2 Idle, as the swarm reads it from how fast the rat really moves. */
  gait: Uint8Array
  /** Where each rat sits between the slowest and fastest speed, 0 to 1: the faster, the bigger it is drawn. */
  place: Float32Array
}

/**
 * A swarm stepped on the GPU (gpuswarm.ts): its state is in the cull's
 * buffers already, and it stands the rats there itself, before the cull. The
 * page holds only what each rat's feet play.
 */
export interface Stepped {
  ready: boolean
  version: number
  count: number
  /** What each rat's feet play, as last read back. */
  gait: Uint8Array
  /** Stand the rats on the cull for this frame: between its last two states, or held. */
  stand(): void
}

/**
 * Seconds a rat takes to blend from one gait's clip into the next: none, a
 * cut. A blend poses the rat twice in every pass while it lasts, and with
 * rats changing gait some thousand times a second that doubled the GPU's
 * frame; under the stop motion a cut is what the animator does anyway.
 */
const GAIT_FADE = 0

export type { TrailLook } from './trails'

/** What the swarm is drawn as: a baked model, the clip it runs with, and the way it faces. */
export interface Creature {
  /** The baked file, under public/. */
  url: string
  /** The clip every one plays, as the bake names it; and, where the model has them, the clips it walks and stands in. */
  clip: string
  walk?: string
  idle?: string
  /** The playback speed at which the clip's feet keep to the ground at the usual speeds. */
  playback: number
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
  playback: 1.7,
  // Untinted: its own three colours.
  color: 0xffffff,
  // White fur on a pale pink-grey skin (belly, paws, ears and tail), for the
  // variants' tints to colour, the skin a shade apart from the fur whatever
  // the tint; the eyes the trails' own colour, so a dot and its streak are one mark. Lemon 0xf3ff47 (panel, 2026-10-05)
  // read as floor glitter in the mass; the lamp's amber (2026-10-07) as one more orange beside the flame; a cold
  // green, then blood red for Halloween; the amber again since 2026-10-11, as the goose's screenshots have it.
  parts: [{ name: 'skin', color: 0xd9c2c4 }, { name: 'fur', color: 0xffffff }, { name: 'eyes', color: 0xffbe0a }],
}


type Clip = VAT['clips'][number]

/** One cycle of `clip`, in seconds at playback speed 1. */
const cycle = (clip: Clip) => clip.frames / clip.fps

const UP = new Vector3(0, 1, 0)
const RIGHT = new Vector3(1, 0, 0)

/** How many variants the rats come in. */
export const VARIANTS = 4

/** A variant: the tint its rats wear over every part but the eyes, and its share of the swarm, against the others'. */
export interface Variant {
  tint: number
  share: number
}

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
/** The depth twins' render order: before every opaque object, which is drawn at 0. */
const DEPTH_FIRST = -1

/**
 * A level of detail: the share of the body's triangles and of the eyes' it
 * keeps, from how many pixels long on screen it is drawn, and its rim's
 * strength and width, each times the rats' rim.
 */
export interface Level {
  body: number
  eyes: number
  from: number
  rim: number
  rimWidth: number
}

/**
 * The rat's levels of detail on the GPU's carrier, as the panel edits them:
 * on or every rat whole; each rat tinted by its level, to see them; the
 * levels, nearest first, the first always whole and the last down to nothing.
 */
export interface LevelsLook {
  on: boolean
  show: boolean
  /**
   * The view split down the middle, to compare: the levels on the left and
   * the same tinted by level on the right ('tint'), or the whole rat on the
   * left and the levels on the right ('whole'); or not split ('none').
   */
  split: 'none' | 'tint' | 'whole'
  /** How much the depth of field's blur counts against a rat's pixels: 0 not at all, 1 as far as it smears it. */
  blur: number
  levels: Level[]
}

/** The levels to start, set from the panel on 2026-10-13. */
export const LEVELS: readonly Level[] = [
  { body: 0.45, eyes: 0.3, from: 238, rim: 1, rimWidth: 1 },
  { body: 0.2, eyes: 0.12, from: 145, rim: 0.8, rimWidth: 1 },
  { body: 0.06, eyes: 0.06, from: 0, rim: 1.27, rimWidth: 0.05 },
]

/** The tint each level shows its rats in, under `show`: green whole, amber, red. */
const LEVEL_TINTS = [0x3cff6e, 0xffc23c, 0xff3c3c]

/**
 * The far crowd's staggered steps as the page shows them (2026-10-16): one step in `n` for the rats further than
 * `from` m from the light, which the swarm's tuning takes; and whether to tint each rat by how it steps.
 */
export interface StaggerLook {
  n: number
  from: number
  show: boolean
}
/** Under the stagger's tint: a rat stepping every step green, as a level's whole rat; a staggered rat by its group, the step in `n` it takes. */
const FULL_RATE_TINT = 0x3cff6e
const STAGGER_TINTS = [0xff3c3c, 0x3c8cff, 0xffc23c, 0xc23cff, 0x3cffe6, 0xff8c3c, 0xb4ff3c, 0xff3cb4]

/**
 * `geometry`'s index simplified to `level`'s shares, over the same vertices:
 * the body and the eyes apart, so neither's triangles are spent on the other.
 */
function simplified(geometry: BufferGeometry, eyePart: number, level: Pick<Level, 'body' | 'eyes'>): Uint32Array {
  const index = geometry.getIndex()!
  const position = geometry.getAttribute('position')
  const part = eyePart < 0 ? undefined : geometry.getAttribute('part')
  const positions = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) positions.set([position.getX(i), position.getY(i), position.getZ(i)], i * 3)
  const sets: number[][] = [[], []]
  for (let t = 0; t < index.count; t += 3) {
    const eye = part !== undefined && part.getX(index.getX(t)) === eyePart
    sets[eye ? 1 : 0]!.push(index.getX(t), index.getX(t + 1), index.getX(t + 2))
  }
  const kept = sets.map((set, k) => {
    const share = k === 0 ? level.body : level.eyes
    if (share >= 1 || set.length === 0) return set
    const target = Math.max(3, Math.floor((set.length * share) / 3) * 3)
    return Array.from(MeshoptSimplifier.simplify(new Uint32Array(set), positions, 3, target, 1, [])[0])
  })
  return Uint32Array.from(kept.flat())
}

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
  /** How many times the slowest rat's size the fastest is drawn: 1, all one size. */
  private sizeBySpeed = 1
  /** When each rat's clip started, at the playback speed. */
  private readonly startTimes: Float64Array
  /** The clip each gait plays, Run, Walk, Idle; a model without Walk or Idle runs in their place. */
  private readonly gaitClips: Clip[]
  /** The gait each rat's row was last written for. */
  private readonly gaits: Uint8Array
  private speed: number
  /** The boil: every vertex moved by a noise of its rest position, re-seeded on the stop motion's beat, in the model's units. */
  private readonly boil = { amount: uniform(0), scale: uniform(1), seed: uniform(0) }
  /** Each variant's tint, and where its rats end on the zero-to-one a rat's index is spread over. */
  private readonly variants = Array.from({ length: VARIANTS }, () => ({ tint: uniform(new Color(0xffffff)), end: uniform(1) }))
  /** The eyes a rat has: none on a model with no eyes part. */
  private readonly eyes: number
  /**
   * Where each eye is at every baked frame, in the model's units, the centre of
   * its vertices as the decode poses them: eye `e` at row `f` at `(f × eyes + e) × 3`.
   */
  private readonly eyeTrack: Float32Array
  /** The eyes' trails: a ribbon an eye a rat, the path it travelled, flat on the ground. */
  private readonly trails: Trails
  /** On WebGPU's carrier, where the trails are laid: on the GPU, after the cull. */
  private readonly gpuTrails: GpuTrails | undefined
  /** The places' version and the run's time the ribbons were last laid for, and whether their look moved since. */
  private trailedVersion = -1
  private trailedTime = Number.NaN
  private trailsDirty = true
  /** The batch, as big as the count has needed so far: the page's carrier only. */
  private batch: BatchedMesh | undefined
  /** On WebGPU's carrier: the cull, a mesh a level of detail it draws indirectly, and the places' version last held on it. */
  private readonly cull: GpuCull | undefined
  private readonly meshes: Mesh[] = []
  /** On WebGPU's carrier: each level mesh's depth-only twin, drawn first, so the shaded draw shades only the nearest rat; and whether they are drawn. */
  private readonly depthMeshes: Mesh[] = []
  private readonly depthMaterial = new MeshBasicNodeMaterial({ colorWrite: false, fog: false })
  private prepass = true
  /** The eyes' part, -1 where the model has none. */
  private readonly eyePart: number
  /** Each level's shares as its index was last simplified to, and whether the simplifier is in. */
  private readonly shares = LEVELS.map(({ body, eyes }) => ({ body, eyes }))
  private simplifierReady = false
  /** 1 tints every rat by its level, 2 those on the right of the view. */
  private readonly showLevels = uniform(0, 'int')
  /** The stagger's tint: on (1), its n, its distance, and the light it is measured from. */
  private readonly stagger = { show: uniform(0), n: uniform(1), from: uniform(5), centre: uniform(new Vector2()) }
  /** Each level's rim, times the rats' own. */
  private readonly levelRims = LEVELS.map(() => ({ strength: uniform(1), width: uniform(1) }))
  private heldVersion = -1
  /** The rats the batch and the playback rows hold. */
  private batchSize = 0
  private readonly indexCount: number
  /** Rats shown: the first `shown` instances are visible, the rest hidden. */
  private shown = 0
  private readonly matrix = new Matrix4()
  private readonly position = new Vector3()
  private readonly turn = new Quaternion()
  private readonly nose = new Quaternion()
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
    /** WebGPU's renderer, to cull and draw the rats on the GPU; none, and they are the batch. */
    private readonly gpu?: WebGPURenderer,
    /** The level's ground, each rat stood on it; none, and the ground is flat. */
    private readonly ground?: HeightGrid,
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
    // A heading turns from +x toward +z; the rat faces +z, a quarter turn from it.
    this.about = Math.PI / 2

    // The creature runs along z; its length across the frames of its run sets its scale.
    const length = vat.bounds.max.z - vat.bounds.min.z
    this.baseScale = RAT_LENGTH / length


    this.startTimes = new Float64Array(capacity)
    this.maxTextureSize = maxTextureSize
    // A model baked from several flat materials carries their colours as
    // vertex colours: split into the creature's parts, each on a colour of its
    // own that the panel's rats folder edits, under the material's colour as a
    // tint. A model with no parts named keeps its vertex colours as baked.
    const parts = partition(vat.geometry, creature.parts)
    this.parts = parts
    // Each rat's variant, by its index times the golden ratio, so the shares
    // hold however many are shown and neighbours in spawn order differ. A
    // rat's index never changes, so neither does its colour. Picked once a
    // vertex, not once a pixel: the tint reaches the fragment as a varying.
    // On the GPU's carrier the drawn slot is not the rat: the cull says which rat it is.
    this.indexCount = vat.geometry.getIndex()?.count ?? 0
    this.cull = gpu === undefined ? undefined : new GpuCull(capacity, this.indexCount, CULL_MARGIN, ground, LEVELS.length)
    if (this.cull !== undefined) {
      this.cull.lod.length.value = length
      LEVELS.slice(0, -1).forEach((level, l) => (this.cull!.lod.limits[l]!.value = level.from))
    }
    const ratIndex = float(this.cull?.logicalIndex ?? batchIndirectIndex)
    const spread = ratIndex.mul(0.6180339887).fract()
    let tint: Node = this.variants[VARIANTS - 1].tint
    for (let i = VARIANTS - 2; i >= 0; i--) tint = select(spread.lessThan(this.variants[i].end), this.variants[i].tint, tint)
    if (this.cull !== undefined) {
      const level = this.cull.level
      let shown: Node = color(LEVEL_TINTS[LEVEL_TINTS.length - 1]!)
      for (let l = LEVEL_TINTS.length - 2; l >= 0; l--) shown = select(level.equal(l), color(LEVEL_TINTS[l]!), shown)
      // The whole rat's draw, past the levels, keeps its own tint.
      shown = select(level.lessThan(LEVEL_TINTS.length), shown, tint)
      const right = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(this.cull.place(), 1)).x.greaterThanEqual(0)
      tint = select(this.showLevels.equal(1).or(this.showLevels.equal(2).and(right)), shown, tint)
    }
    // The stagger's tint, over the levels': green stepping every step; past its distance from the light, the colour of
    // the group whose turn it steps on, its index modulo n, as the swarm takes turns.
    {
      const { show, n, from, centre } = this.stagger
      const at = this.cull !== undefined ? this.cull.place().xz : positionWorld.xz
      const group = ratIndex.mod(n)
      let byGroup: Node = color(STAGGER_TINTS[STAGGER_TINTS.length - 1]!)
      for (let k = STAGGER_TINTS.length - 2; k >= 0; k--) byGroup = select(group.equal(k), color(STAGGER_TINTS[k]!), byGroup)
      const staggered = n.greaterThan(1.5).and(at.sub(centre).length().greaterThan(from))
      tint = select(show.equal(1), select(staggered, byGroup, color(FULL_RATE_TINT)), tint)
    }
    // Each level's rim, by the level the drawing object draws.
    const byLevel = (pick: (rim: (typeof this.levelRims)[number]) => Node<'float'>) => {
      const level = this.cull!.level
      // The whole rat's draw, past the levels, keeps the rats' rim.
      let out: Node<'float'> = float(1)
      for (let l = this.levelRims.length - 1; l >= 0; l--) out = select(level.equal(l), pick(this.levelRims[l]!), out)
      return out
    }
    const rimScale = this.cull === undefined ? undefined : { strength: byLevel((rim) => rim.strength), width: byLevel((rim) => rim.width) }
    this.material = new ShellToonMaterial({
      color: creature.color,
      parts: parts.length,
      tint: varying(tint),
      vertexColors: parts.length === 0 && vat.geometry.hasAttribute('color'),
      painted: { strokes: createStrokes(), extent: length },
      rimScale,
    })
    parts.forEach((part, i) => this.material.parts[i].value.set(part.color))
    this.eyePart = parts.findIndex((part) => part.name === 'eyes')
    const eyes = eyesOf(vat.geometry, this.eyePart)
    this.eyes = eyes.length
    this.eyeTrack = trackVATPoints(vat, eyes)
    // The trails, in the eyes' colour; the fog takes them as it takes the rat. Light over the ground, not a surface the shading reads.
    // On the GPU's carrier they are laid after the cull and drawn indirectly, the page laying none.
    this.gpuTrails = this.cull !== undefined && this.eyes > 0 ? new GpuTrails(this.cull, capacity, this.eyes, this.eyeTrack, time) : undefined
    this.trails = new Trails(uniform(new Color(0xffffff)), this.gpuTrails?.ribbon)
    if (this.gpuTrails !== undefined) this.trails.indirect(this.gpuTrails.args)
    leaveOutOfShading(this.trails.material)
    this.object.add(this.trails.mesh)
    this.vertices = vat.geometry.getAttribute('position').count
    this.build(batchSizeFor(0, capacity))
  }

  /**
   * Playback rows for `size` rats in place of the ones before, every rat
   * shown so far written again as it was, cut; and on the page's carrier, a
   * batch of `size` in place of the one before, every instance hidden until
   * `draw` shows it. The same material, its decode rebound. Instance `i` is
   * rat `i` in either batch, and the GPU's carrier reads rat `i`'s row `i`, so
   * the playback rows stand.
   */
  private build(size: number): void {
    const oldPlayback = this.playback as VATPlaybackTexture | undefined
    this.playback = createVATPlaybackTexture([], { capacity: size, maxTextureSize: this.maxTextureSize })
    for (let i = 0; i < this.shown; i++) this.writeRow(i, this.startTimes[i], this.gaits[i])
    oldPlayback?.texture.dispose()
    this.batchSize = size
    // A ribbon an eye on that many rats, where the page lays them.
    if (this.gpuTrails === undefined) this.trails.resize(size * this.eyes)
    this.trailsDirty = true
    if (this.cull !== undefined) this.buildIndirect(this.cull)
    else this.buildBatch(size)
  }

  /** The decode, and over it the boil: a clay surface re-touched every beat. */
  private boiled(index: { carrier: BatchedMesh } | { logicalIndex: GpuCull['logicalIndex'] }): Node<'vec3'> {
    const decode = vatNodes(this.vat, { time: this.time, playback: this.playback, ...index }).positionNode
    const rest = attribute('position', 'vec3')
    return decode.add(mx_noise_vec3(rest.mul(this.boil.scale).add(this.boil.seed)).mul(this.boil.amount))
  }

  /**
   * The GPU's carrier: the decode read through the cull's survivors, turned
   * and placed as the cull has the rat; and, the first time, a mesh a level
   * that draws its survivors, every level at full detail until the simplifier
   * is in and each takes its own.
   */
  private buildIndirect(cull: GpuCull): void {
    this.material.positionNode = cull.transform(this.boiled({ logicalIndex: cull.logicalIndex }))
    this.material.needsUpdate = true
    // The twins' depth as the shaded draw's: the same position and, where a rat melts, the same mask.
    const shaded = this.material as unknown as { maskNode: Node | null }
    const depth = this.depthMaterial as unknown as { maskNode: Node | null }
    this.depthMaterial.positionNode = this.material.positionNode
    depth.maskNode = shaded.maskNode
    this.depthMaterial.needsUpdate = true
    if (this.meshes.length > 0) return
    // A mesh a level, and the whole rat's after them.
    for (let l = 0; l <= cull.levels; l++) {
      const mesh = new Mesh(this.levelGeometry(cull, l), this.material)
      // Placed by the cull, never culled by three; it casts and takes shadows as the batch does. One material, the level read per object.
      mesh.frustumCulled = false
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.userData.ratLevel = l
      this.object.add(mesh)
      this.meshes.push(mesh)
      // Its depth-only twin: the same geometry and indirect draw, drawn before anything else, casting nothing.
      const twin = new Mesh(mesh.geometry, this.depthMaterial)
      twin.frustumCulled = false
      twin.renderOrder = DEPTH_FIRST
      twin.userData.ratLevel = l
      twin.visible = this.prepass
      this.object.add(twin)
      this.depthMeshes.push(twin)
    }
    void MeshoptSimplifier.ready.then(() => {
      this.simplifierReady = true
      this.simplify(cull)
    })
  }

  /** Every level simplified again to its shares, its mesh given the new index. */
  private simplify(cull: GpuCull): void {
    for (let l = 0; l < cull.levels; l++) {
      const mesh = this.meshes[l]
      if (mesh === undefined) return
      const index = simplified(this.vat.geometry, this.eyePart, this.shares[l]!)
      const old = mesh.geometry
      mesh.geometry = this.levelGeometry(cull, l, index)
      this.depthMeshes[l]!.geometry = mesh.geometry
      old.dispose()
      cull.lod.indexCounts[l]!.value = index.length
    }
  }

  /** Draw the depth-only twins first, or not: off, the shaded draw shades every rat's pixels in the cull's order. Nothing on the batch. */
  setPrepass(on: boolean): void {
    this.prepass = on
    for (const twin of this.depthMeshes) twin.visible = on
  }

  /**
   * The depth of field the levels count, so a rat it blurs is drawn no finer
   * than it shows: the distance in focus, m; how far from it a rat goes fully
   * soft, m; and the blur's radius there, px, 0 without it. Or, given a
   * `band`, the tilt-shift's blur by the screen in place of the depth's.
   * Nothing on the batch.
   */
  focusOn(focus: number, soft: number, blur: number, band?: Band): void {
    const lod = this.cull?.lod
    if (lod === undefined) return
    lod.focus.value = focus
    lod.soft.value = soft
    lod.blur.value = blur
    lod.banded.value = band ? 1 : 0
    if (band) {
      lod.band.centre.value = band.centre
      lod.band.width.value = band.width
      lod.band.falloff.value = Math.max(0.01, band.falloff)
      bandNormal(band.angle, lod.band.normal.value)
    }
  }

  /**
   * The levels of detail as `look` has them: their limits; every rat whole
   * while they are off, or those on the left of a view split against the
   * whole rat; each rat tinted by its level, or those on the right of a view
   * split against the tint; each level's rim; and a level simplified again
   * where its shares moved. Nothing on the batch.
   */
  /** The stagger's tint: on or off, its `n` and distance as the swarm steps by them. */
  setStagger(look: StaggerLook): void {
    this.stagger.show.value = look.show ? 1 : 0
    this.stagger.n.value = Math.max(1, Math.round(look.n))
    this.stagger.from.value = look.from
  }

  /** Where the light the stagger is measured from stands now. */
  staggerCentre(x: number, z: number): void {
    this.stagger.centre.value.set(x, z)
  }

  setLevels(look: LevelsLook): void {
    const cull = this.cull
    if (cull === undefined) return
    look.levels.slice(0, cull.levels - 1).forEach((level, l) => (cull.lod.limits[l]!.value = level.from))
    cull.lod.whole.value = !look.on ? 1 : look.split === 'whole' ? 2 : 0
    // Split against the tint, the right tinted; against the whole rat, neither side; unsplit, as `show` says.
    const split = look.on ? look.split : 'none'
    this.showLevels.value = split === 'tint' ? 2 : split === 'whole' ? 0 : look.show ? 1 : 0
    look.levels.forEach((level, l) => {
      const rim = this.levelRims[l]
      if (rim === undefined) return
      rim.strength.value = level.rim
      rim.width.value = level.rimWidth
    })
    const moved = look.levels.some((level, l) => level.body !== this.shares[l]?.body || level.eyes !== this.shares[l]?.eyes)
    if (!moved) return
    look.levels.forEach((level, l) => (this.shares[l] = { body: level.body, eyes: level.eyes }))
    if (this.simplifierReady) this.simplify(cull)
  }

  /** The triangles the rats in view are drawn with: each level's rats at its triangles, or on the batch every rat whole. */
  get triangles(): number {
    const levels = this.levels
    if (levels.length === 0) return (this.drawn * this.indexCount) / 3
    return levels.reduce((sum, { drawn, triangles }) => sum + drawn * triangles, 0)
  }

  /** On the GPU's carrier, the rats in view at each level and at the whole rat's draw, as last read back, and each one's triangles; none on the batch. */
  get levels(): { drawn: number; triangles: number }[] {
    const cull = this.cull
    if (cull === undefined) return []
    return cull.lod.indexCounts.map((count, l) => ({ drawn: cull.drawnAt[l] ?? 0, triangles: count.value / 3 }))
  }

  /** Level `l`'s geometry: the rat over `index`, its own by default, drawn by the level's arguments. */
  private levelGeometry(cull: GpuCull, l: number, index?: Uint32Array): BufferGeometry {
    const geometry = this.vat.geometry.clone()
    if (index !== undefined) geometry.setIndex(new BufferAttribute(index, 1))
    geometry.setIndirect(cull.args, DRAW * 4 * (1 + l))
    return geometry
  }

  /** The page's carrier: a batch of `size`, every instance hidden, in place of the one before. */
  private buildBatch(size: number): void {
    const old = this.batch
    const batch = new BatchedMesh(size, this.vertices, this.indexCount, this.material)
    const geometry = batch.addGeometry(this.vat.geometry)
    for (let i = 0; i < size; i++) batch.setVisibleAt(batch.addInstance(geometry), false)
    this.material.positionNode = this.boiled({ carrier: batch })
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

  /** Take the eyes folder's trails values; a model with no eyes part leaves none. */
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

  /** Tint each variant's rats, in the shares given; shares all zero, and each has an equal one. */
  setVariants(variants: readonly Variant[]): void {
    const total = variants.reduce((sum, v) => sum + Math.max(0, v.share), 0)
    let end = 0
    this.variants.forEach((uniforms, i) => {
      const v = variants[i]
      uniforms.tint.value.set(v?.tint ?? 0xffffff)
      end += total > 0 ? Math.max(0, v?.share ?? 0) / total : 1 / VARIANTS
      // The last ends past one, so no rat falls beyond it to rounding.
      uniforms.end.value = i === VARIANTS - 1 ? 2 : end
    })
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
    // On the GPU's carrier the cull draws no more rats than the swarm holds.
    if (this.batch !== undefined) for (let i = count; i < this.shown; i++) this.batch.setVisibleAt(i, false)
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

  /** The ground's grid laid again in place: the GPU's copy uploaded again; the batch reads it as it is. */
  groundChanged(): void {
    this.cull?.groundChanged()
  }

  /** On WebGPU's carrier, the cull a GPU step writes its states into; none on the batch. */
  get gpuCull(): GpuCull | undefined {
    return this.cull
  }

  /**
   * Rats in the last pass drawn: what survived the culling, after a render. On
   * the GPU's carrier, as last read back from the GPU, a few times a second.
   */
  get drawn(): number {
    if (this.cull !== undefined) return this.cull.drawn
    return (this.batch as unknown as { _multiDrawCount: number })._multiDrawCount
  }

  /** Free the rats' textures and buffers, the GPU's copies too: when the page leaves. */
  dispose(): void {
    this.playback.texture.dispose()
    this.batch?.dispose()
    for (const mesh of this.meshes) mesh.geometry.dispose()
    if (this.cull !== undefined && this.gpu !== undefined) this.cull.dispose()
    if (this.gpuTrails !== undefined && this.gpu !== undefined) this.gpuTrails.dispose()
  }

  /** Draw every rat `size` times its usual size, from the next frame. */
  setSize(size: number): void {
    this.size = size
  }

  /** Draw the fastest rat `ratio` times the slowest's size, from the next frame; the mean rat stays at the usual size. */
  setSizeBySpeed(ratio: number): void {
    this.sizeBySpeed = ratio
  }

  /**
   * Stand every rat where the swarm has it, facing the way it goes, and draw
   * only those within `camera`'s view, give or take CULL_MARGIN. A rat out of
   * it costs nothing past the test: it is not turned, its gait waits, and its
   * eyes leave no trail. A count that moved is shown first. With `gaited` off
   * every rat runs, whatever the swarm's gait: smooth, a cut between gaits
   * shows, where on the beat it is one photograph after another.
   *
   * On the GPU's carrier the cull stands, turns and keeps the rats, once,
   * before the frame's passes, and every pass draws what it kept; the eyes'
   * trails are laid on the GPU after it. The page tests no rat against the
   * view: every rat whose gait changed goes into that gait's clip, in sight or
   * not, as the page no longer knows which rats are drawn. A swarm stepped on
   * the GPU stands the rats itself; it draws only on that carrier.
   */
  draw(placed: Placed | Stepped, camera: Camera, gaited = true): void {
    if (!placed.ready) return
    const { gait, count } = placed
    if (count !== this.shown) this.show(count)
    const nowClip = this.time.value
    // Each rat's size by its place between the slowest and the fastest: from
    // `smallest` to `smallest + span` times the usual, their mean the usual.
    const ratio = this.sizeBySpeed
    const smallest = 2 / (1 + ratio)
    const span = (2 * (ratio - 1)) / (1 + ratio)
    const usual = this.baseScale * this.size
    camera.updateMatrixWorld()
    this.frustum.setFromProjectionMatrix(
      this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    )
    // The levels go by pixels long in the drawing buffer: the projection's vertical scale, half the buffer's height a unit of it.
    if (this.cull !== undefined && this.gpu !== undefined) {
      camera.getWorldPosition(this.cull.lod.eye.value)
      camera.getWorldDirection(this.cull.lod.forward.value)
      this.cull.lod.viewProjection.value.copy(this.viewProjection)
      this.cull.lod.focal.value = (camera.projectionMatrix.elements[5]! * this.gpu.domElement.height) / 2
      this.cull.lod.aspect.value = this.gpu.domElement.width / Math.max(1, this.gpu.domElement.height)
    }
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
    if (trailing) this.trails.begin(now)
    if (this.cull !== undefined && this.gpu !== undefined) {
      // A rat whose gait changed goes into that gait's clip, from now; nothing else rewrites a row.
      for (let i = 0; i < count; i++) {
        const want = gaited ? gait[i] : 0
        if (want !== this.gaits[i]) this.regait(i, want, gaited, nowClip)
      }
      this.standOnGpu(this.cull, this.gpu, placed, { usual, smallest, span })
      if (trailing) this.gpuTrails?.lay(this.gpu, now, this.trails.seconds)
      return
    }
    if ('stand' in placed) throw new Error("last-light: a swarm stepped on the GPU draws only on the GPU's carrier")
    const { x, z, y: piled, pitch, heading, place } = placed
    const batch = this.batch!
    const ground = this.ground
    for (let i = 0; i < count; i++) {
      // Stood on the ground, a pile's height on top.
      const y = piled[i] + (ground === undefined ? 0 : ground.at(x[i], z[i]))
      this.sphere.center.set(x[i], y, z[i])
      const seen = this.frustum.intersectsSphere(this.sphere)
      batch.setVisibleAt(i, seen)
      if (!seen) {
        if (trailing) for (let e = 0; e < eyes; e++) this.trails.fold(i * eyes + e)
        continue
      }
      placed.orient(i)
      // A rat whose gait changed goes into that gait's clip, from now, or from when it is next in sight; nothing else rewrites a row.
      // Sent back to Run with the gaits off, each takes its own moment in the cycle, as when shown, not all in step.
      const want = gaited ? gait[i] : 0
      if (want !== this.gaits[i]) this.regait(i, want, gaited, nowClip)
      const yaw = this.about - heading[i]
      // The rat faces +z: a turn about its own x by minus the pitch lifts its nose.
      const tilt = -pitch[i]
      const metresPerUnit = usual * (smallest + span * place[i])
      this.scale.setScalar(metresPerUnit)
      this.turn.setFromAxisAngle(UP, yaw).multiply(this.nose.setFromAxisAngle(RIGHT, tilt))
      batch.setMatrixAt(i, this.matrix.compose(this.position.set(x[i], y, z[i]), this.turn, this.scale))
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
      const cosT = Math.cos(tilt)
      const sinT = Math.sin(tilt)
      for (let e = 0; e < eyes; e++) {
        const a = row0 + e * 3
        const b = row1 + e * 3
        const lx = track[a] + (track[b] - track[a]) * mix
        const ly0 = track[a + 1] + (track[b + 1] - track[a + 1]) * mix
        const lz0 = track[a + 2] + (track[b + 2] - track[a + 2]) * mix
        // Tilted about x first, as the rat is, then turned about up.
        const ly = ly0 * cosT - lz0 * sinT
        const lz = ly0 * sinT + lz0 * cosT
        const ex = (lx * cos + lz * sin) * metresPerUnit
        const ez = (-lx * sin + lz * cos) * metresPerUnit
        this.trails.place(i * eyes + e, x[i] + ex, y + ly * metresPerUnit, z[i] + ez)
      }
    }
    if (trailing) this.trails.commit()
  }

  /**
   * The GPU's carrier, before the frame's passes: the rats stood between the
   * pair the swarm sampled, or, held each on a beat of its own, where the page
   * holds them; then culled against the view `draw` set.
   */
  private standOnGpu(cull: GpuCull, renderer: WebGPURenderer, placed: Placed | Stepped, size: { usual: number; smallest: number; span: number }): void {
    cull.size.usual.value = size.usual
    cull.size.smallest.value = size.smallest
    cull.size.span.value = size.span
    if ('stand' in placed) {
      placed.stand()
      cull.cull(renderer, this.frustum)
      return
    }
    const pair = placed.pair()
    if (pair !== undefined) {
      cull.stand(pair, placed.count)
      this.heldVersion = -1
    } else if (placed.version !== this.heldVersion) {
      // The staggered hold: every rat turned as it is held, in sight or not, and every rat's place sent up.
      for (let i = 0; i < placed.count; i++) placed.orient(i)
      cull.hold(placed)
      this.heldVersion = placed.version
    }
    cull.cull(renderer, this.frustum)
  }

  /** Rat `i` into gait `want`'s clip: from now, gaited; sent back to Run with the gaits off, from its own moment in the cycle. */
  private regait(i: number, want: number, gaited: boolean, now: number): void {
    const start = gaited ? now : now - (Math.random() * cycle(this.run)) / this.speed
    this.writeRow(i, start, want, GAIT_FADE)
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
    const clip = this.gaitClips[gait] ?? this.run
    setVATInstance(this.playback, i, { clip, startTime, speed: this.speed, fadeDuration: fade })
    this.gpuTrails?.setRow(i, clip, startTime, this.speed * clip.fps)
  }
}
