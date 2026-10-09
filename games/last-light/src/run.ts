// The run (#173): the game's rules, pure and stepped by input, with no
// renderer, no DOM and no swarm of its own, so it is tested in Node. The
// page hands it a frame's input (where the keys send the holder, the interact
// key, and how many rats the swarm last found at the holder and at each
// light's edge) and hands the swarm what it gives back: the torch, and the
// level's lights as they stand.
//
// The torch is a clock. Its fuel burns at a steady rate; its reach holds
// full for most of the fuel and shrinks to nothing over the last part; at
// empty it goes out, and the swarm closes the front on the holder. Dipped
// into a flame, within touching distance of it, the torch is filled again; a
// light that is not a flame, a lit window, holds rats off but refuels
// nothing. With the torch out, enough rats at the holder catch the player,
// and the run starts again: the holder at the start, the torch full.
//
// The wind (#177): inside a wind zone the torch burns faster, and faster still
// while the wind gusts, which it does on a set timing, so a player can cross
// between gusts. A zone keeps its time from the holder first coming into it,
// calm first, so a fragile flame in the wind lasts until the player comes and
// can die as they arrive. A gust puts out every fragile flame in its zone, and enough
// rats at a fragile flame's edge overrun it and put it out too; an ordinary
// flame never dies. A fragile flame put out stays out, lighting nothing and
// refuelling nothing, until the run starts again.
//
// Nothing is drawn at random: the same inputs give the same run.
import { walkLight, type Bounds, type FixedLight } from './swarm'
import { Walls, type Wall } from './walls'

/**
 * A light the level places: where it stands, how far it reaches, m, whether
 * it is a flame the torch can be dipped into, and whether it is lit; and, a
 * flame, whether it is fragile: one the wind or the rats can put out.
 */
export interface PlacedLight {
  x: number
  z: number
  reach: number
  flame: boolean
  on: boolean
  fragile?: boolean
}

/** A wind zone: a box on the ground, m, where the torch burns faster and the wind gusts. */
export type WindZone = Bounds

/** The level, as data: where the holder starts, the lights, the walls, the wind zones, and the box the rats start in, everywhere in it that is dark. */
export interface Level {
  start: { x: number; z: number }
  lights: PlacedLight[]
  walls: Wall[]
  wind: WindZone[]
  bounds: Bounds
}

/**
 * How many rats at a fragile flame's edge overrun it, to start. Of two
 * thousand, a handful wait at the edge of a flame the holder is far from,
 * and up to fifty or so press on one the holder walks up to and stands at:
 * more than that, so at two thousand a gust is what puts it out, and a
 * thicker swarm overruns it.
 */
const OVERRUN = 70

/** What the run is tuned by. */
export interface RunTuning {
  /** The share of a full torch it burns a second. */
  burnRate: number
  /** The share of the fuel, the last of it, over which the torch's reach shrinks to nothing. */
  fade: number
  /** How far the torch reaches with the fuel above `fade`, m. */
  torchReach: number
  /** How close to a flame the torch is dipped into it, m from the flame. */
  dip: number
  /** How many rats at the holder catch the player once the torch is out. */
  catchCount: number
  /** The share of a full torch the wind burns a second on top, inside a wind zone. */
  windDrain: number
  /** The share of a full torch a gust burns a second on top of the wind's. */
  gustDrain: number
  /**
   * Seconds from the start of one gust to the next. A zone's time is cycles
   * this long from the holder first coming into it, each a calm and then a
   * gust: the first gust comes this less `gustLength` after the holder does.
   */
  gustEvery: number
  /** Seconds a gust blows: 0, and the wind never gusts; `gustEvery` or more, and it never stops. */
  gustLength: number
  /** How many rats at a fragile flame's edge overrun it and put it out. */
  overrun: number
}

/**
 * A full torch burns out in half a minute, its reach shrinking over the last
 * quarter: a few braziers' walk at a jog. The reach as the strength slider
 * left it, 0.26 of the swarm's 3 m. The wind burns it twice as fast, and a
 * gust, two and a half seconds in every eight, four times as fast. A start
 * to tune from the panel.
 */
export const defaultRunTuning = (): RunTuning => ({
  burnRate: 1 / 30,
  fade: 0.25,
  torchReach: 0.78,
  dip: 0.8,
  catchCount: 4,
  windDrain: 1 / 30,
  gustDrain: 2 / 30,
  gustEvery: 8,
  gustLength: 2.5,
  overrun: OVERRUN,
})

/** A frame of the player's input, and what the swarm last measured. */
export interface RunInput {
  /** The frame's time, s. */
  dt: number
  /** Where the keys send the holder, or nothing held. */
  toward: { x: number; z: number } | null
  /** How fast the holder walks, m/s. */
  speed: number
  /** The arena's radius, m: the holder stays a metre inside it. */
  arena: number
  /** The interact key held. Read by nothing yet: keys and levers take it. */
  interact: boolean
  /** Rats at the holder, as the swarm last counted them. */
  reached: number
  /** Rats at each of the level's lights' edge, in the level's order, as the swarm last counted them: none where missing. */
  atLights: readonly number[]
}

/** The torch as it stands: where the holder carries it, how far it reaches, m, and whether it burns. */
export interface Torch {
  x: number
  z: number
  reach: number
  lit: boolean
}

export class Run {
  /** Where the holder stands. */
  readonly holder: { x: number; z: number }
  /** The torch's fuel, 1 full to 0 empty. */
  fuel = 1
  /** How many times the player has been caught. */
  caught = 0
  /** The run's time, s. */
  time = 0
  /** The level's walls, which the holder walks along and never through. */
  private readonly walls: Walls
  /** Each of the level's lights put out, by the level's index: fragile flames the wind or the rats put out. */
  private readonly out: boolean[]
  /** When the holder first came into each wind zone, s of the run's time, by the level's index: NaN, not yet. */
  private readonly windSince: number[]

  constructor(
    /** The level: read live, so its lights' reach can be tuned as the run goes. */
    readonly level: Level,
    /** The tuning: read live, every step. */
    readonly tuning: RunTuning,
  ) {
    this.holder = { ...level.start }
    this.walls = new Walls(level.walls)
    this.out = level.lights.map(() => false)
    this.windSince = level.wind.map(() => Number.NaN)
  }

  /** The torch as it stands. */
  get torch(): Torch {
    const { fuel, tuning } = this
    const share = tuning.fade > 0 ? Math.min(1, fuel / tuning.fade) : fuel > 0 ? 1 : 0
    return { x: this.holder.x, z: this.holder.z, reach: tuning.torchReach * share, lit: fuel > 0 }
  }

  /** The level's lights as they stand, for the swarm: a fragile flame put out is not lit. */
  lights(): FixedLight[] {
    return this.level.lights.map(({ x, z, reach, on }, k) => ({ x, z, reach, on: on && !this.out[k] }))
  }

  /** Whether the wind gusts now in wind zone `zone`: on the tuning's timing, from the holder first coming into it; never before. */
  gusting(zone: number): boolean {
    const { gustEvery, gustLength } = this.tuning
    const since = this.windSince[zone]
    if (since === undefined || Number.isNaN(since) || !(gustLength > 0) || !(gustEvery > 0)) return false
    return (this.time - since) % gustEvery >= gustEvery - gustLength
  }

  /** The wind zone the holder stands in, or -1. */
  get inWind(): number {
    return this.level.wind.findIndex((zone) => inside(zone, this.holder.x, this.holder.z))
  }

  /**
   * One step of the run: the holder walks, along any wall it meets, the torch
   * burns, faster in the wind, the gusts and the rats put fragile flames out,
   * a flame refuels the torch, and the rats at a holder with no light catch
   * the player.
   */
  step(input: RunInput): void {
    const { holder, tuning } = this
    // Caught on what the swarm saw last: at the holder, with the torch already out.
    if (this.fuel <= 0 && input.reached >= tuning.catchCount) {
      this.restart()
      return
    }
    this.time += input.dt
    if (input.toward !== null) walkLight(input.arena, holder, input.toward, input.dt, input.speed, this.walls)
    // Every zone the holder stands in keeps time from now on, if it was not already; the wind burns once, however many overlap.
    const { lights, wind } = this.level
    let windy = false
    let gust = false
    wind.forEach((zone, w) => {
      if (!inside(zone, holder.x, holder.z)) return
      if (Number.isNaN(this.windSince[w])) this.windSince[w] = this.time
      windy = true
      gust ||= this.gusting(w)
    })
    const burn = tuning.burnRate + (windy ? tuning.windDrain + (gust ? tuning.gustDrain : 0) : 0)
    this.fuel = Math.max(0, this.fuel - burn * input.dt)
    lights.forEach((light, k) => {
      if (!light.fragile || !light.flame || !light.on || this.out[k]) return
      const gust = wind.some((zone, w) => this.gusting(w) && inside(zone, light.x, light.z))
      if (gust || (input.atLights[k] ?? 0) >= tuning.overrun) this.out[k] = true
    })
    lights.forEach((light, k) => {
      if (!light.flame || !light.on || this.out[k]) return
      if (Math.hypot(holder.x - light.x, holder.z - light.z) <= tuning.dip) this.fuel = 1
    })
  }

  /** Caught: the run starts again, the holder at the start with a full torch, every fragile flame lit again, and the wind waiting for the holder. */
  private restart(): void {
    this.caught++
    this.holder.x = this.level.start.x
    this.holder.z = this.level.start.z
    this.fuel = 1
    this.out.fill(false)
    this.windSince.fill(Number.NaN)
  }
}

/** Whether (x, z) is inside the box. */
const inside = (box: Bounds, x: number, z: number) => x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ
