// PROTOTYPE, throwaway (2026-10-27): the graveyard, the goose game's fourth scene, tried top-down on the 2D page
// (goose2d.html, `?ghosts=chain|procession|cross`). The graves stretch back along the road from the last fire toward
// the cage; past the cage her torch dies on the way, and the only light is the ghosts'. Each ghost walks a closed path
// of its own, round and round, slower than her walk, paying her no heed; where its path crosses the next ghost's, the
// two pass, their lights meet, and she can go from one to the other. Their lights hold rats off and fill no torch.
//
// Three layouts to compare, the paths made from the panel's few settings (drawn by hand once one wins):
// - chain: a loop each, the loops in a row, each crossing the next; each ghost reaches its crossing with the ghost
//   ahead as that one reaches it, so a ride kept to perfectly flows on from ghost to ghost. Each loop strays from a
//   round one and each ghost hurries and dawdles round it, so it seems to wander; but every ghost takes the same
//   time round, so the meetings keep their time lap after lap.
// - procession: every ghost one after another on one long path winding to and fro across the graveyard and back
//   along its side; ghosts on neighbouring legs pass each other going opposite ways.
// - cross: a figure of eight each, in a row, the front lobe of each crossing the back lobe of the next, timed as the
//   chain's are.
import type { FixedLight } from './swarm'

export type Layout = 'chain' | 'procession' | 'cross'
export const LAYOUTS: readonly Layout[] = ['chain', 'procession', 'cross']

/** What the graveyard folder sets. */
export interface GraveLook {
  layout: Layout
  /** How many ghosts. */
  ghosts: number
  /** Their walk, m/s, and their light's reach, m. */
  speed: number
  reach: number
  /** How far past the last fire's light the nearest path comes, m; less than 0, into it. */
  near: number
  /** chain and cross: each loop's half length along the road and half width across it, m, and how far neighbouring
   * loops reach into each other, m. */
  along: number
  across: number
  overlap: number
  /** chain and cross: every crossing on one side of the road, or on alternate sides; and every ghost going round the
   * same way, or each the other way to its neighbours, as gears turn, so two meet head on. */
  alternate: boolean
  gears: boolean
  /** chain and cross: how far each loop strays from a round one, a share of its size, and how much a ghost's pace
   * changes round it, a share of its mean, so it seems to wander though it keeps to its loop; the wandering's seed. */
  wander: number
  pace: number
  seed: number
  /** procession: how many legs across the graveyard, how far apart, m, and how wide, m. */
  legs: number
  legGap: number
  width: number
}

// Measured on 2026-10-27 for meetings open about 1.3 s to 1.5 s, a little tight: two ghosts meet head on going
// round the same way (geared, they move together where they cross, and stay open twice as long); a narrower light
// or a quicker walk shuts them sooner; the chain's loops just reaching into each other, the eights' well into.
// The chain then set on the 2D page the same day: four ghosts on long loops that stray far from round, at one pace;
// their light 1.75 m, as the 3D page's ghosts were then set.
export const defaultGraveLook = (layout: Layout = 'chain'): GraveLook => ({
  layout,
  ghosts: layout === 'procession' ? 9 : layout === 'chain' ? 4 : 5,
  speed: layout === 'chain' ? 1 : 1.1,
  reach: layout === 'chain' ? 1.75 : 1,
  near: -0.3,
  along: layout === 'chain' ? 3.05 : 2.2,
  across: layout === 'cross' ? 1.7 : 2.5,
  overlap: layout === 'cross' ? 2 : layout === 'chain' ? 0.6 : 0.4,
  alternate: false,
  gears: false,
  wander: layout === 'chain' ? 0.8 : 0.3,
  pace: layout === 'chain' ? 0 : 0.55,
  seed: 1,
  legs: 5,
  legGap: 2.3,
  width: 7,
})

interface P {
  x: number
  z: number
}

/** A closed path, sampled: its points, the length along it to each, and its whole length. */
export interface Path {
  points: P[]
  at: number[]
  length: number
}

/**
 * A ghost: its path; how far round a lap it is at 0 s, a share; how long a lap takes, s; how its pace changes round
 * the lap (`hurry`, the harmonics' strengths, `shift` their phases); and its light as the swarm reads it.
 */
export interface Ghost {
  path: Path
  phase: number
  lap: number
  hurry: number[]
  shift: number[]
  light: FixedLight
}

/** How far along its path a ghost is, a share, `u` of the way through its lap: hurried and held back, 0 at 0, 1 at 1. */
function warp(g: Ghost, u: number): number {
  let w = u
  g.hurry.forEach((b, i) => {
    const k = TAU * (i + 1)
    w += (b * (Math.sin(k * u + g.shift[i]!) - Math.sin(g.shift[i]!))) / k
  })
  return w
}

/** How far through its lap a ghost is when it is `share` of the way along its path. */
function unwarp(g: Ghost, share: number): number {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (warp(g, mid) < share) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

const frac = (x: number) => x - Math.floor(x)

/** Where `g` is at `t` s. */
export function ghostAt(g: Ghost, t: number): P {
  return along(g.path, g.path.length * warp(g, frac(g.phase + t / g.lap)))
}

/** A seeded random number from 0 to 1, mulberry32. */
function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Where two neighbouring ghosts meet: the point their paths cross, and the ghosts. */
export interface Meeting {
  at: P
  a: number
  b: number
  /** Every how many s they meet, and how long the two lights stay close enough to step across, s, each time. */
  every: number
  open: number
}

export interface Graveyard {
  ghosts: Ghost[]
  meetings: Meeting[]
  /** The graves' ground, to draw: its corners, round every ghost's path as it strays, a metre to spare. */
  outline: P[]
  /** Where she comes in from the cage, a step short of the furthest path, and the way on, toward the last fire. */
  entrance: P & { facing: P }
  /** Each ghost where it walks at `t` s of the play; its light moved with it. */
  update(t: number): void
}

const TAU = Math.PI * 2
/** Points a path is sampled at. */
const SAMPLES = 360
/** Her width and a little, m: two lights are open to step across while they meet by at least this much. */
const STEP_ACROSS = 0.6

function pathOf(points: P[]): Path {
  const at = [0]
  for (let i = 1; i <= points.length; i++) {
    const a = points[i - 1]!
    const b = points[i % points.length]!
    at.push(at[i - 1]! + Math.hypot(b.x - a.x, b.z - a.z))
  }
  return { points, at, length: at[points.length]! }
}

/** The point `s` m along `path`, round and round. */
export function along(path: Path, s: number): P {
  const { points, at, length } = path
  const d = ((s % length) + length) % length
  let lo = 0
  let hi = points.length
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (at[mid]! <= d) lo = mid
    else hi = mid
  }
  const a = points[lo]!
  const b = points[(lo + 1) % points.length]!
  const span = at[lo + 1]! - at[lo]!
  const f = span > 0 ? (d - at[lo]!) / span : 0
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f }
}

/** Where `p` and `q` cross, as m along each, the crossing nearest `near` on the side of the road `side` asks for. */
function crossing(p: Path, q: Path, near: P, side: (pt: P) => number, want: number): { at: P; sp: number; sq: number } | undefined {
  let best: { at: P; sp: number; sq: number; d: number } | undefined
  const n = p.points.length
  const m = q.points.length
  for (let i = 0; i < n; i++) {
    const a = p.points[i]!
    const b = p.points[(i + 1) % n]!
    for (let j = 0; j < m; j++) {
      const c = q.points[j]!
      const d = q.points[(j + 1) % m]!
      const den = (b.x - a.x) * (d.z - c.z) - (b.z - a.z) * (d.x - c.x)
      if (Math.abs(den) < 1e-12) continue
      const t = ((c.x - a.x) * (d.z - c.z) - (c.z - a.z) * (d.x - c.x)) / den
      const u = ((c.x - a.x) * (b.z - a.z) - (c.z - a.z) * (b.x - a.x)) / den
      if (t < 0 || t > 1 || u < 0 || u > 1) continue
      const at = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }
      if (Math.sign(side(at)) !== want) continue
      const off = Math.hypot(at.x - near.x, at.z - near.z)
      if (!best || off < best.d) best = { at, sp: p.at[i]! + (p.at[i + 1]! - p.at[i]!) * t, sq: q.at[j]! + (q.at[j + 1]! - q.at[j]!) * u, d: off }
    }
  }
  return best
}

/** Whether `p` is on the graveyard's ground, or within `margin` m of it. */
export function inGraveyard(graveyard: Graveyard, p: P, margin = 0): boolean {
  const { outline } = graveyard
  // Its corners' turn, so each edge's inside is known.
  let area = 0
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length]!
    area += a.x * b.z - b.x * a.z
  })
  const way = Math.sign(area) || 1
  return outline.every((a, i) => {
    const b = outline[(i + 1) % outline.length]!
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1
    return (way * ((b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x))) / length >= -margin
  })
}

/**
 * The graveyard laid behind the last fire `fire` (its light reaching `fireReach`), stretching back toward `cage`, the
 * fire before it.
 */
export function layGraveyard(look: GraveLook, fire: P, fireReach: number, cage: P): Graveyard {
  // The road's frame: `a` m back from the fire toward the cage, `c` m across it.
  const back = Math.hypot(cage.x - fire.x, cage.z - fire.z) || 1
  const ux = (cage.x - fire.x) / back
  const uz = (cage.z - fire.z) / back
  const world = (a: number, c: number): P => ({ x: fire.x + ux * a - uz * c, z: fire.z + uz * a + ux * c })
  const across = (p: P) => -(p.x - fire.x) * uz + (p.z - fire.z) * ux
  const nearest = fireReach + look.near
  const n = Math.max(1, Math.round(look.ghosts))
  const v = Math.max(look.speed, 0.01)
  const ghosts: Ghost[] = []
  const meetings: Meeting[] = []
  let outline: P[]

  if (look.layout === 'procession') {
    // To and fro across the graveyard, from its far end toward the fire, round a half circle at each turn; then out to
    // its side, back along it past the turns, and across the far end to where it began.
    const legs = Math.max(1, Math.round(look.legs)) | 1
    const half = look.width / 2
    const turn = look.legGap / 2
    const nearA = nearest
    const far = nearA + (legs - 1) * look.legGap
    const outside = half + look.legGap
    const pts: P[] = []
    const line = (a0: number, c0: number, a1: number, c1: number) => {
      const k = Math.max(2, Math.ceil(Math.hypot(a1 - a0, c1 - c0) / 0.1))
      for (let i = 0; i < k; i++) pts.push(world(a0 + ((a1 - a0) * i) / k, c0 + ((c1 - c0) * i) / k))
    }
    // From (a, c) to (a - legGap, c), bulging out past c on its side.
    const bend = (a: number, c: number) => {
      const k = 16
      for (let i = 0; i < k; i++) {
        const th = (Math.PI * i) / k
        pts.push(world(a - turn + Math.cos(th) * turn, c + Math.sign(c) * Math.sin(th) * turn))
      }
    }
    for (let j = 0; j < legs; j++) {
      const a = far - j * look.legGap
      const c = j % 2 === 0 ? half : -half
      line(a, -c, a, c)
      if (j < legs - 1) bend(a, c)
    }
    line(nearA, half, nearA, outside)
    line(nearA, outside, far + look.legGap, outside)
    line(far + look.legGap, outside, far + look.legGap, -half)
    line(far + look.legGap, -half, far, -half)
    const path = pathOf(pts)
    // One path: every ghost at one steady pace, or they would walk into each other.
    for (let k = 0; k < n; k++) ghosts.push({ path, phase: k / n, lap: path.length / v, hurry: [], shift: [], light: { x: 0, z: 0, reach: look.reach, on: true } })
    outline = [world(nearA - 0.5, -half - 1), world(far + look.legGap + 0.5, -half - 1), world(far + look.legGap + 0.5, outside + 0.5), world(nearA - 0.5, outside + 0.5)]
  } else {
    // A loop or a figure of eight each, ghost 0 by the fire, the last the first she meets coming from the cage.
    const step = Math.max(0.1, look.along * 2 - look.overlap)
    const paths: Path[] = []
    const rolls = Array.from({ length: n }, (_, k) => random(look.seed * 7919 + k * 104729))
    // The harmonics a loop strays by, 2 to 5 times round, each weaker; their strengths' sum, to keep the stray in bounds.
    const HARMONICS = [2, 3, 4, 5]
    const most = HARMONICS.reduce((sum, h) => sum + 1 / h, 0)
    for (let k = 0; k < n; k++) {
      const roll = rolls[k]!
      const a0 = nearest + look.along + k * step
      const strays = HARMONICS.map((h) => ({ h, by: ((roll() * 2 - 1) / h / most) * look.wander, at: roll() * TAU }))
      const stray = (th: number) => 1 + strays.reduce((sum, { h, by, at }) => sum + by * Math.sin(h * th + at), 0)
      const pts: P[] = []
      for (let i = 0; i < SAMPLES; i++) {
        const th = (i / SAMPLES) * TAU
        const r = stray(th)
        if (look.layout === 'chain') pts.push(world(a0 + Math.cos(th) * look.along * r, Math.sin(th) * look.across * r))
        else {
          // Bernoulli's lemniscate, its lobes along the road.
          const s = Math.sin(th)
          const d = 1 + s * s
          pts.push(world(a0 + (look.along * r * Math.cos(th)) / d, (look.across * r * 2 * s * Math.cos(th)) / d))
        }
      }
      // Geared: every other ghost goes round the other way.
      if (look.gears && k % 2 === 1) pts.reverse()
      paths.push(pathOf(pts))
    }
    // One lap's time for all, at the mean of their paces: so each pair meets every lap, as it did the first.
    const lap = paths.reduce((sum, p) => sum + p.length, 0) / paths.length / v
    const pace = Math.min(0.9, Math.max(0, look.pace))
    for (let k = 0; k < n; k++) {
      const roll = rolls[k]!
      const weights = [roll(), roll() * 0.6, roll() * 0.35]
      const sum = weights.reduce((a, b) => a + b, 0) || 1
      ghosts.push({
        path: paths[k]!,
        phase: 0,
        lap,
        hurry: weights.map((w) => (w / sum) * pace * (roll() < 0.5 ? -1 : 1)),
        shift: weights.map(() => roll() * TAU),
        light: { x: 0, z: 0, reach: look.reach, on: true },
      })
    }
    // Timed from the first she meets toward the fire: each ghost at its crossing with the one ahead as that one is.
    for (let k = n - 1; k > 0; k--) {
      const want = look.alternate && (n - 1 - k) % 2 === 1 ? -1 : 1
      const mid = world(nearest + look.along + (k - 0.5) * step, 0)
      const x = crossing(paths[k]!, paths[k - 1]!, mid, across, want)
      if (!x) continue
      const here = ghosts[k]!
      const ahead = ghosts[k - 1]!
      // Ghost k reaches the crossing `t` s in; the one ahead must be at its own side of it then.
      const t = frac(unwarp(here, x.sp / here.path.length) - here.phase) * lap
      ahead.phase = frac(unwarp(ahead, x.sq / ahead.path.length) - t / lap)
      meetings.push({ at: x.at, a: k, b: k - 1, every: 0, open: 0 })
    }
    const end = nearest + look.along * 2 + (n - 1) * step
    const wide = look.across + 1
    outline = [world(nearest - 0.5, -wide), world(end + 0.5, -wide), world(end + 0.5, wide), world(nearest - 0.5, wide)]
  }

  // The ground the paths really cover, strayed as they are, in the road's frame.
  let aMin = Infinity
  let aMax = -Infinity
  let cMin = Infinity
  let cMax = -Infinity
  for (const g of ghosts)
    for (const p of g.path.points) {
      const a = (p.x - fire.x) * ux + (p.z - fire.z) * uz
      const c = across(p)
      aMin = Math.min(aMin, a)
      aMax = Math.max(aMax, a)
      cMin = Math.min(cMin, c)
      cMax = Math.max(cMax, c)
    }
  outline = [world(aMin - 1, cMin - 1), world(aMax + 1, cMin - 1), world(aMax + 1, cMax + 1), world(aMin - 1, cMax + 1)]
  const entrance = { ...world(aMax + 1.2, 0), facing: { x: -ux, z: -uz } }

  // How often each pair meets and how long the two lights stay open to step across, over a long while.
  const pos = ghostAt
  const room = 2 * look.reach - STEP_ACROSS
  for (const m of meetings) {
    const ga = ghosts[m.a]!
    const gb = ghosts[m.b]!
    const span = Math.max(ga.lap, gb.lap)
    const dt = 0.02
    let open = 0
    let longest = 0
    const starts: number[] = []
    let was = false
    for (let t = 0; t < span * 3; t += dt) {
      const p = pos(ga, t)
      const q = pos(gb, t)
      const is = Math.hypot(p.x - q.x, p.z - q.z) <= room
      if (is && !was) starts.push(t)
      open = is ? open + dt : 0
      longest = Math.max(longest, open)
      was = is
    }
    m.open = longest
    m.every = starts.length > 1 ? (starts[starts.length - 1]! - starts[0]!) / (starts.length - 1) : Number.POSITIVE_INFINITY
  }

  return {
    ghosts,
    meetings,
    outline,
    entrance,
    update(t) {
      for (const g of ghosts) {
        const p = pos(g, t)
        g.light.x = p.x
        g.light.z = p.z
        g.light.reach = look.reach
      }
    },
  }
}
