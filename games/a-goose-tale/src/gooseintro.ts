// The goose game's opening: no one plays it, every run, any key skipping it,
// seen through the game's own camera. He walks calmly up the old road in the
// dark, his goslings round his back, peeping at him as they go and he
// answering them, nothing else about. Lightning strikes the foot of a tree
// in leaf by the road beside them, shaking the screen, and they stop dead,
// frightened: he jumps, the goslings cower, and the fire climbs the tree
// from its foot to its crown. A moment after the strike a burning branch
// snaps off the crown and drops, fast, to lie burning by the trunk. The
// goslings bolt, each his own way up the plain, out of view, the one that
// freezes stopping at the light's edge, and he shouts after them. Then the
// ground rumbles and the rats come, from out of view on every side, rushing
// in at him. The branch lies there as the opening ends, his torch to pick up.
// What happens when, where he walks, and how the screen shakes, as the
// opening's time has it; the page draws it (main.ts).
import type { Point } from './plain'

/** When each beat comes, s into the opening. */
export const INTRO = {
  /** The lightning strikes the tree, stopping him where he starts, walking up the road till then. */
  strike: 9,
  /** How long the fire takes to climb from the tree's foot to its crown's top, s. */
  spread: 2.4,
  /** How long the screen shakes from the strike, s. */
  shaking: 2,
  /** The goslings bolt, each up to `stagger` s after the first, and he shouts after them, a shout at each of `shouts` s. */
  bolt: 9.9,
  stagger: 0.4,
  shouts: [10.1, 10.55, 11.3, 11.75],
  /** The rats rush in from out of view, the ground rumbling. */
  rush: 10.4,
  /** A burning branch snaps off the tree's crown, a second after the strike, and how long it takes to fall to the ground, s: as long as a drop off the crown takes. */
  branch: 10,
  branchFalls: 0.9,
  /** How long of its fall it hangs at its break first, sagging, s, before it drops. */
  branchSags: 0.12,
  /** The opening over. */
  end: 15,
} as const

/**
 * What they say to each other walking up the road, s into the opening: a gosling's peep, `who` his place among those
 * with the goose, or the goose's answer, a soft questioning honk or a mutter. Their chatter dies down a little before the strike.
 */
export const CHAT: readonly { at: number; who: number | 'query' | 'mutter' }[] = [
  { at: 1, who: 0 },
  { at: 1.25, who: 0 },
  { at: 2.1, who: 'query' },
  { at: 3, who: 1 },
  { at: 3.2, who: 2 },
  { at: 3.45, who: 1 },
  { at: 4.3, who: 'mutter' },
  { at: 5.2, who: 2 },
  { at: 5.4, who: 0 },
  { at: 5.55, who: 2 },
  { at: 6.4, who: 'query' },
  { at: 7.2, who: 1 },
  { at: 7.4, who: 1 },
  { at: 7.65, who: 0 },
]

/** How fast he walks up the road, m/s: calmly. */
export const WALK_PACE = 0.7
/** How far behind and ahead of him the walk is read for the way he faces, m: he turns round a bend over that much of it, not at once. */
const TURN_OVER = 0.8
/** How far a bolting gosling runs before he is out of view, m, at what pace, m/s, and how far either side of up the road he may go, rad. */
const BOLT_RUN = 10
const BOLT_PACE = 3.6
const BOLT_SPREAD = 0.45
/** How far behind him the goslings walk, m, and how far round his back their arc reaches either side, rad. */
const BEHIND = 0.55
const ARC = 1.2

/** How much of its light the tree gives the moment it is struck, a share of its light burning whole. */
const STRUCK_LIGHT = 0.75

/**
 * How far the opening has lit the tree, 0 dark to 1 burning whole, `t` s into it: most of the way at once, the strike
 * lighting the scene and the fire keeping it lit, the rest growing as the fire climbs.
 */
export function litShare(t: number): number {
  if (t < INTRO.strike) return 0
  return STRUCK_LIGHT + (1 - STRUCK_LIGHT) * Math.min(1, (t - INTRO.strike) / INTRO.spread)
}

/**
 * How far grown a fire `up` the tree is, 0 its foot to 1 its crown's top, `t` s into the opening: caught as the fire
 * climbs to it from the foot, where the strike landed, grown over FLAME_GROWS s.
 */
const FLAME_GROWS = 0.35
export function flameGrown(t: number, up: number): number {
  const caught = INTRO.strike + INTRO.spread * up
  return Math.min(1, Math.max(0, (t - caught) / FLAME_GROWS))
}

/** How pale the strike leaves the night after its flash, at the most, and how long that takes to fade, s. */
const AFTERGLOW = { strength: 0.3, fade: 1.6 }

/** The night's afterglow `t` s into the opening, 0 to 1 of a flash: none before the strike, then easing back to dark over AFTERGLOW.fade. */
export function afterglow(t: number): number {
  const share = (t - INTRO.strike) / AFTERGLOW.fade
  if (!(share >= 0 && share < 1)) return 0
  return AFTERGLOW.strength * (1 - share) ** 2
}

/** Whether the rats are about yet: from their rush. */
export const ratsOut = (t: number): boolean => t >= INTRO.rush

/** How far through his jump of fright at the strike he is, 0 to 1; none before it or once it is over, over STARTLE s. */
export const STARTLE = 1.33
export function startled(t: number): number | undefined {
  const share = (t - INTRO.strike) / STARTLE
  return share >= 0 && share < 1 ? share : undefined
}

/** Whether the goslings cower, from the strike until they bolt. */
export const cowering = (t: number): boolean => t >= INTRO.strike && t < INTRO.bolt

/**
 * The road he walks in the opening: back from where he starts, `start`, along the old road's points `road`, laid in
 * the order it runs up the plain, WALK_PACE * INTRO.strike m of it; or straight back down the plain, +z, with no road.
 * From its far end to `start`.
 */
export function walkOf(start: Point, road: readonly Point[] = []): Point[] {
  const length = WALK_PACE * INTRO.strike
  // The road's point nearest where he starts, and the way back down it from there.
  const nearest = nearestOf(start, road)
  const back: Point[] = [start]
  let left = length
  let at = start
  for (let k = nearest; k >= 0 && left > 0; k--) {
    const p = road[k]!
    // Only points behind him, down the plain.
    if (p.z <= at.z) continue
    const d = Math.hypot(p.x - at.x, p.z - at.z)
    if (d >= left) {
      back.push({ x: at.x + ((p.x - at.x) * left) / d, z: at.z + ((p.z - at.z) * left) / d })
      left = 0
      break
    }
    back.push(p)
    left -= d
    at = p
  }
  if (left > 0) back.push({ x: at.x, z: at.z + left })
  return back.reverse()
}

/** The index of the point of `road` nearest `start`, -1 with no road. */
function nearestOf(start: Point, road: readonly Point[]): number {
  let nearest = -1
  let best = Infinity
  road.forEach((p, k) => {
    const d = Math.hypot(p.x - start.x, p.z - start.z)
    if (d < best) {
      best = d
      nearest = k
    }
  })
  return nearest
}

/**
 * The way on up the road from where he starts, `start`, a unit vector: to where it is BOLT_RUN m on along the old
 * road's points `road`, laid in the order it runs up the plain; up the plain, -z, with no road ahead.
 */
export function roadAheadOf(start: Point, road: readonly Point[] = []): Point {
  let left = BOLT_RUN
  let at = start
  for (let k = Math.max(0, nearestOf(start, road)); k < road.length && left > 0; k++) {
    const p = road[k]!
    // Only points ahead of him, up the plain.
    if (p.z >= at.z) continue
    const d = Math.hypot(p.x - at.x, p.z - at.z)
    at = d >= left ? { x: at.x + ((p.x - at.x) * left) / d, z: at.z + ((p.z - at.z) * left) / d } : p
    left -= d
  }
  const d = Math.hypot(at.x - start.x, at.z - start.z)
  return d > 1e-6 ? { x: (at.x - start.x) / d, z: (at.z - start.z) / d } : { x: 0, z: -1 }
}

/** The point `along` m along `walk`, held at its ends. */
function pointAlong(walk: readonly Point[], along: number): Point {
  let left = Math.max(0, along)
  for (let k = 1; k < walk.length; k++) {
    const a = walk[k - 1]!
    const b = walk[k]!
    const d = Math.hypot(b.x - a.x, b.z - a.z)
    if (left <= d) {
      const s = d > 1e-6 ? left / d : 1
      return { x: a.x + (b.x - a.x) * s, z: a.z + (b.z - a.z) * s }
    }
    left -= d
  }
  return { ...walk[walk.length - 1]! }
}

/**
 * Where he is on `walk` `t` s into the opening, and the way he faces, a unit vector: walking up it, stopped dead at
 * its end by the strike; facing from TURN_OVER m behind him on it to TURN_OVER m ahead, so he turns round its bends.
 */
export function walkAt(walk: readonly Point[], t: number): { at: Point; facing: Point } {
  const along = Math.min(t, INTRO.strike) * WALK_PACE
  const behind = pointAlong(walk, along - TURN_OVER)
  const ahead = pointAlong(walk, along + TURN_OVER)
  const d = Math.hypot(ahead.x - behind.x, ahead.z - behind.z)
  return { at: pointAlong(walk, along), facing: d > 1e-6 ? { x: (ahead.x - behind.x) / d, z: (ahead.z - behind.z) / d } : { x: 0, z: -1 } }
}

/** A draw from 0 to 1, the same for the same `k` and `channel`. */
function draw(k: number, channel: number): number {
  const s = Math.sin(k * 127.1 + channel * 311.7) * 43758.5453
  return s - Math.floor(s)
}

/**
 * Where gosling `k`, the `index`th of `count`, is `t` s into the opening, with the goose at `at` facing `facing`: walking in
 * an arc round the goose's back, then bolting on up the road, `ahead` as roadAheadOf has it, on a way of his own near it, and once
 * out of view at `home`, where he waits; or, if he is the one that `freezes`, running only as far as `home`, and
 * stopping there.
 */
export function goslingAt(t: number, k: number, index: number, count: number, at: Point, facing: Point, ahead: Point, home: Point, freezes: boolean): Point {
  const share = count > 1 ? index / (count - 1) - 0.5 : 0
  const round = Math.atan2(-facing.z, -facing.x) + share * 2 * ARC
  const walking = { x: at.x + BEHIND * Math.cos(round), z: at.z + BEHIND * Math.sin(round) }
  const leaves = INTRO.bolt + INTRO.stagger * draw(k, 1)
  if (t < leaves) return walking
  const ran = (t - leaves) * BOLT_PACE
  if (freezes) {
    const d = Math.hypot(home.x - walking.x, home.z - walking.z)
    if (ran >= d) return { ...home }
    return { x: walking.x + ((home.x - walking.x) * ran) / d, z: walking.z + ((home.z - walking.z) * ran) / d }
  }
  if (ran >= BOLT_RUN) return { ...home }
  // The road's way ahead, turned `way` either side.
  const way = (draw(k, 2) * 2 - 1) * BOLT_SPREAD
  const cos = Math.cos(way)
  const sin = Math.sin(way)
  return { x: walking.x + (ahead.x * cos - ahead.z * sin) * ran, z: walking.z + (ahead.x * sin + ahead.z * cos) * ran }
}

/** How hard the screen shakes at the strike, m the camera is thrown, and how fast, Hz. */
const SHAKE = 0.16
const SHAKE_RATE = 17

/** How far the strike throws the camera `t` s into the opening, m, along x, y and z: hard the moment it hits, dying away over INTRO.shaking. */
export function shakeAt(t: number): { x: number; y: number; z: number } {
  const since = t - INTRO.strike
  if (!(since >= 0 && since < INTRO.shaking)) return { x: 0, y: 0, z: 0 }
  const amount = SHAKE * (1 - since / INTRO.shaking) ** 2
  const w = since * SHAKE_RATE * 2 * Math.PI
  return {
    x: amount * (Math.sin(w) * 0.7 + Math.sin(w * 2.3 + 1.1) * 0.3),
    y: amount * (Math.sin(w * 1.3 + 0.4) * 0.6 + Math.sin(w * 3.1) * 0.4),
    z: amount * 0.5 * Math.sin(w * 1.7 + 2),
  }
}

/** A point in the world, m: on the ground's x and z, `y` up. */
export interface Place extends Point {
  y: number
}

/**
 * The burning branch's fall: how far it is turned over off lying as it hangs in the crown, radians, its broken end
 * still held there and the rest out and up; how far it has sagged by the time it lets go, radians, and how far down
 * its sag takes it, m; how high it bounces off the ground, m, and how far it rocks, radians, both settling over
 * BRANCH_SETTLES s.
 */
const BRANCH_HUNG = 1.2
const BRANCH_SAGGED = 0.75
const BRANCH_SAG = 0.06
const BRANCH_BOUNCE = 0.06
const BRANCH_ROCK = 0.16
const BRANCH_SETTLES = 0.6

/** Where the burning branch is in the opening: its place, how far it is turned over off lying, radians, and whether it shows yet and has landed. */
export interface BranchFall {
  at: Place
  tumble: number
  shown: boolean
  landed: boolean
}

/** Whether the burning branch is down on the ground `t` s into the opening: from the end of its fall. */
export const branchLanded = (t: number): boolean => t >= INTRO.branch + INTRO.branchFalls

/**
 * Where the burning branch is `t` s into the opening, snapping off the crown at `from` at INTRO.branch and falling to
 * lie at `to`: hidden in the crown till then; hanging at its break for INTRO.branchSags, sagging down, then let go,
 * dropping as anything dropped does, from still, faster and faster, drifting the little way out to where it lands,
 * turning slowly the while to land lying, over the rest of INTRO.branchFalls; then a small bounce or two and a rock,
 * settling still.
 */
export function branchAt(t: number, from: Place, to: Place): BranchFall {
  const since = t - INTRO.branch
  if (since < 0) return { at: { ...from }, tumble: BRANCH_HUNG, shown: false, landed: false }
  if (!branchLanded(t)) {
    const sags = INTRO.branchSags
    if (since < sags) {
      const k = since / sags
      const eased = k * k * (3 - 2 * k)
      return { at: { x: from.x, y: from.y - BRANCH_SAG * k * k, z: from.z }, tumble: BRANCH_HUNG + (BRANCH_SAGGED - BRANCH_HUNG) * eased, shown: true, landed: false }
    }
    const k = (since - sags) / Math.max(INTRO.branchFalls - sags, 1e-3)
    const top = from.y - BRANCH_SAG
    const turned = k * k * (3 - 2 * k)
    return {
      at: { x: from.x + (to.x - from.x) * k, y: top + (to.y - top) * k * k, z: from.z + (to.z - from.z) * k },
      tumble: BRANCH_SAGGED * (1 - turned),
      shown: true,
      landed: false,
    }
  }
  const settled = Math.min(1, (t - INTRO.branch - INTRO.branchFalls) / BRANCH_SETTLES)
  const left = (1 - settled) ** 2
  const bounce = BRANCH_BOUNCE * left * Math.abs(Math.sin(2 * Math.PI * settled))
  return { at: { x: to.x, y: to.y + bounce, z: to.z }, tumble: BRANCH_ROCK * left * Math.sin(3 * Math.PI * settled), shown: true, landed: true }
}

/** How far the burning branch's light flares as it lands, a share over its reach, and how long it takes to settle, s. */
const BRANCH_FLARE = 0.6
const BRANCH_FLARE_LASTS = 0.8

/**
 * How far the burning branch's light reaches `t` s into the opening, of its own reach, as the rats feel it: flared
 * past it the moment it lands, throwing the rats under it back, and easing back over BRANCH_FLARE_LASTS; 1 else.
 */
export function branchFlare(t: number): number {
  if (!branchLanded(t)) return 1
  const since = Math.max(0, t - INTRO.branch - INTRO.branchFalls) / BRANCH_FLARE_LASTS
  if (since >= 1) return 1
  return 1 + BRANCH_FLARE * (1 - since) ** 2
}
