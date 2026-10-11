// The weather as the page shows it (#185), read off the play: how hard it rains,
// eased in as the rain starts when the cart jams and out as it stops past the
// pine; the two lightning strikes, where each lands, when it is due and when
// it came; and the flash a strike throws over the scene. Nothing here draws:
// the rain's streaks and the river's splashes (rain.ts, river.ts) take the
// amount, the bolts (lightning.ts) the strikes, and the page the flash.
//
// The strikes are the script's, so a strike is shown from the play's own
// times, never from a clock of the page's: the play started over plays them
// again, and a paused play holds them.
import type { Play } from './play'
import type { Point } from './woods'

/** How long the rain takes to come in once it rains, and to die away once it stops, s. */
const RAIN_IN = 1.5
const RAIN_OUT = 2.5
/** How long a strike's flash lasts, s. */
export const FLASH = 0.5
/** The flash's first light dies away over this long, s; the second flicker peaks this long after the strike, this strong, this wide. */
const FIRST = 0.06
const AGAIN = { at: 0.15, strength: 0.65, width: 0.04 }

/** How hard it rains, 0 dry to 1 the heaviest: it follows the play's rain, eased. */
export class RainAmount {
  amount = 0

  /** `dt` s on, raining or not: the amount moved toward it. */
  update(dt: number, raining: boolean): number {
    this.amount = raining ? Math.min(1, this.amount + dt / RAIN_IN) : Math.max(0, this.amount - dt / RAIN_OUT)
    return this.amount
  }
}

/** A lightning strike: where it lands; when the script has it due, s of the play, NaN not yet known; when it came, NaN not yet. */
export interface Strike {
  at: Point
  due: number
  time: number
}

/** What the strikes are read off: the play's time, and when the stick first caught and the second strike came. */
type StrikeTimes = Pick<Play, 't' | 'litAt' | 'fellAt' | 'woods'>

/**
 * The play's two strikes: the first on the big tree, at the script's time;
 * the second on the cracked tree, at its root, due the script's time after
 * the stick first caught, or sooner, when the child walks out first.
 */
export function strikesOf(play: StrikeTimes): Strike[] {
  const { woods: map, t, litAt, fellAt } = play
  const tree = map.level.lights[map.bigTree]!
  return [
    { at: { x: tree.x, z: tree.z }, due: map.strike, time: t >= map.strike ? map.strike : Number.NaN },
    { at: map.trunk.root, due: Number.isNaN(fellAt) ? litAt + map.afterLit : fellAt, time: fellAt },
  ]
}

/**
 * How bright a strike's flash is `since` s after it, 0 to 1: full at once,
 * dying fast, a second flicker after it, and nothing past FLASH.
 */
export function flashAt(since: number): number {
  if (!(since >= 0 && since < FLASH)) return 0
  const first = Math.exp(-since / FIRST)
  const again = AGAIN.strength * Math.exp(-(((since - AGAIN.at) / AGAIN.width) ** 2))
  return Math.min(1, Math.max(first, again) * (1 - since / FLASH))
}
