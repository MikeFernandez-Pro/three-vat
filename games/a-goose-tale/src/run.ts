// The run (#173): the goose game's walk and torch, pure and stepped by input,
// with no renderer, no DOM and no swarm of its own, so it is tested in Node.
// The goose play (gooseplay.ts) hands it a frame's input, where the keys send
// the holder and how fast, and reads back where the holder stands, the way he
// faces, the torch, and the level's lights and walls as they stand, which it
// hands on to the swarm. Everything else in the game, the goslings, the
// scenes, the bites and the filling of the torch at a fire, is the goose
// play's own.
//
// The torch is a clock. Its fuel burns at a steady rate from the holder's
// first step, standing or walking; its reach holds full for most of the fuel and shrinks over the
// last part, along its curve, to its least and then nothing; at empty it goes
// out, and stays out until the goose play fills it again.
//
// The holder walks toward where he is sent, at the speed asked, a metre
// inside the arena, along any of the level's walls he meets and never through
// it.
//
// Nothing is drawn at random: the same inputs give the same run.
import { walkLight, type Bounds, type FixedLight } from './swarm'
import { Walls, type Wall } from './walls'

/**
 * A light the level places: where it stands, how far it reaches, m, whether
 * it is a flame the torch can be filled at, and whether it is lit.
 */
export interface PlacedLight {
  x: number
  z: number
  reach: number
  flame: boolean
  on: boolean
  /** How far round (x, z) its body stands, m, where the level has one (a collider): the torch is filled at it from that much further. */
  pad?: number
}

/** The level, as data: where the holder starts, the lights, the walls, and the box the rats start in. */
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
  /** How far the torch still reaches with the last of its fuel, m, before it goes out: nothing unless set. */
  torchLeast?: number
  /** The way the reach shrinks over `fade`: 1 straight, under 1 holding it longer and dropping late, over 1 dropping early. */
  fadeCurve?: number
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
})

/** A frame of the player's input. */
export interface RunInput {
  /** The frame's time, s. */
  dt: number
  /** Where the keys send the holder, or nothing held. */
  toward: { x: number; z: number } | null
  /** How fast the holder walks, m/s. */
  speed: number
  /** The arena's radius, m: the holder stays a metre inside it. */
  arena: number
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
  /** Whether the holder has set off: the torch burns only from his first step. */
  started = false
  /** The way the holder faces: the way he last walked, a unit direction, north at first. */
  readonly facing = { x: 0, z: -1 }
  /** The level's walls, which the holder walks along and never through. */
  private readonly holderWalls: Walls

  constructor(
    /** The level: read live, so its lights' reach can be tuned as the run goes. */
    readonly level: Level,
    /** The tuning: read live, every step. */
    readonly tuning: RunTuning,
  ) {
    this.holder = { ...level.start }
    this.holderWalls = new Walls(level.walls)
  }

  /** The torch as it stands. */
  get torch(): Torch {
    const { fuel, tuning } = this
    const share = tuning.fade > 0 ? Math.min(1, fuel / tuning.fade) : fuel > 0 ? 1 : 0
    const least = Math.min(tuning.torchLeast ?? 0, tuning.torchReach)
    const reach = fuel > 0 ? least + (tuning.torchReach - least) * share ** (tuning.fadeCurve ?? 1) : 0
    return { x: this.holder.x, z: this.holder.z, reach, lit: fuel > 0 }
  }

  /** The level's lights as they stand, for the swarm. */
  lights(): FixedLight[] {
    return this.level.lights.map(({ x, z, reach, on }) => ({ x, z, reach, on }))
  }

  /** The level's walls, for the swarm and the lit areas. */
  walls(): Wall[] {
    return [...this.level.walls]
  }

  /** One step of the run: the holder walks, along any wall he meets, turning the way he goes, and the torch burns once he has set off. */
  step(input: RunInput): void {
    const { holder, facing } = this
    const { toward } = input
    if (toward !== null) {
      this.started = true
      const d = Math.hypot(toward.x - holder.x, toward.z - holder.z)
      if (d > 1e-9) {
        facing.x = (toward.x - holder.x) / d
        facing.z = (toward.z - holder.z) / d
      }
      walkLight(input.arena, holder, toward, input.dt, input.speed, this.holderWalls)
    }
    if (this.started) this.fuel = Math.max(0, this.fuel - this.tuning.burnRate * input.dt)
  }
}
