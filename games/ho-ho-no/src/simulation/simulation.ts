// The game's gameplay, below the renderer seam (ADR-0038): stepped by
// `(time, input)`, with no renderer, DOM or audio. It owns the Rapier world;
// input arrives as plain state; what happens is raised as events that the
// presentation — Santa's animations, the particles, later the sound — listens
// to, and what is left standing is read off its public state each frame.
//
// Ported from DecemberChallenge at 5c6c56b: CharacterController, Character's
// physics, ProjectilesFactory and Camp's colliders, with their constants and
// their per-frame order kept. One thing moves in: the original let the shoot
// animation's `finished` event gate the next shot, so the fire cadence was the
// mixer's. Here the simulation is told how long the clip is and holds the gate
// itself, which is what lets a headless test pin the cadence.
import RAPIER from '@dimforge/rapier3d-compat'
import { Quaternion, Vector3 } from 'three'
import { CollisionGroup, collisionGroups } from './collision-groups'

/** Santa's model stands at this height; his rigid body carries only x and z to it. */
export const SANTA_HEIGHT = 0.55
/** The muzzle's height above Santa's feet: aiming is done on a plane there. */
const AIM_HEIGHT_OFFSET = 0.596
/** The plane the cursor is cast onto to aim, at the muzzle's height. */
export const AIM_HEIGHT = SANTA_HEIGHT + AIM_HEIGHT_OFFSET

const GRAVITY = -9.81 * 3
const MOVE_SPEED = 7.5
/** Hold-to-shoot cadence, in seconds; the shoot clip can hold it back further. */
const SHOOT_REPEAT_DELAY = 0.39
/** The shoot clip plays at this speed, and the next shot waits for it to end. */
export const SHOOT_TIME_SCALE = 1.5

const SNOWBALL_COLLIDER_HALF = 0.4 * 0.5
const SNOWBALL_SPEED = 50
const SNOWBALL_RANGE = 50
/** Where a snowball leaves Santa, in his own frame: off his right hand, at the muzzle. */
const MUZZLE = new Vector3(-0.253, AIM_HEIGHT_OFFSET, 0.719)

/**
 * The longest step the physics takes. The original stepped by whatever the
 * frame took, so a tab returning from the background stepped seconds at once
 * and Santa went through the arena wall; a frame is never this long in play.
 */
const MAX_STEP = 0.1

const UP = new Vector3(0, 1, 0)

/** A point in the world, as plain numbers. */
export interface Point {
  x: number
  y: number
  z: number
}

/** One step's input: what the player is doing, never how it was read. */
export interface SimulationInput {
  /**
   * Movement intent on the ground: `x` to the right, `z` toward the camera,
   * each in [-1, 1]. Any direction moves at the same speed.
   */
  move: { x: number; z: number }
  /** The point on the aim plane (at `AIM_HEIGHT`) under the cursor, or null when the cursor ray misses it. */
  aim: Point | null
  /** Fire is held — or was pressed since the last step, so a tap between two frames still throws. */
  fire: boolean
}

/** The arena's collision mesh, in world space. */
export interface Arena {
  vertices: Float32Array
  indices: Uint32Array
}

export interface SimulationOptions {
  /** How long the character's `shoot` clip is, in seconds, at speed 1. */
  shootClipDuration: number
  /** The arena wall the snowballs burst on and Santa stays inside. None, and the camp is open ground. */
  arena?: Arena
}

export interface Snowball {
  readonly id: number
  /** Where it is drawn: its body's position as the step began, as the original drew it. */
  readonly position: Vector3
  /** The way it flies, about +y. */
  readonly yaw: number
}

/** Why a snowball stopped: it hit the arena wall, or flew its range. */
export type BurstCause = 'arena' | 'range'

export interface SimulationEvents {
  /** Santa threw: the shoot clip starts. */
  shoot: { position: Point; facing: number; timeScale: number }
  /** A snowball is gone — into the arena, or out of range. */
  burst: { position: Point; cause: BurstCause }
}

type Listener<T> = (event: T) => void

interface SnowballBody {
  snowball: { id: number; position: Vector3; yaw: number }
  body: RAPIER.RigidBody
  from: Vector3
  direction: Vector3
}

let rapierReady: Promise<void> | undefined

/** Build a simulation. Async once per page: Rapier's WASM is instantiated on first use. */
export async function createSimulation(options: SimulationOptions): Promise<Simulation> {
  rapierReady ??= RAPIER.init()
  await rapierReady
  return new Simulation(options)
}

export class Simulation {
  /** Whether the run has begun. Nothing moves before it does. */
  started = false
  /** Seconds since the run began. */
  elapsed = 0

  /** Santa as he is drawn: position at his feet, facing about +y, and whether he is walking. */
  readonly santa = { position: new Vector3(0, SANTA_HEIGHT, 0), facing: 0, moving: false }

  private readonly world: RAPIER.World
  private readonly events: RAPIER.EventQueue
  private readonly santaBody: RAPIER.RigidBody
  private readonly shootClipDuration: number
  private readonly arenaHandles = new Set<number>()
  private readonly snowballsByCollider = new Map<number, SnowballBody>()
  private readonly flying: SnowballBody[] = []
  private readonly listeners: { [K in keyof SimulationEvents]: Listener<SimulationEvents[K]>[] } = {
    shoot: [],
    burst: [],
  }

  private startedAt = 0
  private lastTime = 0
  private lastShotAt = -Infinity
  private shootClipEndsAt = -Infinity
  private nextSnowballId = 0

  constructor({ shootClipDuration, arena }: SimulationOptions) {
    this.shootClipDuration = shootClipDuration
    this.world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 })
    this.events = new RAPIER.EventQueue(true)

    const camp = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
    const ground = this.world.createCollider(RAPIER.ColliderDesc.cuboid(100, 0.5, 100), camp)
    ground.setCollisionGroups(
      collisionGroups(
        CollisionGroup.GROUND,
        CollisionGroup.ENEMY | CollisionGroup.CHARACTER | CollisionGroup.PROJECTILE | CollisionGroup.GIFT,
      ),
    )
    if (arena) {
      const wall = this.world.createCollider(RAPIER.ColliderDesc.trimesh(arena.vertices, arena.indices), camp)
      wall.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      wall.setCollisionGroups(
        collisionGroups(CollisionGroup.ARENA, CollisionGroup.CHARACTER | CollisionGroup.PROJECTILE | CollisionGroup.GIFT),
      )
      this.arenaHandles.add(wall.handle)
    }

    this.santaBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1.6, 0).lockRotations(),
    )
    this.santaBody.sleep()
    const santa = this.world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.6), this.santaBody)
    santa.setCollisionGroups(
      collisionGroups(
        CollisionGroup.CHARACTER,
        CollisionGroup.ARENA | CollisionGroup.GROUND | CollisionGroup.ENEMY | CollisionGroup.GIFT,
      ),
    )
  }

  /** The snowballs in flight. */
  get snowballs(): readonly Snowball[] {
    return this.flying.map((flying) => flying.snowball)
  }

  on<K extends keyof SimulationEvents>(type: K, listener: Listener<SimulationEvents[K]>): () => void {
    const list = this.listeners[type]
    list.push(listener)
    return () => {
      const index = list.indexOf(listener)
      if (index !== -1) list.splice(index, 1)
    }
  }

  /** Begin the run at `time`, in seconds, on the clock `step` is given. */
  start(time: number): void {
    if (this.started) return
    this.started = true
    this.startedAt = time
    this.lastTime = time
  }

  /** Advance to `time` (seconds, the clock `start` was given) under `input`. */
  step(time: number, input: SimulationInput): void {
    if (!this.started) return
    const dt = time - this.lastTime
    this.lastTime = time
    this.elapsed = time - this.startedAt

    this.stepSanta(input)
    this.stepSnowballs()

    if (dt <= 0) return
    this.world.timestep = Math.min(dt, MAX_STEP)
    this.world.step(this.events)
    this.events.drainCollisionEvents((first, second, started) => {
      if (started) this.collide(first, second)
    })
  }

  /** Free the physics world. */
  dispose(): void {
    this.events.free()
    this.world.free()
  }

  private emit<K extends keyof SimulationEvents>(type: K, event: SimulationEvents[K]): void {
    for (const listener of [...this.listeners[type]]) listener(event)
  }

  private stepSanta({ move, aim, fire }: SimulationInput): void {
    const body = this.santaBody.translation()
    this.santa.position.set(body.x, SANTA_HEIGHT, body.z)

    if (aim) {
      const x = aim.x - this.santa.position.x
      const z = aim.z - this.santa.position.z
      if (x !== 0 || z !== 0) this.santa.facing = Math.atan2(x, z)
    }

    if (fire) this.tryShoot(aim)

    const velocity = this.santaBody.linvel()
    const length = Math.hypot(move.x, move.z)
    this.santa.moving = length > 0
    const speed = length > 0 ? MOVE_SPEED / length : 0
    this.santaBody.setLinvel({ x: move.x * speed, y: velocity.y, z: move.z * speed }, true)
  }

  private tryShoot(aim: Point | null): void {
    const now = this.elapsed
    if (now < this.shootClipEndsAt) return
    if (now - this.lastShotAt < SHOOT_REPEAT_DELAY) return
    this.lastShotAt = now
    this.shootClipEndsAt = now + this.shootClipDuration / SHOOT_TIME_SCALE

    const { position, facing } = this.santa
    this.emit('shoot', { position: { x: position.x, y: position.y, z: position.z }, facing, timeScale: SHOOT_TIME_SCALE })
    this.throwSnowball(aim)
  }

  private throwSnowball(aim: Point | null): void {
    const turn = new Quaternion().setFromAxisAngle(UP, this.santa.facing)
    const from = MUZZLE.clone().applyQuaternion(turn).add(this.santa.position)

    // Toward the point under the cursor rather than straight ahead, so a shot
    // from the offset muzzle still passes through it; flat, because snowballs
    // fly level.
    const direction = new Vector3()
    if (aim) direction.set(aim.x - from.x, 0, aim.z - from.z)
    if (direction.lengthSq() === 0) direction.set(0, 0, 1).applyQuaternion(turn)
    direction.normalize()
    const yaw = Math.atan2(direction.x, direction.z)

    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(from.x, from.y, from.z)
        .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
        // A thin trimesh at 50 units a second is tunnelled without it.
        .setCcdEnabled(true),
    )
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(SNOWBALL_COLLIDER_HALF, SNOWBALL_COLLIDER_HALF, SNOWBALL_COLLIDER_HALF).setFriction(1),
      body,
    )
    collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
    collider.setCollisionGroups(collisionGroups(CollisionGroup.PROJECTILE, CollisionGroup.ENEMY | CollisionGroup.ARENA))

    const flying: SnowballBody = {
      snowball: { id: this.nextSnowballId++, position: from.clone(), yaw },
      body,
      from,
      direction,
    }
    this.flying.push(flying)
    this.snowballsByCollider.set(collider.handle, flying)
  }

  private stepSnowballs(): void {
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const flying = this.flying[i]
      const { body, direction, snowball } = flying
      // Level flight at a fixed speed, whatever gravity did in the last step.
      body.setLinvel({ x: direction.x * SNOWBALL_SPEED, y: 0, z: direction.z * SNOWBALL_SPEED }, true)
      const at = body.translation()
      snowball.position.set(at.x, at.y, at.z)
      if (flying.from.distanceTo(snowball.position) > SNOWBALL_RANGE) this.burst(flying, 'range')
    }
  }

  private collide(first: number, second: number): void {
    const snowball = this.snowballsByCollider.get(first) ?? this.snowballsByCollider.get(second)
    if (!snowball) return
    const other = this.snowballsByCollider.has(first) ? second : first
    if (this.arenaHandles.has(other)) this.burst(snowball, 'arena')
  }

  private burst(flying: SnowballBody, cause: BurstCause): void {
    const index = this.flying.indexOf(flying)
    if (index === -1) return
    this.flying.splice(index, 1)
    const at = flying.body.translation()
    for (let i = 0; i < flying.body.numColliders(); i++) this.snowballsByCollider.delete(flying.body.collider(i).handle)
    this.world.removeRigidBody(flying.body)
    this.emit('burst', { position: { x: at.x, y: at.y, z: at.z }, cause })
  }
}
