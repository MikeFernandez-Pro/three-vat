// A lightning strike and the flash it throws over the scene: the opening's
// strike at the tree's foot (gooseintro.ts), its bolt drawn by lightning.ts.
import type { Point } from './plain'

/** How long a strike's flash lasts, s. */
export const FLASH = 0.5
/** The flash's first light dies away over this long, s; the second flicker peaks this long after the strike, this strong, this wide. */
const FIRST = 0.06
const AGAIN = { at: 0.15, strength: 0.65, width: 0.04 }

/** A lightning strike: where it lands; when the script has it due, s of the play, NaN not yet known; when it came, NaN not yet. */
export interface Strike {
  at: Point
  due: number
  time: number
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
