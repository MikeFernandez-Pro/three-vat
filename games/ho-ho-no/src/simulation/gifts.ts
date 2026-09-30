// The gifts: one at a time, dropped into the arena on a schedule, blinking
// before they go, each granting the boost its model stands for. Below the
// renderer seam with the rest of the simulation; how a gift is drawn, and
// the burst it goes out in, are the presentation's.
//
// Ported from DecemberChallenge's Gift at 5c6c56b, its schedule and its body
// kept. The original timed everything off the page's clock, with the boost's
// length held by the indicator's countdown tween; here both are the run's.
import RAPIER from '@dimforge/rapier3d-compat'
import { Euler, MathUtils, Quaternion, Vector3 } from 'three'
import { CollisionGroup, collisionGroups } from './collision-groups'

/**
 * What a gift grants: snowballs that pass through skeletons, Santa faster, or
 * his throws faster. The gift model's three presents, in its order.
 */
export type BoostKind = 'ghost' | 'speed' | 'shoot'
export const BOOST_KINDS: readonly BoostKind[] = ['ghost', 'speed', 'shoot']

/** Seconds into the run the first gift drops... */
const FIRST_DROP = 15
/** ...and seconds from one drop to the next. */
const DROP_EVERY = 20
/** A gift nobody collects is gone this long after it dropped... */
const LIFETIME = 7
/** ...and blinks from this long after, every `BLINK_PERIOD` seconds, as a warning. */
const BLINK_FROM = 5
const BLINK_PERIOD = 0.18

/** Gifts drop anywhere in a disc this wide about the camp's centre... */
const DROP_RADIUS = 10
/** ...from this high, so each one falls into view. */
const DROP_HEIGHT = 15

/** Where a gift drops, which present it is, and how it is tilted as it falls. */
export interface GiftDrop {
  kind: BoostKind
  x: number
  z: number
  /** About each axis alike, in radians, so it lands on an angle rather than upright. */
  tilt: number
}

/**
 * The original's drops: a present picked at random, anywhere in the disc with
 * an even spread, every one tilted alike, as the original drew its tilt once
 * when the page loaded.
 */
export function randomDrops(random: () => number = Math.random): () => GiftDrop {
  const tilt = MathUtils.degToRad(random() * 360)
  return () => {
    const kind = BOOST_KINDS[Math.min(Math.floor(random() * BOOST_KINDS.length), BOOST_KINDS.length - 1)]
    const angle = random() * Math.PI * 2
    const radius = Math.sqrt(random()) * DROP_RADIUS
    return { kind, x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, tilt }
  }
}

export interface Gift {
  readonly kind: BoostKind
  /** Its centre, where it is drawn: its body's as the step began. */
  readonly position: Vector3
  readonly rotation: Quaternion
  /** False on the off beats of its warning blink. */
  readonly visible: boolean
}

/** Something a gift did in a step. */
export interface GiftChange {
  change: 'dropped' | 'missed'
  gift: Gift
}

interface Dropped {
  gift: { kind: BoostKind; position: Vector3; rotation: Quaternion; visible: boolean }
  body: RAPIER.RigidBody
  collider: number
  droppedAt: number
}

export class Gifts {
  private dropped: Dropped | null = null
  private nextDropAt = FIRST_DROP

  constructor(
    private readonly world: RAPIER.World,
    private readonly drop: () => GiftDrop,
  ) {}

  /** The gift in the arena, if there is one. */
  get current(): Gift | null {
    return this.dropped?.gift ?? null
  }

  /** Whether `collider` is the gift's. */
  owns(collider: number): boolean {
    return this.dropped?.collider === collider
  }

  /**
   * One step, before the physics, `runTime` seconds into the run: blink, go,
   * drop, or — for a step long enough — go and drop again.
   */
  step(runTime: number): GiftChange[] {
    const changes: GiftChange[] = []
    const dropped = this.dropped
    if (dropped) {
      const since = runTime - dropped.droppedAt
      dropped.gift.visible = since < BLINK_FROM || Math.floor((since - BLINK_FROM) / BLINK_PERIOD) % 2 === 0
      if (since >= LIFETIME) changes.push({ change: 'missed', gift: this.remove() })
    }
    if (!this.dropped && runTime >= this.nextDropAt) {
      changes.push({ change: 'dropped', gift: this.add(runTime) })
      this.nextDropAt += DROP_EVERY
    }

    if (this.dropped) {
      const { gift, body } = this.dropped
      gift.position.copy(body.translation())
      gift.rotation.copy(body.rotation())
    }
    return changes
  }

  /** Santa touched it: it is gone, and it is his. */
  collect(): Gift {
    return this.remove()
  }

  private add(runTime: number): Gift {
    const { kind, x, z, tilt } = this.drop()
    const rotation = new Quaternion().setFromEuler(new Euler(tilt, tilt, tilt))
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, DROP_HEIGHT, z)
        .setRotation(rotation)
        // Or it rolls and spins across the camp for good once it lands.
        .setLinearDamping(0.6)
        .setAngularDamping(1)
        .setCanSleep(true),
    )
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(0.15, 0.15, 0.15, 0.6).setFriction(0).setMass(0.1).setRestitution(0),
      body,
    )
    // The event that tells Santa touched it. Snowballs pass through it.
    collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
    collider.setCollisionGroups(
      collisionGroups(
        CollisionGroup.GIFT,
        CollisionGroup.GROUND | CollisionGroup.ARENA | CollisionGroup.CHARACTER | CollisionGroup.ENEMY,
      ),
    )

    const gift = { kind, position: new Vector3(x, DROP_HEIGHT, z), rotation, visible: true }
    this.dropped = { gift, body, collider: collider.handle, droppedAt: runTime }
    return gift
  }

  private remove(): Gift {
    const dropped = this.dropped!
    this.world.removeRigidBody(dropped.body)
    this.dropped = null
    return dropped.gift
  }
}
