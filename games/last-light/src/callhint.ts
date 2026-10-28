// The goose game's call: the nearest gosling still waiting calls her, now
// and then, a word in Gaegu popping up over it where the camera sees it, or,
// out of view, at the edge of the screen on its side, so the word says which
// way to go. Each grows out of the top of its head and rises off it. The
// further off she is, the louder it calls for her: a small honk close by,
// then honk!! from far away, bigger. It calls as a bird does, never
// on a beat: a honk, or two or three close together, then a pause of its own
// length; as she walks away from it, it calls sooner and in longer bursts,
// as she comes, it calms, till it hears her near and calls eagerly again (the
// game's urgency). Each honk pops in past its size and settles, rises fast
// then slows, drifts and wobbles a little, and fades; no two alike. Out of
// view, a honk rises toward its gosling instead, its letters leaning that way,
// as if shouted from out there.
import { loadHintFont } from './holdhint'

/** The pause between bursts, s, drawn between these: as she comes toward it, as she walks away; the first burst this soon after there is a gosling to call. */
const PAUSE_CALM = [3.5, 6.5] as const
const PAUSE_URGENT = [0.9, 1.8] as const
const FIRST = [0.6, 1.4] as const
/** How many honks a burst has, by chance: one, two or three; as she comes toward it, as she walks away. */
const BURST_CALM = [0.7, 0.25, 0.05] as const
const BURST_URGENT = [0.1, 0.4, 0.5] as const
/** The gap between honks of a burst, s. */
const GAP = [0.2, 0.4] as const
/** How long one honk shows, s; the share of it spent popping in, and the share after which it fades. */
const SHOWS = [1.2, 1.7] as const
const POP = 0.1
const FADE = 0.5
/** How far a honk rises off its gosling's head, px; how far it drifts sideways and scatters from it, px; how far it tilts, degrees. */
const RISE = [22, 40] as const
const DRIFT = 10
const SCATTER = 7
const TILT = 10
/** Out of view, how far a honk's letters lean toward its gosling, degrees, and how far the honk turns that way. */
const LEAN = 16
const TURN = 14
/** How far in from the screen's edge a call out of view sits, px. */
const MARGIN = 56
/** Its ink, as the hold indicator's. */
const INK = '#f6ead0'

/** Where a call is drawn: a point on the page, px. */
export interface CallAt {
  x: number
  y: number
  /** How big it calls, 1 near. */
  size?: number
  /** How far off its gosling is, 0 just out of the quiet to 1 far: what it calls. */
  far?: number
  /** Whether she walks away from it, 1, or toward it, -1: how soon and how much it calls. */
  urgency?: number
  /** Out of view, the way to it on the page from where the call sits, a unit vector, y down. */
  out?: { x: number; y: number }
}

/** What a gosling `far` off (0 to 1) calls: a honk, louder far off. */
export function callWord(far: number): string {
  return far < 0.66 ? 'honk!' : 'honk!!'
}

export interface CallHint {
  /**
   * One frame, `dt` s on: the calling gosling at `at` on the page, px, or nothing calling. The page clamps a point out of
   * view to its edge itself.
   */
  update(at: CallAt | null, dt: number): void
}

/**
 * Where a point the camera projects to `ndc` (x, y in -1..1, z past 1 behind it) is shown in a box: itself, inside the
 * box; out of it, or behind the camera, on the box's edge `margin` in, on the line from the middle toward it, with
 * that line's way as `out`.
 */
export function callAt(ndc: { x: number; y: number; z: number }, box: { left: number; top: number; width: number; height: number }, margin = MARGIN): CallAt {
  const behind = ndc.z > 1
  let x = behind ? -ndc.x : ndc.x
  let y = behind ? -ndc.y : ndc.y
  const halfW = box.width / 2
  const halfH = box.height / 2
  const reachX = Math.max(0, halfW - margin) / halfW
  const reachY = Math.max(0, halfH - margin) / halfH
  const over = Math.max(Math.abs(x) / reachX, Math.abs(y) / reachY)
  if (behind || over > 1) {
    const length = Math.hypot(x * halfW, y * halfH) || 1
    const out = { x: (x * halfW) / length, y: (-y * halfH) / length }
    const scale = 1 / Math.max(over, 1e-6)
    x *= scale
    y *= scale
    return { x: box.left + (x + 1) * halfW, y: box.top + (1 - y) * halfH, out }
  }
  return { x: box.left + (x + 1) * halfW, y: box.top + (1 - y) * halfH }
}

/** A number between `range`'s two. */
const within = (range: readonly [number, number]) => range[0] + Math.random() * (range[1] - range[0])
const mix = (a: number, b: number, t: number) => a + (b - a) * t
/** Out past 1 and back, as t goes 0 to 1: a pop. */
const overshoot = (t: number) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2
const easeOut = (t: number) => 1 - (1 - t) ** 3

/** One honk on the page: its age and how long it shows, s; and its own size, rise, drift, scatter and tilt. */
interface Honk {
  box: HTMLDivElement
  age: number
  shows: number
  size: number
  rise: number
  drift: number
  dx: number
  dy: number
  tilt: number
  wobble: number
}

/** The calls, on the page, none showing; `called` told of each honk as it pops up, how far off its gosling is (0 to 1). */
export function createCallHint(called?: (far: number) => void): CallHint {
  loadHintFont()
  const honks: Honk[] = []
  /** Time to the next honk, s, and how many honks of the burst are still to come after it. */
  let wait = within(FIRST)
  let more = 0
  let last: CallAt | null = null
  const honk = (inBurst: number, far: number) => {
    const box = document.createElement('div')
    box.textContent = callWord(far)
    box.style.cssText = `position:fixed;left:0;top:0;transform-origin:50% 100%;pointer-events:none;white-space:nowrap;font-family:Gaegu,cursive;font-weight:700;font-size:34px;line-height:1;color:${INK};text-shadow:0 2px 4px #000c`
    document.body.append(box)
    // A burst's later honks a little smaller, each to its own side.
    const side = Math.random() < 0.5 ? -1 : 1
    honks.push({
      box,
      age: 0,
      shows: within(SHOWS),
      size: (0.85 + Math.random() * 0.3) * (1 - 0.12 * inBurst),
      rise: within(RISE),
      drift: side * Math.random() * DRIFT,
      dx: side * Math.random() * SCATTER * Math.min(1, inBurst + 0.4),
      dy: 0,
      tilt: side * (2 + Math.random() * TILT),
      wobble: Math.random() * Math.PI * 2,
    })
  }
  let inBurst = 0
  return {
    update(at, dt) {
      if (at) {
        last = at
        // 0 coming toward it, 1 walking away; a pause already running is cut short as she turns away.
        const urgent = (Math.min(1, Math.max(-1, at.urgency ?? 0)) + 1) / 2
        const pause = [mix(PAUSE_CALM[0], PAUSE_URGENT[0], urgent), mix(PAUSE_CALM[1], PAUSE_URGENT[1], urgent)] as const
        if (more === 0) wait = Math.min(wait, pause[1])
        wait -= dt
        if (wait <= 0) {
          if (more === 0) {
            const one = mix(BURST_CALM[0], BURST_URGENT[0], urgent)
            const two = mix(BURST_CALM[1], BURST_URGENT[1], urgent)
            const roll = Math.random()
            more = roll < one ? 0 : roll < one + two ? 1 : 2
            inBurst = 0
          } else {
            more--
            inBurst++
          }
          honk(inBurst, at.far ?? 0.5)
          called?.(at.far ?? 0.5)
          wait = more > 0 ? within(GAP) : within(pause)
        }
      } else {
        wait = within(FIRST)
        more = 0
      }
      // A honk already called finishes where its gosling was last seen calling.
      const from = at ?? last
      for (let k = honks.length - 1; k >= 0; k--) {
        const h = honks[k]!
        h.age += dt
        const share = h.age / h.shows
        if (share >= 1 || !from) {
          h.box.remove()
          honks.splice(k, 1)
          continue
        }
        const scale = h.size * (from.size ?? 1) * (share < POP ? overshoot(share / POP) : 1)
        // In view it rises; out of view it rises toward its gosling, leaning that way.
        const way = from.out ?? { x: 0, y: -1 }
        const up = h.rise * easeOut(share)
        const x = from.x + h.dx + h.drift * easeOut(share) + way.x * up
        const y = from.y + h.dy + way.y * up
        const lean = from.out ? from.out.x : 0
        const tilt = (from.out ? 0.4 : 1) * h.tilt + TURN * lean + 6 * Math.sin(h.wobble + share * 14) * (1 - share)
        const fading = Math.max(0, (share - FADE) / (1 - FADE))
        h.box.style.opacity = String(Math.min(1, share / 0.04) * (1 - fading * fading))
        h.box.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%) rotate(${tilt}deg) skewX(${-LEAN * lean}deg) scale(${Math.max(0, scale)})`
      }
    },
  }
}
