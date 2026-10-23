// PROTOTYPE: the sewers' play step (2026-10-12), headless, as the 2D page
// drives it and as a 3D page will: one frame at a time, fed the keys, read
// for what to draw. Nothing here draws.
//
// The run (run.ts) walks the child along the walls, burns the torch and
// refuels it at the flames, and catches the player; the swarm (swarm.ts) runs
// the rats. Everything new is scripted here on top, for now: doors pushed
// open by holding the interact key; three levers, the hub's moving only once
// the branches' two have drawn their rods; the gas jets out of the walls,
// putting the torch out, shut off by the gas branch's lever; the chandeliers
// swinging, and falling once the water
// branch's lever is pulled; the canal, where no rat goes; the key on the
// worker and the hub's chest; the cistern's plates, seen only in the light,
// and its door of symbols pressed in their order; the ladder and the manhole
// cover.
//
// The rats (2026-10-16, as the village had them): no holes, no pipes, no
// waves, no groups. Every rat is set down all round, anywhere it can stand on
// the hub's side of the huge door or on the canal gallery's walkways behind
// it, out of the lights, and stays where it runs;
// within its notice, it comes for him. While he wades the canal, most of the
// rats left out of his sight are set down again in the cistern ahead, where
// they wait over the plates. A rat with no way out of a light dies there and
// is set down again in its part, out of his sight.
// The rats touching him bite away a life the player never sees, which comes
// back once they let go; at nothing, he is caught.
//
// Progress is never lost: a lever pulled, a door opened, the key, stay so.
// Caught, the run starts again at its last checkpoint zone, the rats set
// down again all round, away from him.
//
// Nothing is drawn at random: the same inputs give the same play.
import { NOTICE, gameTuning } from './gameplay'
import { SteppedSwarm } from './play'
import { defaultRunTuning, Run } from './run'
import { GRID, WALKWAYS_END, cellAt, colliderPad, hubSide, inCanal, sewers, type Chandelier, type Glyph, type Point, type Sewers } from './sewers'
import { random, type Bounds, type FixedLight, type Light, type StepReport, type Tuning } from './swarm'
import { MAX_LIGHTS } from './litareas'
import { Walls, nearestWalls, type Wall } from './walls'

const TAU = Math.PI * 2
const SEED = 11
/** How fast the child walks and runs, m/s: running is slower than the fastest rats (2.3). */
export const WALK = 1.6
export const RUN = 2.1
/** How near the child reaches to push, pull, pick up or press, m. */
const REACH = 0.95
const BUTTON_REACH = 0.6
/**
 * His life, hidden from the player: 1 full. Every rat touching him takes BITE a second, as many as BITERS at most, so
 * the full swarm on him in the dark drags him down in about a second and a half; untouched for REST s, it comes back at REGEN
 * a second. At nothing, he is caught.
 */
const BITE = 0.07
const BITERS = 10
const REST = 1
const REGEN = 0.1
/** How far the chandeliers' fallen light reaches, m. */
const FALLEN_REACH = 3.2
/** How near the child a plate is seen in the torch's light, m, and in a placed light's, as a share of its reach. */
const PLATE_SEEN = 1.8
const PLATE_IN_LIGHT = 1.6
/** How far the eye sees a rat, m: further, or out of sight, a rat may be set down again. */
const EYES = 12
/** The escape holes: how near one a rat dives in when the light reaches it, m; and, once the chandeliers are down, how far round a fallen one's light a rat runs for the nearest hole, m, and how fast, m/s. */
const DIVE = 0.9
const ESCAPE_PAD = 0.6
const ESCAPE_SPEED = 3
/** How long the manhole cover is pushed, s. */
const COVER = 3
/** The sewer rats lunge (2026-10-21): about once in this many seconds each, at this many times its pace, for this long, s: a body length. */
const DASH_EVERY = 2.5
const DASH_SPEED = 2.5
const DASH_TIME = 0.12
/** How far either way off the line to him a sewer rat swerves as it comes, rad: about 45 degrees. */
const WEAVE = 0.8
/** How far off the canal's edge a rat that went in is set back on the walkway, m, at random between the two. */
const CANAL_BACK = [0.15, 0.6]
/** How far from the child the rats are set down, m, at the least. */
const AWAY = 4
/** The share of the rats set down in the cistern while he wades the canal. */
const GATHER = 0.75
/** How far apart the places a rat is set down at stand, m, in rows. */
const SPOT = 0.25

/** A frame of the player's input. */
export interface SewerInput {
  /** Where the keys send him, a unit direction, or nothing held: x east, z south. */
  heading: Point | null
  run?: boolean
  /** The interact key held: F. Lights the torch at a flame, works a lever, pushes, picks up, presses. */
  interact?: boolean
}

/** What the interact key would do here, and where, for the page to show the key over it. */
export interface Prompt extends Point {
  what: 'light' | 'lever' | 'pick up' | 'press'
}

export interface SewerSettings {
  /** How many rats, read at the start. */
  rats: number
  /** Whether the torch never burns out: for exploring. */
  everlasting: boolean
}

export const inBox = (b: Bounds, p: Point) => p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ

export class SewerPlay {
  readonly map: Sewers = sewers()
  readonly settings: SewerSettings
  readonly tuning: Tuning = gameTuning()
  /** How fast he walks and runs, m/s: WALK and RUN to start, the page's panel moves them. */
  readonly pace = { walk: WALK, run: RUN }
  /**
   * The torch burns 14 s; its reach shrinks with its fuel from the first step, from `torchReach` m full to
   * `torchLeast` m last, so the circle is seen closing in; out, nothing.
   */
  readonly runTuning = { ...defaultRunTuning(), burnRate: 1 / 14, fade: 1, torchReach: 1.5, torchLeast: 0, fadeCurve: 0.75 }
  readonly swarm: SteppedSwarm
  /** What stops the eye: the stone, water seen over. */
  readonly sight: Walls
  run!: Run
  /** The play's time, s. */
  t = 0
  caught = 0
  report: StepReport | undefined
  /** The torch as the swarm reads it. */
  readonly torchLight: Light = { x: 0, z: 0, strength: 0, on: false }
  /** The way the child faces, and the way the keys sent him this frame. */
  readonly facing = { x: 1, z: 0 }
  readonly going = { x: 0, z: 0 }
  running = false

  // The way on, never lost.
  lit = false
  doorsOpen: boolean[] = []
  pulled = { gas: false, water: false, hub: false }
  key = false
  chest = false
  fallen = false
  symbolOpen = false
  /** The checkpoint reached: 0 the start, 1 the hub, 2 the cistern. */
  stage = 0
  /** Whether the play began at the start, the opening's line said; a skip has none. */
  opening = true

  // As it stands this frame.
  /** How long each door, then each lever, has been held, s. */
  doorHold: number[] = []
  leverHold = { gas: 0, water: 0, hub: 0 }
  /** The symbols pressed at the cistern door, in order. */
  pressed: Glyph[] = []
  /** Each plate, whether it is in a light now. */
  platesSeen: boolean[] = []
  /** Whether he wades in the canal. */
  wading = false
  /** At the ladder: climbing, and how long the cover has been pushed, s. */
  climbing = false
  cover = 0
  won = false
  /** When the gas, the canal, the rush, and the last catch came, s: NaN, not yet. */
  gassedAt = Number.NaN
  canalAt = Number.NaN
  rushAt = Number.NaN
  caughtAt = Number.NaN
  keyAt = Number.NaN
  chestAt = Number.NaN
  fallenAt = Number.NaN
  hubAt = Number.NaN
  wrongAt = Number.NaN
  /** His life, 0 to 1, and how long since a rat last touched him, s. */
  life = 1
  untouched = 0
  /** Whether the hub lever was tried before the branches were done, and when. */
  triedAt = Number.NaN

  private readonly next: () => number
  private readonly floorWalls: Walls
  private wallsKey = ''
  /** Which rats are the cistern's, 1, the rest the hub side's, 0. */
  private cisterns: Uint8Array
  /** Which rats run for an escape hole, its index, -1 none; and where each is along its run, x then z. */
  private escaping: Int16Array
  private escapeAt: Float32Array
  /** How many rats have gone into the escape holes since the start. */
  escaped = 0
  /** Where a rat can be set down: floor cells it can stand on, the hub's side of the huge door and the cistern. */
  private readonly spots: { before: Point[]; cistern: Point[] }
  private startsSeen = 0
  private interactWas = false

  constructor(settings: Partial<SewerSettings> = {}, seed = SEED) {
    this.settings = { rats: 8000, everlasting: false, ...settings }
    this.next = random(seed)
    const { map } = this
    this.sight = new Walls(map.sight)
    this.floorWalls = new Walls(map.walls)
    this.swarm = new SteppedSwarm(8192, seed, 1, { walls: nearestWalls(map.walls, map.level.start.x, map.level.start.z), bounds: map.level.bounds })
    this.cisterns = new Uint8Array(this.swarm.capacity)
    this.escaping = new Int16Array(this.swarm.capacity).fill(-1)
    this.escapeAt = new Float32Array(this.swarm.capacity * 2)
    this.spots = this.findSpots()
    // A rat with no way out of a light dies there, and comes again in its part, out of his sight.
    this.swarm.kills = true
    this.swarm.onDied = (i) => this.scatter(i, EYES)
    // The far crowd, past what he sees, steps a quarter of it at a time: half the step's cost with 8000 rats (2026-10-16).
    this.swarm.stagger = 4
    this.swarm.staggerFrom = EYES
    // Starving and savage: every rat lunges now and then, at him, at the light, over the backs ahead.
    this.swarm.dashRate = 1 / DASH_EVERY
    this.swarm.dashSpeed = DASH_SPEED
    this.swarm.dashTime = DASH_TIME
    // And none runs the same line at him: each weaves its own way in.
    this.swarm.weave = WEAVE
    this.begin()
  }

  get holder(): Point {
    return this.run.holder
  }

  /** The light left in the torch, s. */
  get left(): number {
    return this.run.fuel / this.runTuning.burnRate
  }

  /** Whether jet `k` jets now: never once the gas branch's lever is pulled, which shuts the gas off. */
  jetting(k: number): boolean {
    if (this.pulled.gas) return false
    const jet = this.map.jets[k]!
    return (this.t + jet.phase) % jet.period < jet.on
  }

  /** How long until jet `k` next jets, s; 0 while it does; never, the gas shut off. */
  untilJet(k: number): number {
    if (this.pulled.gas) return Infinity
    const jet = this.map.jets[k]!
    const into = (this.t + jet.phase) % jet.period
    return into < jet.on ? 0 : jet.period - into
  }

  /** Whether `p` is in jet `k`'s reach, jetting or not. */
  inJet(k: number, p: Point): boolean {
    const jet = this.map.jets[k]!
    const along = (p.x - jet.x) * jet.dx + (p.z - jet.z) * jet.dz
    const across = (p.x - jet.x) * -jet.dz + (p.z - jet.z) * jet.dx
    return along >= 0 && along <= jet.length && Math.abs(across) <= jet.half
  }

  /** How long a full torch burns, s: the panels' control. */
  get torchSeconds(): number {
    return 1 / this.runTuning.burnRate
  }

  set torchSeconds(seconds: number) {
    this.runTuning.burnRate = 1 / Math.max(0.5, seconds)
  }

  /** Where chandelier `c` hangs now. */
  chandelierAt(c: Chandelier): Point {
    if (this.fallen) return c.pivot
    const s = Math.sin((TAU * this.t) / c.period + c.phase) * c.amplitude
    return { x: c.pivot.x + c.axis.x * s, z: c.pivot.z + c.axis.z * s }
  }

  /** The walls as they stand: every door still shut, and the huge door's modelled colliders, its bar while shut, its leaves and arm once open. */
  shutWalls(): Wall[] {
    const { map } = this
    const shut = map.doors.filter((_, k) => !this.doorsOpen[k])
    const hugeOpen = this.doorsOpen[map.doors.findIndex((door) => door.name === 'huge door')] === true
    return [...shut, ...(this.symbolOpen ? [] : [map.symbolDoor]), ...(hugeOpen ? map.hugeDoorColliders.open : map.hugeDoorColliders.shut)]
  }

  /** From the very start: by the lantern, the stick unlit, every door shut, no rat near. */
  begin(): void {
    const { map } = this
    for (const light of map.lights) light.on = true
    this.run = new Run(map.level, this.runTuning)
    this.run.fuel = 0
    this.startsSeen = this.run.starts
    this.t = 0
    this.caught = 0
    this.report = undefined
    this.lit = false
    this.doorsOpen = map.doors.map(() => false)
    this.doorHold = map.doors.map(() => 0)
    this.pulled = { gas: false, water: false, hub: false }
    this.leverHold = { gas: 0, water: 0, hub: 0 }
    this.key = this.chest = this.fallen = this.symbolOpen = false
    this.stage = 0
    this.opening = true
    this.pressed = []
    this.platesSeen = map.plates.map(() => false)
    this.wading = this.climbing = this.won = false
    this.cover = this.untouched = 0
    this.life = 1
    this.gassedAt = this.canalAt = this.rushAt = this.caughtAt = Number.NaN
    this.keyAt = this.chestAt = this.fallenAt = this.hubAt = this.wrongAt = this.triedAt = Number.NaN
    this.facing.x = 1
    this.facing.z = 0
    this.setLights()
    this.wallsChanged()
    this.swarm.reset(this.settings.rats)
    this.setAllDown()
  }

  /**
   * Straight to a point of the run, what comes before it done: 0 the start; 1
   * the hub, first time; 2 the hub, the gas branch done and the key carried; 3
   * the hub lever, both branches done; 4 the cistern; 5 the cistern door
   * opened, the rush on.
   */
  skipTo(point: number): void {
    this.begin()
    if (point === 0) return
    this.opening = false
    const { map, run } = this
    this.lit = true
    if (point >= 2) {
      this.pulled.gas = true
      this.key = true
    }
    if (point >= 3) {
      this.pulled.water = true
      this.fallen = true
    }
    if (point >= 4) {
      this.pulled.hub = true
      this.doorsOpen[map.doors.findIndex((door) => door.name === 'huge door')] = true
    }
    if (point >= 5) this.symbolOpen = true
    run.startAt(-1, { zone: point >= 4 ? map.cisternZone : map.hubZone })
    this.stage = point >= 4 ? 2 : 1
    const at = [undefined, undefined, undefined, { x: map.levers[2]!.x, z: map.levers[2]!.z + 0.4 }, undefined, { x: 4.2, z: -58.85 }][point]
    if (at) {
      run.holder.x = at.x
      run.holder.z = at.z
    }
    if (point >= 5) this.rushAt = this.t
    this.startsSeen = run.starts
    this.setLights()
    this.wallsChanged()
    this.setAllDown()
  }

  /** One frame. */
  frame(dt: number, input: SewerInput): void {
    if (this.won) return
    const { map, run, swarm } = this
    this.t += dt
    const holder = run.holder
    const interact = input.interact === true
    const pressedNow = interact && !this.interactWas
    this.interactWas = interact

    // The keys: at the ladder, nothing moves him.
    const heading = this.climbing ? null : input.heading
    this.going.x = heading?.x ?? 0
    this.going.z = heading?.z ?? 0
    this.running = input.run === true && heading !== null
    const speed = this.running ? this.pace.run : this.pace.walk
    const toward = heading === null ? null : { x: holder.x + heading.x, z: holder.z + heading.z }

    // The run: the rats touching him bite his life away, never on the ladder; left alone, it comes back. At nothing, caught.
    const atHim = this.climbing ? 0 : (this.report?.reached ?? 0)
    this.untouched = atHim > 0 ? 0 : this.untouched + dt
    this.life = Math.min(1, this.life - Math.min(atHim, BITERS) * BITE * dt + (this.untouched >= REST ? REGEN * dt : 0))
    const wasLit = run.fuel > 0
    run.step({ dt, toward, speed, arena: swarm.arena, interact: false, reached: 0, caught: this.life <= 0, dip: interact })
    if (toward !== null) {
      this.facing.x = run.facing.x
      this.facing.z = run.facing.z
    }

    // Gas puts the torch out.
    if (map.jets.some((_, k) => this.jetting(k) && this.inJet(k, holder))) {
      if (run.fuel > 0) this.gassedAt = this.t
      run.fuel = 0
    }
    this.wading = inCanal(map, holder.x, holder.z)
    if (this.wading && Number.isNaN(this.canalAt)) this.canalAt = this.t
    if (this.settings.everlasting) run.fuel = 1
    if (!this.lit && run.fuel > 0 && !wasLit) this.lit = true

    // A catch: the run starts again at its checkpoint; what was done stays done.
    if (run.starts !== this.startsSeen) {
      this.startsSeen = run.starts
      this.caught++
      this.caughtAt = this.t
      this.afterRestart()
    }

    // The checkpoints the run keeps.
    if (this.stage < 1 && run.zones[map.hubZone]) this.stage = 1
    if (this.stage < 2 && run.zones[map.cisternZone]) this.stage = 2

    this.work(dt, interact, pressedNow)
    this.setLights()
    const key = this.shutWalls().length + (this.symbolOpen ? 's' : '')
    if (key !== this.wallsKey) this.wallsChanged()

    // The plates in the light.
    const torch = run.torch
    const lights = run.lights()
    this.platesSeen = map.plates.map((plate) => {
      if (torch.lit && Math.hypot(plate.x - holder.x, plate.z - holder.z) <= PLATE_SEEN) return true
      return lights.some((light) => light.on && Math.hypot(plate.x - light.x, plate.z - light.z) <= light.reach * PLATE_IN_LIGHT)
    })

    // The rats: while he wades the canal, most of them gather in the cistern ahead.
    if (this.wading) this.gather()

    const light = this.torchLight
    light.x = torch.x
    light.z = torch.z
    light.strength = torch.reach / this.tuning.ringMax
    light.on = torch.lit
    this.report = swarm.advance(dt, light, this.tuning, this.nearestLights(lights))
    this.escape(dt)
    this.keepOutOfCanal()
  }

  /** The line the child says now, or none. Placeholders. */
  line(): string {
    const { t, run, map } = this
    const holder = run.holder
    const near = (p: Point, r: number) => Math.hypot(p.x - holder.x, p.z - holder.z) <= r
    const since = (at: number, long: number) => t - at < long
    if (this.won) return 'Out.'
    if (this.climbing) return 'Up! The cover...'
    if (since(this.caughtAt, 2)) return 'No...!'
    if (this.opening && t < 3.5) return 'Where... where am I?'
    if (!this.lit && near(map.lights[0]!, 4)) return 'The lantern... my stick could catch. [F]'
    if (since(this.gassedAt, 2)) return 'The gas! My light...'
    if (since(this.canalAt, 3)) return "The water... they won't come in."
    if (since(this.rushAt, 2.5)) return 'Run!'
    if (since(this.keyAt, 3)) return 'A key, in his hand...'
    if (since(this.chestAt, 3)) return 'A secret!'
    if (since(this.fallenAt, 3)) return "They're falling... the light!"
    if (since(this.hubAt, 3)) return "It's opening!"
    if (since(this.triedAt, 3.5)) return 'Stuck. Two rods hold it... from either side.'
    if (!this.key && near(map.corpse, 1.6)) return 'Someone... [F]'
    if (this.key && !this.chest && near(map.chest, 1.6)) return 'The chest... [F]'
    if (near(map.props.find((prop) => prop.kind === 'sign')!, 2.5)) return 'Gas. Wait for it.'
    if (!this.symbolOpen && map.buttons.some((button) => near(button, 1.2))) return this.pressed.length ? this.pressed.join(' · ') : 'Four signs. Which order? [F]'
    if (!this.pulled.water && holder.x > 26 && holder.z > -15 && holder.z < 0) return 'The chandeliers... stay in their light.'
    return ''
  }

  /** What the interact key would do where he stands, the nearest first: a flame to light the torch at, short of full; a lever not yet pulled; the key, the chest, a button. */
  prompt(): Prompt | undefined {
    const { map, run } = this
    const holder = run.holder
    if (this.climbing || this.won) return undefined
    const d = (p: Point) => Math.hypot(p.x - holder.x, p.z - holder.z)
    const all: Prompt[] = []
    if (run.fuel < 0.99 && !run.raining) {
      run.lights().forEach((light, k) => {
        if (map.level.lights[k]!.flame && light.on && d(light) <= this.runTuning.dip + (map.level.lights[k]!.pad ?? 0)) all.push({ x: light.x, z: light.z, what: 'light' })
      })
    }
    for (const lever of map.levers) if (!this.pulled[lever.name] && d(lever) <= REACH + colliderPad(lever)) all.push({ x: lever.x, z: lever.z, what: 'lever' })
    if (!this.key && d(map.corpse) <= REACH + colliderPad(map.corpse)) all.push({ ...map.corpse, what: 'pick up' })
    if (this.key && !this.chest && d(map.chest) <= REACH + colliderPad(map.chest)) all.push({ ...map.chest, what: 'pick up' })
    if (!this.symbolOpen) for (const button of map.buttons) if (d(button) <= BUTTON_REACH + colliderPad(button)) all.push({ x: button.x, z: button.z, what: 'press' })
    return all.sort((a, b) => d(a) - d(b))[0]
  }

  /** Doors, levers, the key, the chest, the cistern door's buttons, the ladder. */
  private work(dt: number, interact: boolean, pressedNow: boolean): void {
    const { map, run } = this
    const holder = run.holder
    // Each reached from as much further as its body stands out, where it has one (sewers.colliders.ts).
    const near = (p: Point, r = REACH) => Math.hypot(p.x - holder.x, p.z - holder.z) <= r + colliderPad(p)
    // The levers: the hub's moves only once the other two are pulled.
    for (const lever of map.levers) {
      const name = lever.name
      if (this.pulled[name]) continue
      const at = interact && near(lever)
      if (name === 'hub' && at && !(this.pulled.gas && this.pulled.water)) {
        if (pressedNow) this.triedAt = this.t
        this.leverHold.hub = 0
        continue
      }
      this.leverHold[name] = at ? this.leverHold[name] + dt : 0
      if (this.leverHold[name] >= lever.hold) {
        this.pulled[name] = true
        this.leverHold[name] = 0
        if (name === 'water') {
          this.fallen = true
          this.fallenAt = this.t
        }
        if (name === 'hub') {
          this.doorsOpen[map.doors.findIndex((door) => door.name === 'huge door')] = true
          this.hubAt = this.t
        }
      }
    }
    if (pressedNow && !this.key && near(map.corpse)) {
      this.key = true
      this.keyAt = this.t
    }
    if (pressedNow && this.key && !this.chest && near(map.chest)) {
      this.chest = true
      this.chestAt = this.t
    }
    // The cistern door: a symbol a press, four in the plates' order opening it; any other four, nothing.
    if (pressedNow && !this.symbolOpen) {
      const button = map.buttons.find((b) => near(b, BUTTON_REACH))
      if (button) {
        this.pressed.push(button.symbol)
        if (this.pressed.length === 4) {
          const order = [...map.plates].sort((a, b) => a.numeral - b.numeral).map((plate) => plate.symbol)
          if (this.pressed.every((symbol, k) => symbol === order[k])) {
            this.symbolOpen = true
            this.rushAt = this.t
          } else this.wrongAt = this.t
          this.pressed = []
        }
      }
    }
    // The ladder: reached, he climbs it by himself, out of the rats' reach, and pushes the cover open.
    if (!this.climbing && near(map.ladder, 0.9)) this.climbing = true
    if (this.climbing) {
      this.cover += dt
      if (this.cover >= COVER) {
        this.won = true
        run.won = true
      }
    }
  }

  /** After a catch: nothing held, the rats set down away from him. */
  private afterRestart(): void {
    this.life = 1
    this.untouched = 0
    this.climbing = false
    this.cover = 0
    this.pressed = []
    this.doorHold.fill(0)
    this.leverHold = { gas: 0, water: 0, hub: 0 }
    this.wallsChanged()
    this.setAllDown()
  }

  /** The lights that change: the chandeliers swinging, or fallen. */
  private setLights(): void {
    for (const c of this.map.chandeliers) {
      const light = this.map.lights[c.light]!
      const at = this.chandelierAt(c)
      light.x = at.x
      light.z = at.z
      light.reach = this.fallen ? FALLEN_REACH : 1.5
      // Down, a chandelier burns on the floor: a flame the torch is lit again at.
      light.flame = this.fallen
    }
  }

  private wallsChanged(): void {
    const shut = this.shutWalls()
    this.wallsKey = shut.length + (this.symbolOpen ? 's' : '')
    this.run.setHolderWalls([...shut, ...this.map.holderColliders])
    // Every wall, not only those near him, stands for the swarm: the rats are all round, the cistern's far from him.
    // The canal's edge is among them: no rat goes in the water.
    this.swarm.setWalls([...this.map.walls, ...shut, ...this.map.ratWalls])
  }

  /** The fallen chandelier whose light, and ESCAPE_PAD round it, (x, z) is in, or -1; always -1 while they hang. */
  private inFallenLight(x: number, z: number): number {
    if (!this.fallen) return -1
    const { map } = this
    return map.chandeliers.findIndex((c) => {
      const light = map.lights[c.light]!
      return Math.hypot(x - light.x, z - light.z) <= FALLEN_REACH + ESCAPE_PAD
    })
  }

  /**
   * The escape holes: a rat by a hole the light reaches goes in; and once the
   * chandeliers are down, every rat in or near one's light runs straight for
   * the nearest hole, over-ruling the swarm's own steps, and goes in. A rat
   * gone in is set down again in its part, out of his sight: none comes out.
   */
  private escape(dt: number): void {
    const { swarm, map, escaping, escapeAt } = this
    const holes = map.escapes
    // A slot is lit where any of it is: its middle or either end.
    const lit = holes.map((hole) => [-1, 0, 1].some((s) => this.lightNear(hole.x + hole.dx * hole.half * s, hole.z + hole.dz * hole.half * s, 0.6)))
    const anyLit = lit.some(Boolean)
    if (!anyLit && !this.fallen) return
    /** The point of slot `hole` nearest (x, z). */
    const nearest = (hole: (typeof holes)[number], x: number, z: number) => {
      const t = Math.max(-hole.half, Math.min(hole.half, (x - hole.x) * hole.dx + (z - hole.z) * hole.dz))
      return { x: hole.x + hole.dx * t, z: hole.z + hole.dz * t }
    }
    for (let i = 0; i < swarm.count; i++) {
      let x = swarm.x[i]!
      let z = swarm.z[i]!
      if (escaping[i]! < 0) {
        if (anyLit && holes.some((hole, k) => {
          if (!lit[k]) return false
          const p = nearest(hole, x, z)
          return Math.abs(p.x - x) < DIVE && Math.abs(p.z - z) < DIVE
        })) {
          this.goneIn(i)
          continue
        }
        if (this.inFallenLight(x, z) < 0) continue
        let best = 0
        let off = Infinity
        holes.forEach((hole, k) => {
          const p = nearest(hole, x, z)
          const d = Math.hypot(p.x - x, p.z - z)
          if (d < off) {
            off = d
            best = k
          }
        })
        escaping[i] = best
        escapeAt[2 * i] = x
        escapeAt[2 * i + 1] = z
      }
      // Along its own track, wherever the swarm's step put it meanwhile, for the nearest point of its slot.
      x = escapeAt[2 * i]!
      z = escapeAt[2 * i + 1]!
      const hole = nearest(holes[escaping[i]!]!, x, z)
      const dx = hole.x - x
      const dz = hole.z - z
      const d = Math.hypot(dx, dz)
      const step = ESCAPE_SPEED * dt
      if (d <= step) {
        this.goneIn(i)
        continue
      }
      escapeAt[2 * i] = x + (dx / d) * step
      escapeAt[2 * i + 1] = z + (dz / d) * step
      swarm.setDown(i, escapeAt[2 * i]!, escapeAt[2 * i + 1]!)
      swarm.heading[i] = Math.atan2(dz, dx)
    }
  }

  /** Rat `i` into an escape hole: set down again in its part, out of his sight. */
  private goneIn(i: number): void {
    this.escaping[i] = -1
    this.escaped++
    this.scatter(i, EYES)
  }

  /** A rat the swarm put in the canal, set back on the nearer walkway; past the walkways' end, set down again out of sight: no rat goes in. */
  private keepOutOfCanal(): void {
    const { swarm, map } = this
    const { minX, maxX } = map.canalBox
    for (let i = 0; i < swarm.count; i++) {
      const x = swarm.x[i]!
      const z = swarm.z[i]!
      if (!inCanal(map, x, z)) continue
      if (z < WALKWAYS_END) this.scatter(i, EYES)
      else {
        // Set back at a depth of its own and a little along, so the rats set back stand in no line.
        const back = CANAL_BACK[0]! + this.next() * (CANAL_BACK[1]! - CANAL_BACK[0]!)
        swarm.setDown(i, x - minX < maxX - x ? minX - back : maxX + back, z + (this.next() - 0.5) * 0.3)
      }
    }
  }

  /** The lit lights nearest the child, as many as the swarm reads. */
  private nearestLights(lights: FixedLight[]): FixedLight[] {
    const { x, z } = this.run.holder
    return lights
      .filter((light) => light.on)
      .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))
      .slice(0, MAX_LIGHTS)
  }

  /** Whether (x, z) is in a light: the torch's, or a placed one's, grown by `pad` m. */
  private lightNear(x: number, z: number, pad: number): boolean {
    const torch = this.run.torch
    if (torch.lit && Math.hypot(x - torch.x, z - torch.z) < torch.reach + pad + 0.6) return true
    return this.run.lights().some((light) => light.on && Math.hypot(x - light.x, z - light.z) < light.reach + pad)
  }

  /** Whether a rat can stand at (x, z): on the floor, out of the canal, off the walls. */
  private canStand(x: number, z: number): boolean {
    return cellAt(this.map.grid, x, z) === 1 && !inCanal(this.map, x, z) && !this.floorWalls.inside(x, z, this.tuning.ratRadius + 0.02)
  }

  /** Every place a rat can stand, SPOT apart in rows: the hub's side of the huge door, and the cistern. */
  private findSpots(): { before: Point[]; cistern: Point[] } {
    const { map } = this
    const { cistern } = map
    const before: Point[] = []
    const inside: Point[] = []
    const { minX, maxX, minZ, maxZ } = map.level.bounds
    for (let z = minZ + GRID / 2; z < maxZ; z += SPOT) {
      for (let x = minX + GRID / 2; x < maxX; x += SPOT) {
        if (!this.canStand(x, z)) continue
        if (hubSide(x, z)) before.push({ x, z })
        else if (Math.hypot(x - cistern.x, z - cistern.z) < cistern.r) inside.push({ x, z })
      }
    }
    return { before, cistern: inside }
  }

  /** Whether rat `i` may be set down elsewhere unseen: further than its notice, and out of the child's sight. `sight` taken near him first. */
  private spare(i: number): boolean {
    const holder = this.run.holder
    const x = this.swarm.x[i]!
    const z = this.swarm.z[i]!
    const d = Math.hypot(x - holder.x, z - holder.z)
    if (d <= NOTICE) return false
    return d > EYES || this.sight.ray(holder.x, holder.z, (x - holder.x) / d, (z - holder.z) / d, d) < d - 0.3
  }

  /** Every rat set down again all round, evenly, away from him: on the hub's side of the huge door; once he is past the canal, most of them in the cistern. */
  private setAllDown(): void {
    const { swarm, cisterns } = this
    this.escaping.fill(-1)
    const gathered = this.stage >= 2 ? Math.floor(swarm.count * GATHER) : 0
    const before: number[] = []
    const inside: number[] = []
    for (let i = 0; i < swarm.count; i++) {
      cisterns[i] = i < gathered ? 1 : 0
      ;(cisterns[i] ? inside : before).push(i)
    }
    this.spread(before, this.spots.before, AWAY)
    this.spread(inside, this.spots.cistern, AWAY)
  }

  /** Rats `ids` laid evenly over `spots`, out of the lights and `away` from him: the spots in rows, every so many taken. */
  private spread(ids: number[], spots: Point[], away: number): void {
    if (ids.length === 0) return
    const holder = this.run.holder
    const free = spots.filter((p) => Math.hypot(p.x - holder.x, p.z - holder.z) >= away && !this.lightNear(p.x, p.z, 0))
    const from = free.length ? free : spots
    ids.forEach((i, k) => this.setDownAt(i, from[Math.floor(((k + 0.5) * from.length) / ids.length)]!))
  }

  /** Rat `i` set down anywhere it can stand in its part, the cistern or the hub's side of the huge door, out of the lights and `away` from him: as near as tries find. */
  private scatter(i: number, away: number): void {
    const holder = this.run.holder
    const spots = this.cisterns[i] ? this.spots.cistern : this.spots.before
    let at = spots[Math.floor(this.next() * spots.length)]!
    for (let tries = 0; tries < 20; tries++) {
      if (Math.hypot(at.x - holder.x, at.z - holder.z) >= away && !this.lightNear(at.x, at.z, 0)) break
      at = spots[Math.floor(this.next() * spots.length)]!
    }
    this.setDownAt(i, at)
  }

  /** Rat `i` set down by the spot `at`, a little off it where it can stand there too, in the same part. */
  private setDownAt(i: number, at: Point): void {
    const x = at.x + (this.next() - 0.5) * SPOT
    const z = at.z + (this.next() - 0.5) * SPOT
    const ok = this.canStand(x, z) && hubSide(x, z) === hubSide(at.x, at.z)
    this.swarm.setDown(i, ok ? x : at.x, ok ? z : at.z)
  }

  /** While he wades the canal: the rats left out of his sight set down again in the cistern ahead, evenly, till most of them are there. */
  private gather(): void {
    const { swarm, cisterns } = this
    let n = Math.floor(swarm.count * GATHER)
    for (let i = 0; i < swarm.count; i++) n -= cisterns[i]!
    if (n <= 0) return
    const holder = this.run.holder
    this.sight.nearTo(holder.x, holder.z, 200)
    const ids: number[] = []
    for (let i = 0; i < swarm.count && ids.length < n; i++) {
      if (cisterns[i] || !this.spare(i)) continue
      cisterns[i] = 1
      ids.push(i)
    }
    this.spread(ids, this.spots.cistern, AWAY)
  }
}
