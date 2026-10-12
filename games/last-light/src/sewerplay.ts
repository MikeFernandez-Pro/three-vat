// PROTOTYPE: the sewers' play step (2026-10-12), headless, as the 2D page
// drives it and as a 3D page will: one frame at a time, fed the keys, read
// for what to draw. Nothing here draws.
//
// The run (run.ts) walks the child along the walls, burns the torch and
// refuels it at the flames, and catches the player; the swarm (swarm.ts) runs
// the rats. Everything new is scripted here on top, for now: the boat in the
// gutter; doors pushed open by holding the interact key; three levers, the
// hub's moving only once the branches' two have drawn their rods; the gas
// jets out of the walls, shut off by the gas branch's lever, the bats in the
// chandeliers' gallery and the cascade putting the torch out, no rat crossing the cascade; the chandeliers swinging, and
// falling once the water branch's lever is pulled; the key on the worker and
// the hub's chest; the cistern's plates, seen only in the light, and its
// door of symbols pressed in their order; the beam walked on balance; the
// ladder and the manhole cover.
//
// The rats come out of holes and pipes in the walls, each live from its part
// of the run on, and dive back into a hole the light reaches. They are a
// budget: a rat further off than its notice and out of the child's sight is
// set down again at a live hole ahead of him, out of the light. Groups set
// down at the start wait where they are until he comes within their notice.
// A few rats at the child with no light catch him only once they have held
// on for the grip.
//
// Progress is never lost: a lever pulled, a door opened, the key, stay so.
// Caught, the run starts again at its last checkpoint zone, the hub or the
// cistern, or at the start, the rats set down again away from him.
//
// Nothing is drawn at random: the same inputs give the same play.
import { NOTICE, gameTuning } from './gameplay'
import { SteppedSwarm } from './play'
import { defaultRunTuning, Run } from './run'
import { cellAt, sewers, type Chandelier, type Glyph, type HoleWhen, type Point, type Sewers } from './sewers'
import { random, type Bounds, type FixedLight, type Light, type StepReport, type Tuning } from './swarm'
import { MAX_LIGHTS } from './litareas'
import { Walls, nearestWalls, type Wall } from './walls'

const TAU = Math.PI * 2
const SEED = 11
/** How fast the child walks and runs, m/s: running is slower than the fastest rats (2.3). */
export const WALK = 1.6
export const RUN = 2.1
/** How fast he goes through the squeeze and along the beam, m/s. */
const SQUEEZE_SPEED = 0.9
const BEAM_SPEED = 0.9
/** How fast the boat drifts, m/s. */
export const BOAT_SPEED = 1.1
/** How near the child reaches to push, pull, pick up or press, m. */
const REACH = 0.95
const BUTTON_REACH = 0.6
/** How long rats at him with no light hold on before they drag him down, s. */
const GRIP = 2
/** How far the chandeliers' fallen light reaches, m. */
const FALLEN_REACH = 3.2
/** How near the child a plate is seen in the torch's light, m, and in a placed light's, as a share of its reach. */
const PLATE_SEEN = 1.8
const PLATE_IN_LIGHT = 1.6
/** Spawning: the share of the rats a second set down again; how near and how far ahead a hole lets them out, m. */
const RESPAWN_RATE = 0.3
const HOLE_NEAR = 3
const HOLE_FAR = 12
/** How far the eye sees a rat, m: further, or out of sight, a rat may be set down again. */
const EYES = 12
/** How near a hole a rat dives into it when the light reaches the hole, m. */
const DIVE = 0.9
/** The beam's balance: how fast a lean grows on its own, how hard the beam sways him walking and standing, how hard a key brings him back, a second. */
const LEAN_GROW = 0.9
const SWAY_WALKING = 0.5
const SWAY_STANDING = 0.15
const CORRECT = 1.5
/** How long the manhole cover is pushed, s. */
const COVER = 3
/** How many rats each wave lets out. */
const RUSH_WAVE = 180
/** How far from the child a waiting group's rats are set down when the run starts again by them, m. */
const AWAY = 4
/** How far the walls handed to the swarm reach round the child, refreshed each RESTREAM m he walks. */
const RESTREAM = 1

/** A frame of the player's input. */
export interface SewerInput {
  /** Where the keys send him, a unit direction, or nothing held: x east, z south. */
  heading: Point | null
  run?: boolean
  /** The interact key held: Space. */
  interact?: boolean
}

export interface SewerSettings {
  /** The rats' budget, read at the start. */
  rats: number
  /** Whether the beam's balance can fail: off, he walks it like any floor. */
  balance: boolean
  /** Whether the torch never burns out: for exploring. */
  everlasting: boolean
}

export const inBox = (b: Bounds, p: Point) => p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ

export class SewerPlay {
  readonly map: Sewers = sewers()
  readonly settings: SewerSettings
  readonly tuning: Tuning = gameTuning()
  readonly runTuning = defaultRunTuning()
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
  /** The beam: whether he is on it, and his lean, -1 fallen left to 1 fallen right. */
  onBeam = false
  lean = 0
  /** At the ladder: climbing, and how long the cover has been pushed, s. */
  climbing = false
  cover = 0
  won = false
  /** When the bats came. */
  batsAt = Number.NaN
  /** When the gas, the cascade, the rush, and the last catch came, s: NaN, not yet. */
  gassedAt = Number.NaN
  cascadeAt = Number.NaN
  rushAt = Number.NaN
  caughtAt = Number.NaN
  fellAt = Number.NaN
  keyAt = Number.NaN
  chestAt = Number.NaN
  fallenAt = Number.NaN
  hubAt = Number.NaN
  wrongAt = Number.NaN
  /** How long enough rats have held on to him in the dark, s. */
  gripped = 0
  /** Whether the hub lever was tried before the branches were done, and when. */
  triedAt = Number.NaN

  private readonly next: () => number
  private readonly floorWalls: Walls
  private ratWalls: Wall[] = []
  private readonly streamedAt = { x: Number.NaN, z: Number.NaN }
  private wallsKey = ''
  /** Which rats wait where the level put them, the group's index and one, 0 none. */
  private waiting: Uint8Array
  private owed = 0
  private cursor = 0
  private startsSeen = 0
  private interactWas = false

  constructor(settings: Partial<SewerSettings> = {}, seed = SEED) {
    this.settings = { rats: 700, balance: true, everlasting: false, ...settings }
    this.next = random(seed)
    const { map } = this
    this.sight = new Walls(map.sight)
    this.floorWalls = new Walls(map.walls)
    this.swarm = new SteppedSwarm(4096, seed, 1, { walls: nearestWalls(map.walls, map.level.start.x, map.level.start.z), bounds: map.level.bounds })
    this.waiting = new Uint8Array(this.swarm.capacity)
    this.begin()
  }

  get holder(): Point {
    return this.run.holder
  }

  /** The light left in the torch, s. */
  get left(): number {
    return this.run.fuel / this.runTuning.burnRate
  }

  /** Where the boat is, or none once it has slipped into the culvert. */
  boat(): (Point & { heading: number }) | undefined {
    let s = this.t * BOAT_SPEED
    const path = this.map.boatPath
    for (let k = 0; k + 1 < path.length; k++) {
      const a = path[k]!
      const b = path[k + 1]!
      const l = Math.hypot(b.x - a.x, b.z - a.z)
      if (s <= l) return { x: a.x + ((b.x - a.x) * s) / l, z: a.z + ((b.z - a.z) * s) / l, heading: Math.atan2(b.z - a.z, b.x - a.x) }
      s -= l
    }
    return undefined
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

  /** Where chandelier `c` hangs now. */
  chandelierAt(c: Chandelier): Point {
    if (this.fallen) return c.pivot
    const s = Math.sin((TAU * this.t) / c.period + c.phase) * c.amplitude
    return { x: c.pivot.x + c.axis.x * s, z: c.pivot.z + c.axis.z * s }
  }

  /** Whether hole `when` lets rats out now. */
  live(when: HoleWhen): boolean {
    const levers = Number(this.pulled.gas) + Number(this.pulled.water)
    switch (when) {
      case 'start':
      case 'hub0':
      case 'gas':
      case 'nave':
        return true
      // The cistern's holes let rats out only once he is at its threshold: the cave before it stays empty.
      case 'cistern':
        return this.stage >= 2
      case 'hub1':
        return levers >= 1
      case 'hub2':
        return levers >= 2
      case 'push':
        return this.leverHold.hub > 0 || this.pulled.hub
      case 'rush':
        return this.symbolOpen
    }
  }

  /** The walls as they stand: the floor's edge, and every door still shut. */
  shutWalls(): Wall[] {
    const { map } = this
    const shut = map.doors.filter((_, k) => !this.doorsOpen[k])
    return [...shut, ...(this.symbolOpen ? [] : [map.symbolDoor])]
  }

  /** From the very start: on the quay, the stick unlit, every door shut, no rat near. */
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
    this.onBeam = this.climbing = this.won = false
    this.lean = this.cover = this.gripped = 0
    this.batsAt = this.gassedAt = this.cascadeAt = this.rushAt = this.caughtAt = this.fellAt = Number.NaN
    this.keyAt = this.chestAt = this.fallenAt = this.hubAt = this.wrongAt = this.triedAt = Number.NaN
    this.facing.x = 1
    this.facing.z = 0
    this.setChandeliers()
    this.wallsChanged()
    this.swarm.reset(this.settings.rats)
    this.setAllDown()
  }

  /**
   * Straight to a point of the run, what comes before it done: 0 the start; 1
   * the hub, first time; 2 the hub, the gas branch done and the key carried; 3
   * the hub lever, both branches done; 4 the cistern; 5 the cistern door
   * opened, the rush on; 6 the beam's near end.
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
    const at = [undefined, undefined, undefined, { x: map.levers[2]!.x, z: map.levers[2]!.z + 0.4 }, undefined, { x: 4.2, z: -64.6 }, { x: 4.2, z: -73.2 }][point]
    if (at) {
      run.holder.x = at.x
      run.holder.z = at.z
    }
    if (point >= 5) this.rushAt = this.t
    this.startsSeen = run.starts
    this.setChandeliers()
    this.wallsChanged()
    this.setAllDown()
  }

  /** One frame. */
  frame(dt: number, input: SewerInput): void {
    if (this.won) return
    const { map, run, swarm, runTuning } = this
    this.t += dt
    const holder = run.holder
    const interact = input.interact === true
    const pressedNow = interact && !this.interactWas
    this.interactWas = interact

    // The keys: on the beam, ahead and back only, the sideways keys his balance; at the ladder, nothing moves him.
    this.onBeam = this.isOnBeam(holder)
    let heading = input.heading
    let sideways = 0
    // On the beam the keys are his own: W on along it, S back, A and D his balance, whichever way it runs.
    const { from: bf, to: bt } = map.beam
    const bl = Math.hypot(bt.x - bf.x, bt.z - bf.z)
    const bx = (bt.x - bf.x) / bl
    const bz = (bt.z - bf.z) / bl
    if (this.onBeam && heading !== null) {
      sideways = Math.sign(heading.x)
      heading = Math.abs(heading.z) > 0.01 ? { x: bx * -Math.sign(heading.z), z: bz * -Math.sign(heading.z) } : null
    }
    if (this.climbing) heading = null
    this.going.x = heading?.x ?? 0
    this.going.z = heading?.z ?? 0
    this.running = input.run === true && heading !== null && !this.onBeam
    let speed = this.running ? RUN : WALK
    if (inBox(map.squeeze, holder)) speed = Math.min(speed, SQUEEZE_SPEED)
    if (this.onBeam) speed = BEAM_SPEED
    // Along the beam, he is kept on its line.
    const onLine = (along: number) => ({ x: bf.x + bx * along, z: bf.z + bz * along })
    const alongBeam = (holder.x - bf.x) * bx + (holder.z - bf.z) * bz
    const toward = heading === null ? null : this.onBeam ? onLine(alongBeam + heading.x * bx + heading.z * bz) : { x: holder.x + heading.x, z: holder.z + heading.z }

    // The run: a catch counts only once enough rats have held on for the grip, never on the ladder.
    const atHim = this.report?.reached ?? 0
    const dark = run.fuel <= 0
    this.gripped = dark && atHim >= runTuning.catchCount && !this.climbing ? this.gripped + dt : 0
    const reached = this.gripped >= GRIP ? atHim : 0
    const wasLit = run.fuel > 0
    run.step({ dt, toward, speed, arena: swarm.arena, interact: false, reached })
    if (toward !== null) {
      this.facing.x = run.facing.x
      this.facing.z = run.facing.z
    }

    // Gas and the cascade put the torch out.
    if (map.jets.some((_, k) => this.jetting(k) && this.inJet(k, holder))) {
      if (run.fuel > 0) this.gassedAt = this.t
      run.fuel = 0
    }
    // The bats, out of the vault before the first chandelier, until the chandeliers are down.
    if (!this.pulled.water && inBox(map.bats, holder) && run.fuel > 0) {
      this.batsAt = this.t
      run.fuel = 0
    }
    if (inBox(map.cascade, holder)) {
      if (run.fuel > 0) this.cascadeAt = this.t
      run.fuel = 0
    }
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
    this.balance(dt, sideways)
    this.setChandeliers()
    const key = this.shutWalls().length + (this.symbolOpen ? 's' : '')
    if (key !== this.wallsKey) this.wallsChanged()

    // The plates in the light.
    const torch = run.torch
    const lights = run.lights()
    this.platesSeen = map.plates.map((plate) => {
      if (torch.lit && Math.hypot(plate.x - holder.x, plate.z - holder.z) <= PLATE_SEEN) return true
      return lights.some((light) => light.on && Math.hypot(plate.x - light.x, plate.z - light.z) <= light.reach * PLATE_IN_LIGHT)
    })

    // The rats: waiting ones the child comes near are free; the light drives rats into the holes it reaches; the rats
    // doing nothing come out again ahead of him.
    const { waiting } = this
    for (let i = 0; i < swarm.count; i++) if (waiting[i] && Math.hypot(swarm.x[i]! - holder.x, swarm.z[i]! - holder.z) <= NOTICE) waiting[i] = 0
    this.dive()
    this.respawn(dt)
    this.stream(false)

    const light = this.torchLight
    light.x = torch.x
    light.z = torch.z
    light.strength = torch.reach / this.tuning.ringMax
    light.on = torch.lit
    this.report = swarm.advance(dt, light, this.tuning, this.nearestLights(lights))
  }

  /** The line the child says now, or none. Placeholders. */
  line(): string {
    const { t, run, map } = this
    const holder = run.holder
    const near = (p: Point, r: number) => Math.hypot(p.x - holder.x, p.z - holder.z) <= r
    const since = (at: number, long: number) => t - at < long
    if (this.won) return 'Out.'
    if (this.climbing) return 'Up! Push the cover: hold Space'
    if (since(this.caughtAt, 2)) return 'No...!'
    if (since(this.fellAt, 2)) return 'I fell...'
    if (this.opening && t < 3.5) return 'Where... where am I?'
    if (!this.lit && near(map.lights[0]!, 4)) return 'The lantern... my stick could catch.'
    if (since(this.gassedAt, 2)) return 'The gas! My light...'
    if (since(this.batsAt, 2.5)) return 'Bats! My light... the chandeliers!'
    if (since(this.cascadeAt, 2.5)) return 'The water... no light!'
    if (since(this.rushAt, 2.5)) return 'Run!'
    if (since(this.keyAt, 3)) return 'A key, in his hand...'
    if (since(this.chestAt, 3)) return 'A secret!'
    if (since(this.fallenAt, 3)) return "They're falling... the light!"
    if (since(this.hubAt, 3)) return "It's opening!"
    if (since(this.triedAt, 3.5)) return 'Stuck. Two rods hold it... from either side.'
    if (this.onBeam) return 'Careful... W on, A / D to keep balance'
    if (inBox(map.squeeze, holder)) return 'Tight... sideways.'
    if (!this.key && near(map.corpse, 1.6)) return 'Someone... [Space]'
    if (this.key && !this.chest && near(map.chest, 1.6)) return 'The chest... [Space]'
    if (near(map.props.find((prop) => prop.kind === 'sign')!, 2.5)) return 'Gas. Wait for it.'
    if (!this.symbolOpen && map.buttons.some((button) => near(button, 1.2))) return this.pressed.length ? this.pressed.join(' · ') : 'Four signs. Which order? [Space]'
    if (!this.pulled.water && holder.x > 26 && holder.z > -15 && holder.z < 0) return 'The chandeliers... stay in their light.'
    return ''
  }

  /** Doors, levers, the key, the chest, the cistern door's buttons, the ladder. */
  private work(dt: number, interact: boolean, pressedNow: boolean): void {
    const { map, run } = this
    const holder = run.holder
    const near = (p: Point, r = REACH) => Math.hypot(p.x - holder.x, p.z - holder.z) <= r
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
            this.wave('rush', RUSH_WAVE)
          } else this.wrongAt = this.t
          this.pressed = []
        }
      }
    }
    // The ladder: climbing, out of the rats' reach; the cover pushed open.
    if (!this.climbing && near(map.ladder, 0.9)) this.climbing = true
    if (this.climbing) {
      this.cover = interact ? this.cover + dt : 0
      if (this.cover >= COVER) {
        this.won = true
        run.won = true
      }
    }
  }

  /** The beam: on it, his lean grows by itself and the beam sways him, more walking; the sideways keys bring him back; too far, he falls. */
  private balance(dt: number, sideways: number): void {
    if (!this.onBeam) {
      this.lean = 0
      return
    }
    const t = this.t
    const sway = 0.6 * Math.sin(1.7 * t) + 0.4 * Math.sin(2.9 * t + 1.3)
    const walking = this.going.z !== 0
    this.lean += (LEAN_GROW * this.lean + sway * (walking ? SWAY_WALKING : SWAY_STANDING) + CORRECT * sideways) * dt
    if (!this.settings.balance) this.lean = 0
    if (Math.abs(this.lean) >= 1) {
      this.fellAt = this.t
      this.lean = 0
      const { run, map } = this
      run.startAt(-1, { zone: this.stage >= 2 ? map.cisternZone : this.stage >= 1 ? map.hubZone : undefined })
      this.startsSeen = run.starts
      this.caught++
      this.afterRestart()
    }
  }

  private isOnBeam(p: Point): boolean {
    const { from, to } = this.map.beam
    const l = Math.hypot(to.x - from.x, to.z - from.z)
    const ux = (to.x - from.x) / l
    const uz = (to.z - from.z) / l
    const along = (p.x - from.x) * ux + (p.z - from.z) * uz
    const across = (p.x - from.x) * -uz + (p.z - from.z) * ux
    return Math.abs(across) <= 0.6 && along >= 0.6 && along <= l - 0.6
  }

  /** After a catch or a fall: nothing held, the rats set down away from him. */
  private afterRestart(): void {
    this.gripped = 0
    this.lean = 0
    this.climbing = false
    this.cover = 0
    this.pressed = []
    this.doorHold.fill(0)
    this.leverHold = { gas: 0, water: 0, hub: 0 }
    this.wallsChanged()
    this.setAllDown()
  }

  private setChandeliers(): void {
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
    this.run.setHolderWalls(shut)
    this.ratWalls = [...this.map.walls, ...shut, this.map.cascadeWall]
    this.stream(true)
  }

  /** The walls nearest the child handed to the swarm, if he has walked RESTREAM since, or `now`. */
  private stream(now: boolean): void {
    const holder = this.run.holder
    const at = this.streamedAt
    if (!now && Math.hypot(holder.x - at.x, holder.z - at.z) < RESTREAM) return
    at.x = holder.x
    at.z = holder.z
    this.swarm.setWalls(nearestWalls(this.ratWalls, holder.x, holder.z))
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

  /** Set rat `i` down within `r` of `p`, on the floor and off the walls, and at least `away` m from the child. */
  private setDownNear(i: number, p: Point, r: number, away = 0): void {
    const holder = this.run.holder
    let x = p.x
    let z = p.z
    for (let tries = 0; tries < 10; tries++) {
      const a = this.next() * TAU
      const d = Math.sqrt(this.next()) * r
      const tx = p.x + Math.cos(a) * d
      const tz = p.z + Math.sin(a) * d
      if (cellAt(this.map.grid, tx, tz) === 1 && !this.floorWalls.inside(tx, tz, 0.12) && Math.hypot(tx - holder.x, tz - holder.z) >= away) {
        x = tx
        z = tz
        break
      }
    }
    this.swarm.setDown(i, x, z)
  }

  /** Whether rat `i` may be set down elsewhere: not waiting, further than its notice, and out of the child's sight. `sight` taken near him first. */
  private spare(i: number): boolean {
    if (this.waiting[i]) return false
    const holder = this.run.holder
    const x = this.swarm.x[i]!
    const z = this.swarm.z[i]!
    const d = Math.hypot(x - holder.x, z - holder.z)
    if (d <= NOTICE) return false
    return d > EYES || this.sight.ray(holder.x, holder.z, (x - holder.x) / d, (z - holder.z) / d, d) < d - 0.3
  }

  /** Every rat set down again: the waiting groups where the child is not near them, the rest at live holes away from him. */
  private setAllDown(): void {
    const { swarm, map, waiting } = this
    const holder = this.run.holder
    waiting.fill(0)
    let i = 0
    // The rats round him at the start are there only when he starts there, and are on him at once; the rest wait.
    const atStart = Math.hypot(holder.x - map.level.start.x, holder.z - map.level.start.z) < 1
    map.waiting.forEach((group, g) => {
      if (group.round && !atStart) return
      for (let k = 0; k < group.count && i < swarm.count; k++, i++) {
        this.setDownNear(i, group, group.r, group.round ? 0 : AWAY)
        if (!group.round) waiting[i] = g + 1
      }
    })
    const far = map.holes.filter((hole) => this.live(hole.when) && Math.hypot(hole.x - holder.x, hole.z - holder.z) > NOTICE + 6)
    const holes = far.length ? far : map.holes.filter((hole) => Math.hypot(hole.x - holder.x, hole.z - holder.z) > NOTICE + 6)
    for (let k = 0; i < swarm.count; i++, k++) this.setDownNear(i, holes[k % holes.length]!, 1.4)
  }

  /** `n` rats to spare let out of the live holes of `when`. */
  private wave(when: HoleWhen, n: number): void {
    const holes = this.map.holes.filter((hole) => hole.when === when)
    if (holes.length === 0) return
    this.sight.nearTo(this.run.holder.x, this.run.holder.z, 200)
    for (let i = 0, k = 0; i < this.swarm.count && k < n; i++) {
      if (!this.spare(i)) continue
      this.setDownNear(i, holes[k % holes.length]!, 0.8)
      k++
    }
  }

  /** The rats by a hole the light reaches dive into it, and come out of a dark live hole away from the child. */
  private dive(): void {
    const { map, swarm } = this
    const holder = this.run.holder
    const lit = map.holes.filter((hole) => this.lightNear(hole.x, hole.z, 0.6))
    if (lit.length === 0) return
    const dark = map.holes.filter((hole) => this.live(hole.when) && !this.lightNear(hole.x, hole.z, 1) && Math.hypot(hole.x - holder.x, hole.z - holder.z) > NOTICE)
    if (dark.length === 0) return
    for (let i = 0; i < swarm.count; i++) {
      if (this.waiting[i]) continue
      const x = swarm.x[i]!
      const z = swarm.z[i]!
      if (lit.some((hole) => Math.abs(hole.x - x) < DIVE && Math.abs(hole.z - z) < DIVE)) this.setDownNear(i, dark[Math.floor(this.next() * dark.length)]!, 0.8)
    }
  }

  /** The rats doing nothing set down again at the live holes ahead of the child, a share of them a second. */
  private respawn(dt: number): void {
    const { map, swarm, facing } = this
    const holder = this.run.holder
    const holes = map.holes.filter((hole) => {
      if (!this.live(hole.when)) return false
      const dx = hole.x - holder.x
      const dz = hole.z - holder.z
      const d = Math.hypot(dx, dz)
      if (d < HOLE_NEAR || d > HOLE_FAR || this.lightNear(hole.x, hole.z, 1)) return false
      return dx * facing.x + dz * facing.z >= -0.25 * d
    })
    if (holes.length === 0) return
    this.owed = Math.min(this.owed + swarm.count * RESPAWN_RATE * dt, swarm.count)
    let n = Math.floor(this.owed)
    this.owed -= n
    this.sight.nearTo(holder.x, holder.z, 200)
    for (let seen = 0; seen < swarm.count && n > 0; seen++) {
      const i = this.cursor
      this.cursor = (this.cursor + 1) % swarm.count
      if (!this.spare(i)) continue
      this.setDownNear(i, holes[Math.floor(this.next() * holes.length)]!, 0.6)
      n--
    }
  }
}
