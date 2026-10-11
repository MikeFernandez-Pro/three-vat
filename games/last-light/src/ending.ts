// The ending (#185), in place of the end card: the child reaches the manor's
// door, stands a moment, walks in, pushing it open as he goes, and is out of sight past the
// threshold; a moment after, the door shuts behind him, the lamplight in its
// gap gone. Then the night fades out, and the last word shows.
//
// A pure function of the time since he reached the door: the page walks the
// child, swings the door and fades the screen by what it says, and the run,
// won, plays no more.
import type { Point, Woods } from './woods'

/** How long he stands at the door before he goes in, s; and how fast he walks in, spent, m/s. */
const PAUSE = 0.6
const WALK = 0.8
/** Where he walks: to the porch, this far in front of the door; then this far past it, into the house. */
const PORCH = 0.4
const INSIDE = 0.9
/** How far past the threshold he is out of sight, m. */
const GONE = 0.15
/** How far the door stands open, radians from shut: ajar, as he left it sleepwalking; and pushed wide as he goes in. */
export const DOOR_AJAR = 0.785
const DOOR_WIDE = 1.3
/** How far short of the threshold he starts pushing it, m. */
const PUSH = 0.9
/** How long the door stays open after he is gone, s, and how long it takes to shut. */
const HOLD = 0.5
const SHUT = 0.45
/** How long after it shuts the night starts to fade, how long that takes, and then the word, s. */
const BEFORE_FADE = 1.2
const FADE = 2
const BEFORE_WORDS = 0.3
const WORDS = 1
/** By this long after he reaches the door, s, the ending is over from anywhere the exit takes him: the words are up. */
export const ENDING = 9

/** The ending at a moment: where the child is, and whether he is still seen; how far the door is open, radians; the night faded out, and the word shown, 0 to 1. */
export interface EndingPose extends Point {
  shown: boolean
  door: number
  fade: number
  words: number
}

/** 0 to 1, eased at both ends. */
const ease = (t: number) => {
  const c = Math.min(1, Math.max(0, t))
  return c * c * (3 - 2 * c)
}
/** `t` held between 0 and 1. */
const clamped = (t: number) => Math.min(1, Math.max(0, t))

/** The ending `since` s after the child, at `from`, reached the door. */
export function ending(map: Woods, from: Point, since: number): EndingPose {
  const exit = map.level.exit!
  const threshold = map.front.maxZ
  const porch = { x: exit.x, z: threshold + PORCH }
  const inside = { x: exit.x, z: threshold - INSIDE }
  const first = Math.hypot(porch.x - from.x, porch.z - from.z)
  const walked = Math.max(0, since - PAUSE) * WALK
  const at = walked <= first ? along(from, porch, first > 0 ? walked / first : 1) : along(porch, inside, Math.min(1, (walked - first) / (PORCH + INSIDE)))
  // When he is out of sight past the threshold, and when the door has shut behind him.
  const goneAt = PAUSE + (first + PORCH + GONE) / WALK
  const shutAt = goneAt + HOLD + SHUT
  const shown = since < goneAt
  let door: number
  if (shown) {
    // Pushed open over the last of the way to the threshold.
    const toDoor = at.z - threshold
    door = DOOR_AJAR + (DOOR_WIDE - DOOR_AJAR) * ease(1 - toDoor / PUSH)
  } else {
    // Held a moment, then swung shut, gathering speed: it slams.
    const swing = clamped((since - goneAt - HOLD) / SHUT)
    door = swing >= 1 ? 0 : DOOR_WIDE * (1 - swing * swing)
  }
  const fadeAt = shutAt + BEFORE_FADE
  const fade = ease((since - fadeAt) / FADE)
  const words = ease((since - fadeAt - FADE - BEFORE_WORDS) / WORDS)
  return { x: at.x, z: at.z, shown, door, fade, words }
}

/** `t` of the way from `a` to `b`. */
const along = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })
