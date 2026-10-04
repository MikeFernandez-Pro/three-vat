// The crowd the swarm is drawn as: one `BatchedMesh` over the baked rat, one
// geometry and one material (the rat's two flat colours merged at the bake),
// culled rat by rat and drawn in one draw by the collapse. Each rat plays the
// clip its gait names and nothing else: Run or Walk, looping, at a playback
// speed that matches the speed it really moves at, so its feet keep to the
// ground; Idle where it stands. A rat's row is written when it spawns, when its
// gait changes, when its real speed drifts DRIFT from the speed its row was
// written for, and when the rat scale moves; a rat out of view gets its row
// when it comes back into view. Per frame, the matrices and which rats are in
// view move, and the few rats whose row is out of date.
import { BatchedMesh, Frustum, Matrix4, MeshStandardNodeMaterial, Quaternion, Sphere, Vector3, type Camera } from 'three/webgpu'
import { createVATPlaybackTexture, setVATInstance, type VAT, type VATPlaybackTexture } from 'three-vat'
import { vatNodes, type VATTimeUniform } from 'three-vat/tsl'
import { CREEP, defaultTuning, IDLE, WALK, type Swarm, type Tuning } from './swarm'

/** The clips, as the bake names them, one a gait. */
const RUN_CLIP = 'RatArmature|Rat_Run'
const WALK_CLIP = 'RatArmature|Rat_Walk'
const IDLE_CLIP = 'RatArmature|Rat_Idle'

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
 * whatever makes it cover this once a cycle at the speed it really moves.
 */
const STRIDE = 0.5
/** How far one Walk cycle carries the rat, in metres: an estimate, about half a body length a step. */
const WALK_STRIDE = 0.25

/** How far a rat's real speed drifts from the speed its row was written for, as a share, before the row is rewritten. */
const DRIFT = 0.25

type Clip = VAT['clips'][number]

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
  /** The gait each rat's row was last written for, and the real speed, m/s. */
  private readonly written: Uint8Array
  private readonly writtenSpeed: Float32Array
  /** The rat's scale at its usual size, and as drawn this frame. */
  private readonly baseScale: number
  private readonly scale = new Vector3()
  /** What each rat's row says: when it started, and at what playback speed. */
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
    this.run = clip(RUN_CLIP)
    this.walk = clip(WALK_CLIP)
    this.idle = clip(IDLE_CLIP)
    this.written = new Uint8Array(capacity)
    this.writtenSpeed = new Float32Array(capacity)

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
   * start their clip at their own moment; rats it dropped are hidden.
   */
  show(swarm: Swarm, tuning: Tuning): void {
    for (let i = this.shown; i < swarm.count; i++) this.gaitChanged(swarm, tuning, i, Math.random())
    for (let i = swarm.count; i < this.shown; i++) this.mesh.setVisibleAt(i, false)
    this.shown = swarm.count
  }

  /**
   * The rat scale moved: every running or walking rat's playback speed follows
   * its new stride, once, at the speed its row was written for.
   */
  retime(tuning: Tuning): void {
    for (let i = 0; i < this.shown; i++) if (this.written[i] !== IDLE) this.respeed(tuning, i, this.writtenSpeed[i])
  }

  /** Rats in the last pass drawn: what survived the culling, after a render. */
  get drawn(): number {
    return (this.mesh as unknown as { _multiDrawCount: number })._multiDrawCount
  }

  /**
   * Stand every rat where the swarm has it, facing the way it goes, and draw
   * only those within `camera`'s view, give or take CULL_MARGIN. A rat in view
   * whose gait changed since its row was written gets its new clip; one whose
   * real speed drifted gets its new playback speed.
   */
  draw(swarm: Swarm, tuning: Tuning, camera: Camera): void {
    const { x, z, heading, count, gait, realSpeed } = swarm
    this.scale.setScalar(this.baseScale * sizeOf(tuning))
    camera.updateMatrixWorld()
    this.frustum.setFromProjectionMatrix(
      this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    )
    for (let i = 0; i < count; i++) {
      this.sphere.center.set(x[i], 0, z[i])
      const seen = this.frustum.intersectsSphere(this.sphere)
      this.mesh.setVisibleAt(i, seen)
      if (!seen) continue
      if (gait[i] !== this.written[i]) this.gaitChanged(swarm, tuning, i, 0)
      else if (gait[i] !== IDLE && Math.abs(realSpeed[i] - this.writtenSpeed[i]) > DRIFT * this.writtenSpeed[i]) {
        this.respeed(tuning, i, realSpeed[i])
      }
      // A heading turns from +x toward +z; the rat faces +z at no turn.
      this.turn.setFromAxisAngle(UP, Math.PI / 2 - heading[i])
      this.mesh.setMatrixAt(i, this.matrix.compose(this.position.set(x[i], 0, z[i]), this.turn, this.scale))
    }
  }

  /**
   * Rat `i`'s row, for the gait the swarm has it in: Idle, or Walk or Run at
   * the speed it really moves. It starts `into` of a cycle in, 0 to 1.
   */
  private gaitChanged(swarm: Swarm, tuning: Tuning, i: number, into: number): void {
    const gait = swarm.gait[i]
    const real = swarm.realSpeed[i]
    const clip = this.clipOf(gait)
    const speed = this.playbackSpeed(tuning, gait, real)
    this.writeRow(i, gait, real, clip, this.time.value - (into * cycle(clip)) / speed, speed)
  }

  /**
   * Rat `i`'s row, its gait unchanged, at the playback speed for `real` m/s.
   * Its start time moves with it so the stride carries on from the pose it
   * shows rather than jumping to another.
   */
  private respeed(tuning: Tuning, i: number, real: number): void {
    const gait = this.written[i]
    const speed = this.playbackSpeed(tuning, gait, real)
    const now = this.time.value
    const startTime = now - ((now - this.startTimes[i]) * this.speeds[i]) / speed
    this.writeRow(i, gait, real, this.clipOf(gait), startTime, speed)
  }

  /** The clip a gait plays. */
  private clipOf(gait: number): Clip {
    return gait === IDLE ? this.idle : gait === WALK ? this.walk : this.run
  }

  /** The playback speed at which a rat in `gait` covers a stride a cycle at `real` m/s, at its size; Idle plays at 1. */
  private playbackSpeed(tuning: Tuning, gait: number, real: number): number {
    if (gait === IDLE) return 1
    const clip = gait === WALK ? this.walk : this.run
    const stride = gait === WALK ? WALK_STRIDE : STRIDE
    return (Math.max(real, CREEP) * cycle(clip)) / (stride * sizeOf(tuning))
  }

  /** Rat `i`'s playback row: `clip`, from `startTime`, at `speed`, written for `gait` at `real` m/s. */
  private writeRow(i: number, gait: number, real: number, clip: Clip, startTime: number, speed: number): void {
    this.written[i] = gait
    this.writtenSpeed[i] = real
    this.startTimes[i] = startTime
    this.speeds[i] = speed
    setVATInstance(this.playback, i, { clip, startTime, speed })
  }
}
