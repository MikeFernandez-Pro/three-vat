// The goose play (#187): the goose game, one frame at a time, headless, as the
// 3D page drives it at `#goose`. The page builds one, hands it its swarm,
// feeds it the keys and draws what it reports: the goose, her torch, the
// braziers, the goslings waiting, in her circle or taken, the pond, and the
// count. Nothing here draws.
//
// The plain (plain.ts) is the seed's: a route of braziers heading north to the
// pond. The run (run.ts) walks the goose, burns her torch, its flame shrinking
// over the last of its fuel, and fills it again at a brazier dipped into; the
// swarm (swarm.ts) runs the rats, which start everywhere on the plain, and
// those left behind out of her sight are brought round ahead of her. The
// rest is the goose play's own:
//
// - Each brazier has a gosling waiting in its light, which joins her circle as
//   she walks into that light. A gosling walks by itself, on its own legs, at
//   its own top pace, a little over her walk: it comes over to her, then
//   follows its place in an arc close round her back and sides, a moment behind it and
//   swaying a little, each its own way. Nothing moves it but its own steps:
//   walking, she keeps them in her light; running, she leaves them behind.
// - A debug key, a number, gives her that many goslings at once.
// - With the torch out, a grace runs, then the dark takes the gosling of the
//   circle furthest behind her, and another every interval after, until she
//   dips the torch in a flame. The play reports each taking: which gosling,
//   where and when. A gosling taken is gone for good.
// - She is never caught: the run is handed no rats at her, so it never starts
//   again, and there are no checkpoints.
// - The pond is water no rat enters: the swarm holds rats off its shore as off
//   a light (`water`), the shore the page draws once it hands its own over.
//   Wading in ends the run: the goslings of her circle swim out on the water,
//   the count is how many came home, and nothing else moves after but the rats.
//
// Nothing is drawn at random: the same seed and the same inputs give the same run.
import { LIGHT_SPEED, NOTICE, RESTART_ROOM, gameTuning } from './gameplay'
import { SteppedSwarm, type PlayDrive, type PlaySwarm } from './play'
import { WADE, plain, type Plain, type Point } from './plain'
import { defaultRunTuning, Run, type Level } from './run'
import { shoreLight, type Dark, type FixedLight, type Ground, type Light, type StepReport, type Tuning } from './swarm'

/** A frame of the player's input. */
export interface GooseInput {
  /** Where the keys send her, a unit direction, or nothing held. */
  heading: Point | null
}

/** The play's knobs: the panel's. */
export interface GooseSettings {
  /** The rats' budget, read at the start. */
  rats: number
  /** How long the torch is out before the dark takes the first gosling, s; and how long between each next, s. Read live. */
  grace: number
  interval: number
  /** How fast she walks, m/s. Read live; the plain is laid for the pace it starts at. */
  pace: number
  /** The plain's seed, read at the start. */
  seed: number
  /** How far she sees round her, m: rats left behind further are brought round ahead, on a swarm the play steps itself. */
  sight: number
}

/** Where a gosling is in the run: waiting at its brazier, in her circle, or taken. */
export type GoslingState = 'waiting' | 'circle' | 'taken'

/** A gosling: where it is, and where it is in the run. */
export interface Gosling extends Point {
  state: GoslingState
  /** When it joined the circle, and when it was taken, s of the play: NaN, not yet. */
  gatheredAt: number
  takenAt: number
}

/** A gosling taken by the dark: which, where, and when, s of the play. */
export interface Taking extends Point {
  gosling: number
  at: number
}

/** The torch: burns out in 25 s, its reach shrinking over the last third of it, from 1.86 m, the light at 0.62 of its strength as on `#lod`, to a metre before it goes out. */
export const gooseRunTuning = () => ({ ...defaultRunTuning(), burnRate: 1 / 25, fade: 0.3, torchReach: 1.86, torchLeast: 1 })

const SEED = 1
/**
 * Her circle's places, in arcs round her back, close behind her: the first arc
 * CLOSE m out, or her torch's reach less RING_MARGIN where that is closer, and
 * never closer than HUDDLE, as in the dark: a shrinking flame draws the places
 * in. Along an arc the places stand PLACE m apart, centred behind her, the arc
 * no wider round her than BEHIND radians, a little over a half circle, so the
 * ends come just ahead of her sides; those that do not fit take the next arc,
 * ROW m further out.
 */
const CLOSE = 0.42
const RING_MARGIN = 0.6
const HUDDLE = 0.36
const PLACE = 0.32
const BEHIND = Math.PI * 1.15
const ROW = 0.3
/** How long the arcs take to turn after the way she faces, s. */
const RING_TURN = 0.6
/** How far each gosling's place sways, m, and how fast, radians a second at the least: each at a pace of its own. */
const SWAY = 0.1
const SWAY_RATE = 1.3
/**
 * A gosling walks by itself, on its own legs: its top pace, m/s, each its own
 * between the two, a little over her walk, so it keeps up with her walking and
 * falls behind her running; how fast it gathers pace or slows, m/s a second;
 * and how far from where it is going it starts to slow, m, each its own
 * between the two, so it trails a moment behind its place as she walks.
 */
export const GOSLING_TOP = [2.6, 3]
const GOSLING_ACCEL = 9
const ARRIVE = [0.35, 0.6]
/** How close a gosling lets a sibling come, and her, m, before it steps away. */
const SPACE = 0.28
const HER_SPACE = 0.32
/**
 * With her standing, a gosling comes to rest within REST m of its place, under
 * RESTING m/s, and stays at rest, idling as she does, until its place is GO m
 * off: she walks on. Her own pace under STILL m/s is standing; and the sway of
 * the places fades in and out over SWAY_FADE s as she walks and stops.
 */
const REST = 0.12
const RESTING = 0.3
const GO = 0.3
const STILL = 0.05
const SWAY_FADE = 0.3
/** Out on the water at the end: how far ahead of her the goslings float, m, every other one this much further, m; and how far apart, radians. */
const FLOAT = 1.6
const FLOAT_STAGGER = 0.4
const FLOAT_SPREAD = 0.45

export class GoosePlay<S extends PlaySwarm = SteppedSwarm> {
  readonly settings: GooseSettings
  readonly runTuning = gooseRunTuning()
  readonly plain: Plain
  /** The plain as the run reads it: the braziers its flames, no walls. */
  readonly level: Level
  readonly tuning: Tuning
  readonly swarm: S
  readonly run: Run
  /** The play's time, s. */
  t = 0
  /** The goslings, one to a brazier, in the route's order. */
  readonly goslings: Gosling[]
  /** Every gosling the dark took, in the order taken. */
  readonly takings: Taking[] = []
  /** Whether she has waded into the pond; and how many goslings came home with her. */
  ended = false
  cameHome = 0
  report: StepReport | undefined
  /**
   * The pond as the swarm holds rats off it, after the flames: a round one at
   * the plain's pond, until the page hands over the shore it draws (`setWater`).
   */
  water: FixedLight
  /** The torch as the swarm reads it, where she carries it. */
  readonly torchLight: Light = { x: 0, z: 0, strength: 0, on: false }
  /** When the torch went out, and when the dark takes the next gosling, s of the play: NaN while it burns. */
  private darkSince = Number.NaN
  private nextTake = Number.NaN
  /** Where each gosling of her circle swims out to on the pond, once home. */
  private readonly floatAt: Point[]
  /** Which goslings are at rest, idling at their places while she stands. */
  private readonly resting: boolean[]
  /** Where she stood last frame, and how far the places sway, 0 standing to 1 walking. */
  private readonly stoodAt = { x: Number.NaN, z: Number.NaN }
  private swaying = 0
  /** Which way the ring of places is turned, radians from +x: easing after the way she faces. */
  private ringYaw = Math.PI / 2
  /** How fast each gosling goes, m/s, on its spring. */
  private readonly vx: number[]
  private readonly vz: number[]

  constructor(settings: Partial<GooseSettings> = {}, drive: PlayDrive<S> = {}) {
    this.settings = { rats: 2000, grace: 3, interval: 4, pace: LIGHT_SPEED, seed: SEED, sight: 7, ...settings }
    this.plain = plain(this.settings.seed, { burnRate: this.runTuning.burnRate, pace: this.settings.pace })
    const { start, braziers, bounds } = this.plain
    this.level = {
      start: { ...start },
      lights: braziers.map(({ x, z, reach }) => ({ x, z, reach, flame: true, on: true })),
      walls: [],
      wind: [],
      gates: [],
      keys: [],
      levers: [],
      bounds,
    }
    this.run = new Run(this.level, this.runTuning)
    this.tuning = drive.tuning ?? Object.assign(gameTuning(), { notice: NOTICE })
    const { pond } = this.plain
    this.water = shoreLight(pond.x, pond.z, () => pond.radius)
    const ground: Ground = { walls: [], bounds, lights: this.startLights() }
    this.swarm = drive.swarm?.(ground) ?? (new SteppedSwarm(16384, this.settings.seed, 1, ground) as unknown as S)
    this.swarm.reset(this.settings.rats)
    this.goslings = braziers.map(({ gosling }) => ({ ...gosling, state: 'waiting', gatheredAt: Number.NaN, takenAt: Number.NaN }))
    this.floatAt = braziers.map(({ gosling }) => ({ ...gosling }))
    this.resting = braziers.map(() => false)
    this.vx = braziers.map(() => 0)
    this.vz = braziers.map(() => 0)
  }

  /** The lights the swarm holds rats off: the braziers', then the pond's. */
  lights(): FixedLight[] {
    return [...this.run.lights(), this.water]
  }

  /** The rats start everywhere on the plain but the braziers' light, the pond and her own light, with room to breathe. */
  private startLights(): FixedLight[] {
    return [...this.lights(), { ...this.plain.start, reach: this.runTuning.torchReach + RESTART_ROOM, on: true }]
  }

  /** The pond as the page draws it, its shore the swarm's to hold rats off: before the play starts, every rat set down out of it. */
  setWater(water: FixedLight): void {
    this.water = water
    if (this.t === 0) this.swarm.restart(this.startLights())
  }

  /** The goose. */
  get holder(): Point {
    return this.run.holder
  }

  /** The way she faces. */
  get facing(): Point {
    return this.run.facing
  }

  /** The light left in the torch, s at the rate it burns. */
  get left(): number {
    return this.run.fuel / this.run.burnRate
  }

  /** How many goslings are in her circle. */
  get circle(): number {
    return this.goslings.filter((g) => g.state === 'circle').length
  }

  /**
   * A debug key's: her circle made the first `n` goslings, in the route's
   * order, each come in at its place behind her, a taken one given back; the
   * rest back waiting at their braziers. Nothing, once she is home.
   */
  giveGoslings(n: number): void {
    if (this.ended) return
    const braziers = this.plain.braziers
    const came: number[] = []
    this.goslings.forEach((g, k) => {
      const was = g.state
      g.takenAt = Number.NaN
      this.vx[k] = this.vz[k] = 0
      this.resting[k] = false
      if (k < n) {
        g.state = 'circle'
        if (was !== 'circle') {
          g.gatheredAt = this.t
          came.push(k)
        }
      } else {
        g.state = 'waiting'
        g.gatheredAt = Number.NaN
        g.x = braziers[k]!.gosling.x
        g.z = braziers[k]!.gosling.z
      }
    })
    const places = this.places()
    const circle = this.goslings.flatMap((g, k) => (g.state === 'circle' ? [k] : []))
    for (const k of came) Object.assign(this.goslings[k]!, places[circle.indexOf(k)]!)
  }

  /** One frame of the play: her walk and the run, the goslings gathered, placed and taken, the pond, and the swarm moved on. */
  frame(dt: number, input: GooseInput): void {
    const { run, settings } = this
    this.t += dt
    if (!this.ended) {
      const way = input.heading
      const holder = run.holder
      const toward = way === null ? null : { x: holder.x + way.x, z: holder.z + way.z }
      // No rats are ever at her, as the run counts them: she is never caught.
      run.step({ dt, toward, speed: settings.pace, arena: this.swarm.arena, interact: false, reached: 0 })
      this.gather()
      this.toll()
      const { pond } = this.plain
      if (Math.hypot(holder.x - pond.x, holder.z - pond.z) <= pond.radius - WADE) this.end()
    }
    this.walkGoslings(dt)
    const torch = run.torch
    const light = this.torchLight
    light.x = torch.x
    light.z = torch.z
    light.strength = torch.reach / this.tuning.ringMax
    light.on = torch.lit
    const dark: Dark = { x: run.holder.x, z: run.holder.z, radius: settings.sight }
    this.report = this.swarm.advance(dt, light, this.tuning, this.lights(), dark)
  }

  /** The goslings waiting in the light of a brazier she has walked into join her circle. */
  private gather(): void {
    const { holder } = this.run
    this.plain.braziers.forEach((b, k) => {
      const g = this.goslings[k]!
      if (g.state !== 'waiting' || Math.hypot(holder.x - b.x, holder.z - b.z) > b.reach) return
      g.state = 'circle'
      g.gatheredAt = this.t
    })
  }

  /** The dark's toll: with the torch out, after the grace, the gosling furthest behind her, then one every interval, until it burns again. */
  private toll(): void {
    if (this.run.torch.lit) {
      this.darkSince = this.nextTake = Number.NaN
      return
    }
    if (Number.isNaN(this.darkSince)) {
      this.darkSince = this.t
      this.nextTake = this.t + this.settings.grace
    }
    const { holder, facing } = this.run
    while (this.t >= this.nextTake - 1e-9) {
      this.nextTake += Math.max(this.settings.interval, 0.1)
      let taken = -1
      let back = Infinity
      this.goslings.forEach((g, k) => {
        const along = (g.x - holder.x) * facing.x + (g.z - holder.z) * facing.z
        if (g.state === 'circle' && along < back) {
          back = along
          taken = k
        }
      })
      if (taken < 0) continue
      const g = this.goslings[taken]!
      g.state = 'taken'
      g.takenAt = this.t
      this.takings.push({ gosling: taken, x: g.x, z: g.z, at: this.t })
    }
  }

  /**
   * Where each gosling of her circle, in its order, is to stand: in the arcs
   * round her back, turned after the way she faces, each place swaying a
   * little while she walks.
   */
  private places(): Point[] {
    const { holder } = this.run
    const circle = this.goslings.flatMap((g, k) => (g.state === 'circle' ? [k] : []))
    const first = Math.max(HUDDLE, Math.min(CLOSE, this.run.torch.reach - RING_MARGIN))
    const places: Point[] = []
    for (let row = 0, from = 0; from < circle.length; row++) {
      const radius = first + row * ROW
      const step = PLACE / radius
      const fits = Math.floor(BEHIND / step + 1e-9) + 1
      const here = circle.slice(from, from + fits)
      here.forEach((k, i) => {
        // Each its own sway, from its index: a golden-ratio spread, the same every run.
        const own = (k * 0.618034) % 1
        const sway = SWAY * this.swaying * Math.sin(this.t * SWAY_RATE * (1 + own) + k * 2.4)
        const a = this.ringYaw + Math.PI + (i - (here.length - 1) / 2) * step + sway / radius
        places.push({ x: holder.x + Math.cos(a) * (radius + sway), z: holder.z + Math.sin(a) * (radius + sway) })
      })
      from += fits
    }
    return places
  }

  /**
   * The goslings of her circle walk, each by itself: for its place in the
   * arcs close round her back (`places`), the arcs turning after the way she
   * faces, each place swaying a little; once home, for
   * its place out on the water. Each goes at its own top pace at most,
   * gathering pace and slowing as its legs allow, slowing as it nears where it
   * is going, so it trails a moment behind as she walks, and stepping away
   * from a sibling or her that comes too close. Nothing else moves it.
   */
  private walkGoslings(dt: number): void {
    if (dt <= 0) return
    const { holder, facing } = this.run
    const way = Math.atan2(facing.z, facing.x)
    const turn = Math.atan2(Math.sin(way - this.ringYaw), Math.cos(way - this.ringYaw))
    if (!this.ended) this.ringYaw += turn * (1 - Math.exp(-dt / RING_TURN))
    // Whether she walks: the places sway only while she does, and only then do the goslings at rest set off.
    const { stoodAt } = this
    const walking = !Number.isNaN(stoodAt.x) && Math.hypot(holder.x - stoodAt.x, holder.z - stoodAt.z) / dt > STILL
    stoodAt.x = holder.x
    stoodAt.z = holder.z
    this.swaying += ((walking ? 1 : 0) - this.swaying) * (1 - Math.exp(-dt / SWAY_FADE))
    const circle = this.goslings.flatMap((g, k) => (g.state === 'circle' ? [k] : []))
    const places = this.ended ? [] : this.places()
    const { vx, vz, resting } = this
    circle.forEach((k, place) => {
      const g = this.goslings[k]!
      // Each its own legs, from its index: a golden-ratio spread, the same every run.
      const own = (k * 0.618034) % 1
      const { x: tx, z: tz } = this.ended ? this.floatAt[k]! : places[place]!
      const top = GOSLING_TOP[0]! + (GOSLING_TOP[1]! - GOSLING_TOP[0]!) * own
      const arrive = ARRIVE[0]! + (ARRIVE[1]! - ARRIVE[0]!) * (1 - own)
      const ox = tx - g.x
      const oz = tz - g.z
      const d = Math.hypot(ox, oz)
      // At rest it stays so, wanting no pace, until its place has gone off; come to its place with her standing, it rests.
      if (resting[k] && d > GO) resting[k] = false
      else if (!resting[k] && !walking && d < REST && Math.hypot(vx[k]!, vz[k]!) < RESTING) resting[k] = true
      const wanted = d > 1e-6 && !resting[k] ? (top * Math.min(1, d / arrive)) / d : 0
      let wx = ox * wanted
      let wz = oz * wanted
      // Room: away from a sibling, or her, too close, the closer the harder.
      const away = (x: number, z: number, room: number) => {
        const ax = g.x - x
        const az = g.z - z
        const r = Math.hypot(ax, az)
        if (r >= room || r < 1e-6) return
        const push = (top * (room - r)) / room / r
        wx += ax * push
        wz += az * push
      }
      if (!resting[k]) {
        for (const j of circle) if (j !== k) away(this.goslings[j]!.x, this.goslings[j]!.z, SPACE)
        if (!this.ended) away(holder.x, holder.z, HER_SPACE)
      }
      const w = Math.hypot(wx, wz)
      if (w > top) {
        wx *= top / w
        wz *= top / w
      }
      // Its legs: the pace it wants, gathered or shed no faster than they allow.
      let dvx = wx - vx[k]!
      let dvz = wz - vz[k]!
      const dv = Math.hypot(dvx, dvz)
      const most = GOSLING_ACCEL * dt
      if (dv > most) {
        dvx *= most / dv
        dvz *= most / dv
      }
      vx[k]! += dvx
      vz[k]! += dvz
      g.x += vx[k]! * dt
      g.z += vz[k]! * dt
    })
  }

  /** Home: the count, and where on the water ahead of her the goslings of her circle swim out to. */
  private end(): void {
    this.ended = true
    this.cameHome = this.circle
    const { holder } = this.run
    const { pond } = this.plain
    const out = Math.atan2(pond.z - holder.z, pond.x - holder.x)
    const circle = this.goslings.filter((g) => g.state === 'circle')
    circle.forEach((g, k) => {
      const a = out + (k - (circle.length - 1) / 2) * FLOAT_SPREAD
      const r = FLOAT + (k % 2) * FLOAT_STAGGER
      const at = this.floatAt[this.goslings.indexOf(g)]!
      at.x = holder.x + Math.cos(a) * r
      at.z = holder.z + Math.sin(a) * r
    })
  }
}
