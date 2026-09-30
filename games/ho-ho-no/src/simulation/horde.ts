// The skeletons: they spawn on a ring on a ramp that tightens, rise out of the
// snow, walk at Santa, die to his snowballs and sink away. Below the renderer
// seam with the rest of the simulation; what the horde draws with is a row per
// skeleton, and all this module knows of the carrier is that it numbers those
// rows.
//
// Ported from DecemberChallenge's Enemy at 5c6c56b, its constants kept. What
// the original animated with a hand-written VAT shader — a walk, and a death
// blended from the walk's pose frozen at the hit — is now instance playback,
// written through the library: a spawn plays `spawn`, crossfades into `walk`,
// and a hit crossfades into `death`. The playback defaults (once or repeat,
// clamped, the walk at 2x) come with the clips from the bake config
// (models/vat.config.json), so each write here names a clip and a start.
//
// The rise is new, and a skeleton stands where it rose, facing Santa, until it
// has risen: a body gliding across the snow as it climbs out of it reads as a
// bug. So each one reaches Santa 3.6 s later than in the original, on the same
// ring and the same ramp; a decision taken for the look, not a retuning.
import RAPIER from '@dimforge/rapier3d-compat'
import { MathUtils, Quaternion, Vector3 } from 'three'
import { endsAt, setVATInstance, type VAT, type VATClip, type VATInstance, type VATPlaybackState, type VATPlaybackTexture } from 'three-vat'
import { clipNamed } from './clips'
import { CollisionGroup, collisionGroups } from './collision-groups'

/**
 * The horde's capacity: the rows its playback texture reserves and its carrier
 * holds. Spawning waits while every one is taken.
 */
export const SKELETON_CAPACITY = 400

const CHASE_SPEED = 3.5
/** Spawns land on a ring this far from the camp's centre. */
const SPAWN_RADIUS = 17
const SPAWN_INTERVAL_START = 0.9
const SPAWN_INTERVAL_END = 0.35
/** Seconds of the run over which the interval closes from start to end. */
const SPAWN_INTERVAL_RAMP = 90
/** A long frame spawns what it owes, up to this many. */
const MAX_SPAWNS_PER_STEP = 10

/** The collider's centre stands this far above the feet the skeleton is drawn from. */
const BODY_HEIGHT = 1
/**
 * The top of the ground slab. The original spawned its bodies at y = 0, half
 * sunk in it, and the physics shoved them up over the next frames; with a rise
 * to watch, a skeleton starts standing on the snow instead.
 */
const GROUND_TOP = 0.5
/** Seconds the crossfade from the risen pose into the walk takes. */
const WALK_CROSSFADE = 0.3
/** Seconds the crossfade into the death takes, from whatever it was doing: the original's. */
const DEATH_CROSSFADE = 0.1
/** A corpse sinks at this rate, in units a second... */
const SINK_SPEED = 1
/** ...until its feet are this far down, where its row is given back. */
const SINK_DEPTH = -3

const UP = new Vector3(0, 1, 0)

/** The skeleton VAT's clips the horde plays: `run` is baked, and unused, as in the original. */
export interface SkeletonClips {
  spawn: VATClip
  walk: VATClip
  death: VATClip
}

/** The horde's clips out of the skull's baked file. */
export function skeletonClipsOf(vat: VAT): SkeletonClips {
  return { spawn: clipNamed(vat, 'spawn'), walk: clipNamed(vat, 'walk'), death: clipNamed(vat, 'death') }
}

/**
 * The carrier's numbering, and nothing else of it. Three's `BatchedMesh`
 * reissues the lowest freed id, so a spawn routinely lands on a row a corpse
 * left: the horde writes the whole row every time (row recycling).
 */
export interface SkeletonRows {
  addInstance(): number
  deleteInstance(row: number): void
}

/** What the horde draws with: its clips, its rows, and the playback texture over them. */
export interface SkeletonCrowd {
  clips: SkeletonClips
  rows: SkeletonRows
  /** Reserved from {@link SKELETON_CAPACITY}; every row the horde takes, it writes. */
  playback: VATPlaybackTexture
}

/** Rising out of the snow, walking at Santa, dying, then sinking. */
export type SkeletonState = 'rising' | 'walking' | 'dying' | 'sinking'

export interface Skeleton {
  /** Its row: in the carrier and in the playback texture. */
  readonly row: number
  readonly state: SkeletonState
  /** Where it is drawn, at its feet. */
  readonly position: Vector3
  /** Its heading about +y. */
  readonly facing: number
  /** What its row of the playback texture holds, the band it is blending out of included. */
  readonly playback: VATInstance
}

/** The seconds between two spawns, `runTime` seconds into the run: the original's ramp, a straight line clamped at its end. */
export function spawnInterval(runTime: number): number {
  const along = MathUtils.clamp(runTime / SPAWN_INTERVAL_RAMP, 0, 1)
  return SPAWN_INTERVAL_START + (SPAWN_INTERVAL_END - SPAWN_INTERVAL_START) * along
}

interface Member {
  skeleton: { row: number; state: SkeletonState; position: Vector3; facing: number; playback: VATInstance }
  body: RAPIER.RigidBody | null
  /** When the risen pose starts blending into the walk: the end of `spawn`. */
  walkAt: number
  /** When the corpse starts sinking: the end of `death`. */
  sinkAt: number
  /** The corpse's feet, where it fell. */
  fallenY: number
}

/** One clip playing, without the transition it may be in the middle of. */
const playingOf = ({ from: _from, fadeDuration: _duration, fadeStart: _start, ...playing }: VATInstance): VATPlaybackState =>
  playing

export class Horde {
  private readonly members: Member[] = []
  private readonly byCollider = new Map<number, Member>()
  private readonly turn = new Quaternion()
  private nextSpawnAt = SPAWN_INTERVAL_START

  constructor(
    private readonly world: RAPIER.World,
    private readonly crowd: SkeletonCrowd,
    private readonly random: () => number,
  ) {}

  /** Everything the horde has standing or sinking, in the order they came. */
  get skeletons(): readonly Skeleton[] {
    return this.members.map((member) => member.skeleton)
  }

  /** Whether `collider` is a live skeleton's. */
  owns(collider: number): boolean {
    return this.byCollider.has(collider)
  }

  /**
   * One step, before the physics: spawn what is due by `runTime` seconds into
   * the run, move each skeleton on at `time` on the VAT's clock, and chase
   * `target`, Santa's body. Returns the skeletons it spawned.
   */
  step(time: number, runTime: number, target: { x: number; z: number }): Skeleton[] {
    const spawned: Skeleton[] = []
    while (spawned.length < MAX_SPAWNS_PER_STEP && runTime >= this.nextSpawnAt) {
      // Full: the rest wait for a row. The original crashed on its 401st.
      if (this.members.length >= SKELETON_CAPACITY) break
      spawned.push(this.spawn(time))
      this.nextSpawnAt += spawnInterval(runTime)
    }

    for (let i = this.members.length - 1; i >= 0; i--) {
      const member = this.members[i]
      const { skeleton, body } = member

      if (skeleton.state === 'rising' && time >= member.walkAt) {
        this.write(skeleton, { clip: this.crowd.clips.walk, startTime: member.walkAt, fadeDuration: WALK_CROSSFADE })
        skeleton.state = 'walking'
      }
      if (skeleton.state === 'dying' && time >= member.sinkAt) skeleton.state = 'sinking'

      if (body) {
        this.chase(member, body, target)
        continue
      }
      if (skeleton.state !== 'sinking') continue
      skeleton.position.y = member.fallenY - (time - member.sinkAt) * SINK_SPEED
      if (skeleton.position.y <= SINK_DEPTH) {
        this.crowd.rows.deleteInstance(skeleton.row)
        this.members.splice(i, 1)
      }
    }
    return spawned
  }

  /** Kill the skeleton `collider` belongs to at `time`: it crossfades into its death, and its body is gone. */
  kill(collider: number, time: number): Skeleton | undefined {
    const member = this.byCollider.get(collider)
    if (!member?.body) return undefined
    this.byCollider.delete(collider)
    this.world.removeRigidBody(member.body)
    member.body = null

    const { skeleton } = member
    const death: VATInstance = { clip: this.crowd.clips.death, startTime: time, fadeDuration: DEATH_CROSSFADE }
    this.write(skeleton, death)
    skeleton.state = 'dying'
    // The clip table's own answer to when it is over: the play's start plus
    // the clip's length over its speed, one play, as the bake config has it.
    member.sinkAt = endsAt(death) ?? Infinity
    member.fallenY = skeleton.position.y
    return skeleton
  }

  private spawn(time: number): Skeleton {
    const angle = this.random() * Math.PI * 2
    const x = Math.cos(angle) * SPAWN_RADIUS
    const z = Math.sin(angle) * SPAWN_RADIUS

    // The carrier's numbering: often a row a corpse has just given back.
    const row = this.crowd.rows.addInstance()
    // A cut, never a crossfade: one would blend out of whatever the row still
    // holds, and for a recycled row that is the last corpse.
    const rise: VATInstance = { clip: this.crowd.clips.spawn, startTime: time }
    const skeleton = { row, state: 'rising' as SkeletonState, position: new Vector3(x, GROUND_TOP, z), facing: 0, playback: rise }
    setVATInstance(this.crowd.playback, row, rise)

    const body = this.world.createRigidBody(
      // Upright; the chase sets its heading.
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, GROUND_TOP + BODY_HEIGHT, z).lockRotations(),
    )
    const collider = this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.8, BODY_HEIGHT, 0.7), body)
    collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
    collider.setCollisionGroups(
      collisionGroups(
        CollisionGroup.ENEMY,
        CollisionGroup.GROUND | CollisionGroup.CHARACTER | CollisionGroup.PROJECTILE | CollisionGroup.GIFT | CollisionGroup.ARENA,
      ),
    )

    const member: Member = { skeleton, body, walkAt: endsAt(rise) ?? time, sinkAt: Infinity, fallenY: 0 }
    this.members.push(member)
    this.byCollider.set(collider.handle, member)
    return skeleton
  }

  /** Turn to `target`, and walk at it once risen; draw it where its body is. */
  private chase(member: Member, body: RAPIER.RigidBody, target: { x: number; z: number }): void {
    const { skeleton } = member
    const at = body.translation()
    const x = target.x - at.x
    const z = target.z - at.z
    const length = Math.hypot(x, z)
    if (length > 1e-3) {
      skeleton.facing = Math.atan2(x, z)
      this.turn.setFromAxisAngle(UP, skeleton.facing)
      body.setRotation(this.turn, true)
      // It stands where it rose until it has risen.
      const speed = skeleton.state === 'walking' ? CHASE_SPEED / length : 0
      body.setLinvel({ x: x * speed, y: body.linvel().y, z: z * speed }, true)
    }
    skeleton.position.set(at.x, at.y - BODY_HEIGHT, at.z)
  }

  /**
   * Write `instance` into the skeleton's row, and remember what the row now
   * holds: a crossfade leaves the band it was playing, which the library
   * reads back from the row and keeps playing.
   */
  private write(skeleton: Member['skeleton'], instance: VATInstance): void {
    setVATInstance(this.crowd.playback, skeleton.row, instance)
    skeleton.playback = instance.fadeDuration ? { ...instance, from: playingOf(skeleton.playback) } : instance
  }
}
