// The swarm (CONTEXT.md, ADR-0046): every rat running for the light's holder,
// with no ring, no route map and no moods. Written from scratch in a
// prototype beside the route-map swarm (ADR-0045) and kept in its place. No
// renderer and no DOM, so it is tested in Node and could move into a worker
// unchanged.
//
// Every rat wants one thing: the holder. Nothing tells it to circle. It runs
// straight in at its own speed; what stops it is the light's edge, which it
// will not step over, and the bodies ahead of it. A rat stopped that way slides
// sideways, toward whichever side is less crowded, keeping its side until the
// other is clearly emptier: that is the only reason a rat goes round the light,
// so the milling at the edge comes out of crowding, in every direction at
// once, and there is no band and no line between circling and waiting. Bodies
// push each other off softly, so they overlap and climb over each other as
// they press in. And they are starving: each writhes at walking pace in a way
// its whim picks, on top of all that, so a rat packed in where it can go
// nowhere seethes in place instead of standing still.
//
// The light burns. A rat at its edge holds there only as long as it can stand
// it, a second or two, each rat its own; then it flinches back through the
// mass for a moment, and comes again. Fear spreads: a rat that has stood the
// edge a while flinches with a rat beside it that just did, so the front
// recoils in clumps. And each rat has its own nerve, how close it dares come,
// from the edge itself to twice the gap off it. So the front is never a line:
// it breaks open in bays where clumps flinch, and the rats behind pour in.
//
// A rat at the light's edge faces it; one flinching, caught, or in the way
// of the light coming at it turns and runs. Every other rat faces where it
// really goes, so the mass behind points every way, and no rat ever backs
// away facing the light.
//
// The flame flickers: how far it burns wobbles round it and over time, by up
// to FLICKER of its radius, so the edge the rats press on is never a circle.
//
// The light moves nobody. A rat at its edge only refuses to step in. A walking
// light reaches ahead along its path, `lookAhead` seconds of it, so rats get
// out of its way before it arrives; rats it overtakes, or a relit light opens
// over, run out on their own.
//
// The dark keeps the crowd. Told what the page cannot see, the swarm takes
// rats a walking light has left behind in it and sets them down in it again
// ahead, running in, a stream of them and never a wall: the light walks into
// as many rats as it leaves.
//
// The pile: the mass climbs over itself. A rat pressing into a body ahead of
// its own way, one not pressing back, rides up on it, as deep as it is into
// it and from where that body already rides, so the mass behind a packed
// front crests over the backs in front. The front itself, and any rat running
// from the light, keeps to the ground; the pile rises from each rat's own
// hold at the light in a straight line over `pileRamp` gaps. Only the drawing
// reads it: the step stays on the ground plane, and rats collide and steer
// there.
//
// Positions are metres on the ground (x, z), with the arena's centre at the
// origin, and `y` how high a rat rides on the pile; a heading is a yaw in
// radians, measured from +x toward +z, and a pitch the slope a rat takes,
// nose up positive.

const TAU = Math.PI * 2

/** The light, as the swarm reads it: where its holder stands, how strong it is, and whether it is lit. */
export interface Light {
  x: number
  z: number
  /** 0 to 1: scales the hard radius. */
  strength: number
  on: boolean
}

/** What the swarm is tuned by. */
export interface Tuning {
  /** The collision disc; a rat's body is about 0.25 m long. */
  ratRadius: number
  /** The light's hard radius at full strength. */
  ringMax: number
  /** The strip off the light's edge a rat feels the light in, m: the boldest hold at the edge, the most timid twice this off it. */
  gap: number
  /** The slowest and fastest rat, in m/s. */
  minSpeed: number
  maxSpeed: number
  /** Radians a second a rat's facing turns at most toward where it really goes. */
  turnRate: number
  /** Seconds a rat takes to reach the pace it wants: how quickly it reacts. */
  reaction: number
  /** Seconds ahead a rat reads a walking light's path. */
  lookAhead: number
  /**
   * The pace a starving rat writhes at, m/s, in whatever way its whim points,
   * on top of where it wants to go: it never stands still, even packed in
   * where it can go nowhere. The Walk clip's own pace, so a rat that can go
   * nowhere else walks on the spot and over its neighbours.
   */
  agitation: number
  /**
   * How high a rat rides the bodies it presses into, as a multiple of a rat's
   * height: 0 and every rat stays on the ground. Prototype, see the pile below.
   */
  pile: number
  /** How many gaps past a rat's own hold at the light the pile takes to reach its full height, in a straight line: short, a cliff; long, a slope. */
  pileRamp: number
}

// The start, as the panel left it on 2026-10-05: the rats keep well off the
// light, read none of its walk ahead, and writhe at walking pace.
export const defaultTuning = (): Tuning => ({
  ratRadius: 0.07,
  ringMax: 3,
  gap: 0.6,
  minSpeed: 1.2,
  maxSpeed: 2.2,
  turnRate: 10,
  reaction: 0.25,
  lookAhead: 0,
  agitation: 0.4,
  pile: 1,
  pileRamp: 3,
})

/** What the page cannot see: everything further than `radius` from (x, z), m. */
export interface Dark {
  x: number
  z: number
  radius: number
}

/** What one step measured. */
export interface StepReport {
  /** Rats inside the light, caught in the flame where it reaches as it flickers: overtaken by it, or caught by a light that grew or relit over them. */
  inside: number
  /** Pairs of rats closer than touching, and how deep, as a share of a rat's width. */
  overlappingPairs: number
  meanOverlap: number
  /** The step's own time. */
  ms: number
}

/** The holder's walking pace, m/s. */
export const WALK_SPEED = 1.6

/** A rat's gait: what its feet play, read from how fast it really moves. */
export const RUN = 0
export const WALK = 1
export const IDLE = 2

/**
 * The gait's thresholds, m/s, with hysteresis: Run from RUN_IN and back to Walk
 * under RUN_OUT; Walk from WALK_IN and back to Idle under WALK_OUT.
 */
const RUN_IN = 0.75
const RUN_OUT = 0.6
const WALK_IN = 0.14
const WALK_OUT = 0.06
/** Seconds a gait holds at least, but Idle: a rat that moves shows it at once. */
const GAIT_DWELL = 0.3
/** Seconds the real speed is smoothed over, so jostling back and forth cancels out. */
const SEEN = 0.3
/** The light's own walk is read smoothed over this many seconds for its path ahead, and counts as walking from this pace, m/s, smoothed or as stepped. */
const LIGHT_SMOOTHING = 0.2
const LIGHT_WALKING = 0.2
/**
 * How hard two overlapping bodies push apart, m/s², at full overlap, falling
 * to nothing at touching. A rat drives itself at about its speed over its
 * reaction time, 7 m/s² at 1.7 m/s and 0.25 s; at 25, one rat pressing on
 * another sinks about a third of a body into it before the push holds it.
 */
const PUSH = 25
/** How far round a rat feels the crowd, as a multiple of touching. */
const FEEL = 1.3
/** How much more crowded its side must be than the other before a sliding rat turns round. */
const SWITCH = 0.5
/** Radians a second a rat's wander turns at random: about a new whim every third of a second. */
const WHIM = 8
/** How far the flame's reach wobbles, as a share of the light's radius. */
const FLICKER = 0.08
/** Seconds a rat stands the light's edge before it flinches: each rat its own, from the first to the second. */
const TOLERANCE = [0.6, 2.4]
/** Seconds a flinch carries a rat back, give or take a quarter. */
const FLINCH = 0.4
/** A rat's velocity is capped at this much over its own running speed. */
const TOP = 1.2
/** How many angles round the light the flame's reach is read at, each step: a rat reads its own angle between two. */
const FLAME_BINS = 512
/**
 * Rats left behind in the dark are brought round ahead of a walking light: at
 * most this share of the swarm a second, so they come out of the dark as a
 * stream and not a wall, though a share unspent is kept for this many
 * seconds, so a page that hands the swarm the light slower than it steps
 * loses none of the stream; within this many radians either side of its
 * walk; and up to this many metres past the dark's edge, or past the
 * flame's reach where the dark lies inside it.
 */
const ROUND_RATE = 0.2
const ROUND_HOLD = 0.1
const ROUND_SPREAD = Math.PI / 3
const ROUND_DEPTH = 3
/**
 * The pile (prototype): a rat pressing into a body ahead of it rides up on
 * it, as deep as it is into it and from where that body already rides, so
 * the mass behind a packed front crests over the backs in front. A rat's
 * height, as a multiple of its collision radius; how deep into a body a rat
 * is riding its full height; how many heights high the pile stops; and the
 * seconds a rat takes to climb up, and to drop back.
 */
const RAT_HEIGHT = 1.2
const RIDE_DEPTH = 0.6
const PILE_CAP = 2.5
const RISE = 0.15
const FALL = 0.3
/** A rat running from the light drops to the ground this fast, s, so it never looks to fly. */
const FALL_FLEE = 0.08
/** The pitch follows the slope a rat climbs, smoothed over this many seconds, and no steeper than this, radians. */
const PITCH_SMOOTHING = 0.15
const PITCH_MAX = 1

/** The arena's radius: sized to the count, so the swarm is under the same pressure at any count. */
export const arenaRadiusFor = (count: number) => 7 + Math.sqrt(count / Math.PI) * 0.32

/** Walk `light` toward `target` for `dt` at `speed`, kept a metre inside an arena of radius `arena`. */
export function walkLight(arena: number, light: Light, target: { x: number; z: number }, dt: number, speed = WALK_SPEED): void {
  const dx = target.x - light.x
  const dz = target.z - light.z
  const d = Math.hypot(dx, dz)
  if (d > 1e-4) {
    const step = Math.min(d, speed * dt)
    light.x += (dx / d) * step
    light.z += (dz / d) * step
  }
  const r = Math.hypot(light.x, light.z)
  const limit = arena - 1
  if (r > limit) {
    light.x *= limit / r
    light.z *= limit / r
  }
}

/** A point on the fixed loop the benchmark walks the light round an arena of radius `arena`, at `t` seconds. */
export const loopPoint = (arena: number, t: number) => ({ x: Math.sin(t * 0.12) * arena * 0.45, z: Math.sin(t * 0.24) * arena * 0.25 })

/** The light's hard radius. Out, it is zero, and the swarm closes on the holder. */
export const hardRadius = (light: Light, tuning: Tuning) => (light.on ? tuning.ringMax * light.strength : 0)

/** The least the flame reaches anywhere round the light as it flickers: a rat this close is inside it at any angle. */
export const leastRadius = (light: Light, tuning: Tuning) => hardRadius(light, tuning) * (1 - FLICKER)

/** The most the flame reaches anywhere round the light as it flickers: a rat this far off is outside it at any angle. */
export const mostRadius = (light: Light, tuning: Tuning) => hardRadius(light, tuning) * (1 + FLICKER)

/** mulberry32: small, fast and seeded, so every run of a test is the same. */
function random(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

export class Swarm {
  /** Rats alive: the first `count` of every array. */
  count = 0
  arena = arenaRadiusFor(0)
  readonly x: Float32Array
  readonly z: Float32Array
  /** Each rat's facing: the light at its edge, else where it really goes, at a capped turn rate. */
  readonly heading: Float32Array
  /** What each rat's feet play: RUN, WALK or IDLE. */
  readonly gait: Uint8Array
  /** How fast each rat really moves, m/s, smoothed over about a third of a second. */
  readonly realSpeed: Float32Array
  /** How high each rat rides on the pile, m above the ground; and its pitch, radians, nose up positive. */
  readonly y: Float32Array
  readonly pitch: Float32Array
  /** Which rats the last step moved rather than ran, 1 or 0: brought round in the dark, to be placed and never slid. */
  readonly moved: Uint8Array

  private readonly random: () => number
  private time = 0
  /** Where each rat sits between the slowest and fastest speed: drawn once, at its spawn. The page sizes the rat by it. */
  readonly places: Float32Array
  /** Its velocity, m/s: what the bodies push on. */
  private readonly vx: Float32Array
  private readonly vz: Float32Array
  /** Its real velocity, smoothed: what the facing and the gait read. */
  private readonly sx: Float32Array
  private readonly sz: Float32Array
  private readonly gaitSince: Float32Array
  /** Which way a blocked rat slides, 1 left or -1 right as it faces the holder, 0 not sliding. */
  private readonly side: Int8Array
  /** The way its wander points, radians. */
  private readonly whim: Float32Array
  /** How long it has stood the light's edge, s; how long it stands it; and how long its flinch has left to run. Read by the fear page (prototype/). */
  readonly burn: Float32Array
  readonly tolerance: Float32Array
  readonly flinch: Float32Array
  /** Whether its last flinch was caught from a neighbour (1) rather than its own burn (0). */
  readonly caught: Uint8Array
  /** Whether the light burns at all: off, no rat ever flinches, and the front holds the edge. For the top-down page (prototype/). */
  fear = true
  /** Whether fear spreads: a flinching neighbour halves what a rat stands. Off, each rat flinches on its own burn alone. */
  contagion = true
  /** How close it dares come to the light: 0 the edge itself, 1 twice the gap off it. */
  readonly timid: Float32Array
  /** Where it wants to go, as a direction: what it faces, unless it runs elsewhere. And whether it may face its run. */
  private readonly faceX: Float32Array
  private readonly faceZ: Float32Array
  private readonly free: Uint8Array
  private readonly oldX: Float32Array
  private readonly oldZ: Float32Array
  /** How far the flame reaches this step, as a share of the hard radius, at FLAME_BINS angles round the light, -pi to pi. */
  private readonly flame = new Float32Array(FLAME_BINS + 1)
  // The neighbour grid, rebuilt as the arena or the rat size changes.
  private readonly cellOf: Int32Array
  private readonly sorted: Int32Array
  private gridN = 0
  private cellSize = 0
  private cellStart = new Int32Array(1)
  private cursor = new Int32Array(0)
  /** The light's last place and smoothed velocity; fresh until the first step reads it. */
  private readonly was = { x: 0, z: 0, vx: 0, vz: 0, fresh: true }
  /** Where the search for rats left behind takes up again next step, so every rat gets its turn; and the share of a rat owed. */
  private roundFrom = 0
  private roundOwed = 0

  constructor(
    readonly capacity: number,
    seed: number,
    /** How much wider than the count asks the arena is: the bare simulation doubles it. */
    private readonly arenaScale = 1,
  ) {
    const floats = () => new Float32Array(capacity)
    this.random = random(seed)
    this.x = floats()
    this.z = floats()
    this.heading = floats()
    this.gait = new Uint8Array(capacity)
    this.realSpeed = floats()
    this.y = floats()
    this.pitch = floats()
    this.moved = new Uint8Array(capacity)
    this.places = floats()
    this.vx = floats()
    this.vz = floats()
    this.sx = floats()
    this.sz = floats()
    this.gaitSince = floats()
    this.side = new Int8Array(capacity)
    this.whim = floats()
    this.burn = floats()
    this.tolerance = floats()
    this.flinch = floats()
    this.caught = new Uint8Array(capacity)
    this.timid = floats()
    this.faceX = floats()
    this.faceZ = floats()
    this.free = new Uint8Array(capacity)
    this.oldX = floats()
    this.oldZ = floats()
    this.cellOf = new Int32Array(capacity)
    this.sorted = new Int32Array(capacity)
  }

  /** Where rat `i` sits between the slowest and fastest speed, 0 to 1. */
  place(i: number): number {
    return this.places[i]
  }

  /** Rat `i`'s own running speed under `tuning`, m/s. */
  speedOf(i: number, tuning: Tuning): number {
    return tuning.minSpeed + (tuning.maxSpeed - tuning.minSpeed) * this.places[i]
  }

  /** Start over with `count` rats spread over the arena. */
  reset(count: number): void {
    this.count = count
    this.time = 0
    this.was.fresh = true
    this.arena = arenaRadiusFor(count) * this.arenaScale
    for (let i = 0; i < count; i++) this.spawn(i, Math.sqrt(this.random()) * this.arena * 0.97, this.random() * TAU)
  }

  /** Grow or shrink to `count`: newcomers arrive at the arena's edge, and every rat already there stays put. */
  setCount(count: number): void {
    const was = this.count
    this.count = count
    this.arena = arenaRadiusFor(count) * this.arenaScale
    for (let i = was; i < count; i++) this.spawn(i, this.arena * (0.9 + 0.08 * this.random()), this.random() * TAU)
  }

  /** Walk the light toward `target` for `dt` at `speed`, kept a metre inside the arena. */
  walkLight(light: Light, target: { x: number; z: number }, dt: number, speed = WALK_SPEED): void {
    walkLight(this.arena, light, target, dt, speed)
  }

  /** A point on the fixed loop the benchmark walks the light round, at `t` seconds. */
  loopPoint(t: number): { x: number; z: number } {
    return loopPoint(this.arena, t)
  }

  /**
   * One step of `dt`. Given `dark`, what the page cannot see, a walking
   * light brings rats left behind in it round ahead of it, still in it.
   */
  step(dt: number, light: Light, tuning: Tuning, dark?: Dark): StepReport {
    const t0 = performance.now()
    this.time += dt
    const now = this.time
    const { x: px, z: pz, vx, vz, side, whim, flinch, count } = this
    this.moved.fill(0, 0, count)
    const r = tuning.ratRadius
    const touch = 2 * r
    const feel = touch * FEEL
    const feel2 = feel * feel

    // The light's walk, smoothed: where it will be `lookAhead` from now.
    const was = this.was
    if (was.fresh) {
      was.x = light.x
      was.z = light.z
      was.vx = was.vz = 0
      was.fresh = false
    }
    // This step's own walk, unsmoothed: the light halts the moment it stops.
    const stepVx = (light.x - was.x) / dt
    const stepVz = (light.z - was.z) / dt
    const stepV = Math.hypot(stepVx, stepVz)
    const k = Math.min(1, dt / LIGHT_SMOOTHING)
    was.vx += (stepVx - was.vx) * k
    was.vz += (stepVz - was.vz) * k
    was.x = light.x
    was.z = light.z
    const lv = Math.hypot(was.vx, was.vz)
    const reachAhead = lv > LIGHT_WALKING ? lv * tuning.lookAhead : 0
    const lux = reachAhead > 0 ? was.vx / lv : 0
    const luz = reachAhead > 0 ? was.vz / lv : 0

    const inner = hardRadius(light, tuning)
    const zone = Math.max(tuning.gap, r)
    // Past this far from the light nothing of it reaches a rat, whichever way the flame leans: the reach is not read.
    const far = mostRadius(light, tuning) + 2 * tuning.gap + zone
    // Only a lit light brings rats round, and only on a step it walked: the smoothed walk would go on tearing them from behind a halted light.
    if (dark !== undefined && light.on && count > 0) {
      this.roundOwed = Math.min(this.roundOwed + count * ROUND_RATE * dt, count * ROUND_RATE * ROUND_HOLD + 1)
      if (stepV > LIGHT_WALKING) this.bringRound(light, tuning, dark, stepVx / stepV, stepVz / stepV, far)
    }
    this.buildGrid(feel)
    const { cellStart, sorted, cellOf, gridN: n } = this
    // The flame's flicker, once a step round the light rather than once a rat.
    const flame = this.flame
    for (let b = 0; b <= FLAME_BINS; b++) {
      const theta = (b / FLAME_BINS) * TAU - Math.PI
      flame[b] =
        1 +
        FLICKER *
          (0.5 * Math.sin(3 * theta + now * 1.3) +
            0.3 * Math.sin(5 * theta - now * 2.1 + 1) +
            0.2 * Math.sin(8 * theta + now * 3.7 + 2))
    }
    const pushOf = PUSH / touch
    const { y, pitch } = this
    const height = RAT_HEIGHT * r * tuning.pile
    const pileCap = PILE_CAP * height
    let inside = 0
    let touching = 0
    let depth = 0

    for (let i = 0; i < count; i++) {
      const x = px[i]
      const z = pz[i]
      const v0 = tuning.minSpeed + (tuning.maxSpeed - tuning.minSpeed) * this.places[i]
      // The way it goes, for the pile: where it really runs, or toward the holder when it hardly moves.
      const mv = Math.sqrt(vx[i] * vx[i] + vz[i] * vz[i])
      let mount = 0

      // Toward the holder: what it wants.
      const hx = light.x - x
      const hz = light.z - z
      const H = Math.sqrt(hx * hx + hz * hz) || 1e-6
      const ix = hx / H
      const iz = hz / H
      // Its left, facing the holder.
      const lx = -iz
      const lz = ix
      const gx = mv > WALK_OUT ? vx[i] / mv : ix
      const gz = mv > WALK_OUT ? vz[i] / mv : iz

      // The light as it stands and as it is about to: the nearest point on its walk ahead.
      let qx = light.x
      let qz = light.z
      // How far along its walk ahead the light is nearest: past 0, it is coming at this rat.
      let along = 0
      if (reachAhead > 0) {
        along = Math.max(0, Math.min(reachAhead, (x - light.x) * lux + (z - light.z) * luz))
        qx += lux * along
        qz += luz * along
      }
      let ox = x - qx
      let oz = z - qz
      const Q = Math.sqrt(ox * ox + oz * oz) || 1e-6
      ox /= Q
      oz /= Q
      // How far the flame burns this way, now.
      const burns = Q < far ? inner * this.reach(ox, oz) : inner
      // Caught in the light as it stands: inside the flame's reach at its angle round the holder.
      if (inner > 0 && H < far && H < (along > 0 ? inner * this.reach(-hx, -hz) : burns)) inside++

      // The bodies round it: how crowded it is ahead, to its left and to its right; and their push.
      let ahead = 0
      let left = 0
      let right = 0
      let ax = 0
      let az = 0
      let scared = false
      const c = cellOf[i]
      const cx = c % n
      const cz = (c / n) | 0
      for (let jz = cz - 1; jz <= cz + 1; jz++) {
        if (jz < 0 || jz >= n) continue
        for (let jx = cx - 1; jx <= cx + 1; jx++) {
          if (jx < 0 || jx >= n) continue
          const cc = jz * n + jx
          for (let q = cellStart[cc], e = cellStart[cc + 1]; q < e; q++) {
            const j = sorted[q]
            if (j === i) continue
            const ex = px[j] - x
            const ez = pz[j] - z
            const d2 = ex * ex + ez * ez
            if (d2 >= feel2 || d2 < 1e-12) continue
            const d = Math.sqrt(d2)
            const inv = 1 / d
            // 1 touching or closer, 0 at the edge of feeling.
            const w = d <= touch ? 1 : (feel - d) / (feel - touch)
            const fwd = (ex * ix + ez * iz) * inv
            const lat = (ex * lx + ez * lz) * inv
            if (fwd > 0.5) ahead += w
            if (lat > 0.3) left += w
            else if (lat < -0.3) right += w
            if (d < touch) {
              if (flinch[j] > FLINCH * 0.5) scared = true
              const f = pushOf * (touch - d) * inv
              ax -= ex * f
              az -= ez * f
              touching++
              const into = (touch - d) / touch
              depth += into
              // The pile: it rides a body it presses into that is ahead of its own way and not pressing back
              // into it, as deep as it is into it, from where that body rides. Two head on ride neither.
              if (height > 0 && (ex * gx + ez * gz) * inv > 0.5) {
                const jv = Math.sqrt(vx[j] * vx[j] + vz[j] * vz[j])
                let jwx = light.x - px[j]
                let jwz = light.z - pz[j]
                if (jv > WALK_OUT) {
                  jwx = vx[j] / jv
                  jwz = vz[j] / jv
                } else {
                  const jw = Math.sqrt(jwx * jwx + jwz * jwz) || 1e-6
                  jwx /= jw
                  jwz /= jw
                }
                if (-(ex * jwx + ez * jwz) * inv <= 0.5) {
                  const on = y[j] + (into / RIDE_DEPTH) * height
                  if (on > mount) mount = on
                }
              }
            }
          }
        }
      }

      // What it wants to do, as a velocity.
      let wx: number
      let wz: number
      const edge = inner > 0 ? clamp01((burns + 2 * tuning.gap * this.timid[i] + zone - Q) / zone) : 0
      // The pile is flat at a rat's own hold at the light and rises in a straight line from there, over `pileRamp`
      // gaps: the front stays on the ground, and the mass behind piles up gradually, each rat from its own line.
      if (inner > 0) mount *= clamp01((Q - burns - tuning.gap * (1 + this.timid[i])) / (tuning.pileRamp * tuning.gap))
      let drop = FALL
      whim[i] += (this.random() * 2 - 1) * WHIM * dt
      // At the edge it burns; away from it, it gets over it. Stood too long, it flinches.
      if (edge > 0) this.burn[i] += edge * dt
      else this.burn[i] = Math.max(0, this.burn[i] - dt)
      if (this.fear && this.flinch[i] <= 0 && (this.burn[i] > this.tolerance[i] || (scared && this.contagion && this.burn[i] > this.tolerance[i] * 0.5))) {
        this.caught[i] = this.burn[i] > this.tolerance[i] ? 0 : 1
        this.flinch[i] = FLINCH * (0.75 + 0.5 * this.random())
        this.burn[i] = 0
      }
      if ((inner > 0 && Q < burns) || this.flinch[i] > 0 || (along > 0 && edge > 0)) {
        // Caught in the light, flinching from it, or in the way of it coming: it turns and runs, away
        // the shortest way, through whatever is behind. And straight down: a rat running from the light never rides.
        mount = 0
        drop = FALL_FLEE
        this.flinch[i] -= dt
        wx = ox * v0 + Math.cos(whim[i]) * tuning.agitation
        wz = oz * v0 + Math.sin(whim[i]) * tuning.agitation
        this.faceX[i] = ox
        this.faceZ[i] = oz
        this.free[i] = 0
        side[i] = 0
      } else {
        this.faceX[i] = ix
        this.faceZ[i] = iz
        this.free[i] = edge > 0 ? 0 : 1
        // At the light's edge, or behind bodies, it is blocked; the light also warns it off.
        const blocked = Math.min(1, Math.max(ahead, edge))
        if (blocked < 0.1) side[i] = 0
        else if (side[i] === 0) side[i] = left < right ? 1 : right < left ? -1 : this.random() < 0.5 ? 1 : -1
        else if ((side[i] > 0 ? left : right) > (side[i] > 0 ? right : left) + SWITCH) side[i] = -side[i] as -1 | 1
        const s = side[i]
        const sideBlocked = clamp01(s > 0 ? left : right)
        const slide = blocked * (1 - sideBlocked)
        wx = ix * (1 - blocked) + lx * s * slide + ox * edge
        wz = iz * (1 - blocked) + lz * s * slide + oz * edge
        const wl = Math.sqrt(wx * wx + wz * wz)
        if (wl > 1) {
          wx /= wl
          wz /= wl
        }
        wx = wx * v0 + Math.cos(whim[i]) * tuning.agitation
        wz = wz * v0 + Math.sin(whim[i]) * tuning.agitation
      }

      let nvx = vx[i] + ((wx - vx[i]) / tuning.reaction + ax) * dt
      let nvz = vz[i] + ((wz - vz[i]) / tuning.reaction + az) * dt
      const sp = Math.sqrt(nvx * nvx + nvz * nvz)
      if (sp > v0 * TOP) {
        nvx *= (v0 * TOP) / sp
        nvz *= (v0 * TOP) / sp
      }
      // It will not step into the light: at its edge, the part of its velocity toward it goes.
      if (inner > 0 && Q >= burns && Q < burns + r) {
        const toward = -(nvx * ox + nvz * oz)
        if (toward > 0) {
          nvx += ox * toward
          nvz += oz * toward
        }
      }
      vx[i] = nvx
      vz[i] = nvz
      this.oldX[i] = x
      this.oldZ[i] = z
      px[i] = x + nvx * dt
      pz[i] = z + nvz * dt
      // Up the pile at a climb, and back down at a drop; its pitch the slope it takes.
      const want = mount > pileCap ? pileCap : mount
      const y0 = y[i]
      const ny = y0 + (want - y0) * Math.min(1, dt / (want > y0 ? RISE : drop))
      y[i] = ny
      const pitchWant = Math.atan2(ny - y0, Math.max(mv, WALK_IN) * dt)
      const pw = pitchWant > PITCH_MAX ? PITCH_MAX : pitchWant < -PITCH_MAX ? -PITCH_MAX : pitchWant
      pitch[i] += (pw - pitch[i]) * Math.min(1, dt / PITCH_SMOOTHING)
    }

    // The arena's wall; where each rat really went; its facing; its gait.
    const { heading, gait, gaitSince, realSpeed, sx, sz } = this
    const a = Math.min(1, dt / SEEN)
    const most = tuning.turnRate * dt
    for (let i = 0; i < count; i++) {
      const rr = Math.sqrt(px[i] * px[i] + pz[i] * pz[i])
      if (rr > this.arena) {
        px[i] *= this.arena / rr
        pz[i] *= this.arena / rr
      }
      const mx = (sx[i] += ((px[i] - this.oldX[i]) / dt - sx[i]) * a)
      const mz = (sz[i] += ((pz[i] - this.oldZ[i]) / dt - sz[i]) * a)
      const seen = (realSpeed[i] = Math.sqrt(mx * mx + mz * mz))
      // At the edge it faces the light, flinching away from it; anywhere else, where it really goes.
      // And a rat really moving away from where it faces turns to run: no rat backs off facing the light.
      if (!this.free[i] || seen > WALK_OUT) {
        const retreating = seen > WALK_IN && mx * this.faceX[i] + mz * this.faceZ[i] < -0.5 * seen
        const run = this.free[i] === 1 || retreating
        let diff = (run ? Math.atan2(mz, mx) : Math.atan2(this.faceZ[i], this.faceX[i])) - heading[i]
        diff -= TAU * Math.round(diff / TAU)
        heading[i] += diff > most ? most : diff < -most ? -most : diff
      }
      const g = gait[i]
      let next = g
      if (g === RUN) {
        if (seen < RUN_OUT) next = seen < WALK_OUT ? IDLE : WALK
      } else if (g === WALK) {
        if (seen > RUN_IN) next = RUN
        else if (seen < WALK_OUT) next = IDLE
      } else if (seen > WALK_IN) next = seen > RUN_IN ? RUN : WALK
      if (next !== g && now - gaitSince[i] > GAIT_DWELL) {
        gait[i] = next
        gaitSince[i] = now
      }
    }

    return {
      inside,
      overlappingPairs: touching / 2,
      meanOverlap: touching ? depth / touching : 0,
      ms: performance.now() - t0,
    }
  }

  /**
   * Bring rats left behind round ahead of the light, walking (ux, uz): a rat
   * in the `dark` and behind its centre is set down in it again ahead,
   * running in for the light at its own speed, so the page never sees it
   * go or come. As many as the step has left owing, and only where the arena
   * has room for them. None is set down nearer the light than `keepOut`,
   * where the flame reaches: a tight dark may lie inside the flame's reach,
   * and a rat put there would only flinch straight back out. Each one moved
   * is marked in `moved`, so the page places it rather than sliding it.
   */
  private bringRound(light: Light, tuning: Tuning, dark: Dark, ux: number, uz: number, keepOut: number): void {
    const { count, x, z } = this
    const r2 = dark.radius * dark.radius
    const keepOut2 = keepOut * keepOut
    const edge = Math.max(dark.radius, keepOut)
    const walk = Math.atan2(uz, ux)
    const limit = this.arena - 1
    let i = this.roundFrom % count
    for (let seen = 0; seen < count && this.roundOwed >= 1; seen++, i = i + 1 === count ? 0 : i + 1) {
      const dx = x[i] - dark.x
      const dz = z[i] - dark.z
      if (dx * dx + dz * dz <= r2 || dx * ux + dz * uz >= 0) continue
      const angle = walk + (this.random() * 2 - 1) * ROUND_SPREAD
      const off = edge + this.random() * ROUND_DEPTH
      const nx = dark.x + Math.cos(angle) * off
      const nz = dark.z + Math.sin(angle) * off
      if (nx * nx + nz * nz > limit * limit) continue
      // Out of the flame's reach, wherever the dark is centred.
      if ((nx - light.x) * (nx - light.x) + (nz - light.z) * (nz - light.z) < keepOut2) continue
      x[i] = nx
      z[i] = nz
      this.moved[i] = 1
      // Running in for the light already, as it would be had it come all the way.
      const tx = light.x - nx
      const tz = light.z - nz
      const tl = Math.hypot(tx, tz) || 1
      const speed = this.speedOf(i, tuning)
      this.vx[i] = this.sx[i] = (tx / tl) * speed
      this.vz[i] = this.sz[i] = (tz / tl) * speed
      this.realSpeed[i] = speed
      this.heading[i] = Math.atan2(tz, tx)
      this.burn[i] = this.flinch[i] = 0
      this.side[i] = 0
      this.gait[i] = RUN
      this.gaitSince[i] = this.time
      this.roundOwed--
    }
    this.roundFrom = i
  }

  /** How far the flame reaches this step toward (dx, dz) from the light, as a share of the hard radius: read between the two nearest angles. */
  private reach(dx: number, dz: number): number {
    const flame = this.flame
    const fb = ((Math.atan2(dz, dx) + Math.PI) / TAU) * FLAME_BINS
    const b0 = fb < FLAME_BINS - 1 ? fb | 0 : FLAME_BINS - 1
    return flame[b0] + (flame[b0 + 1] - flame[b0]) * (fb - b0)
  }

  private spawn(i: number, radius: number, angle: number): void {
    this.x[i] = Math.cos(angle) * radius
    this.z[i] = Math.sin(angle) * radius
    this.heading[i] = this.random() * TAU
    this.places[i] = this.random()
    this.whim[i] = this.random() * TAU
    this.burn[i] = this.flinch[i] = 0
    this.timid[i] = this.random()
    this.tolerance[i] = TOLERANCE[0] + this.random() * (TOLERANCE[1] - TOLERANCE[0])
    this.vx[i] = this.vz[i] = this.sx[i] = this.sz[i] = this.realSpeed[i] = 0
    this.y[i] = this.pitch[i] = 0
    this.side[i] = 0
    this.gait[i] = IDLE
    this.gaitSince[i] = this.time
  }

  /** Sort the rats into cells of `cellSize` over the arena, a cell's margin round it, so a rat's neighbours are the nine cells about it. */
  private buildGrid(cellSize: number): void {
    const n = Math.ceil((2 * this.arena) / cellSize) + 3
    if (n !== this.gridN || cellSize !== this.cellSize) {
      this.gridN = n
      this.cellSize = cellSize
      this.cellStart = new Int32Array(n * n + 1)
      this.cursor = new Int32Array(n * n)
    }
    const { x: px, z: pz, cellOf, sorted, cellStart, cursor, count } = this
    cellStart.fill(0)
    const inv = 1 / cellSize
    const off = this.arena + cellSize
    const max = n - 1
    for (let i = 0; i < count; i++) {
      let cx = ((px[i] + off) * inv) | 0
      let cz = ((pz[i] + off) * inv) | 0
      cx = cx < 0 ? 0 : cx > max ? max : cx
      cz = cz < 0 ? 0 : cz > max ? max : cz
      const c = cz * n + cx
      cellOf[i] = c
      cellStart[c + 1]++
    }
    for (let c = 1; c <= n * n; c++) cellStart[c] += cellStart[c - 1]
    cursor.set(cellStart.subarray(0, n * n))
    for (let i = 0; i < count; i++) sorted[cursor[cellOf[i]]++] = i
  }
}
