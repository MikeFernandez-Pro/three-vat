// The play step (#181): one frame of the woods' play at a time, headless, as
// both pages drive it. A page builds one, feeds it the frame's input (where
// the keys send the child, crawling, the interact key) and draws what it
// reports: the child and his torch, the lights as they stand, the cart, the
// rain, the line he says, the stage, and the rats. It knows nothing of
// drawing, and is tested in Node, walking the real level on the keys.
//
// The play is the game's own: the run (run.ts) burns and refuels the torch and
// catches the player, the swarm (swarm.ts) runs the rats, the walls and the lit
// areas stop them and the light, all tuned as the 3D page tunes them
// (gameplay.ts). The run walks the child, crawling where the level's crawl
// zones say, and keeps the checkpoints the level's zones, its gate and its
// jammed cart make (#182, #183). What is new is scripted here, on top, for
// now: the opening with control locked, the two lightning strikes, the cracked
// tree knocked down burning, the low growth that stops the child but not the
// rats, the light or the eye, the river that stops all three but the eye, the
// text lines, and where the rats are set down. They move into the run as
// rules of their own with the beats that first need them in 3D.
//
// The gate is the run's own, opened by the key and left open; its bars stop
// the child alone, so the swarm never reads it.
//
// The cart and the rain are the run's (#183): the cart rolls on while the
// child walks into its back, and jams at the bottom step; the rain starts as
// it jams and puts the stick out until the far side of the pine; the cart's
// fire and the braziers drown after. The climb's braziers are the run's
// fragile flames, each set off as he leaves it, one as he comes up to it. Up on
// the pine, the run's no-catch zone, the child is out of the rats' reach, and
// goes slowly.
//
// Past the pine the stick is damp: caught again, it burns a short time and
// dims as fast, and it gutters out at the same place on the path whatever is
// left of it. The far side's rats press round it and follow him down the
// path. When it dies he panics and runs by himself at his own pace, the
// player still steering, the rats on his heels, a little faster than he is:
// in the dark run a few rats at him take a moment to drag him down, so while
// he keeps going they only snap at his heels, and if he stops, or crawls, they
// pile on. The damp stick, the panic and the grip are the run's rules (#184),
// the panel's knobs written into the level and the run's tuning each frame.
// The tangle across the path is crawled through, as the trunk is; leaving
// either stands him up again.
//
// The rats are a budget, not a crowd spread over the level: every one is
// meant to be chasing the child. They start in the bushes round the clearing,
// but for the groups the level has wait further on, still until the child
// comes within their notice; a rat left further behind than the eye reaches is
// set down again at a spawn spot near the child, inside a bush or the thicket
// where nothing shows it, and comes out running. A spot wakes only within the
// rats' notice of the child, never in a light.
//
// The level has a few hundred walls, and the GPU step reads MAX_WALLS: the
// swarm is handed only the MAX_WALLS nearest the child, picked again each
// metre he moves. They reach thirteen metres round him at the least, past the
// rats' notice and every light's lit area near him. The CPU swarm works its
// lit areas out from them; the 3D page works out its own from every wall
// (ADR-0055), and near the child the two agree.
//
// The rats are the play's to set down, but not always its to step: the tests
// and the 2D page step the CPU swarm as the play goes (SteppedSwarm), and the
// 3D page hands the play its swarm on the GPU, which it steps as it draws and
// whose rats' places come back a frame or two late.
//
// Nothing is drawn at random: the same inputs give the same play.
import { LIGHT_SPEED, NOTICE, RESTART_ROOM, gameTuning } from './gameplay'
import { defaultRunTuning, Run, type CrawlZone } from './run'
import { Swarm, random, type Bounds, type Dark, type FixedLight, type Ground, type Light, type StepReport, type Tuning } from './swarm'
import { STEP } from './swarm-remote'
import { Walls, nearestWalls, within, type Wall } from './walls'
import { sides, woods, type Circle, type Point } from './woods'

const TAU = Math.PI * 2
const SEED = 7
/** The most swarm steps a frame takes: a hitch slows the swarm rather than stalling the page. */
const MOST_STEPS = 3
/** The share of the rats a second that may be set down again at the spawn spots: a stream, never a wall. */
const RESPAWN_RATE = 0.3
/** Seconds after the first strike no catch counts: the rats on the child run out of the new light. */
const GRACE = 1.5
/** How near the child a spot may wake, m: never on top of him; and how far, ahead of him: a rat set down past the rats' notice waits there for him. */
const SPOT_NEAR = 3
const SPOT_FAR = 12
/** How far off a light's reach a spot stays asleep, m. */
const SPOT_LIGHT = 1
/** How far the child walks before the walls nearest him are picked again, m. */
const RESTREAM = 1

/**
 * The beats whose waiting groups wait, by the last checkpoint passed: from the
 * trunk the burning tree's; from the gate's torches the gate's, round the guard;
 * past the gate those where the bridge lands (3.5) and the hill's; from the
 * cart jammed the hill's and the ravine's (4.5), which wait for those where
 * the bridge lands to be let go; past the pine, the ravine's and the far
 * side's, which follow him down the path. The budget never holds the whole
 * level's groups at once.
 */
const BEATS = [[1], [3], [3.5, 4], [4, 4.5], [4.5, 6]]

/**
 * The rats as the play sets them down and reads where they are: the CPU
 * swarm, or a page's own, whose places may come back late.
 */
export interface PlaySwarm {
  readonly capacity: number
  readonly count: number
  readonly arena: number
  /** Where each rat is, as last known: a rat set down is there at once. */
  readonly x: ArrayLike<number>
  readonly z: ArrayLike<number>
  /** `count` rats, every one placed afresh by the swarm's own rule. */
  reset(count: number): void
  setCount(count: number): void
  setDown(i: number, x: number, z: number): void
  setWalls(walls: readonly Wall[]): void
  /** Every rat placed again, out of the walls and `lights`. */
  restart(lights: readonly FixedLight[]): void
  /**
   * The swarm moved on by `dt` of play, under the torch, the tuning and the
   * placed lights: what its last step measured, or nothing yet. A swarm a
   * page steps as it draws only says what it last measured. Given a `dark`,
   * what lies out of view round the light, rats left behind in it are
   * brought round ahead, where the swarm does that.
   */
  advance(dt: number, light: Light, tuning: Tuning, lights: readonly FixedLight[], dark?: Dark): StepReport | undefined
}

/** The CPU swarm, stepped at the worker's pace as the play goes, MOST_STEPS a frame at most: what the tests and the 2D page play. */
export class SteppedSwarm extends Swarm implements PlaySwarm {
  /** The time not yet stepped, s, and what the last step measured. */
  private unstepped = 0
  private last: StepReport | undefined

  override reset(count: number): void {
    super.reset(count)
    this.unstepped = 0
    this.last = undefined
  }

  advance(dt: number, light: Light, tuning: Tuning, lights: readonly FixedLight[], dark?: Dark): StepReport | undefined {
    this.unstepped = Math.min(this.unstepped + dt, MOST_STEPS * STEP)
    while (this.unstepped >= STEP) {
      this.unstepped -= STEP
      this.last = this.step(STEP, light, tuning, dark, lights)
    }
    return this.last
  }
}

/** What a page hands the play of its own: its swarm, made on the ground the play gives it; and the swarm's tuning, which the page's panel edits. */
export interface PlayDrive<S extends PlaySwarm> {
  swarm?: (ground: Ground) => S
  tuning?: Tuning
}

/** A frame of the player's input. */
export interface PlayInput {
  /** Where the keys send the child, a unit direction, or nothing held. */
  heading: Point | null
  /** Crawling switched on or off since the last frame: C. */
  toggleCrawl?: boolean
  /** Crawling while held: left Ctrl. */
  crawlHeld?: boolean
  /** The interact key held: Space. */
  interact?: boolean
}

/** The play's knobs, read live: the panel's. */
export interface PlaySettings {
  /** The rats' budget: read when the play starts again. */
  rats: number
  /** How long the damp stick burns, s. */
  damp: number
  /** How long rats at him in the dark run take to drag him down, s. */
  grip: number
  /** How far off the child sees a rat's eyes, m: a rat further, or out of his sight, may be set down again. */
  eyes: number
  /** Whether the play opens with control locked, the child wondering where he is, until the first strike; without it he walks from the start. */
  opening: boolean
}

/** Whether `p` is in box `b`. */
export const inBox = (b: Bounds, p: Point) => p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ

export class Play<S extends PlaySwarm = SteppedSwarm> {
  /** The woods, the play's own copy: the strikes, the cart and the checkpoints change its level as the play goes. */
  readonly woods = woods()
  readonly settings: PlaySettings
  /** The swarm's and the run's tuning, as the play sets them as it goes: no notice before the rush, the grip as the panel has it. */
  readonly tuning: Tuning
  readonly runTuning = defaultRunTuning()
  readonly swarm: S
  /** What the eye stops at: what stops the light, but the water's edge and the bridge's rails. */
  readonly sight: Walls
  run!: Run
  /** The script's time, s from the start. */
  t = 0
  /** Whether the torch has been lit: the intro is done, and a catch starts the run again at the trunk. */
  lit = false
  /** Whether he crawls this frame, and whether he pushes the cart, the run's own. */
  crawling = false
  pushing = false
  /** The way the keys sent him this frame, a unit direction, or none: as the page turns its child. */
  readonly going = { x: 0, z: 0 }
  /** How many times he was caught. */
  caught = 0
  /** What the swarm's last step measured. */
  report: StepReport | undefined
  /** When the second strike came, when the stick first caught, and when the cart jammed, s of the script: NaN, not yet. */
  fellAt = Number.NaN
  litAt = Number.NaN
  jammedAt = Number.NaN
  /** When the stick died in the dark run and he bolted, s of the script: NaN, not yet. */
  panicAt = Number.NaN
  /** The last checkpoint passed: 0 the trunk, 1 the gate's torches, outside it, 2 through the gate, 3 the cart jammed at the foot of the steps, where the rain starts, 4 the far side of the pine, where the rain stops. */
  stage = 0
  /** The way the child faces. */
  readonly facing = { x: 0, z: -1 }
  /** The torch as the swarm reads it, where the child carries it. */
  readonly torchLight: Light = { x: 0, z: 0, strength: 0, on: false }

  private readonly next: () => number
  /** What stops the rats, every wall of it: the level's walls and the pine's ends. The swarm is handed the nearest of them. */
  readonly ratWalls: Wall[]
  private readonly allRatWalls: Walls
  /** Where the walls the swarm has were picked from. */
  private readonly streamedAt = { x: Number.NaN, z: Number.NaN }
  /** The trunk and the tangle's ends, for the hints; the gate, for its line; and the low growth, which stops the child alone, as the cart does. */
  private readonly trunkOnly: Walls
  private readonly tangleOnly: Walls
  private readonly gateOnly: Walls
  private readonly growthWalls: Wall[]
  /** Which rats wait where the level put them, left to themselves until the child comes within their notice: the group's index and one, 0 for none. */
  private readonly waiting: Uint8Array
  /** The run's starts, as last seen: one more, and he was caught. */
  private startsSeen = 0
  /** How long he has stood at the fallen trunk without crawling, s; and whether he has been told to crawl. */
  private atTrunk = 0
  private crawlHint = false
  /** Whether he is through, on the trunk's far side. */
  private through = false
  /** Whether the rats round the clearing have come: at the first strike, out of the bushes; till then only the groups waiting further on are there. */
  private come = false
  /** When the rain started, when he went through the gate, when the rain stopped, and when the manor was first seen, s of the script: NaN, not yet. */
  private rainAt = Number.NaN
  private gateAt = Number.NaN
  private rainStopped = Number.NaN
  private manorAt = Number.NaN
  /** When the brazier went out in the rain as he came up to it, and when the cart's fire went out behind him, s of the script: NaN, not yet. */
  private guttered = Number.NaN
  private behindAt = Number.NaN
  /** When the damp stick last caught, and when the drowned lanterns were passed, s of the script: NaN, not yet. */
  private dampAt = Number.NaN
  private drownedAt = Number.NaN
  /** Whether the stick burned last frame; and whether he stands at the tangle, not crawling. */
  private wasLit = false
  private atTangle = false
  /** The rats owed a respawn, a share of one carried from frame to frame; and the rat respawn looks at next. */
  private owed = 0
  private cursor = 0
  /** Which side of the trunk's line the child starts. */
  private readonly south: number

  constructor(settings: Partial<PlaySettings> = {}, seed = SEED, drive: PlayDrive<S> = {}) {
    const { woods: map } = this
    const { level } = map
    const damp = 1 / level.burns![map.dampZone]!.rate
    this.settings = { rats: 1000, damp, grip: this.runTuning.grip, eyes: 12, opening: true, ...settings }
    this.tuning = drive.tuning ?? gameTuning()
    this.next = random(seed)
    // The rats are stopped by the level's walls, and by the pine's ends: none follows him over it.
    this.ratWalls = [...level.walls, ...map.pineEnds]
    this.allRatWalls = new Walls(this.ratWalls)
    const ground: Ground = { walls: nearestWalls(this.ratWalls, level.start.x, level.start.z), bounds: level.bounds }
    this.swarm = drive.swarm?.(ground) ?? (new SteppedSwarm(16384, seed, 1, ground) as unknown as S)
    this.waiting = new Uint8Array(this.swarm.capacity)
    this.sight = new Walls(level.walls.filter((wall) => !map.banks.includes(wall)))
    this.trunkOnly = new Walls(this.fallen.walls)
    this.growthWalls = map.thickets.flatMap(sides)
    this.tangleOnly = new Walls(level.crawls!.filter((_, k) => k !== map.trunkCrawl).flatMap((zone) => zone.walls))
    this.gateOnly = new Walls([level.gates[0]!])
    this.south = this.sideOf(level.start)
    this.begin()
  }

  /** The child. */
  get holder(): Point {
    return this.run.holder
  }

  /** Whether it rains: from the cart jammed past the bridge to the far side of the pine. The stick is wet, and won't catch. */
  get raining(): boolean {
    return this.run.raining
  }

  /** The light left in the torch, s at the rate it burns now. */
  get left(): number {
    return this.run.fuel / this.run.burnRate
  }

  /** Whether the cart has jammed against the bottom step. */
  get jammed(): boolean {
    return this.run.jammed
  }

  /** Whether the child runs by himself, the stick dead in the dark run past the pine. */
  get panicking(): boolean {
    return this.run.panicking
  }

  /** Whether the child is on the fallen pine, over the ravine: out of the rats' reach, and slow. */
  onPine(p: Point): boolean {
    return this.run.spared(p.x, p.z)
  }

  /** The cart's outline as it now stands: its back's two corners, then its front's. */
  cartOutline(): Point[] {
    return this.run.cartOutline()
  }

  /** Where a rat is out of sight: 2 in a rock, 1 in the growth, where its eyes show dimly through the leaves; 0 in the open. */
  coverAt(x: number, z: number): number {
    const { rocks, thickets } = this.woods
    return rocks.some((rock) => within(rock, x, z)) ? 2 : thickets.some((growth) => within(growth, x, z)) ? 1 : 0
  }

  /** The spots awake: ahead of the child, up to SPOT_FAR. */
  wakeful(): Circle[] {
    return this.spotsNear(SPOT_FAR, true)
  }

  /** From the very start: the opening again, the stick unlit, the tree standing, the cart at the bridge's south end, the rats in the bushes. */
  begin(): void {
    const { woods: map, swarm } = this
    const { level } = map
    // Every light burns from the start but the two trees, which the strikes light; and the trunk is still standing.
    level.lights.forEach((light, k) => (light.on = k !== map.bigTree && k !== map.crown))
    this.fallen.on = false
    this.run = new Run(level, this.runTuning)
    this.run.setHolderWalls(this.growthWalls)
    this.run.fuel = 0
    this.startsSeen = this.run.starts
    this.t = 0
    this.lit = false
    this.crawling = false
    this.atTrunk = 0
    this.crawlHint = false
    this.through = false
    this.caught = 0
    this.owed = 0
    this.report = undefined
    this.come = false
    this.fellAt = Number.NaN
    this.litAt = Number.NaN
    this.jammedAt = Number.NaN
    this.rainAt = Number.NaN
    this.gateAt = Number.NaN
    this.rainStopped = Number.NaN
    this.manorAt = Number.NaN
    this.guttered = Number.NaN
    this.behindAt = Number.NaN
    this.dampAt = Number.NaN
    this.drownedAt = Number.NaN
    this.panicAt = Number.NaN
    this.wasLit = false
    this.atTangle = false
    this.stage = 0
    this.pushing = false
    this.going.x = this.going.z = 0
    this.facing.x = 0
    this.facing.z = -1
    this.stream(true)
    swarm.reset(map.waiting.reduce((sum, group) => sum + (BEATS[0]!.includes(group.beat) ? group.count : 0), 0))
    swarm.setCount(Math.min(swarm.count, this.settings.rats))
    this.setWaitingDown()
  }

  /** Straight to a checkpoint, the intro skipped: both trees burning, the torch lit; 0 at the trunk, 1 between the gate's torches, outside it, 2 past the gate, the cart ahead, 3 at the cart's side, jammed at the foot of the steps, in the rain, 4 past the pine, the damp stick just caught at the far side's brazier. */
  skipTo(checkpoint: number): void {
    this.begin()
    const { woods: map, run } = this
    const { level } = map
    this.t = map.strike + 5
    this.fellAt = this.t - map.falling - 0.5
    this.lit = true
    this.stage = checkpoint
    this.through = checkpoint > 0
    if (checkpoint >= 3) {
      this.jammedAt = this.t
      this.rainAt = this.t
    }
    if (checkpoint === 4) this.rainStopped = this.t
    level.lights[map.bigTree]!.on = true
    level.lights[map.crown]!.on = true
    this.fallen.on = true
    // The run as walking there would have left it: in the clearing, between the gate's torches, through the gate, the cart
    // jammed, or past the pine.
    const zone = [map.clearingZone, map.entranceZone, undefined, undefined, map.farZone][checkpoint]
    run.startAt(checkpoint >= 2 ? 0 : -1, { jammed: checkpoint >= 3, zone })
    this.startsSeen = run.starts
    this.come = true
    this.stream(true)
    this.swarm.setCount(this.settings.rats)
    this.setAllDown()
  }

  /** One frame of the play: the script, the child's walk and the run, the rats set down again, and the swarm moved on. */
  frame(dt: number, input: PlayInput): void {
    const { woods: map, swarm, settings, runTuning } = this
    const { level } = map
    // The run, and the child, until a catch before the torch was lit starts the play again with new ones.
    let run = this.run
    let holder = run.holder
    if (run.won) return
    this.t += dt
    let t = this.t
    // The script.
    const walkedOut = inBox(map.fallTrigger, holder)
    if (Number.isNaN(this.fellAt) && (t >= this.litAt + map.afterLit || walkedOut)) this.fellAt = t
    const down = t >= this.fellAt + map.falling
    level.lights[map.bigTree]!.on = t >= map.strike
    level.lights[map.crown]!.on = down
    // Down, the trunk is a place passed only crawling.
    this.fallen.on = down
    this.tuning.notice = t < map.rush ? 0 : NOTICE
    const locked = settings.opening && t < map.strike
    // The first strike: the rats round the clearing come, in the bushes, and burst out of them.
    if (!this.come && !locked) {
      this.come = true
      const was = swarm.count
      swarm.setCount(settings.rats)
      this.setRestDown(was)
    }
    // The stick dead in the dark run: he runs by himself, the way he faces, at his own pace, the keys steering him; the run's own.
    this.going.x = this.going.z = 0
    let toward: Point | null = null
    if (!locked) {
      const way = input.heading
      if (way !== null) {
        this.going.x = way.x
        this.going.z = way.z
        toward = { x: holder.x + way.x, z: holder.z + way.z }
      }
    }
    // The run: the child walks, crawling where he must, at the crawl's pace; the torch burns, a flame lights or refuels it, and
    // the rats at a child with no light catch the player; never in the opening, nor while the rats on him run out of the first
    // strike's light.
    // Past the pine the stick is damp: it burns short, and dims as fast. In the dark run, rats at him drag him down only once
    // they've held on for the grip: running, they snap at his heels.
    level.burns![map.dampZone]!.rate = 1 / settings.damp
    runTuning.grip = settings.grip
    // The run counts no catch on the pine, high over the ravine.
    const spared = t < map.strike + GRACE
    const reached = spared ? 0 : (this.report?.reached ?? 0)
    run.step({ dt, toward, speed: LIGHT_SPEED, arena: swarm.arena, interact: input.interact === true, reached, toggleCrawl: input.toggleCrawl, crawlHeld: input.crawlHeld })
    this.crawling = run.crawling
    this.pushing = run.pushing
    if (Number.isNaN(this.jammedAt) && run.jammed) this.jammedAt = t
    if (run.panicking) {
      this.going.x = this.facing.x = run.facing.x
      this.going.z = this.facing.z = run.facing.z
    } else if (toward !== null) {
      this.facing.x = run.facing.x
      this.facing.z = run.facing.z
    }
    this.atTangle = !this.crawling && this.tangleOnly.inside(holder.x, holder.z, 1.2)
    if (!this.through && down && this.sideOf(holder) !== this.south && !run.under) this.through = true
    if (run.starts !== this.startsSeen) {
      this.startsSeen = run.starts
      this.caught++
      this.panicAt = Number.NaN
      if (!this.lit) {
        const times = this.caught
        this.begin()
        this.caught = times
        run = this.run
        holder = run.holder
        t = this.t
      } else {
        // The run starts again at its last checkpoint, the level as it stood there, the cart where it stood.
        if (!run.jammed) this.jammedAt = Number.NaN
        this.stream(true)
        this.setAllDown()
      }
    }
    if (!this.lit && run.fuel > 0) {
      this.lit = true
      this.litAt = t
    }
    // The checkpoints further on, the run's: the gate's torches, the gate, the cart jammed at the foot of the steps, and over
    // the pine, where the rain stops.
    if (this.lit && this.stage < 1 && run.zones[map.entranceZone]) this.reachStage(1)
    if (this.stage < 2 && run.passed[0]) this.reachStage(2)
    if (this.stage === 2 && run.jammed) this.reachStage(3)
    if (this.stage === 3 && run.weather === 'over') this.reachStage(4)
    if (Number.isNaN(this.manorAt) && inBox(map.hilltop, holder)) this.manorAt = t
    // The damp stick: caught again, past the drowned lanterns, and dead, gone out where the path nears the fallen tree if not before.
    if (this.stage >= 4 && run.torch.lit && !this.wasLit) this.dampAt = t
    if (this.stage >= 4 && Number.isNaN(this.drownedAt) && inBox(map.pastLanterns, holder)) this.drownedAt = t
    if (run.panicking && Number.isNaN(this.panicAt)) this.panicAt = t
    this.wasLit = run.torch.lit
    // The braziers gone in the rain, the one ahead and the first behind; lit again, a run started again, they may go again.
    const guttering = !run.lights()[map.gutters]!.on
    if (guttering && Number.isNaN(this.guttered)) this.guttered = t
    else if (!guttering) this.guttered = Number.NaN
    const drowned = !run.lights()[map.brazier]!.on
    if (drowned && Number.isNaN(this.behindAt)) this.behindAt = t
    else if (!drowned) this.behindAt = Number.NaN
    // The crawl hint: standing at the fallen trunk, south of it, three seconds without crawling.
    const nearTrunk = down && !this.through && this.trunkOnly.inside(holder.x, holder.z, 1.6)
    this.atTrunk = nearTrunk && !this.crawling ? this.atTrunk + dt : nearTrunk ? this.atTrunk : 0
    if (this.atTrunk >= 3) this.crawlHint = true
    // A waiting rat the child has come within notice of is one of the swarm's like any other.
    const { waiting } = this
    for (let i = 0; i < swarm.count; i++) if (waiting[i] && Math.hypot(swarm.x[i]! - holder.x, swarm.z[i]! - holder.z) <= NOTICE) waiting[i] = 0
    this.respawn(dt)
    this.stream(false)
    // The swarm at the worker's pace, reading the torch where the child carries it.
    const torch = run.torch
    const light = this.torchLight
    light.x = torch.x
    light.z = torch.z
    light.strength = torch.reach / this.tuning.ringMax
    light.on = torch.lit
    this.report = swarm.advance(dt, light, this.tuning, run.lights())
  }

  /** The line the child says now, or none. Placeholders, every one. */
  line(): string {
    const { run, woods: map, t, stage } = this
    if (run.won) return ''
    if (this.settings.opening && t > 0.6 && t < map.strike - 0.2) return 'Where... where am I?'
    if (!this.lit && t >= map.strike + 6) return 'The fire... my stick could catch.'
    if (this.crawlHint && !this.through) return 'Too high to climb. Crawl under it: C'
    const holder = run.holder
    const carrying = run.carrying[0]
    if (!carrying && !run.open[0] && this.gateOnly.inside(holder.x, holder.z, 1.2)) return "Locked. Where's the guard?"
    if (!carrying && Math.hypot(holder.x - map.guard.x, holder.z - map.guard.z) < 1.2) return 'A guard... his key. [Space]'
    if (stage === 2 && t - this.gateAt < 3.5) return "The cart's fire... push it over."
    if (t - this.rainAt < 2) return 'Rain... no, my stick!'
    if (stage === 3 && t - this.jammedAt < 5.5 && run.lights()[map.brazier]!.on) return 'The braziers. Stay in their light.'
    if (stage === 3 && t - this.behindAt < 2.5) return "Behind me... the rain's putting them out!"
    if (t - this.manorAt < 4) return 'Home... the manor!'
    if (this.raining && !run.lights()[map.gutters]!.on && t - this.guttered < 2.5) return "It's out... keep going!"
    if (t - this.panicAt < 2.5) return 'No... no, no!'
    if (this.atTangle) return 'The branches... crawl under! C'
    if (t - this.drownedAt < 3) return "They're all out..."
    if (stage === 4 && run.torch.lit && t - this.dampAt < 3) return "It's still wet..."
    if (stage === 4 && !run.torch.lit && Number.isNaN(this.panicAt) && t - this.rainStopped < 8) return 'The rain stopped. The fire, quick.'
    return ''
  }

  /** The cracked tree's crawl zone: there once it is down. */
  private get fallen(): CrawlZone {
    return this.woods.level.crawls![this.woods.trunkCrawl]!
  }

  /** Which side of the trunk's line `p` is on. */
  private sideOf(p: Point): number {
    const { root, crown } = this.woods.trunk
    return Math.sign((crown.x - root.x) * (p.z - root.z) - (crown.z - root.z) * (p.x - root.x))
  }

  /** The walls nearest the child handed to the swarm and its lit areas, if he has walked RESTREAM since they were last picked, or `now`. */
  private stream(now: boolean): void {
    const { holder } = this.run
    const at = this.streamedAt
    if (!now && Math.hypot(holder.x - at.x, holder.z - at.z) < RESTREAM) return
    at.x = holder.x
    at.z = holder.z
    this.swarm.setWalls(nearestWalls(this.ratWalls, holder.x, holder.z))
  }

  /** Whether a spot at (x, z) is in a light, or near enough one: the torch's or a placed one's. */
  private lightNear(x: number, z: number): boolean {
    const torch = this.run.torch
    if (torch.lit && Math.hypot(x - torch.x, z - torch.z) < torch.reach + RESTART_ROOM) return true
    return this.run.lights().some((light) => light.on && Math.hypot(x - light.x, z - light.z) < light.reach + SPOT_LIGHT)
  }

  /** Set rat `i` down somewhere in `spot`, off the walls. */
  private setDownAt(i: number, spot: Circle): void {
    let x = spot.x
    let z = spot.z
    for (let tries = 0; tries < 8; tries++) {
      const a = this.next() * TAU
      const r = Math.sqrt(this.next()) * spot.r
      x = spot.x + Math.cos(a) * r
      z = spot.z + Math.sin(a) * r
      if (!this.allRatWalls.inside(x, z, 0.15)) break
    }
    this.swarm.setDown(i, x, z)
  }

  /** The spots within `far` of the child, not on top of him, out of every light, and, if `ahead`, not behind the way he faces. */
  private spotsNear(far: number, ahead: boolean): Circle[] {
    const holder = this.run.holder
    const { facing } = this
    return this.woods.spots.filter((spot) => {
      const dx = spot.x - holder.x
      const dz = spot.z - holder.z
      const d = Math.hypot(dx, dz)
      if (d < SPOT_NEAR || d > far || this.lightNear(spot.x, spot.z)) return false
      return !ahead || dx * facing.x + dz * facing.z >= -0.25 * d
    })
  }

  /** The level's waiting groups of the beats waiting now set down, those further than a spot wakes and out of the light, as the swarm's first rats: how many. */
  private setWaitingDown(): number {
    const { waiting, swarm, woods: map } = this
    waiting.fill(0)
    const holder = this.run.holder
    let i = 0
    map.waiting.forEach((group, g) => {
      const { spot } = group
      if (!BEATS[this.stage]!.includes(group.beat) || Math.hypot(spot.x - holder.x, spot.z - holder.z) < SPOT_NEAR || this.lightNear(spot.x, spot.z)) return
      for (let k = 0; k < group.count && i < swarm.count; k++, i++) {
        this.setDownAt(i, spot)
        waiting[i] = g + 1
      }
    })
    return i
  }

  /** The sight walls near the child, every one: as far as the level reaches. */
  private seeFromChild(): void {
    const holder = this.run.holder
    const b = this.woods.level.bounds
    this.sight.nearTo(holder.x, holder.z, Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ))
  }

  /** Whether rat `i` may be set down elsewhere: past its notice of the child, and out of his sight, further than the eyes show, in the growth or a rock, or behind what stops the eye. `sight` near the child first. */
  private spare(i: number): boolean {
    const holder = this.run.holder
    const x = this.swarm.x[i]!
    const z = this.swarm.z[i]!
    const d = Math.hypot(x - holder.x, z - holder.z)
    if (d <= NOTICE) return false
    return d > this.settings.eyes || this.coverAt(x, z) > 0 || this.sight.ray(holder.x, holder.z, (x - holder.x) / d, (z - holder.z) / d, d) < d - 0.3
  }

  /** A checkpoint passed: the groups of beats left behind wait no more, and those of the beats now waiting that are not yet there are set down, out of the rats to spare. */
  private reachStage(next: number): void {
    const { waiting, swarm, woods: map } = this
    const was = BEATS[this.stage]!
    this.stage = next
    if (next === 2) this.gateAt = this.t
    if (next === 3) this.rainAt = this.t
    if (next === 4) this.rainStopped = this.t
    const now = BEATS[this.stage]!
    for (let i = 0; i < swarm.count; i++) if (waiting[i] && !now.includes(map.waiting[waiting[i]! - 1]!.beat)) waiting[i] = 0
    this.seeFromChild()
    let i = 0
    map.waiting.forEach((group, g) => {
      if (was.includes(group.beat) || !now.includes(group.beat)) return
      for (let k = 0; k < group.count; k++) {
        while (i < swarm.count && (waiting[i] || !this.spare(i))) i++
        if (i === swarm.count) return
        this.setDownAt(i, group.spot)
        waiting[i++] = g + 1
      }
    })
  }

  /** The rats from `from` on set down at the spots within notice of the child, or the nearest out of the light if none is. */
  private setRestDown(from: number): void {
    let spots = this.spotsNear(NOTICE - 0.5, false)
    if (spots.length === 0) {
      const holder = this.run.holder
      const dark = this.woods.spots.filter((spot) => !this.lightNear(spot.x, spot.z))
      dark.sort((a, b) => Math.hypot(a.x - holder.x, a.z - holder.z) - Math.hypot(b.x - holder.x, b.z - holder.z))
      spots = dark.slice(0, 4)
    }
    if (spots.length === 0) return
    for (let i = from, k = 0; i < this.swarm.count; i++, k++) this.setDownAt(i, spots[k % spots.length]!)
  }

  /** Every rat set down at once: the waiting groups, and the rest round the child. */
  private setAllDown(): void {
    this.setRestDown(this.setWaitingDown())
  }

  /**
   * The rats doing nothing set down again at the spots awake, a share of them a
   * second: past their notice of the child, so not chasing him, and out of his
   * sight, further than the eyes show, in the growth or a rock, or behind what
   * stops the eye. A waiting group is left to wait.
   */
  private respawn(dt: number): void {
    const spots = this.wakeful()
    if (spots.length === 0) return
    const { swarm, waiting } = this
    this.owed = Math.min(this.owed + swarm.count * RESPAWN_RATE * dt, swarm.count)
    let n = Math.floor(this.owed)
    this.owed -= n
    this.seeFromChild()
    for (let seen = 0; seen < swarm.count && n > 0; seen++) {
      const i = this.cursor
      this.cursor = (this.cursor + 1) % swarm.count
      if (waiting[i] || !this.spare(i)) continue
      this.setDownAt(i, spots[Math.floor(this.next() * spots.length)]!)
      n--
    }
  }
}
