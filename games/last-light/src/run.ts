// The run (#173): the game's rules, pure and stepped by input, with no
// renderer, no DOM and no swarm of its own, so it is tested in Node. The
// page hands it a frame's input (where the keys send the holder, the interact
// key, and how many rats the swarm last found at the holder) and hands the
// swarm what it gives back: the torch, and the level's lights as they stand.
//
// The torch is a clock. Its fuel burns at a steady rate; its reach holds
// full for most of the fuel and shrinks to nothing over the last part; at
// empty it goes out, and the swarm closes the front on the holder. Dipped
// into a flame, within touching distance of it, the torch is filled again; a
// light that is not a flame, a lit window, holds rats off but refuels
// nothing. With the torch out, enough rats at the holder catch the player,
// and the run starts again: the holder at the start, the torch full.
//
// Nothing is drawn at random: the same inputs give the same run.
import { walkLight, type Bounds, type FixedLight } from './swarm'
import { Walls, type Wall } from './walls'

/** A light the level places: where it stands, how far it reaches, m, whether it is a flame the torch can be dipped into, and whether it is lit. */
export interface PlacedLight {
  x: number
  z: number
  reach: number
  flame: boolean
  on: boolean
}

/** The level, as data: where the holder starts, the lights, the walls, and the box the rats start in, everywhere in it that is dark. */
export interface Level {
  start: { x: number; z: number }
  lights: PlacedLight[]
  walls: Wall[]
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
}

/**
 * A full torch burns out in half a minute, its reach shrinking over the last
 * quarter: a few braziers' walk at a jog. The reach as the strength slider
 * left it, 0.26 of the swarm's 3 m. A start to tune from the panel.
 */
export const defaultRunTuning = (): RunTuning => ({
  burnRate: 1 / 30,
  fade: 0.25,
  torchReach: 0.78,
  dip: 0.8,
  catchCount: 4,
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
  /** The level's walls, which the holder walks along and never through. */
  private readonly walls: Walls

  constructor(
    /** The level: read live, so its lights' reach can be tuned as the run goes. */
    readonly level: Level,
    /** The tuning: read live, every step. */
    readonly tuning: RunTuning,
  ) {
    this.holder = { ...level.start }
    this.walls = new Walls(level.walls)
  }

  /** The torch as it stands. */
  get torch(): Torch {
    const { fuel, tuning } = this
    const share = tuning.fade > 0 ? Math.min(1, fuel / tuning.fade) : fuel > 0 ? 1 : 0
    return { x: this.holder.x, z: this.holder.z, reach: tuning.torchReach * share, lit: fuel > 0 }
  }

  /** The level's lights as they stand, for the swarm. */
  lights(): FixedLight[] {
    return this.level.lights.map(({ x, z, reach, on }) => ({ x, z, reach, on }))
  }

  /** One step of the run: the holder walks, along any wall it meets, the torch burns, a flame refuels it, and the rats at a holder with no light catch the player. */
  step(input: RunInput): void {
    const { holder, tuning } = this
    // Caught on what the swarm saw last: at the holder, with the torch already out.
    if (this.fuel <= 0 && input.reached >= tuning.catchCount) {
      this.restart()
      return
    }
    if (input.toward !== null) walkLight(input.arena, holder, input.toward, input.dt, input.speed, this.walls)
    this.fuel = Math.max(0, this.fuel - tuning.burnRate * input.dt)
    for (const light of this.level.lights) {
      if (!light.flame || !light.on) continue
      if (Math.hypot(holder.x - light.x, holder.z - light.z) <= tuning.dip) this.fuel = 1
    }
  }

  /** Caught: the run starts again, the holder at the start with a full torch. */
  private restart(): void {
    this.caught++
    this.holder.x = this.level.start.x
    this.holder.z = this.level.start.z
    this.fuel = 1
  }
}
