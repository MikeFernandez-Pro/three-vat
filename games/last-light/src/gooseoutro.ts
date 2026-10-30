// The goose game's ending: no one plays it. Once he swims near the pond's
// island, home, it takes him: he swims on to its shore and steps out of the
// water. The mother gets up off her nest, runs out of the tent's door and
// straight at him, and the
// island's goslings leave their play and run down round where the two of them
// meet. His goslings swim in after him, climb out and shake themselves dry. As
// the two of them meet, the island's goslings run round and round them for
// joy, never through them, his joining in once dry; then every gosling, his and hers, steps in close round
// the two of them, each a little in or out of a loose ring, and hops for joy
// where it stands, peeping. The dawn comes up, the rats draining off out of its light, the camera
// draws back, and the night fades out to the game's title.
// What happens when and where each bird is, as the ending's time has it; the
// page draws it (main.ts).
import type { Point } from './plain'

/** When each beat comes, s into the ending; and how near the island's waterline he is when it starts, m. */
export const OUTRO = {
  near: 4,
  /** He stands on the island, where he meets her. */
  landed: 4,
  /** The mother gets up off her nest, from `rise` to `risen`, and runs down to him, there at `met`. */
  rise: 0.7,
  risen: 1.2,
  met: 4.3,
  /** The island's goslings leave their play, each up to `stagger` s after the first. */
  call: 0.9,
  stagger: 0.5,
  /**
   * Every gosling runs round the two of them as they meet, the island's from `met`, each up to `stagger` s after the
   * first, his once shaken dry; at `settle` each steps in to its place in the ring.
   */
  settle: 8.4,
  /** The dawn comes up, and the camera draws back. */
  dawn: [5, 12],
  pull: [9, 15],
  /** The night fades out, and the title comes in over it. */
  fade: [12, 13.2],
  title: [12.8, 13.8],
  /** The ending over: the title stays. */
  end: 15,
} as const

/** How far up the island from the waterline he stands, m, and how far short of him she stops, facing him. */
const GANDER_IN = 1.3
const MEET_GAP = 0.9
/**
 * The ring the goslings stand in, close round the two of them: an oval hugging them, its middle theirs, out past
 * each of them along the way they face each other RING_ALONG m, and RING_ACROSS m out to either side of the middle;
 * as much bigger as there are more goslings than fit RING_ROOM m apart round it.
 */
const RING_ALONG = 0.6
const RING_ACROSS = 0.65
const RING_ROOM = 0.45
/** How many points the oval is measured round by, to share it out evenly. */
const RING_POINTS = 360
/**
 * How loose the ring is: how much further out than the oval a gosling stands at the most, a share of the way out to
 * it; and how far off facing the two of them it looks, rad either way.
 */
const RING_OUT = 0.25
const LOOKS_OFF = 0.5
/** How far off the shore his goslings swim in to, m, and how far up the bank they climb, either side of him from `LAND_SIDE` out, `LAND_STEP` apart. */
const OFF_SHORE = 0.25
const LAND_IN = 0.35
const LAND_SIDE = 0.35
const LAND_STEP = 0.3
/**
 * How far out the goslings keep round the two of them on their way anywhere, times the oval of the ring; and how far
 * round it each point of a way round them is, rad.
 */
const KEEP_OUT = 1.1
const KEEP_STEP = Math.PI / 12
/**
 * The goslings running round the two of them: on an oval PLAY_WIDE times the ring's, at PLAY_RUN m/s, all one way,
 * PLAY_ROOM m apart at the least; how long getting on to it takes at the least, s; how many legs a lap is run in.
 */
const PLAY_WIDE = 1.4
const PLAY_RUN = 1.5
const PLAY_ROOM = 0.55
const JOIN_LEAST = 0.4
const LAP_LEGS = 32
/** How fast the goslings run, m/s, and climb out, m/s; how much later each of his comes ashore than the last, s. */
const RUN = 1.3
const CLIMB = 0.6
const BROOD_STAGGER = 0.2
/** How long a gosling's shake takes, s (baby_shake_dry), and its hop (baby_jump), the share of the hop its feet are off the ground, and how high it goes, m. */
export const SHAKE = 1.67
export const HOP = 1.29
const HOP_AIR = [0.27, 0.6] as const
const HOP_HEIGHT = 0.12
/** When each gosling hops after it reaches the ring, s, and how much later each of its hops at the most. */
const HOPS = [0.2, 1.8]
const HOP_SPREAD = 0.3
/**
 * A gosling's happy peeps in the ring: one run of two or three, PEEP_RUN, each PEEP_GAP s after the last; the run
 * starting PEEP_FROM s after it reaches the ring at the soonest and PEEP_SPREAD s later at the most, each its own
 * time, so no two goslings peep together.
 */
const PEEP_RUN = [2, 3] as const
const PEEP_GAP = [0.15, 0.32] as const
const PEEP_FROM = 0.2
const PEEP_SPREAD = 2.2
/** How fast the mother runs at the least, m/s, so she never dawdles. */
const MOTHER_LEAST = 0.8
/** How far the camera draws back by the end, m. */
export const PULL = 3
/** How far the dawn's light reaches by the end, m: the rats drain off out of it. */
export const DRAIN = 40

/** The island as the ending reads it: its middle, and how far its waterline is from it `angle` radians round from +x toward +z, m. */
export interface Island {
  middle: Point
  shoreAt(angle: number): number
}

/** Whether he, at `at`, is near enough the island's waterline for the ending: in from OUTRO.near of it. */
export function outroDue(island: Island, at: Point): boolean {
  const dx = at.x - island.middle.x
  const dz = at.z - island.middle.z
  return Math.hypot(dx, dz) - island.shoreAt(Math.atan2(dz, dx)) < OUTRO.near
}

/** A way a bird goes: from `from`, leg after leg, each left at `leave` s at the soonest, at `pace` m/s. */
export interface Plan {
  from: Point
  legs: { to: Point; leave: number; pace: number }[]
}

/** When each leg of `plan` starts and ends, s. */
export function legTimes(plan: Plan): { start: number; end: number }[] {
  let at = plan.from
  let free = 0
  return plan.legs.map((leg) => {
    const start = Math.max(free, leg.leave)
    const d = Math.hypot(leg.to.x - at.x, leg.to.z - at.z)
    free = start + (leg.pace > 0 ? d / leg.pace : 0)
    at = leg.to
    return { start, end: free }
  })
}

/** Where `plan` has its bird `t` s in, and the way it goes there, a unit vector, while it moves. */
export function planAt(plan: Plan, t: number): { at: Point; going?: Point } {
  let at = plan.from
  const times = legTimes(plan)
  for (let k = 0; k < plan.legs.length; k++) {
    const { to } = plan.legs[k]!
    const { start, end } = times[k]!
    if (t < start) return { at: { ...at } }
    if (t < end) {
      const s = (t - start) / (end - start)
      const d = Math.hypot(to.x - at.x, to.z - at.z)
      return { at: { x: at.x + (to.x - at.x) * s, z: at.z + (to.z - at.z) * s }, going: { x: (to.x - at.x) / d, z: (to.z - at.z) / d } }
    }
    at = to
  }
  return { at: { ...at } }
}

/**
 * Who is where as the ending starts: him; the mother on her nest, facing `motherYaw`, and the door she goes out by,
 * if she is in the tent; the island's goslings; and his, following him.
 */
export interface Cast {
  gander: Point
  mother: Point
  door?: Point
  motherYaw: number
  island: Point[]
  brood: Point[]
}

/** The ending laid out from where they all are as it starts. */
export interface Stage {
  /** The way out from the island's middle to where he lands, a unit vector, and the waterline there. */
  way: Point
  shore: Point
  /** Where he swims from and where he stands, facing her. */
  gander: { from: Point; to: Point }
  /** Where she sits and the way she faces there, a yaw; the door she goes out by; where she stops, facing him. */
  mother: { from: Point; yaw: number; door?: Point; to: Point }
  /** The middle of the two of them, where the camera looks and the goslings gather round. */
  pair: Point
  /** Each of his goslings' way and each of the island's, in the cast's order; when each shakes, s, his only. */
  brood: Plan[]
  island: Plan[]
  shakes: number[]
}

/** A draw from 0 to 1, the same for the same `k` and `channel`. */
function draw(k: number, channel: number): number {
  const s = Math.sin(k * 127.1 + channel * 311.7) * 43758.5453
  return s - Math.floor(s)
}

/** The ending laid out on `island` for `cast`. */
export function layOutro(island: Island, cast: Cast): Stage {
  const { middle } = island
  const angle = Math.atan2(cast.gander.z - middle.z, cast.gander.x - middle.x)
  const way = { x: Math.cos(angle), z: Math.sin(angle) }
  // Along the shore, to his left as he comes in.
  const along = { x: -way.z, z: way.x }
  const reach = island.shoreAt(angle)
  const shore = { x: middle.x + way.x * reach, z: middle.z + way.z * reach }
  /** On the island `inland` m up from where he lands, `side` m along the shore. */
  const up = (inland: number, side: number): Point => ({ x: shore.x - way.x * inland + along.x * side, z: shore.z - way.z * inland + along.z * side })
  const gander = { from: { ...cast.gander }, to: up(GANDER_IN, 0) }
  // She comes straight at him from her door, stopping short of him.
  const comes = cast.door ?? cast.mother
  const stops = Math.atan2(comes.z - gander.to.z, comes.x - gander.to.x)
  const mother = {
    from: { ...cast.mother },
    yaw: cast.motherYaw,
    door: cast.door && { ...cast.door },
    to: { x: gander.to.x + Math.cos(stops) * MEET_GAP, z: gander.to.z + Math.sin(stops) * MEET_GAP },
  }
  const pair = { x: (gander.to.x + mother.to.x) / 2, z: (gander.to.z + mother.to.z) / 2 }

  // The oval hugging the two of them, the goslings' ring, as big as there are goslings for.
  const meets = { x: (mother.to.x - gander.to.x) / MEET_GAP, z: (mother.to.z - gander.to.z) / MEET_GAP }
  const beside = { x: -meets.z, z: meets.x }
  const oval = (a: number, grow: number): Point => {
    const u = Math.cos(a) * (MEET_GAP / 2 + RING_ALONG) * grow
    const v = Math.sin(a) * RING_ACROSS * grow
    return { x: pair.x + meets.x * u + beside.x * v, z: pair.z + meets.z * u + beside.z * v }
  }
  // Its length round, and how far along it each of its points is.
  const points = Array.from({ length: RING_POINTS + 1 }, (_, j) => oval((j / RING_POINTS) * Math.PI * 2, 1))
  const reached = [0]
  for (let j = 1; j <= RING_POINTS; j++) reached.push(reached[j - 1]! + Math.hypot(points[j]!.x - points[j - 1]!.x, points[j]!.z - points[j - 1]!.z))
  const length = reached[RING_POINTS]!
  const grow = Math.max(1, ((cast.brood.length + cast.island.length) * RING_ROOM) / length)
  /** Where `p` is against the oval: along the way they face each other and across it, the oval at 1 out. */
  const flat = (p: Point) => {
    const dx = p.x - pair.x
    const dz = p.z - pair.z
    return { u: (dx * meets.x + dz * meets.z) / ((MEET_GAP / 2 + RING_ALONG) * grow), v: (dx * beside.x + dz * beside.z) / (RING_ACROSS * grow) }
  }
  /**
   * The way from `from` to `to` kept off the two of them: straight, unless that cuts in past KEEP_OUT times the oval;
   * then round them the shorter way, from where the oval that far out is first passed to where `to` is seen past it.
   * The points along it, `to` last.
   */
  const around = (from: Point, to: Point): Point[] => {
    const a = flat(from)
    const b = flat(to)
    const du = b.u - a.u
    const dv = b.v - a.v
    const t = Math.min(1, Math.max(0, -(a.u * du + a.v * dv) / (du * du + dv * dv || 1)))
    const ra = Math.hypot(a.u, a.v)
    const rb = Math.hypot(b.u, b.v)
    if (ra < KEEP_OUT || rb < KEEP_OUT || Math.hypot(a.u + du * t, a.v + dv * t) >= KEEP_OUT) return [to]
    const fromAngle = Math.atan2(a.v, a.u)
    let turn = Math.atan2(b.v, b.u) - fromAngle
    turn -= Math.PI * 2 * Math.round(turn / (Math.PI * 2))
    const side = Math.sign(turn) || 1
    const start = fromAngle + side * Math.acos(KEEP_OUT / ra)
    let sweep = Math.atan2(b.v, b.u) - side * Math.acos(KEEP_OUT / rb) - start
    sweep -= Math.PI * 2 * Math.round(sweep / (Math.PI * 2))
    if (Math.sign(sweep) !== side) return [to]
    const steps = Math.ceil(Math.abs(sweep) / KEEP_STEP)
    return [...Array.from({ length: steps + 1 }, (_, i) => oval(start + (sweep * i) / steps, grow * KEEP_OUT)), to]
  }
  /** How long the way along `way` from `from` is, m. */
  const lengthOf = (from: Point, way: Point[]) => way.reduce((d, p, i) => d + Math.hypot(p.x - (way[i - 1] ?? from).x, p.z - (way[i - 1] ?? from).z), 0)
  /** `plan` on to `to`, round the two of them, leaving at `leave` s at the soonest, at `pace` m/s. */
  const go = (plan: Plan, to: Point, leave: number, pace: number) => {
    around(plan.legs.at(-1)?.to ?? plan.from, to).forEach((p, i) => plan.legs.push({ to: p, leave: i === 0 ? leave : 0, pace }))
  }

  // His goslings come ashore either side of him, one side then the other, the nearer him first.
  const sideOf = (k: number, from: number, step: number) => (k % 2 === 0 ? 1 : -1) * (from + step * Math.floor(k / 2))
  const broodSides = cast.brood.map((_, k) => sideOf(k, LAND_SIDE, LAND_STEP))
  const brood: Plan[] = cast.brood.map((from, k) => {
    const off = { x: shore.x + way.x * OFF_SHORE + along.x * broodSides[k]!, z: shore.z + way.z * OFF_SHORE + along.z * broodSides[k]! }
    const swim = Math.hypot(off.x - from.x, off.z - from.z)
    const due = OUTRO.landed - 0.2 + BROOD_STAGGER * k
    return { from: { ...from }, legs: [{ to: off, leave: 0, pace: Math.max(0.3, swim / due) }, { to: up(LAND_IN, broodSides[k]!), leave: 0, pace: CLIMB }] }
  })
  const shakes = brood.map((plan) => legTimes(plan)[1]!.end)

  // The island's goslings from where they play.
  const home: Plan[] = cast.island.map((from) => ({ from: { ...from }, legs: [] }))

  // Then every one of them round the two of them: before OUTRO.settle running round them on a wider oval, all one
  // way at one pace, each on to it at its nearest point and spaced so none runs into another; then each steps in from
  // where it is to its place on an oval hugging them, a little in or out.
  const all = [...brood, ...home]
  /** The angle round the oval `s` of the way along it. */
  const angleAt = (s: number) => {
    const want = (((s % 1) + 1) % 1) * length
    let j = 1
    while (j < RING_POINTS && reached[j]! < want) j++
    const share = (want - reached[j - 1]!) / (reached[j]! - reached[j - 1]! || 1)
    return ((j - 1 + share) / RING_POINTS) * Math.PI * 2
  }
  const wide = grow * PLAY_WIDE
  const lap = length * wide
  const round = (s: number) => ((s % 1) + 1) % 1
  /** The point of the wider oval nearest `p`: how far along it, a share of the way round, and how far off, m. */
  const nearest = (p: Point) => {
    let best = 0
    let off = Infinity
    points.forEach((q, j) => {
      const d = Math.hypot(pair.x + (q.x - pair.x) * wide - p.x, pair.z + (q.z - pair.z) * wide - p.z)
      if (d < off) {
        off = d
        best = j
      }
    })
    return { s: reached[best]! / length, off }
  }
  // Each leaves where it is, the island's as they leave their play, his once shaken dry, for the wider oval's point
  // nearest it, and runs on round from there, the island's waiting there for the two of them to meet; on it in time to
  // run, it is where it would be round it at OUTRO.settle.
  const runs = all.map((plan, k) => {
    const his = k < brood.length
    const leave = his ? Math.max(legTimes(plan).at(-1)!.end, shakes[k]! + SHAKE) : OUTRO.call + OUTRO.stagger * draw(k, 1)
    const on = nearest(plan.legs.at(-1)?.to ?? plan.from)
    const joins = Math.max(leave + Math.max(JOIN_LEAST, on.off / RUN), his ? 0 : OUTRO.met + OUTRO.stagger * draw(k, 2))
    const running = joins < OUTRO.settle - JOIN_LEAST
    return { leave, joins, running, s: running ? on.s + ((OUTRO.settle - joins) * PLAY_RUN) / lap : 0 }
  })
  // Spaced: on round from the one after the widest gap, each PLAY_ROOM m on from the one before at the least.
  const running = runs.map((_, k) => k).filter((k) => runs[k]!.running)
  running.sort((a, b) => round(runs[a]!.s) - round(runs[b]!.s))
  let first = 0
  let widest = -1
  running.forEach((k, i) => {
    const gap = round(runs[k]!.s - runs[running[(i + running.length - 1) % running.length]!]!.s) || 1
    if (gap > widest) {
      widest = gap
      first = i
    }
  })
  const base = running.length ? runs[running[first]!]!.s : 0
  running.forEach((_, i) => {
    const run = runs[running[(first + i) % running.length]!]!
    const before = i > 0 ? runs[running[(first + i - 1) % running.length]!]!.s : -Infinity
    run.s = Math.max(base + round(run.s - base), before + PLAY_ROOM / lap)
  })
  // Any too late to run takes the middle of the widest gap left.
  const taken = running.map((k) => round(runs[k]!.s))
  runs.forEach((run, k) => {
    if (run.running) return
    const sorted = [...taken].sort((a, b) => a - b)
    let gap = -1
    run.s = draw(k, 4)
    sorted.forEach((s, i) => {
      const next = sorted[i + 1] ?? sorted[0]! + 1
      if (next - s > gap) {
        gap = next - s
        run.s = round(s + gap / 2)
      }
    })
    taken.push(run.s)
  })
  all.forEach((plan, k) => {
    const { leave, joins, running, s } = runs[k]!
    if (running) {
      const track = (t: number) => oval(angleAt(s - ((OUTRO.settle - t) * PLAY_RUN) / lap), wide)
      const from = plan.legs.at(-1)?.to ?? plan.from
      const on = track(joins)
      go(plan, on, leave, Math.max(RUN, lengthOf(from, around(from, on)) / (joins - leave)))
      const steps = Math.ceil(((OUTRO.settle - joins) * PLAY_RUN * LAP_LEGS) / lap)
      for (let i = 1; i <= steps; i++) {
        const start = joins + ((OUTRO.settle - joins) * (i - 1)) / steps
        const end = joins + ((OUTRO.settle - joins) * i) / steps
        const a = track(start)
        const b = track(end)
        plan.legs.push({ to: b, leave: start, pace: Math.hypot(b.x - a.x, b.z - a.z) / (end - start) })
      }
    }
    go(plan, oval(angleAt(s), grow * (1 + RING_OUT * draw(k, 5))), Math.max(leave, OUTRO.settle), RUN)
  })
  return { way, shore, gander, mother, pair, brood, island: home, shakes }
}

/** Eased in and out, 0 to 1, over [from, to] s. */
function eased(t: number, [from, to]: readonly [number, number]): number {
  const s = Math.min(1, Math.max(0, (t - from) / (to - from)))
  return s * s * (3 - 2 * s)
}

/**
 * Where he is `t` s into the ending, and the way he faces, a unit vector: swimming on to the island, slowing as he
 * steps out, then facing her.
 */
export function ganderAt(stage: Stage, t: number): { at: Point; facing: Point } {
  const { from, to } = stage.gander
  const u = Math.min(1, Math.max(0, t / OUTRO.landed))
  // Fast at first, as he swam, slowing to a stop.
  const s = 0.5 * u + 0.5 * (1 - (1 - u) ** 2)
  const d = Math.hypot(to.x - from.x, to.z - from.z)
  const going = d > 1e-6 ? { x: (to.x - from.x) / d, z: (to.z - from.z) / d } : { x: -stage.way.x, z: -stage.way.z }
  const her = stage.mother.to
  const gap = Math.hypot(her.x - to.x, her.z - to.z)
  const toHer = gap > 1e-6 ? { x: (her.x - to.x) / gap, z: (her.z - to.z) / gap } : going
  return { at: { x: from.x + (to.x - from.x) * s, z: from.z + (to.z - from.z) * s }, facing: u < 1 ? going : toHer }
}

/** The mother `t` s into the ending: where she is, which way she faces, a yaw, how far up off her nest, 0 to 1, and whether she runs. */
export function motherAt(stage: Stage, t: number): { at: Point; yaw: number; up: number; running: boolean } {
  const { from, door, to, yaw } = stage.mother
  const up = eased(t, [OUTRO.rise, OUTRO.risen])
  // Out of the door first, if she is in the tent, then to him.
  const way = door ? [door, to] : [to]
  let d = 0
  way.reduce((a, b) => ((d += Math.hypot(b.x - a.x, b.z - a.z)), b), from)
  const pace = Math.max(MOTHER_LEAST, d / (OUTRO.met - OUTRO.risen))
  const { at, going } = planAt({ from, legs: way.map((p) => ({ to: p, leave: OUTRO.risen, pace })) }, t)
  if (going) return { at, yaw: Math.atan2(going.x, going.z), up, running: true }
  // Got up, she turns to face him; there, she faces him.
  const him = stage.gander.to
  const toHim = Math.atan2(him.x - to.x, him.z - to.z)
  return { at, yaw: t < OUTRO.risen ? yaw : toHim, up, running: false }
}

/** What a gosling does in place, its clip held at `share` of the way through, and how high it is off the ground, m. */
export interface Act {
  clip: 'shake' | 'jump'
  share: number
  lift: number
}

/** Gosling `k`'s act `t` s into the ending, his (`brood`) or the island's: shaking dry once ashore, hopping in the ring. */
export function actOf(stage: Stage, brood: boolean, k: number, t: number): Act | undefined {
  if (brood) {
    const shook = (t - stage.shakes[k]!) / SHAKE
    if (shook >= 0 && shook < 1) return { clip: 'shake', share: shook, lift: 0 }
  }
  for (const start of hopsOf(stage, brood, k)) {
    const share = (t - start) / HOP
    if (share >= 0 && share < 1) return hopAt(share)
  }
  return undefined
}

/** When gosling `k`, his (`brood`) or the island's, starts each of its hops in the ring, s into the ending. */
function hopsOf(stage: Stage, brood: boolean, k: number): number[] {
  const inRing = ringReached(stage, brood, k)
  return HOPS.map((after) => inRing + after + HOP_SPREAD * draw(k + (brood ? 0 : 50), 3))
}

/** When gosling `k`, his (`brood`) or the island's, peeps for joy in the ring, s into the ending: one short run, at a time of its own. */
export function peepsOf(stage: Stage, brood: boolean, k: number): number[] {
  const seed = k + (brood ? 0 : 50)
  const count = PEEP_RUN[0] + Math.floor(draw(seed, 12) * (PEEP_RUN[1] - PEEP_RUN[0] + 1))
  let at = ringReached(stage, brood, k) + PEEP_FROM + PEEP_SPREAD * draw(seed, 13)
  return Array.from({ length: count }, (_, p) => (p === 0 ? at : (at += PEEP_GAP[0] + (PEEP_GAP[1] - PEEP_GAP[0]) * draw(seed + 7 * p, 11))))
}

/** When gosling `k`, his (`brood`) or the island's, reaches the ring, s: the end of its last leg. */
function ringReached(stage: Stage, brood: boolean, k: number): number {
  const times = legTimes((brood ? stage.brood : stage.island)[k]!)
  return times[times.length - 1]!.end
}

/** A hop `share` of the way through, 0 to 1: its clip held there, and off the ground, as high as HOP_HEIGHT, while its feet are. */
export function hopAt(share: number): Act {
  const air = (share - HOP_AIR[0]) / (HOP_AIR[1] - HOP_AIR[0])
  return { clip: 'jump', share, lift: air > 0 && air < 1 ? HOP_HEIGHT * Math.sin(Math.PI * air) : 0 }
}

/**
 * Gosling `k`, his (`brood`) or the island's, `t` s into the ending: where it is, what it does, and, standing, the way
 * it faces, a yaw: the island's to the water as they wait for his, and every one to the two of them in the ring.
 */
export function goslingOf(stage: Stage, brood: boolean, k: number, t: number): { at: Point; act?: Act; face?: number } {
  const plan = (brood ? stage.brood : stage.island)[k]!
  const { at, going } = planAt(plan, t)
  const act = actOf(stage, brood, k, t)
  if (going) return { at, act }
  const times = legTimes(plan)
  const toward = (p: Point) => Math.atan2(p.x - at.x, p.z - at.z)
  // In the ring, to the two of them, each a little off.
  if (t >= ringReached(stage, brood, k)) return { at, act, face: toward(stage.pair) + (draw(k + (brood ? 0 : 50), 9) * 2 - 1) * LOOKS_OFF }
  if (!brood && t >= times[0]!.end) return { at, act, face: Math.atan2(stage.way.x, stage.way.z) }
  return { at, act }
}

/** How far the dawn has come up `t` s into the ending, 0 night to 1. */
export const dawnOf = (t: number): number => eased(t, OUTRO.dawn)
/** How far the camera has drawn back, m. */
export const pullOf = (t: number): number => PULL * eased(t, OUTRO.pull)
/** How far the camera looks from him to the middle of the two of them, 0 to 1. */
export const aimOf = (t: number): number => eased(t, [0, OUTRO.landed])
/** How dark the night has faded out, 0 to 1, and how far the title is in. */
export const fadeOf = (t: number): number => eased(t, OUTRO.fade)
export const titleOf = (t: number): number => eased(t, OUTRO.title)
