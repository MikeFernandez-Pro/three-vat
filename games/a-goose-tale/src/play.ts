// The swarm a play sets its rats down in and reads (gooseplay.ts): the CPU
// swarm, stepped as the play goes (SteppedSwarm), as the tests and the 2D page
// play it; or a page's own, handed to the play, which the 3D page steps on the
// GPU as it draws and whose rats' places come back a frame or two late.
import { Swarm, type Dark, type FixedLight, type Ground, type Light, type StepReport, type Target, type Tuning } from './swarm'
import { STEP } from './swarm-remote'
import type { Wall } from './walls'

/** The most swarm steps a frame takes: a hitch slows the swarm rather than stalling the page. */
const MOST_STEPS = 3

/**
 * The rats as the play sets them down and reads where they are: the CPU
 * swarm, or a page's own, whose places may come back late.
 */
export interface PlaySwarm {
  readonly capacity: number
  readonly count: number
  readonly arena: number
  /** Where each rat is, as last known: a rat set down is there at once. */
  readonly x: ArrayLike<number>
  readonly z: ArrayLike<number>
  /** `count` rats, every one placed afresh by the swarm's own rule. */
  reset(count: number): void
  setCount(count: number): void
  setDown(i: number, x: number, z: number): void
  setWalls(walls: readonly Wall[]): void
  /** Every rat placed again, out of the walls and `lights`. */
  restart(lights: readonly FixedLight[]): void
  /**
   * The swarm moved on by `dt` of play, under the torch, the tuning and the
   * placed lights: what its last step measured, or nothing yet. A swarm a
   * page steps as it draws only says what it last measured. Given a `dark`,
   * what lies out of view round the light, rats left behind in it are
   * brought round ahead, where the swarm does that. Given `targets`, those
   * out of every light pull the rats near them; a swarm a page steps is
   * handed them by the page.
   */
  advance(dt: number, light: Light, tuning: Tuning, lights: readonly FixedLight[], dark?: Dark, targets?: readonly Target[]): StepReport | undefined
}

/** The CPU swarm, stepped at the worker's pace as the play goes, MOST_STEPS a frame at most: what the tests and the 2D page play. */
export class SteppedSwarm extends Swarm implements PlaySwarm {
  /** The time not yet stepped, s, and what the last step measured. */
  private unstepped = 0
  private last: StepReport | undefined

  override reset(count: number): void {
    super.reset(count)
    this.unstepped = 0
    this.last = undefined
  }

  advance(dt: number, light: Light, tuning: Tuning, lights: readonly FixedLight[], dark?: Dark, targets: readonly Target[] = []): StepReport | undefined {
    this.unstepped = Math.min(this.unstepped + dt, MOST_STEPS * STEP)
    while (this.unstepped >= STEP) {
      this.unstepped -= STEP
      this.last = this.step(STEP, light, tuning, dark, lights, targets)
    }
    return this.last
  }
}

/** What a page hands the play of its own: its swarm, made on the ground the play gives it; and the swarm's tuning, which the page's panel edits. */
export interface PlayDrive<S extends PlaySwarm> {
  swarm?: (ground: Ground) => S
  tuning?: Tuning
}
