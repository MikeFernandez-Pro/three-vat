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
import { createVATPlaybackTexture, setVATInstance, type VAT, type VATPlaybackTexture } from 'three-vat'
import { vatNodes, type VATTimeUniform } from 'three-vat/tsl'
import { ShellToonMaterial } from './shell'
import { createStrokes } from './strokes'

/** Where the swarm has its rats this frame: the first `count` of each array, and each rat's facing. */
export interface Placed {
  count: number
  x: Float32Array
  z: Float32Array
  heading: Float32Array
}

/** What the swarm is drawn as: a baked model, the clip it runs with, and the way it faces. */
export interface Creature {
  /** The baked file, under public/. */
  url: string
  /** The clip every one plays, as the bake names it. */
  clip: string
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
  private readonly playback: VATPlaybackTexture
  private readonly run: Clip
  /** The turn about up at heading zero, so the model faces +x. */
  private readonly about: number
  /** The rat's scale at its usual size, and as drawn this frame. */
  private readonly baseScale: number
  private readonly scale = new Vector3()
  /** How many times its usual size a rat is drawn; the swarm's collision disc is the page's business. */
  private size = 1
  /** When each rat's Run started, at the playback speed. */
  private readonly startTimes: Float64Array
  private speed: number
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
    this.speed = speed
    // A heading turns from +x toward +z; a model facing +z needs no turn of its own, one facing -z a half turn.
    this.about = creature.facing === 1 ? Math.PI / 2 : -Math.PI / 2

    // The creature runs along z; its length across the frames of its run sets its scale.
    const length = vat.bounds.max.z - vat.bounds.min.z
    this.baseScale = RAT_LENGTH / length

    if (creature.smooth) shadeSmooth(vat.geometry)

    this.startTimes = new Float64Array(capacity)
    this.playback = createVATPlaybackTexture([], { capacity, maxTextureSize })
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
    this.material.positionNode = vatNodes(this.vat, { time: this.time, playback: this.playback, carrier: batch }).positionNode
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
  }

  /** Colour part `i` `hex`, from the next frame. */
  setPartColor(i: number, hex: number): void {
    this.material.parts[i].value.set(hex)
  }

  /**
   * Show `count` rats, in a bigger batch if they need one. Rats just spawned,
   * past what was shown, each start Run at their own moment in the cycle; rats
   * dropped are hidden.
   */
  show(count: number): void {
    if (count > this.batchSize) this.build(batchSizeFor(count, this.capacity))
    const now = this.time.value
    for (let i = this.shown; i < count; i++) this.writeRow(i, now - (Math.random() * cycle(this.run)) / this.speed)
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
    for (let i = 0; i < this.shown; i++) this.writeRow(i, this.startTimes[i])
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
   * moved is shown first.
   */
  draw(placed: Placed, camera: Camera): void {
    const { x, z, heading, count } = placed
    if (count !== this.shown) this.show(count)
    this.scale.setScalar(this.baseScale * this.size)
    camera.updateMatrixWorld()
    this.frustum.setFromProjectionMatrix(
      this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    )
    for (let i = 0; i < count; i++) {
      this.sphere.center.set(x[i], 0, z[i])
      const seen = this.frustum.intersectsSphere(this.sphere)
      this.batch.setVisibleAt(i, seen)
      if (!seen) continue
      this.turn.setFromAxisAngle(UP, this.about - heading[i])
      this.batch.setMatrixAt(i, this.matrix.compose(this.position.set(x[i], 0, z[i]), this.turn, this.scale))
    }
  }

  /** Rat `i`'s playback row: Run, from `startTime`, at the playback speed. */
  private writeRow(i: number, startTime: number): void {
    this.startTimes[i] = startTime
    setVATInstance(this.playback, i, { clip: this.run, startTime, speed: this.speed })
  }
}
