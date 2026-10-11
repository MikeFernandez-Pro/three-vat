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
// (gameplay.ts). What is new is scripted here, on top, for now: the opening
// with control locked, the two lightning strikes, the cracked tree knocked
// down burning, crawling under it, the low growth that stops the child but not
// the rats, the light or the eye, the river that stops all three but the eye,
// the cart pushed over the bridge, the text lines, the checkpoints, and where
// the rats are set down. They move into the run as rules of their own with the
// beats that first need them in 3D.
//
// The gate is the run's own, opened by the key and left open; its bars stop
// the child alone, so the swarm never reads it.
//
// The rain starts as the cart jams past the bridge and puts the stick out
// until the far side of the pine; the cart's fire and the braziers drown after.
//
// The cart rolls on only while the child walks into its back, at the push's
// pace, the share of his walk that goes along the bridge, and never back. It
// stops him, never the rats or the light: its brazier's light covers him as
// he pushes. Its brazier is a light the run reads where the cart now is.
//
// The climb's braziers are the run's fragile flames, each set off as he
// leaves it, one as he comes up to it. Up on the pine the child is out of the
// rats' reach: no catch counts there, and he goes slowly.
//
// Past the pine the stick is damp: caught again, it burns a short time and
// dims as fast. The far side's rats press round it and follow him down the
// path. When it dies he panics and runs by himself at his own pace, the
// player still steering, the rats on his heels, a little faster than he is:
// in the dark run a few rats at him take a moment to drag him down, so while
// he keeps going they only snap at his heels, and if he stops, or crawls, they
// pile on.
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
// swarm and its lit areas are handed only the MAX_WALLS nearest the child,
// picked again each metre he moves. They reach thirteen metres round him at
// the least, past the rats' notice and every light's lit area near him.
//
// Nothing is drawn at random: the same inputs give the same play.
import { LIGHT_SPEED, NOTICE, RESTART_ROOM, gameTuning } from './gameplay'
import { defaultRunTuning, Run } from './run'
import { Swarm, random, walkLight, type Bounds, type Light, type StepReport } from './swarm'
import { STEP } from './swarm-remote'
import { HOLDER_RADIUS, WALL_THICKNESS, Walls, distanceTo, nearestWalls, type Wall } from './walls'
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
/** How far off the cart's back the child still pushes it, m, past where its wall keeps him. */
const CART_TOUCH = WALL_THICKNESS / 2 + HOLDER_RADIUS + 0.08
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
  /** How fast the child crawls, pushes the cart, and walks the pine, m/s. */
  crawlSpeed: number
  pushSpeed: number
  beamSpeed: number
  /** How long the damp stick burns, s. */
  damp: number
  /** How long rats at him in the dark run take to drag him down, s. */
  grip: number
  /** How far off the child sees a rat's eyes, m: a rat further, or out of his sight, may be set down again. */
  eyes: number
}

/** Whether `p` is in box `b`. */
export const inBox = (b: Bounds, p: Point) => p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ

/** Whether (x, z) is inside `outline`. */
export function within(outline: Point[], x: number, z: number): boolean {
  let inside = false
  for (let k = 0, j = outline.length - 1; k < outline.length; j = k++) {
    const p = outline[k]!
    const q = outline[j]!
    if (p.z > z !== q.z > z && x < ((q.x - p.x) * (z - p.z)) / (q.z - p.z) + p.x) inside = !inside
  }
  return inside
}

export class Play {
  /** The woods, the play's own copy: the strikes, the cart and the checkpoints change its level as the play goes. */
  readonly woods = woods()
  readonly settings: PlaySettings
  /** The swarm's and the run's tuning, as the play sets them as it goes: no notice before the rush, a damp stick past the pine. */
  readonly tuning = gameTuning()
  readonly runTuning = defaultRunTuning()
  readonly swarm: Swarm
  /** What the eye stops at: what stops the light, but the water's edge and the bridge's rails. */
  readonly sight: Walls
  run!: Run
  /** The script's time, s from the start. */
  t = 0
  /** Whether the torch has been lit: the intro is done, and a catch starts the run again at the trunk. */
  lit = false
  /** Whether he crawls this frame, and whether he pushes the cart. */
  crawling = false
  pushing = false
  /** How many times he was caught. */
  caught = 0
  /** What the swarm's last step measured. */
  report: StepReport | undefined
  /** When the second strike came, when the stick first caught, and when the cart jammed, s of the script: NaN, not yet. */
  fellAt = Number.NaN
  litAt = Number.NaN
  jammedAt = Number.NaN
  /** When the damp stick died past the pine and he bolted, s of the script: NaN, not yet. */
  panicAt = Number.NaN
  /** The last checkpoint passed: 0 the trunk, 1 the gate's torches, outside it, 2 through the gate, 3 the cart jammed at the foot of the steps, where the rain starts, 4 the far side of the pine, where the rain stops. */
  stage = 0
  /** The way the child faces. */
  readonly facing = { x: 0, z: -1 }
  /** The torch as the swarm reads it, where the child carries it. */
  readonly torchLight: Light = { x: 0, z: 0, strength: 0, on: false }
  /** The cart: where its back now stands, z, and where it stood at the last checkpoint. */
  readonly cart: { back: number; saved: number }

  private readonly start: Point
  /** How fast a dry stick burns: the run's own. */
  private readonly dry: number
  private readonly next: () => number
  /** What stops the rats, every wall of it: the level's walls and the pine's ends. The swarm is handed the nearest of them. */
  private readonly ratWalls: Wall[]
  private readonly allRatWalls: Walls
  /** Where the walls the swarm has were picked from. */
  private readonly streamedAt = { x: Number.NaN, z: Number.NaN }
  /** What stops the child: the level's walls, the low growth and the cart as it stands; and the trunk once it is down, unless crawling. */
  private readonly trunkOnly: Walls
  private readonly tangleOnly: Walls
  private readonly tangleWalls: Wall[]
  private readonly growthWalls: Wall[]
  private readonly trunkWall: Wall
  private readonly gateOnly: Walls
  private walking!: Walls
  /** What stops him standing: what stops him crawling, and the tangle's ends. */
  private upright!: Walls
  private blocked!: Walls
  /** The level's walls as the run has them standing, the gate among them while it is shut; and the run's count of changes they were last taken at. */
  private standing: Wall[]
  private wallsSeen = -1
  /** Which rats wait where the level put them, left to themselves until the child comes within their notice: the group's index and one, 0 for none. */
  private readonly waiting: Uint8Array
  /** Whether C has crawling on. */
  private crawlOn = false
  /** The run's starts, as last seen: one more, and he was caught. */
  private startsSeen = 0
  /** The swarm's time not yet stepped, s. */
  private unstepped = 0
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
  /** Whether the stick burned last frame; whether he was in a place he can only crawl through; and whether he stands at the tangle, not crawling. */
  private wasLit = false
  private wasUnder = false
  private atTangle = false
  /** How long enough rats to catch him have been at him without a break, s, in the dark run. */
  private gripped = 0
  /** The rats owed a respawn, a share of one carried from frame to frame; and the rat respawn looks at next. */
  private owed = 0
  private cursor = 0
  /** Which side of the trunk's line the child starts. */
  private readonly south: number

  constructor(settings: Partial<PlaySettings> = {}, seed = SEED) {
    const { woods: map } = this
    const { level } = map
    this.settings = { rats: 1000, crawlSpeed: 1.5, pushSpeed: map.cart.speed, beamSpeed: 0.8, damp: map.dampBurn, grip: 2, eyes: 12, ...settings }
    this.start = { ...level.start }
    this.dry = this.runTuning.burnRate
    this.next = random(seed)
    // The rats are stopped by the level's walls, and by the pine's ends: none follows him over it.
    this.ratWalls = [...level.walls, ...map.pineEnds]
    this.allRatWalls = new Walls(this.ratWalls)
    this.swarm = new Swarm(16384, seed, 1, { walls: nearestWalls(this.ratWalls, this.start.x, this.start.z), bounds: level.bounds })
    this.waiting = new Uint8Array(this.swarm.capacity)
    this.sight = new Walls(level.walls.filter((wall) => !map.banks.includes(wall)))
    this.trunkWall = { from: map.trunk.root, to: map.trunk.crown }
    this.trunkOnly = new Walls([this.trunkWall])
    this.growthWalls = map.thickets.flatMap(sides)
    // The tangle's two ends across the path: they stop him standing, never crawling; the wood either side is its sides.
    const [ta, tb, tc, td] = map.tangle.zone as [Point, Point, Point, Point]
    this.tangleWalls = [
      { from: ta, to: tb },
      { from: tc, to: td },
    ]
    this.tangleOnly = new Walls(this.tangleWalls)
    this.gateOnly = new Walls([level.gates[0]!])
    this.standing = level.walls
    this.cart = { back: map.cart.back, saved: map.cart.back }
    this.south = this.sideOf(this.start)
    this.begin()
  }

  /** The child. */
  get holder(): Point {
    return this.run.holder
  }

  /** Whether it rains: from the cart jammed past the bridge to the far side of the pine. The stick is wet, and won't catch. */
  get raining(): boolean {
    return this.stage === 3
  }

  /** The light left in the torch, s at the rate it burns now. */
  get left(): number {
    return this.run.fuel / this.runTuning.burnRate
  }

  /** Whether the cart has jammed against the bottom step. */
  get jammed(): boolean {
    return this.cart.back <= this.woods.cart.jam + 1e-6
  }

  /** Whether the child runs by himself, the stick dead past the pine. */
  get panicking(): boolean {
    return !Number.isNaN(this.panicAt)
  }

  /** Whether the child is on the fallen pine, over the ravine: out of the rats' reach, and slow. */
  onPine(p: Point): boolean {
    const { overRavine, pine } = this.woods
    if (!inBox(overRavine, p)) return false
    return distanceTo(pine, p.x, p.z) <= pine.half + 0.1
  }

  /** The cart's outline as it now stands: its back's two corners, then its front's. */
  cartOutline(): Point[] {
    const { x, half, length } = this.woods.cart
    const { back } = this.cart
    return [
      { x: x - half, z: back },
      { x: x + half, z: back },
      { x: x + half, z: back - length },
      { x: x - half, z: back - length },
    ]
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
    // Every light burns from the start but the two trees, which the strikes light.
    level.lights.forEach((light, k) => (light.on = k !== map.bigTree && k !== map.crown))
    this.cart.back = this.cart.saved = map.cart.back
    level.start = { ...this.start }
    this.runTuning.burnRate = this.dry
    this.run = new Run(level, this.runTuning)
    this.wallsSeen = -1
    this.takeWalls()
    this.run.fuel = 0
    this.startsSeen = this.run.starts
    this.t = 0
    this.lit = false
    this.crawlOn = false
    this.crawling = false
    this.atTrunk = 0
    this.crawlHint = false
    this.through = false
    this.caught = 0
    this.unstepped = 0
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
    this.wasUnder = false
    this.atTangle = false
    this.gripped = 0
    this.stage = 0
    this.pushing = false
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
    level.start = { ...(checkpoint === 0 ? map.checkpoint : map.entranceCheckpoint) }
    if (checkpoint >= 3) {
      this.cart.back = this.cart.saved = map.cart.jam
      this.jammedAt = this.t
      this.rainAt = this.t
    }
    if (checkpoint === 4) this.rainStopped = this.t
    level.lights[map.bigTree]!.on = true
    level.lights[map.crown]!.on = true
    run.startAt(checkpoint >= 2 ? 0 : -1)
    const at = checkpoint === 3 ? map.cartCheckpoint : checkpoint === 4 ? map.farCheckpoint : null
    if (at !== null) {
      run.holder.x = at.x
      run.holder.z = at.z
    }
    this.runTuning.burnRate = checkpoint >= 4 ? 1 / this.settings.damp : this.dry
    this.takeWalls()
    this.startsSeen = run.starts
    this.come = true
    this.stream(true)
    this.swarm.setCount(this.settings.rats)
    this.setAllDown()
  }

  /** One frame of the play: the script, the child's walk, the run, the rats set down again, and the swarm stepped at the worker's pace. */
  frame(dt: number, input: PlayInput): void {
    const { woods: map, swarm, settings, runTuning } = this
    const { level } = map
    if (input.toggleCrawl) this.crawlOn = !this.crawlOn
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
    this.tuning.notice = t < map.rush ? 0 : NOTICE
    const locked = t < map.strike
    // The first strike: the rats round the clearing come, in the bushes, and burst out of them.
    if (!this.come && !locked) {
      this.come = true
      const was = swarm.count
      swarm.setCount(settings.rats)
      this.setRestDown(was)
    }
    // Crawling: on while C has it on or left Ctrl is held, and always under the trunk or the tangle, where there is no standing
    // up; out from under either, he stands up again.
    const under = down && this.trunkOnly.inside(holder.x, holder.z, HOLDER_RADIUS + 0.05)
    const tangled = this.tangleOnly.inside(holder.x, holder.z, HOLDER_RADIUS + 0.05) || within(map.tangle.zone, holder.x, holder.z)
    if (this.wasUnder && !under && !tangled) this.crawlOn = false
    this.wasUnder = under || tangled
    this.crawling = this.crawlOn || input.crawlHeld === true || under || tangled
    this.atTangle = !this.crawling && this.tangleOnly.inside(holder.x, holder.z, 1.2)
    // The stick dead past the pine: he runs by himself, the way he faces, at his own pace, the keys steering him.
    const panicking = this.panicking
    this.pushing = false
    if (!locked) {
      const toward = input.heading ?? (panicking ? { ...this.facing } : null)
      if (toward !== null) {
        this.facing.x = toward.x
        this.facing.z = toward.z
        // Walking into the cart's back, north along the bridge, rolls it on ahead of him, as far as it jams.
        const off = holder.z - this.cart.back
        this.pushing = !this.jammed && toward.z < 0 && off > 0 && off < CART_TOUCH && Math.abs(holder.x - map.cart.x) < map.cart.half + WALL_THICKNESS / 2
        if (this.pushing) {
          this.cart.back = Math.max(map.cart.jam, this.cart.back + toward.z * settings.pushSpeed * dt)
          this.placeCart()
          if (this.jammed) this.jammedAt = t
        }
        const pace = this.crawling ? settings.crawlSpeed : this.onPine(holder) ? settings.beamSpeed : LIGHT_SPEED
        const speed = this.pushing ? Math.min(pace, settings.pushSpeed) : pace
        const ox = holder.x
        const oz = holder.z
        walkLight(swarm.arena, holder, { x: holder.x + toward.x, z: holder.z + toward.z }, dt, speed, this.crawling ? this.walking : down ? this.blocked : this.upright)
        run.pass(ox, oz)
      }
    }
    if (!this.through && down && this.sideOf(holder) !== this.south && !under) this.through = true
    // The run: the torch burns, a flame lights or refuels it, and the rats at a child with no light catch the player; never
    // in the opening, nor while the rats on him run out of the first strike's light.
    // Past the pine the stick is damp: it burns short, and dims as fast.
    runTuning.burnRate = this.stage >= 4 ? 1 / settings.damp : this.dry
    // On the pine, high over the ravine, no rat reaches him.
    const spared = t < map.strike + GRACE || this.onPine(holder)
    const at = spared ? 0 : (this.report?.reached ?? 0)
    // In the dark run, rats at him drag him down only once they've held on for `grip` seconds: running, they snap at his heels.
    this.gripped = panicking && at >= runTuning.catchCount ? this.gripped + dt : 0
    const reached = panicking && this.gripped < settings.grip ? 0 : at
    run.step({ dt, toward: null, speed: 0, arena: swarm.arena, interact: input.interact === true, reached })
    this.takeWalls()
    // In the rain the stick is wet: it neither burns nor catches, whatever flame it is dipped into.
    if (this.raining) run.fuel = 0
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
        // The cart as it stood at the checkpoint.
        this.cart.back = this.cart.saved
        this.placeCart()
        // Once the cart has jammed, the run starts again at its side, and past the pine at the far side's brazier, not at the
        // gate: the run's own last checkpoint.
        const at = this.stage === 3 ? map.cartCheckpoint : this.stage >= 4 ? map.farCheckpoint : null
        if (at !== null) {
          holder.x = at.x
          holder.z = at.z
        }
        this.stream(true)
        this.setAllDown()
      }
    }
    if (!this.lit && run.fuel > 0) {
      this.lit = true
      this.litAt = t
      level.start = { ...map.checkpoint }
    }
    // The checkpoints further on: the torch dipped at the gate's torches; past the gate, the cart jammed at the foot of the steps.
    const dipped = (k: number) => {
      const light = level.lights[k]!
      return Math.hypot(holder.x - light.x, holder.z - light.z) <= runTuning.dip
    }
    if (this.lit && this.stage < 1 && map.entrance.some(dipped)) {
      this.reachStage(1)
      level.start = { ...map.entranceCheckpoint }
      this.cart.saved = this.cart.back
    }
    // Past the gate: the run's own checkpoint from now on.
    if (this.stage < 2 && run.checkpoint === 0) this.reachStage(2)
    if (this.stage === 2 && this.jammed) {
      this.reachStage(3)
      this.cart.saved = this.cart.back
    }
    // Over the pine: the rain stops.
    if (this.raining && inBox(map.farSide, holder)) this.reachStage(4)
    if (Number.isNaN(this.manorAt) && inBox(map.hilltop, holder)) this.manorAt = t
    // The damp stick: caught again, past the drowned lanterns, gone out where the path nears the fallen tree, and dead.
    if (this.stage >= 4 && run.torch.lit && !this.wasLit) this.dampAt = t
    if (this.stage >= 4 && inBox(map.guttersOut, holder)) run.fuel = 0
    if (this.stage >= 4 && Number.isNaN(this.drownedAt) && inBox(map.pastLanterns, holder)) this.drownedAt = t
    if (this.stage >= 4 && this.wasLit && !run.torch.lit && Number.isNaN(this.panicAt)) this.panicAt = t
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
    const placed = run.lights()
    this.unstepped = Math.min(this.unstepped + dt, MOST_STEPS * STEP)
    while (this.unstepped >= STEP) {
      this.unstepped -= STEP
      this.report = swarm.step(STEP, light, this.tuning, undefined, placed)
    }
  }

  /** The line the child says now, or none. Placeholders, every one. */
  line(): string {
    const { run, woods: map, t, stage } = this
    if (run.won) return ''
    if (t > 0.6 && t < map.strike - 0.2) return 'Where... where am I?'
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

  /** The cart where its back now stands: its brazier there, and its sides among what stops the child. */
  private placeCart(): void {
    const { woods: map } = this
    const brazier = map.level.lights[map.brazier]!
    brazier.x = map.cart.x + map.cart.across
    brazier.z = this.cart.back - map.cart.along
    const body = sides(this.cartOutline())
    this.walking = new Walls([...this.standing, ...this.growthWalls, ...body])
    this.upright = new Walls([...this.walking.walls, ...this.tangleWalls])
    this.blocked = new Walls([...this.upright.walls, this.trunkWall])
  }

  /** The walls again, if the run opened the gate since they were last taken: for the child only, since the gate's bars stop neither the rats nor the light. */
  private takeWalls(): void {
    if (this.run.wallsVersion === this.wallsSeen) return
    this.wallsSeen = this.run.wallsVersion
    this.standing = this.run.walls()
    this.placeCart()
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
