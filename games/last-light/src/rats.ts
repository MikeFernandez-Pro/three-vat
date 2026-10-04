// The crowd the swarm is drawn as: one `BatchedMesh` over the baked rat, one
// geometry and one material (the rat's two flat colours merged at the bake), so
// three culls it rat by rat and the collapse draws it in one draw. Every rat
// plays Run, looping, from its own start time and at a playback speed matching
// its running speed. Both are written when a rat spawns, and the speed again
// when the speed sliders move; never per frame. Per frame, only the matrices
// move.
import { BatchedMesh, Matrix4, MeshStandardNodeMaterial, Quaternion, Vector3 } from 'three/webgpu'
import { createVATPlaybackTexture, setVATInstance, type VAT, type VATPlaybackTexture } from 'three-vat'
import { vatNodes, type VATTimeUniform } from 'three-vat/tsl'
import type { Swarm, Tuning } from './swarm'

/** The clip every rat plays, as the bake names it. */
const RUN = 'RatArmature|Rat_Run'

/**
 * The rat's length across every frame of Run, nose to tail, in metres: its
 * body, without the tail, is a little over half of it, about 0.25 m.
 */
const RAT_LENGTH = 0.46

/**
 * How far one Run cycle carries the rat, in metres, at RAT_LENGTH: a constant
 * of the model, about two body lengths a bound. A rat's playback speed is
 * whatever makes it cover this once a cycle at its running speed.
 */
const STRIDE = 0.5

const UP = new Vector3(0, 1, 0)

export class Rats {
  readonly mesh: BatchedMesh
  private readonly playback: VATPlaybackTexture
  private readonly run: VAT['clips'][number]
  private readonly scale: Vector3
  /** What each rat's Run row says: when it started, and at what playback speed. */
  private readonly startTimes: Float64Array
  private readonly speeds: Float64Array
  /** Rats shown: the first `shown` instances are visible, the rest hidden. */
  private shown = 0
  private readonly matrix = new Matrix4()
  private readonly position = new Vector3()
  private readonly turn = new Quaternion()

  constructor(
    vat: VAT,
    capacity: number,
    maxTextureSize: number,
    private readonly time: VATTimeUniform,
  ) {
    const run = vat.clips.find((clip) => clip.name === RUN)
    if (run === undefined) throw new Error(`last-light: the baked rat has no clip named ${RUN}`)
    this.run = run

    // The rat runs along +z; its length across the frames of Run sets its scale.
    const length = vat.bounds.max.z - vat.bounds.min.z
    this.scale = new Vector3().setScalar(RAT_LENGTH / length)

    this.startTimes = new Float64Array(capacity)
    this.speeds = new Float64Array(capacity)
    this.playback = createVATPlaybackTexture([], { capacity, maxTextureSize })
    // Tinted down so the rats read as a dark carpet at the light's edge, not brown.
    const material = new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85, color: 0x404040 })
    const position = vat.geometry.getAttribute('position').count
    this.mesh = new BatchedMesh(capacity, position, vat.geometry.getIndex()?.count ?? 0, material)
    const geometry = this.mesh.addGeometry(vat.geometry)
    for (let i = 0; i < capacity; i++) this.mesh.setVisibleAt(this.mesh.addInstance(geometry), false)
    material.positionNode = vatNodes(vat, { time, playback: this.playback, carrier: this.mesh }).positionNode
    // Its bounds change every step and the swarm fills the view: culled rat by
    // rat, never as a whole.
    this.mesh.frustumCulled = false
  }

  /**
   * Show the swarm's count. Rats it just spawned, past what was shown, each
   * start Run at their own moment, at a speed their feet match; rats it
   * dropped are hidden.
   */
  show(swarm: Swarm, tuning: Tuning): void {
    const cycle = this.cycle
    for (let i = this.shown; i < swarm.count; i++) {
      this.writeRow(i, this.time.value - Math.random() * cycle, this.playbackSpeed(swarm, tuning, i))
      this.mesh.setVisibleAt(i, true)
    }
    for (let i = swarm.count; i < this.shown; i++) this.mesh.setVisibleAt(i, false)
    this.shown = swarm.count
  }

  /**
   * The speed sliders moved: every rat's playback speed follows its new running
   * speed, once. Its start time moves with it so the stride carries on from the
   * pose it shows rather than jumping to another.
   */
  retime(swarm: Swarm, tuning: Tuning): void {
    const now = this.time.value
    for (let i = 0; i < this.shown; i++) {
      const speed = this.playbackSpeed(swarm, tuning, i)
      if (speed === this.speeds[i]) continue
      this.writeRow(i, now - ((now - this.startTimes[i]) * this.speeds[i]) / speed, speed)
    }
  }

  /** Whether three culls the crowd rat by rat. Off, every rat shown is drawn in every pass. */
  set culled(culled: boolean) {
    this.mesh.perObjectFrustumCulled = culled
  }

  /** Rats in the last pass drawn: what survived the culling, after a render. */
  get drawn(): number {
    return (this.mesh as unknown as { _multiDrawCount: number })._multiDrawCount
  }

  /** Stand every rat where the swarm has it, facing the way it runs. */
  draw(swarm: Swarm): void {
    const { x, z, heading, count } = swarm
    for (let i = 0; i < count; i++) {
      // A heading turns from +x toward +z; the rat faces +z at no turn.
      this.turn.setFromAxisAngle(UP, Math.PI / 2 - heading[i])
      this.mesh.setMatrixAt(i, this.matrix.compose(this.position.set(x[i], 0, z[i]), this.turn, this.scale))
    }
  }

  /** One Run cycle, in seconds of clip at playback speed 1. */
  private get cycle(): number {
    return this.run.frames / this.run.fps
  }

  /** The playback speed at which rat `i` covers a stride a cycle at its running speed. */
  private playbackSpeed(swarm: Swarm, tuning: Tuning, i: number): number {
    return (swarm.speedOf(i, tuning) * this.cycle) / STRIDE
  }

  /** Rat `i`'s playback row: Run, from `startTime`, at `speed`. */
  private writeRow(i: number, startTime: number, speed: number): void {
    this.startTimes[i] = startTime
    this.speeds[i] = speed
    setVATInstance(this.playback, i, { clip: this.run, startTime, speed })
  }
}
