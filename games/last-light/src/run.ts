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
// Nothing is drawn at random: the same inputs give the same run.
import { walkLight, type Bounds, type FixedLight } from './swarm'
import { HOLDER_RADIUS, WALL_THICKNESS, Walls, type Wall } from './walls'

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
 * The level, as data: where the holder starts, the lights, the walls, the
 * wind zones, the gates in the order the way on passes them, the keys and
 * levers that open them, the exit, and the box the rats start in, everywhere
 * in it that is dark.
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
}

/** The torch as it stands: where the holder carries it, how far it reaches, m, and whether it burns. */
export interface Torch {
  x: number
  z: number
  reach: number
  lit: boolean
}

/** The way on as it stands: each key carried, each gate open and passed, each lever pulled; and each of the level's lights put out, fragile flames a gust or their trigger put out. */
interface WayOn {
  carrying: boolean[]
  open: boolean[]
  passed: boolean[]
  pulled: boolean[]
  out: boolean[]
}

/** How far off a gate's line the holder is clear of it, m: its body's half-width and the gate's, and a little. */
const CLEAR = WALL_THICKNESS / 2 + HOLDER_RADIUS + 0.1

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
  /** Whether the holder has reached the exit. */
  won = false
  /** Counts up each time a gate opens or shuts: the walls the swarm and the lit areas read have changed. */
  wallsVersion = 0
  /** How long each lever has been held, s, while it is held. */
  readonly holding: number[]
  /** The level's pieces as they stand, and as they stood when the last checkpoint was passed. */
  private now: WayOn
  private atCheckpoint: WayOn
  /** The level's walls and its shut gates, which the holder walks along and never through. */
  private standingWalls: Walls
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
    this.standingWalls = new Walls(this.walls())
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

  /** The torch as it stands. */
  get torch(): Torch {
    const { fuel, tuning } = this
    const share = tuning.fade > 0 ? Math.min(1, fuel / tuning.fade) : fuel > 0 ? 1 : 0
    return { x: this.holder.x, z: this.holder.z, reach: tuning.torchReach * share, lit: fuel > 0 }
  }

  /** The level's lights as they stand, for the swarm: a fragile flame put out is not lit. */
  lights(): FixedLight[] {
    return this.level.lights.map(({ x, z, reach, on }, k) => ({ x, z, reach, on: on && !this.now.out[k] }))
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
    // Caught on what the swarm saw last: at the holder, with the torch already out.
    if (this.fuel <= 0 && input.reached >= tuning.catchCount) {
      this.caught++
      this.restart(this.checkpoint, this.atCheckpoint)
      return
    }
    this.time += input.dt
    const ox = holder.x
    const oz = holder.z
    if (input.toward !== null) walkLight(input.arena, holder, input.toward, input.dt, input.speed, this.standingWalls)
    this.pass(ox, oz)
    // Every trigger the holder stands in is set off from now on, if it was not already.
    const { lights, wind } = this.level
    const { out } = this.now
    const at = (box: Bounds) => inside(box, holder.x, holder.z)
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
    const burn = tuning.burnRate + (windy ? tuning.windDrain + (gust ? tuning.gustDrain : 0) : 0)
    this.fuel = Math.max(0, this.fuel - burn * input.dt)
    lights.forEach((light, k) => {
      if (light.fragile === undefined || !light.flame || !light.on || out[k]) return
      const blown = wind.some((zone, w) => this.gusting(w) && inside(zone, light.x, light.z))
      const since = this.flameSince[k]!
      const timedOut = !Number.isNaN(since) && this.time - since >= (light.fragile.after ?? 0) - 1e-9
      if (blown || timedOut) out[k] = true
    })
    lights.forEach((light, k) => {
      if (!light.flame || !light.on || out[k]) return
      if (Math.hypot(holder.x - light.x, holder.z - light.z) <= tuning.dip) this.fuel = 1
    })
    this.work(input)
    const exit = this.level.exit
    if (exit !== undefined && Math.hypot(holder.x - exit.x, holder.z - exit.z) <= exit.radius) this.won = true
  }

  /**
   * Start the run again at checkpoint `checkpoint`, or the start at -1: the
   * holder there with a full torch, every gate before it passed, as passing
   * them would have left the level. The designer's way in to a late section.
   */
  startAt(checkpoint: number): void {
    const at = Math.max(-1, Math.min(checkpoint, this.level.gates.length - 1))
    const standing = this.fresh()
    const before = (g: number) => g <= at
    this.level.keys.forEach((key, k) => (standing.carrying[k] = before(key.gate)))
    this.level.levers.forEach((lever, l) => (standing.pulled[l] = before(lever.gate)))
    this.level.gates.forEach((gate, g) => {
      standing.passed[g] = before(g)
      standing.open[g] = before(g) && !gate.shutsBehind
    })
    this.won = false
    this.restart(at, standing)
  }

  /** The level's pieces as they stand at the start: no key carried, every gate shut and none passed, no lever pulled, every light lit. */
  private fresh(): WayOn {
    const { keys, gates, levers, lights } = this.level
    const none = (list: readonly unknown[]) => list.map(() => false)
    return { carrying: none(keys), open: none(gates), passed: none(gates), pulled: none(levers), out: none(lights) }
  }

  /**
   * Start again at checkpoint `checkpoint`, the level as `standing` has it:
   * the holder there, the torch full, every trigger waiting for the holder
   * again, the rats placed again.
   */
  private restart(checkpoint: number, standing: WayOn): void {
    const at = checkpoint >= 0 ? this.level.gates[checkpoint]!.checkpoint : this.level.start
    this.starts++
    this.checkpoint = checkpoint
    this.holder.x = at.x
    this.holder.z = at.z
    this.fuel = 1
    this.holding.fill(0)
    this.windSince.fill(Number.NaN)
    this.flameSince.fill(Number.NaN)
    this.atCheckpoint = copy(standing)
    this.now = copy(standing)
    this.wallsChanged()
  }

  /**
   * The gates a holder walking from (ox, oz) went on through: across an open
   * one's line, within its length, onto its checkpoint's side. Passing one
   * passes its checkpoint, the level as it stands kept for a restart there:
   * a gate that shuts behind the holder kept shut, as the holder starting
   * again beyond it would leave it.
   */
  private pass(ox: number, oz: number): void {
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

  /** The walls as they now stand, for the holder's walk and for whoever reads `walls()`. */
  private wallsChanged(): void {
    this.standingWalls = new Walls(this.walls())
    this.wallsVersion++
  }
}

/** A copy of `standing`, its own to change. */
const copy = (standing: WayOn): WayOn => ({
  carrying: [...standing.carrying],
  open: [...standing.open],
  passed: [...standing.passed],
  pulled: [...standing.pulled],
  out: [...standing.out],
})

/** How far across `gate`'s line (x, z) is, toward its checkpoint's side; scaled by its length, and below 0 on the side it is passed from. */
function beyond(gate: Gate, x: number, z: number): number {
  const ux = gate.to.x - gate.from.x
  const uz = gate.to.z - gate.from.z
  const across = (px: number, pz: number) => (px - gate.from.x) * -uz + (pz - gate.from.z) * ux
  return across(x, z) * Math.sign(across(gate.checkpoint.x, gate.checkpoint.z))
}

/** How far (x, z) is from the line of `wall`, its ends included, m. */
function distanceTo(wall: Wall, x: number, z: number): number {
  const dx = wall.to.x - wall.from.x
  const dz = wall.to.z - wall.from.z
  const t = Math.max(0, Math.min(1, ((x - wall.from.x) * dx + (z - wall.from.z) * dz) / (dx * dx + dz * dz || 1)))
  return Math.hypot(x - wall.from.x - dx * t, z - wall.from.z - dz * t)
}

/** Whether (x, z) is inside the box. */
const inside = (box: Bounds, x: number, z: number) => x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ
