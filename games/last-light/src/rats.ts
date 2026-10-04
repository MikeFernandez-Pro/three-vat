// The crowd the swarm is drawn as: one `BatchedMesh` over the baked rat, one
// geometry and one material (the rat's two flat colours merged at the bake), so
// three culls it rat by rat and the collapse draws it in one draw. Every rat
// plays Run, looping, from its own start time and at a playback speed matching
// its running speed. Both are written when a rat spawns and never per frame;
// per frame, only the matrices move.
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

    this.playback = createVATPlaybackTexture([], { capacity, maxTextureSize })
    const material = new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85 })
    const position = vat.geometry.getAttribute('position').count
    this.mesh = new BatchedMesh(capacity, position, vat.geometry.getIndex()?.count ?? 0, material)
    const geometry = this.mesh.addGeometry(vat.geometry)
    for (let i = 0; i < capacity; i++) this.mesh.addInstance(geometry)
    material.positionNode = vatNodes(vat, { time, playback: this.playback, carrier: this.mesh }).positionNode
    // Its bounds change every step and the swarm fills the view: culled rat by
    // rat, never as a whole.
    this.mesh.frustumCulled = false
  }

  /** Rats `from` to `to`, just spawned: each starts Run at its own moment, at a speed its feet match. */
  spawned(swarm: Swarm, tuning: Tuning, from: number, to: number): void {
    const cycle = this.run.frames / this.run.fps
    for (let i = from; i < to; i++) {
      setVATInstance(this.playback, i, {
        clip: this.run,
        startTime: this.time.value - Math.random() * cycle,
        speed: (swarm.speedOf(i, tuning) * cycle) / STRIDE,
      })
    }
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
}
