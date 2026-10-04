// The crowd the swarm is drawn as: one `BatchedMesh` over the baked rat, one
// geometry and one material (the rat's two flat colours merged at the bake),
// culled rat by rat and drawn in one draw by the collapse. A hunting rat, or one
// coming in, plays Run, looping, from its own start time and at a playback speed matching its
// running speed; a strolling one Walk, at its pace; a sitting one Idle. A rat's
// row is written when it spawns, when its mood changes, and when the speed
// sliders or the rat scale move; never otherwise. Per frame, the matrices and which rats are in
// view move, and the few rats whose mood changed.
import { BatchedMesh, Frustum, Matrix4, MeshStandardNodeMaterial, Quaternion, Sphere, Vector3, type Camera } from 'three/webgpu'
import { createVATPlaybackTexture, setVATInstance, type VAT, type VATPlaybackTexture } from 'three-vat'
import { vatNodes, type VATTimeUniform } from 'three-vat/tsl'
import { defaultTuning, HUNTING, SITTING, STROLL_SPEED, STROLLING, type Swarm, type Tuning } from './swarm'

/** The clips, as the bake names them: hunting, strolling, sitting. */
const RUN = 'RatArmature|Rat_Run'
const WALK = 'RatArmature|Rat_Walk'
const IDLE = 'RatArmature|Rat_Idle'

/**
 * The rat's length across every frame of Run, nose to tail, in metres: its
 * body, without the tail, is a little over half of it, about 0.25 m.
 */
const RAT_LENGTH = 0.46

/** The collision disc at RAT_LENGTH: a rat drawn bigger collides bigger, by the same factor. */
const RAT_RADIUS = defaultTuning().ratRadius

/** How many times its usual size the swarm's tuning makes a rat: drawn, striding and colliding alike. */
const sizeOf = (tuning: Tuning) => tuning.ratRadius / RAT_RADIUS

/**
 * How far one Run cycle carries the rat, in metres, at RAT_LENGTH: a constant
 * of the model, about two body lengths a bound. A rat's playback speed is
 * whatever makes it cover this once a cycle at its running speed.
 */
const STRIDE = 0.5
/** How far one Walk cycle carries the rat, in metres: an estimate, about half a body length a step. */
const WALK_STRIDE = 0.25

type Clip = VAT['clips'][number]

/** The mood a rat's row is written for: hunting and coming in both run, so they share a row. */
const rowMood = (mood: number) => (mood === SITTING || mood === STROLLING ? mood : HUNTING)

/** One cycle of `clip`, in seconds at playback speed 1. */
const cycle = (clip: Clip) => clip.frames / clip.fps

const UP = new Vector3(0, 1, 0)

/**
 * How far past the view a rat is still drawn, in metres: its own length, and
 * the shadow it casts into the view from just outside it.
 */
const CULL_MARGIN = 1

export class Rats {
  readonly mesh: BatchedMesh
  private readonly playback: VATPlaybackTexture
  private readonly run: Clip
  private readonly walk: Clip
  private readonly idle: Clip
  /** The mood each rat's row was last written for, as `rowMood` has it. */
  private readonly written: Uint8Array
  /** The rat's scale at its usual size, and as drawn this frame. */
  private readonly baseScale: number
  private readonly scale = new Vector3()
  /** What each rat's Run row says: when it started, and at what playback speed. */
  private readonly startTimes: Float64Array
  private readonly speeds: Float64Array
  /** Rats shown: the first `shown` instances are visible, the rest hidden. */
  private shown = 0
  private readonly matrix = new Matrix4()
  private readonly position = new Vector3()
  private readonly turn = new Quaternion()
  private readonly frustum = new Frustum()
  private readonly viewProjection = new Matrix4()
  private readonly sphere = new Sphere(new Vector3(), CULL_MARGIN)

  constructor(
    vat: VAT,
    capacity: number,
    maxTextureSize: number,
    private readonly time: VATTimeUniform,
  ) {
    const clip = (name: string) => {
      const found = vat.clips.find((c) => c.name === name)
      if (found === undefined) throw new Error(`last-light: the baked rat has no clip named ${name}`)
      return found
    }
    this.run = clip(RUN)
    this.walk = clip(WALK)
    this.idle = clip(IDLE)
    this.written = new Uint8Array(capacity)

    // The rat runs along +z; its length across the frames of Run sets its scale.
    const length = vat.bounds.max.z - vat.bounds.min.z
    this.baseScale = RAT_LENGTH / length

    this.startTimes = new Float64Array(capacity)
    this.speeds = new Float64Array(capacity)
    this.playback = createVATPlaybackTexture([], { capacity, maxTextureSize })
    const material = new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85 })
    const position = vat.geometry.getAttribute('position').count
    this.mesh = new BatchedMesh(capacity, position, vat.geometry.getIndex()?.count ?? 0, material)
    const geometry = this.mesh.addGeometry(vat.geometry)
    for (let i = 0; i < capacity; i++) this.mesh.setVisibleAt(this.mesh.addInstance(geometry), false)
    material.positionNode = vatNodes(vat, { time, playback: this.playback, carrier: this.mesh }).positionNode
    // Its bounds change every step and the swarm fills the view: culled rat by
    // rat, never as a whole. And by `draw`, not by three: on WebGPU, a batch
    // three culls per camera draws the wrong rats once a shadow pass and the
    // view cull differently, so every pass must draw the one list.
    this.mesh.frustumCulled = false
    this.mesh.perObjectFrustumCulled = false
  }

  /** The tint over the rat's own two colours. */
  get material(): MeshStandardNodeMaterial {
    return this.mesh.material as MeshStandardNodeMaterial
  }

  /**
   * Show the swarm's count. Rats it just spawned, past what was shown, each
   * start their clip at their own moment, at a speed their feet match; rats it
   * dropped are hidden.
   */
  show(swarm: Swarm, tuning: Tuning): void {
    for (let i = this.shown; i < swarm.count; i++) this.moodChanged(swarm, tuning, i, Math.random())
    for (let i = swarm.count; i < this.shown; i++) this.mesh.setVisibleAt(i, false)
    this.shown = swarm.count
  }

  /**
   * The speed sliders or the rat scale moved: every running or strolling rat's
   * playback speed follows its new pace and stride, once. Its start time moves
   * with it so the stride carries on from the pose it shows rather than jumping
   * to another.
   */
  retime(swarm: Swarm, tuning: Tuning): void {
    const now = this.time.value
    for (let i = 0; i < this.shown; i++) {
      const mood = this.written[i]
      if (mood === SITTING) continue
      const speed = mood === STROLLING ? this.walkSpeed(tuning) : this.runSpeed(swarm, tuning, i)
      if (speed === this.speeds[i]) continue
      const clip = mood === STROLLING ? this.walk : this.run
      this.writeRow(i, mood, clip, now - ((now - this.startTimes[i]) * this.speeds[i]) / speed, speed)
    }
  }

  /** Rats in the last pass drawn: what survived the culling, after a render. */
  get drawn(): number {
    return (this.mesh as unknown as { _multiDrawCount: number })._multiDrawCount
  }

  /**
   * Stand every rat where the swarm has it, facing the way it runs, and draw
   * only those within `camera`'s view, give or take CULL_MARGIN. A rat whose
   * clip changed with its mood since its row was written, in view or not, gets its new row.
   */
  draw(swarm: Swarm, tuning: Tuning, camera: Camera): void {
    const { x, z, heading, count, mood } = swarm
    this.scale.setScalar(this.baseScale * sizeOf(tuning))
    camera.updateMatrixWorld()
    this.frustum.setFromProjectionMatrix(
      this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    )
    for (let i = 0; i < count; i++) {
      if (rowMood(mood[i]) !== this.written[i]) this.moodChanged(swarm, tuning, i, 0)
      this.sphere.center.set(x[i], 0, z[i])
      const seen = this.frustum.intersectsSphere(this.sphere)
      this.mesh.setVisibleAt(i, seen)
      if (!seen) continue
      // A heading turns from +x toward +z; the rat faces +z at no turn.
      this.turn.setFromAxisAngle(UP, Math.PI / 2 - heading[i])
      this.mesh.setMatrixAt(i, this.matrix.compose(this.position.set(x[i], 0, z[i]), this.turn, this.scale))
    }
  }

  /**
   * Rat `i`'s row, for the mood the swarm has it in: Idle sitting, Walk at the
   * strolling pace shuffling, and otherwise Run at its running speed. It starts
   * `into` of a cycle in, 0 to 1.
   */
  private moodChanged(swarm: Swarm, tuning: Tuning, i: number, into: number): void {
    const m = swarm.mood[i]
    const clip = m === SITTING ? this.idle : m === STROLLING ? this.walk : this.run
    const speed =
      m === SITTING ? 1 : m === STROLLING ? this.walkSpeed(tuning) : this.runSpeed(swarm, tuning, i)
    this.writeRow(i, rowMood(m), clip, this.time.value - (into * cycle(clip)) / speed, speed)
  }

  /** The playback speed at which rat `i` covers a stride a Run cycle at its running speed, at its size. */
  private runSpeed(swarm: Swarm, tuning: Tuning, i: number): number {
    return (swarm.speedOf(i, tuning) * cycle(this.run)) / (STRIDE * sizeOf(tuning))
  }

  /** The playback speed at which a strolling rat covers a stride a Walk cycle, at its size. */
  private walkSpeed(tuning: Tuning): number {
    return (STROLL_SPEED * cycle(this.walk)) / (WALK_STRIDE * sizeOf(tuning))
  }

  /** Rat `i`'s playback row: `clip`, from `startTime`, at `speed`, written for `mood`. */
  private writeRow(i: number, mood: number, clip: Clip, startTime: number, speed: number): void {
    this.written[i] = mood
    this.startTimes[i] = startTime
    this.speeds[i] = speed
    setVATInstance(this.playback, i, { clip, startTime, speed })
  }
}
