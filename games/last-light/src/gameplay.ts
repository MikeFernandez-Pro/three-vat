// What the game plays by, past the run's and the swarm's own defaults: how many
// rats, how they run and crowd, how far off they notice the holder, and how
// fast the holder walks. The 3D page (main.ts) and the 2D prototype
// (twod.prototype.ts) both read these, so the two play alike: the 2D page
// tests the play the 3D page will have, never a copy of its numbers.
import { defaultTuning, type Tuning } from './swarm'

/** How many rats the game starts with. */
export const RATS = 2000
/** How far off a rat notices the holder, m: past the fog, so a rat that comes is never seen setting off, and short of the level, so the far rats seethe where they are. */
export const NOTICE = 9
/** How fast the light walks to start, m/s: a jog; set from the panel on 2026-10-08. */
export const LIGHT_SPEED = 2
/** How far past the torch's reach no rat is set down when the run starts again, m: room to breathe before the front comes. */
export const RESTART_ROOM = 2
/** How big a rat is against the swarm's own: three quarters again, saved from the panel on 2026-10-05. */
export const RAT_SIZE = 1.75

/**
 * The crowd as the panel left it on 2026-10-08: the rats keep off the light by
 * a fifth of a metre, writhe at a metre a second, and pile up high (2) over the
 * mass behind the front, over five and a half gaps. Since 2026-10-10 they read
 * the light's walk a fifth of a second ahead: a rat in the way of the holder
 * running at it gets out of the way, where it was caught and turned in the
 * light. The swarm's own defaults stay the ones its tests pin, where a writhe
 * this hard leaves a few rats inside the light.
 */
export const CROWD = { gap: 0.2, agitation: 1, pile: 2, pileRamp: 5.5, lookAhead: 0.2 } satisfies Partial<Tuning>

/** Since 2026-10-10 the rats run in from 1.7 to 2.3 m/s, and from the light from 3 to 3.3. */
export const RAT_SPEEDS = { minSpeed: 1.7, maxSpeed: 2.3, fleeMinSpeed: 3, fleeMaxSpeed: 3.3 } satisfies Partial<Tuning>

/** The swarm as the game tunes it: its crowd, its speeds, its notice, and its rats' size. */
export function gameTuning(): Tuning {
  const tuning = Object.assign(defaultTuning(), CROWD, RAT_SPEEDS, { notice: NOTICE })
  tuning.ratRadius *= RAT_SIZE
  return tuning
}
