// The run (#173): the game's rules, pure and stepped by input, with no
// renderer, no DOM and no swarm of its own, so it is tested in Node. The
// page hands it a frame's input (where the keys send the holder, the interact
// key, and how many rats the swarm last found at the holder) and hands the
// swarm what it gives back: the torch, the level's lights as they stand, and
// its walls as they stand, every shut gate among them.
//
// The torch is a clock. Its fuel burns at a steady rate; its reach holds
// full for most of the fuel and shrinks to nothing over the last part; at
// empty it goes out, and the swarm closes the front on the holder. Dipped
// into a flame, within touching distance of it, the torch is filled again; a
// light that is not a flame, a lit window or door, holds rats off but refuels
// nothing. With the torch out, enough rats at the holder catch the player.
//
// The wind and fragile flames (#177) are scripted: the level writes when each
// thing happens, and nothing is counted or drawn at random. Inside a wind zone
// the torch burns faster, and faster still while the wind gusts. A zone is set
// off by the holder first walking into its trigger, the zone itself if it has
// none, and its gusts then come as its script lists them, each so many seconds
// after, so a player can learn them and cross between them. A gust puts out
// every fragile flame in its zone. A fragile flame with a trigger goes out its
// set time after the holder first walks into it; an ordinary flame never dies.
// A fragile flame put out stays out, lighting nothing and refuelling nothing,
// until the run starts again from before it went out.
//
// The way on (#176): a gate is a wall while shut. It opens to its key, picked
// up off the ground with the interact key, standing on it, once the holder
// carrying it reaches the gate; or to a lever held with the interact key for
// its set time, letting go early doing nothing. Going on through a gate passes
// its checkpoint, and a gate marked to shut behind the holder shuts once the
// holder is clear of it. Caught, the run starts again at the last checkpoint
// passed, or the start: the holder there with a full torch, the level as it
// stood when the checkpoint was passed, its fragile flames as they were, and
// every wind zone and fragile flame's trigger waiting for the holder again. Reaching the exit wins the run, and
// nothing moves after it.
//
// Crawl zones and checkpoint zones (#182): a crawl zone is a place passed
// only crawling, under a fallen trunk or a tangle of branches. What hangs low
// there stops the holder standing; crawling, the holder goes on at the
// crawl's pace, and under it crawls whatever the keys say, standing up again
// once out from under it: C, the toggle, is switched off as the holder comes
// out. A zone may come down partway through the run: a trunk falls. A
// checkpoint zone is a place where walking in keeps the level as it stands
// for a restart there, as going through a gate does; one lying before a gate
// is passed no more once that gate has been.
//
// The cart, the rain and no-catch zones (#183). A cart is a light that rolls:
// the holder walking into its back pushes it on along its track, at its own
// pace, never back, until it jams at the track's end; its body stops the
// holder, never the rats or the light, and its brazier burns where it now is.
// Jammed, it is a checkpoint: the run starts again at its side. The rain
// starts as the level says, the cart jamming or the holder walking into its
// trigger, and stops as he walks into its end: while it rains the torch is put
// out, and no flame lights it. A no-catch zone is a place out of the rats'
// reach, high on a fallen pine: no catch counts there, and the holder goes
// slowly. Every checkpoint keeps the cart where it stood and the rain as it
// was, as it keeps the lights.
//
// Burn-rate zones, gutter places and dark runs (#184): inside a burn-rate zone
// the torch burns at the zone's own rate, the wind on top of it, a damp stick
// burning short and dimming as fast. Walking into a gutter place puts the
// torch out whatever its fuel, so the dark starts at the same place for every
// pace. The torch going out inside a dark run sets the holder running by
// himself: he runs on the way he faces with no key held, the keys steering
// him, at his own pace, until he is caught or the torch catches again. Running
// so, the rats at him catch him only once they have held on for the grip, a
// moment with fewer at him starting it again: while he keeps going they snap
// at his heels, and if he stops, or crawls, they pile on.
//
// Nothing is drawn at random: the same inputs give the same run.
import { walkLight, type Bounds, type FixedLight } from './swarm'
import { HOLDER_RADIUS, WALL_THICKNESS, Walls, distanceTo, within, type Wall } from './walls'

/**
 * A light the level places: where it stands, how far it reaches, m, whether
 * it is a flame the torch can be dipped into, and whether it is lit; and, a
 * flame, whether it is fragile, and its script: one a gust or its trigger
 * puts out.
 */
export interface PlacedLight {
  x: number
  z: number
  reach: number
  flame: boolean
  on: boolean
  fragile?: Fragile
}

/** A fragile flame's script: set off by the holder first walking into `trigger`, it goes out `after` seconds later, none at once. With no trigger, only a gust puts it out. */
export interface Fragile {
  trigger?: Bounds
  after?: number
}

/** A gust in a wind zone's script: when it comes, s after the zone is set off, and how long it blows, s. */
export interface Gust {
  at: number
  length: number
}

/**
 * A wind zone: a box on the ground, m, where the torch burns faster; set off
 * by the holder first walking into `trigger`, the zone itself if none, its
 * `gusts` then blowing when its script says.
 */
export interface WindZone extends Bounds {
  trigger?: Bounds
  gusts: Gust[]
}

/** A gate: a wall, from one point to another, while shut; where its checkpoint stands, beyond it; and whether it shuts behind the holder once passed. */
export interface Gate extends Wall {
  checkpoint: { x: number; z: number }
  shutsBehind?: boolean
}

/** A key lying on the ground, and the gate, by its index, it opens. */
export interface Key {
  x: number
  z: number
  gate: number
}

/** A lever: where it stands, the gate it opens, by its index, and how long it is held to open it, s. */
export interface Lever {
  x: number
  z: number
  gate: number
  hold: number
}

/** The exit: the lit house door, and how near it, m, the holder has reached it. */
export interface Exit {
  x: number
  z: number
  radius: number
}

/**
 * A crawl zone: `walls`, what hangs low there, stop the holder standing, and
 * within UNDER of them, or inside `area`, the holder is under it and crawls.
 * It is there while `on`, read live: a trunk not yet fallen is not.
 */
export interface CrawlZone {
  walls: Wall[]
  area?: { x: number; z: number }[]
  on?: boolean
}

/** A burn-rate zone: a box on the ground, m, where the torch burns `rate` of a full torch a second, in place of the tuning's. */
export interface BurnZone extends Bounds {
  rate: number
}

/** A checkpoint zone: walked into, the level as it stands is kept for a restart at `at`; lying before gate `before`, it is passed no more once that gate has been. */
export interface CheckpointZone extends Bounds {
  at: { x: number; z: number }
  before?: number
}

/** A point on the ground. */
interface Point {
  x: number
  z: number
}

/**
 * A cart: where its back's middle stands at the start, and where it stands
 * jammed, the straight way between its track; its half-width and length, m;
 * how fast it is pushed, m/s; its brazier, by the level's index, which burns
 * `across` m to the right of the way on from its back's middle and `along` m
 * ahead of it; and where the run starts again once it has jammed.
 */
export interface Cart {
  from: Point
  jam: Point
  half: number
  length: number
  speed: number
  light: number
  across: number
  along: number
  checkpoint: Point
}

/** The rain: it starts as the cart jams, or as the holder walks into a box, and stops for good as he walks into `stops`. */
export interface Rain {
  starts: 'jammed' | Bounds
  stops: Bounds
}

/** A place out of the rats' reach, inside an outline: no catch counts there, and the holder walks it at `speed`, m/s, at most. */
export interface NoCatchZone {
  area: Point[]
  speed: number
}

/** The rain as it stands: not yet started, falling, or stopped for good. */
export type Weather = 'dry' | 'raining' | 'over'

/**
 * The level, as data: where the holder starts, the lights, the walls, the
 * wind zones, the gates in the order the way on passes them, the keys and
 * levers that open them, the exit, the box the rats start in, everywhere in
 * it that is dark; the places passed only crawling, the checkpoint zones,
 * the cart, the rain and the places no catch counts; and where the torch
 * burns at a rate of its own, where it gutters out, and where it going out
 * sets the holder running.
 */
export interface Level {
  start: { x: number; z: number }
  lights: PlacedLight[]
  walls: Wall[]
  wind: WindZone[]
  gates: Gate[]
  keys: Key[]
  levers: Lever[]
  exit?: Exit
  bounds: Bounds
  crawls?: CrawlZone[]
  checkpoints?: CheckpointZone[]
  cart?: Cart
  rain?: Rain
  noCatch?: NoCatchZone[]
  burns?: BurnZone[]
  gutters?: Bounds[]
  darkRuns?: Bounds[]
}

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
  /** How close to a key the holder stands on it, m. */
  keyReach: number
  /** How close to its gate, m from the gate's line, the holder carrying its key reaches it. */
  gateReach: number
  /** How close to a lever the holder stands at it, m. */
  leverReach: number
  /** How fast the holder crawls, m/s. */
  crawlSpeed: number
  /** How long rats at the holder running in a dark run hold on before they catch the player, s. */
  grip: number
}

/**
 * A full torch burns out in half a minute, its reach shrinking over the last
 * quarter: a few braziers' walk at a jog. The reach as the strength slider
 * left it, 0.26 of the swarm's 3 m. The wind burns it twice as fast, and a
 * gust four times as fast. A start to tune from the panel.
 */
export const defaultRunTuning = (): RunTuning => ({
  burnRate: 1 / 30,
  fade: 0.25,
  torchReach: 0.78,
  dip: 0.8,
  catchCount: 4,
  windDrain: 1 / 30,
  gustDrain: 2 / 30,
  keyReach: 0.6,
  gateReach: 1.2,
  leverReach: 0.8,
  crawlSpeed: 1.5,
  grip: 2,
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
  /** The interact key held: picks a key up, and works a lever. */
  interact: boolean
  /** Rats at the holder, as the swarm last counted them. */
  reached: number
  /** Crawling switched on or off since the last step: C. */
  toggleCrawl?: boolean
  /** Crawling while held: left Ctrl. */
  crawlHeld?: boolean
}

/** The torch as it stands: where the holder carries it, how far it reaches, m, and whether it burns. */
export interface Torch {
  x: number
  z: number
  reach: number
  lit: boolean
}

/**
 * The way on as it stands: each key carried, each gate open and passed, each
 * lever pulled, each checkpoint zone walked into; each of the level's lights
 * put out, fragile flames a gust or their trigger put out; how far the cart
 * has rolled along its track, m; and the rain.
 */
interface WayOn {
  carrying: boolean[]
  open: boolean[]
  passed: boolean[]
  pulled: boolean[]
  reached: boolean[]
  out: boolean[]
  rolled: number
  weather: Weather
}

/** How far off a gate's line the holder is clear of it, m: its body's half-width and the gate's, and a little. */
const CLEAR = WALL_THICKNESS / 2 + HOLDER_RADIUS + 0.1
/**
 * How far off what hangs low in a crawl zone the holder is under it, m, past
 * the wall's half-thickness: short of where it stops him standing, so he is
 * never put under it without crawling in.
 */
const UNDER = 0.2
/** How far off the cart's back the holder still pushes it, m: past where its body keeps him. */
const CART_TOUCH = WALL_THICKNESS / 2 + HOLDER_RADIUS + 0.08

export class Run {
  /** Where the holder stands. */
  readonly holder: { x: number; z: number }
  /** The torch's fuel, 1 full to 0 empty. */
  fuel = 1
  /** How many times the player has been caught. */
  caught = 0
  /** The run's time, s. */
  time = 0
  /** How many times the run has started again, caught or set down at a checkpoint: the rats are placed again each time. */
  starts = 0
  /** The last checkpoint passed, by its gate's index; -1, none, the start. */
  checkpoint = -1
  /** The checkpoint zone walked into since, by its index; -1, none: the run starts again at the gate's checkpoint, or the start. */
  zone = -1
  /** Whether the holder crawled this step: C has it on, left Ctrl is held, or he is under a crawl zone; and whether he was under one. */
  crawling = false
  under = false
  /** Whether the holder pushed the cart this step. */
  pushing = false
  /** Whether the holder runs by himself: the torch went out in a dark run. */
  panicking = false
  /** The way the holder faces: the way he last walked, a unit direction, north at first. */
  readonly facing = { x: 0, z: -1 }
  /** Whether the holder has reached the exit. */
  won = false
  /** Counts up each time a gate opens or shuts: the walls the swarm and the lit areas read have changed. */
  wallsVersion = 0
  /** How long each lever has been held, s, while it is held. */
  readonly holding: number[]
  /** The level's pieces as they stand, and as they stood when the last checkpoint was passed; and where the run starts again. */
  private now: WayOn
  private atCheckpoint: WayOn
  private resume: Point
  /** The level's walls, its shut gates and what stops the holder alone, which the holder walks along and never through; and, standing, those and every crawl zone's. */
  private standingWalls!: Walls
  private uprightWalls!: Walls
  private holderOnly: Wall[] = []
  /** Which crawl zones were there when the walls were last put together. */
  private crawlsThere = ''
  /** Whether C has crawling on, and whether the holder was under a crawl zone last step. */
  private crawlOn = false
  private wasUnder = false
  /** What hangs low in each crawl zone, as bodies read walls. */
  private readonly low = new Map<CrawlZone, Walls>()
  /** How long enough rats to catch the player have held on to the running holder without a break, s. */
  private gripped = 0
  /** When the holder set off each wind zone, and each light's trigger, s of the run's time, by the level's index: NaN, not yet. */
  private readonly windSince: number[]
  private readonly flameSince: number[]

  constructor(
    /** The level: read live, so its lights' reach can be tuned as the run goes. */
    readonly level: Level,
    /** The tuning: read live, every step. */
    readonly tuning: RunTuning,
  ) {
    this.holder = { ...level.start }
    this.holding = level.levers.map(() => 0)
    this.windSince = level.wind.map(() => Number.NaN)
    this.flameSince = level.lights.map(() => Number.NaN)
    this.now = this.fresh()
    this.atCheckpoint = copy(this.now)
    this.resume = { ...level.start }
    this.wallsChanged()
  }

  /** Each checkpoint zone, walked into or not, in the level's order. */
  get zones(): readonly boolean[] {
    return this.now.reached
  }

  /** What stops the holder alone, past the level's walls and its shut gates: low growth, a cart. Never the rats or the light. */
  setHolderWalls(walls: readonly Wall[]): void {
    this.holderOnly = [...walls]
    this.wallsChanged()
  }

  /** Each key, carried or not, in the level's order. */
  get carrying(): readonly boolean[] {
    return this.now.carrying
  }

  /** Each gate, open or not, in the level's order. */
  get open(): readonly boolean[] {
    return this.now.open
  }

  /** Each lever, pulled or not, in the level's order. */
  get pulled(): readonly boolean[] {
    return this.now.pulled
  }

  /** Each gate, passed or not, in the level's order. */
  get passed(): readonly boolean[] {
    return this.now.passed
  }

  /** The rain as it stands. */
  get weather(): Weather {
    return this.now.weather
  }

  /** Whether it rains now: the torch is out, and won't catch. */
  get raining(): boolean {
    return this.now.weather === 'raining'
  }

  /** Whether the cart has jammed at its track's end. */
  get jammed(): boolean {
    const cart = this.level.cart
    return cart !== undefined && this.now.rolled >= trackLength(cart) - 1e-6
  }

  /** Where the cart's back's middle now stands, and the way on along its track; none, without a cart. */
  cartAt(): { x: number; z: number; ux: number; uz: number } | undefined {
    const cart = this.level.cart
    if (cart === undefined) return undefined
    const length = trackLength(cart)
    const ux = (cart.jam.x - cart.from.x) / length
    const uz = (cart.jam.z - cart.from.z) / length
    return { x: cart.from.x + ux * this.now.rolled, z: cart.from.z + uz * this.now.rolled, ux, uz }
  }

  /** The cart's outline as it now stands: its back's two corners, then its front's; none, without a cart. */
  cartOutline(): Point[] {
    const cart = this.level.cart
    const at = this.cartAt()
    if (cart === undefined || at === undefined) return []
    // Across, to the right of the way on.
    const nx = -at.uz
    const nz = at.ux
    const { half, length } = cart
    return [
      { x: at.x - nx * half, z: at.z - nz * half },
      { x: at.x + nx * half, z: at.z + nz * half },
      { x: at.x + nx * half + at.ux * length, z: at.z + nz * half + at.uz * length },
      { x: at.x - nx * half + at.ux * length, z: at.z - nz * half + at.uz * length },
    ]
  }

  /** Whether (x, z) is in a no-catch zone. */
  spared(x: number, z: number): boolean {
    return (this.level.noCatch ?? []).some((zone) => within(zone.area, x, z))
  }

  /** The torch as it stands. */
  get torch(): Torch {
    const { fuel, tuning } = this
    const share = tuning.fade > 0 ? Math.min(1, fuel / tuning.fade) : fuel > 0 ? 1 : 0
    return { x: this.holder.x, z: this.holder.z, reach: tuning.torchReach * share, lit: fuel > 0 }
  }

  /** The share of a full torch it burns a second where the holder stands, the wind aside: the burn-rate zone's, the first he stands in, or the tuning's. */
  get burnRate(): number {
    const { x, z } = this.holder
    return this.level.burns?.find((zone) => inside(zone, x, z))?.rate ?? this.tuning.burnRate
  }

  /** The level's lights as they stand, for the swarm: a fragile flame put out is not lit. */
  lights(): FixedLight[] {
    return this.level.lights.map(({ reach, on }, k) => ({ ...this.placeOf(k), reach, on: on && !this.now.out[k] }))
  }

  /** Whether the wind gusts now in wind zone `zone`: as its script says, from the holder setting it off; never before. */
  gusting(zone: number): boolean {
    const since = this.windSince[zone]
    if (since === undefined || Number.isNaN(since)) return false
    const t = this.time - since
    return this.level.wind[zone]!.gusts.some((gust) => t >= gust.at && t < gust.at + gust.length)
  }

  /** The wind zone the holder stands in, or -1. */
  get inWind(): number {
    return this.level.wind.findIndex((zone) => inside(zone, this.holder.x, this.holder.z))
  }

  /** The level's walls as they stand, for the swarm and the lit areas: its own, then every shut gate. */
  walls(): Wall[] {
    const shut = this.level.gates.filter((_, g) => !this.now.open[g]).map(({ from, to }) => ({ from, to }))
    return [...this.level.walls, ...shut]
  }

  /**
   * One step of the run: the holder walks, along any wall it meets, passing
   * the gates it goes on through; the wind zones and fragile flames it walks
   * into the triggers of are set off; the torch burns, faster in the wind;
   * the gusts and the triggers put fragile flames out; a flame refuels it; a
   * key is picked up, a lever worked, a gate opened or shut behind; the rats
   * at a holder with no light catch the player; and the exit reached wins.
   */
  step(input: RunInput): void {
    if (this.won) return
    const { holder, tuning } = this
    // Caught on what the swarm saw last: at the holder, with the torch already out, where the rats reach him; running, once they
    // have held on for the grip.
    const held = this.fuel <= 0 && input.reached >= tuning.catchCount && !this.spared(holder.x, holder.z)
    this.gripped = held && this.panicking ? this.gripped + input.dt : 0
    if (held && (!this.panicking || this.gripped >= tuning.grip - 1e-9)) {
      this.caught++
      this.restart(this.checkpoint, this.atCheckpoint)
      return
    }
    const wasLit = this.fuel > 0
    this.time += input.dt
    // Crawling: C's toggle, left Ctrl held, or under a crawl zone, where there is no standing up; out from under one, he stands.
    const crawls = this.level.crawls ?? []
    if (whichCrawls(crawls) !== this.crawlsThere) this.wallsChanged()
    const under = crawls.some((zone) => zone.on !== false && this.isUnder(zone))
    if (input.toggleCrawl) this.crawlOn = !this.crawlOn
    if (this.wasUnder && !under) this.crawlOn = false
    this.wasUnder = this.under = under
    this.crawling = this.crawlOn || input.crawlHeld === true || under
    const ox = holder.x
    const oz = holder.z
    let speed = this.crawling ? Math.min(input.speed, tuning.crawlSpeed) : input.speed
    for (const zone of this.level.noCatch ?? []) if (within(zone.area, holder.x, holder.z)) speed = Math.min(speed, zone.speed)
    // Running by himself, with no key held, he runs on the way he faces.
    const { facing } = this
    const toward = input.toward ?? (this.panicking ? { x: holder.x + facing.x, z: holder.z + facing.z } : null)
    // Walking into the cart's back rolls it on ahead of him, at its pace, as far as it jams.
    if (this.push(toward, input.dt, speed)) speed = Math.min(speed, this.level.cart!.speed)
    if (toward !== null) {
      const d = Math.hypot(toward.x - holder.x, toward.z - holder.z)
      if (d > 1e-9) {
        facing.x = (toward.x - holder.x) / d
        facing.z = (toward.z - holder.z) / d
      }
      walkLight(input.arena, holder, toward, input.dt, speed, this.crawling ? this.standingWalls : this.uprightWalls)
    }
    // The rain starts or stops where he now stands, before a checkpoint there keeps it as it is.
    const { lights, wind, rain } = this.level
    const { out } = this.now
    const at = (box: Bounds) => inside(box, holder.x, holder.z)
    if (rain !== undefined && this.now.weather === 'dry' && rain.starts !== 'jammed' && at(rain.starts)) this.now.weather = 'raining'
    if (rain !== undefined && this.now.weather === 'raining' && at(rain.stops)) this.now.weather = 'over'
    this.pass(ox, oz)
    this.passZones()
    // Every trigger the holder stands in is set off from now on, if it was not already.
    wind.forEach((zone, w) => {
      if (Number.isNaN(this.windSince[w]) && at(zone.trigger ?? zone)) this.windSince[w] = this.time
    })
    lights.forEach((light, k) => {
      const trigger = light.fragile?.trigger
      if (trigger !== undefined && Number.isNaN(this.flameSince[k]) && at(trigger)) this.flameSince[k] = this.time
    })
    // The wind burns once, however many zones overlap where the holder stands, and a gust in any of them on top.
    const windy = wind.some((zone) => at(zone))
    const gust = wind.some((zone, w) => at(zone) && this.gusting(w))
    const burn = this.burnRate + (windy ? tuning.windDrain + (gust ? tuning.gustDrain : 0) : 0)
    this.fuel = Math.max(0, this.fuel - burn * input.dt)
    if (this.level.gutters?.some((place) => at(place))) this.fuel = 0
    lights.forEach((light, k) => {
      if (light.fragile === undefined || !light.flame || !light.on || out[k]) return
      const blown = wind.some((zone, w) => this.gusting(w) && inside(zone, light.x, light.z))
      const since = this.flameSince[k]!
      const timedOut = !Number.isNaN(since) && this.time - since >= (light.fragile.after ?? 0) - 1e-9
      if (blown || timedOut) out[k] = true
    })
    // In the rain no flame lights the torch, and it goes out.
    lights.forEach((light, k) => {
      if (!light.flame || !light.on || out[k] || this.raining) return
      const { x, z } = this.placeOf(k)
      if (Math.hypot(holder.x - x, holder.z - z) <= tuning.dip) this.fuel = 1
    })
    if (this.raining) this.fuel = 0
    this.work(input)
    // The torch gone out in a dark run, this step: he panics; caught again at a flame, he stops running by himself.
    if (wasLit && this.fuel <= 0 && this.level.darkRuns?.some((zone) => at(zone))) this.panicking = true
    else if (this.fuel > 0) this.panicking = false
    const exit = this.level.exit
    if (exit !== undefined && Math.hypot(holder.x - exit.x, holder.z - exit.z) <= exit.radius) this.won = true
  }

  /**
   * Start the run again at checkpoint `checkpoint`, or the start at -1: the
   * holder there with a full torch, every gate before it passed, as passing
   * them would have left the level. Further on, with `past.jammed` the cart
   * jammed, and the rain started if it starts there, at the cart's side; and
   * with `past.zone` that checkpoint zone walked into, there, the rain over if
   * it ends there. The designer's way in to a late section.
   */
  startAt(checkpoint: number, past: { jammed?: boolean; zone?: number } = {}): void {
    const { level } = this
    const at = Math.max(-1, Math.min(checkpoint, level.gates.length - 1))
    const standing = this.fresh()
    const before = (g: number) => g <= at
    level.keys.forEach((key, k) => (standing.carrying[k] = before(key.gate)))
    level.levers.forEach((lever, l) => (standing.pulled[l] = before(lever.gate)))
    level.gates.forEach((gate, g) => {
      standing.passed[g] = before(g)
      standing.open[g] = before(g) && !gate.shutsBehind
    })
    ;(level.checkpoints ?? []).forEach((zone, k) => (standing.reached[k] = zone.before !== undefined && before(zone.before)))
    this.resume = { ...(at >= 0 ? level.gates[at]!.checkpoint : level.start) }
    this.zone = -1
    if (past.jammed && level.cart !== undefined) {
      standing.rolled = trackLength(level.cart)
      if (level.rain?.starts === 'jammed') standing.weather = 'raining'
      this.resume = { ...level.cart.checkpoint }
    }
    const zone = past.zone === undefined ? undefined : level.checkpoints?.[past.zone]
    if (zone !== undefined) {
      standing.reached[past.zone!] = true
      this.zone = past.zone!
      this.resume = { ...zone.at }
      if (standing.weather === 'raining' && level.rain !== undefined && inside(level.rain.stops, zone.at.x, zone.at.z)) standing.weather = 'over'
    }
    this.won = false
    this.restart(at, standing)
  }

  /** The level's pieces as they stand at the start: no key carried, every gate shut and none passed, no lever pulled, no checkpoint zone walked into, every light lit. */
  private fresh(): WayOn {
    const { keys, gates, levers, lights, checkpoints = [] } = this.level
    const none = (list: readonly unknown[]) => list.map(() => false)
    return { carrying: none(keys), open: none(gates), passed: none(gates), pulled: none(levers), reached: none(checkpoints), out: none(lights), rolled: 0, weather: 'dry' }
  }

  /** Where light `k` now burns: the cart's brazier where the cart now is, every other where the level places it. */
  private placeOf(k: number): Point {
    const light = this.level.lights[k]!
    const cart = this.level.cart
    const at = cart?.light === k ? this.cartAt() : undefined
    if (cart === undefined || at === undefined) return { x: light.x, z: light.z }
    return { x: at.x - at.uz * cart.across + at.ux * cart.along, z: at.z + at.ux * cart.across + at.uz * cart.along }
  }

  /**
   * Push the cart, if the holder walking toward `toward` at `speed`, for `dt`, walks into its back: on
   * along its track by the share of the walk that goes that way, at its pace
   * at most, and never back. Jammed, the rain starts if it starts there, and
   * the level as it stands is kept for a restart at the cart's side. Whether
   * he pushed it.
   */
  private push(toward: { x: number; z: number } | null, dt: number, speed: number): boolean {
    const { holder, level, now } = this
    const { cart } = level
    const at = this.cartAt()
    this.pushing = false
    if (cart === undefined || at === undefined || toward === null || this.jammed) return false
    const wx = toward.x - holder.x
    const wz = toward.z - holder.z
    const w = Math.hypot(wx, wz)
    if (w === 0) return false
    const on = (wx * at.ux + wz * at.uz) / w
    const rx = holder.x - at.x
    const rz = holder.z - at.z
    const off = -(rx * at.ux + rz * at.uz)
    const across = Math.abs(rx * -at.uz + rz * at.ux)
    if (!(on > 0 && off > 0 && off < CART_TOUCH && across < cart.half + WALL_THICKNESS / 2)) return false
    this.pushing = true
    now.rolled = Math.min(trackLength(cart), now.rolled + on * Math.min(speed, cart.speed) * dt)
    this.wallsChanged()
    if (this.jammed) {
      if (level.rain?.starts === 'jammed' && now.weather === 'dry') now.weather = 'raining'
      this.zone = -1
      this.resume = { ...cart.checkpoint }
      this.atCheckpoint = copy(now)
    }
    return true
  }

  /** Whether the holder is under crawl zone `zone`: within UNDER of what hangs low there, or in its area. */
  private isUnder(zone: CrawlZone): boolean {
    const { x, z } = this.holder
    let low = this.low.get(zone)
    if (low === undefined) this.low.set(zone, (low = new Walls(zone.walls)))
    return low.inside(x, z, UNDER) || (zone.area !== undefined && within(zone.area, x, z))
  }

  /** The checkpoint zones the holder stands in, walked into for the first time: the level as it stands kept for a restart there. */
  private passZones(): void {
    const { holder, now } = this
    ;(this.level.checkpoints ?? []).forEach((zone, k) => {
      if (now.reached[k] || (zone.before !== undefined && now.passed[zone.before]) || !inside(zone, holder.x, holder.z)) return
      now.reached[k] = true
      this.zone = k
      this.resume = { ...zone.at }
      this.atCheckpoint = copy(now)
    })
  }

  /**
   * Start again at checkpoint `checkpoint`, the level as `standing` has it:
   * the holder there, the torch full unless it rains there, every trigger
   * waiting for the holder again, the rats placed again.
   */
  private restart(checkpoint: number, standing: WayOn): void {
    const at = this.resume
    this.starts++
    this.checkpoint = checkpoint
    this.holder.x = at.x
    this.holder.z = at.z
    this.fuel = 1
    this.crawlOn = this.wasUnder = this.under = this.crawling = this.pushing = this.panicking = false
    this.gripped = 0
    this.holding.fill(0)
    this.windSince.fill(Number.NaN)
    this.flameSince.fill(Number.NaN)
    this.atCheckpoint = copy(standing)
    this.now = copy(standing)
    // In the rain, his torch is out.
    if (this.raining) this.fuel = 0
    this.wallsChanged()
  }

  /**
   * The gates a holder walking from (ox, oz) went on through: across an open
   * one's line, within its length, onto its checkpoint's side. Passing one
   * passes its checkpoint, the level as it stands kept for a restart there:
   * a gate that shuts behind the holder kept shut, as the holder starting
   * again beyond it would leave it. A page that walks the holder itself, the
   * 2D prototype, calls it after each walk, from where the holder stood.
   */
  pass(ox: number, oz: number): void {
    const { holder } = this
    this.level.gates.forEach((gate, g) => {
      if (!this.now.open[g] || this.now.passed[g]) return
      const was = beyond(gate, ox, oz)
      const is = beyond(gate, holder.x, holder.z)
      if (!(was <= 0 && is > 0)) return
      // Where along the gate the walk crossed its line, a share of its length.
      const s = was === is ? 0 : was / (was - is)
      const ux = gate.to.x - gate.from.x
      const uz = gate.to.z - gate.from.z
      const at = ((ox + (holder.x - ox) * s - gate.from.x) * ux + (oz + (holder.z - oz) * s - gate.from.z) * uz) / (ux * ux + uz * uz)
      if (at < 0 || at > 1) return
      this.now.passed[g] = true
      this.checkpoint = g
      this.zone = -1
      this.resume = { ...gate.checkpoint }
      this.atCheckpoint = copy(this.now)
      if (gate.shutsBehind) this.atCheckpoint.open[g] = false
    })
  }

  /** The keys picked up, the levers worked, and the gates opened by them or shut behind the holder. */
  private work(input: RunInput): void {
    const { holder, tuning, level, now } = this
    let changed = false
    level.keys.forEach((key, k) => {
      if (input.interact && !now.carrying[k] && Math.hypot(holder.x - key.x, holder.z - key.z) <= tuning.keyReach) now.carrying[k] = true
    })
    level.levers.forEach((lever, l) => {
      if (now.pulled[l]) return
      const at = Math.hypot(holder.x - lever.x, holder.z - lever.z) <= tuning.leverReach
      this.holding[l] = input.interact && at ? this.holding[l]! + input.dt : 0
      if (this.holding[l]! < lever.hold - 1e-9) return
      now.pulled[l] = true
      this.holding[l] = 0
      if (!now.open[lever.gate] && !now.passed[lever.gate]) changed = now.open[lever.gate] = true
    })
    level.gates.forEach((gate, g) => {
      const off = distanceTo(gate, holder.x, holder.z)
      if (!now.open[g] && !now.passed[g]) {
        const keyed = level.keys.some((key, k) => key.gate === g && now.carrying[k])
        if (keyed && off <= tuning.gateReach) changed = now.open[g] = true
      } else if (now.open[g] && now.passed[g] && gate.shutsBehind && off > CLEAR && beyond(gate, holder.x, holder.z) > 0) {
        now.open[g] = false
        changed = true
      }
    })
    if (changed) this.wallsChanged()
  }

  /** The walls as they now stand, for the holder's walk, crawling and standing, and for whoever reads `walls()`. */
  private wallsChanged(): void {
    const walls = [...this.walls(), ...this.holderOnly, ...sides(this.cartOutline())]
    const crawls = this.level.crawls ?? []
    this.crawlsThere = whichCrawls(crawls)
    this.standingWalls = new Walls(walls)
    this.uprightWalls = new Walls([...walls, ...crawls.flatMap((zone) => (zone.on === false ? [] : zone.walls))])
    this.wallsVersion++
  }
}

/** A copy of `standing`, its own to change. */
const copy = (standing: WayOn): WayOn => ({
  carrying: [...standing.carrying],
  open: [...standing.open],
  passed: [...standing.passed],
  pulled: [...standing.pulled],
  reached: [...standing.reached],
  out: [...standing.out],
  rolled: standing.rolled,
  weather: standing.weather,
})

/** How long a cart's track is, m. */
const trackLength = (cart: Cart) => Math.hypot(cart.jam.x - cart.from.x, cart.jam.z - cart.from.z)

/** A closed outline's walls, each side one. */
const sides = (outline: readonly Point[]): Wall[] => outline.map((from, k) => ({ from, to: outline[(k + 1) % outline.length]! }))

/** Which crawl zones are there, as a key: one character each. */
const whichCrawls = (crawls: readonly CrawlZone[]) => crawls.map((zone) => (zone.on === false ? '0' : '1')).join('')

/** How far across `gate`'s line (x, z) is, toward its checkpoint's side; scaled by its length, and below 0 on the side it is passed from. */
function beyond(gate: Gate, x: number, z: number): number {
  const ux = gate.to.x - gate.from.x
  const uz = gate.to.z - gate.from.z
  const across = (px: number, pz: number) => (px - gate.from.x) * -uz + (pz - gate.from.z) * ux
  return across(x, z) * Math.sign(across(gate.checkpoint.x, gate.checkpoint.z))
}

/** Whether (x, z) is inside the box. */
const inside = (box: Bounds, x: number, z: number) => x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ

