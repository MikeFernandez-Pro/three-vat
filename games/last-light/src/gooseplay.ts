// The goose play (#187): the goose game, one frame at a time, headless, as the
// 3D page drives it at `#goose`. The page builds one, hands it its swarm,
// feeds it the keys and draws what it reports: the goose, her torch, the
// braziers, the goslings waiting, in her circle or taken, the pond, and the
// count. Nothing here draws.
//
// The plain (plain.ts) is the seed's: a route of braziers heading north to the
// pond. The run (run.ts) walks the goose, burns her torch, its flame shrinking
// over the last of its fuel; nothing fills it but the interact key held at a
// fire, in its dip, or at the well's lantern (`work`), over its set time; the
// swarm (swarm.ts) runs the rats, which start round her, out of her light,
// and those left behind out of her sight are brought round ahead of her, so
// the goslings waiting ahead meet them as she does. The rest is the goose
// play's own:
//
// - Each brazier has a gosling waiting in its light, which joins her circle as
//   she walks into that light. A gosling walks by itself, on its own legs, at
//   its own top pace, a little over her walk: it comes over to her, then
//   follows its place in an arc close round her back and sides, a moment behind it and
//   swaying a little, each its own way. Nothing moves it but its own steps:
//   walking, she keeps them in her light; running, she leaves them behind.
// - A debug key, a number, gives her that many goslings at once; others stand
//   her back where she starts (`standAtStart`), by the well's zone and by the
//   dead tree's (`standBy`).
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
// - The well is a body no rat, nor she, nor a gosling walks into: its outline
//   on the ground, the model's collider seen from above (WELL_OUTLINE). The
//   swarm holds rats off it as off the pond's water, a shore round its middle,
//   so it throws no shadow in a light; she and her goslings are set back out
//   of it, sliding along it, and her goslings go round it. So with the foot of
//   its lantern, its brazier's light (plain.ts).
// - The rats' pull (#188): each frame the swarm is handed every gosling not
//   taken, waiting or in her circle, and a rat runs at the nearest of her and
//   them, held off at the edge of any light as it is held off her. With the
//   torch out nothing holds them off her circle while the dark takes its toll.
// - Scenes (#190) take a brazier's place where the plain sets them, each in
//   place of that brazier's waiting gosling, worked with the interact key.
//   The well: its gosling is down it in the bucket; the interact key held at
//   the well for its set time winches it up and it joins her circle; let go
//   early, the bucket drops, and the next hold starts from none, the lever's
//   rule. Wound up, the gosling hops out of the bucket onto the rim on her
//   side of the well, and from it down to the ground, and walks to her from
//   there. The well stands in its brazier's light, out of its dip, so the
//   torch burns the while. The dead tree stands in its brazier's stead with no light
//   of its own, its gosling up it; the interact key at its trunk, the torch
//   lit, held its set time, calls the gosling down: it jumps down from it
//   to the ground in front of it, as it hops out of the well, and joins her
//   circle once down. The tree never burns: it is never a light, nothing
//   holds the rats off it and it fills no torch. A brazier burns by it, on its right and a
//   little ahead (TREE_FIRE), a lit flame like any other, near enough to make
//   for and far enough that its light leaves the tree in the dark, the rats
//   round its trunk.
// - The cage and the skull (#191): the cage's gosling is in it, in its
//   brazier's light; its key lies beside a dead body out in the dark. At the
//   key, the interact key picks it up, the run's key rule; carried
//   back to the cage, the interact key held its set time unlocks it, let go
//   early starting again from none, and the cage opens and its gosling joins
//   her circle. With no key the cage does nothing. Shut, it is a body as the well
//   is; open, its gosling walks out of it. Its brazier is the set's campfire,
//   the set turned so the campfire stands on it (`Cage.turn`); the set's cart
//   behind the cage is a body, open or shut.
// - The hollow log (#191): its gosling hides deep in its trunk, in the dark:
//   its place has no brazier. Coming within its thunder circle, LOG_THUNDER
//   m round its middle (`strikeZone`), a strike comes down on it at once,
//   torch or no torch, no key pressed, and fires it, its roots at the far end
//   burning from then on: its place's light, unlit till then, stands there, a
//   flame like any other, the rats held off it and the torch filled at it.
//   At its zone at its near end, the interact key held its set time calls its
//   gosling out, let go early starting again from none, and LOG_FOLLOW s later
//   it runs along the trunk as it lies (`logTurn`, `logSize`) and out of its
//   open end, never through its side, and joins her circle; walking into that
//   zone strikes it too, if the strike has not come. The far end does nothing.
//   The log is a body as the well is; rats walk through it.
// - Where a scene's zone, the key working it now, overlaps a fire's dip or a
//   lantern's, the scene comes first: the key works it, and fills no torch.
//
// Nothing is drawn at random: the same seed and the same inputs give the same run.
import { LIGHT_SPEED, NOTICE, RESTART_ROOM, gameTuning } from './gameplay'
import { SteppedSwarm, type PlayDrive, type PlaySwarm } from './play'
import { HOLDER_RADIUS, within } from './walls'
import { BRAZIER_REACH, WADE, WELL_LANTERN, plain, type Log, type Plain, type Point, type Scene } from './plain'
import { defaultRunTuning, Run, type Level } from './run'
import { FLICKER, shoreLight, type Dark, type FixedLight, type Ground, type Light, type StepReport, type Target, type Tuning } from './swarm'

/** How far from her start the rats start, m: the plain's margin, so none is set down off it. */
const START_RING = 12

/** A frame of the player's input. */
export interface GooseInput {
  /** Where the keys send her, a unit direction, or nothing held. */
  heading: Point | null
  /** The interact key held: winches the well, calls the tree's gosling down, picks the cage's key up and opens it. */
  interact?: boolean
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
  /** How long the interact key is held at the well to winch its gosling up, s. Read live. */
  wellHold: number
  /** How long the interact key is held at the dead tree to call its gosling down, s. Read live. */
  treeHold: number
  /** How long the interact key is held at the hollow log's near end to call its gosling out, s. Read live. */
  logHold: number
  /**
   * The hollow log as it lies: how far it is turned about its middle off its line, degrees, 0 its roots at the near end,
   * 180 at the far end; and how big, times its line end to end. Its gosling runs out along it, out of its open end, the
   * end away from its roots. Read live.
   */
  logTurn: number
  logSize: number
  /** How long the dead tree's gosling's jump down from it takes, s, its jump clip stretched over it. Read as it jumps. */
  treeJump: number
  /** How long the interact key is held at a fire or the well's lantern to fill an empty torch, s; held less, it fills that share. Read live. */
  refillHold: number
  /** Where she fills her torch at a well's lantern: how far off its foot's middle, m, along x and z, and its reach's scale along x and along z (`scaleY`, the ground's other way). Read live. */
  refillZone: ZoneSetting
  /** Where she winches a well: how far off its middle, m, along x and z, and its reach's scale along x and along z. Read live. */
  winchZone: ZoneSetting
  /** Where she calls the dead tree's gosling down: how far off its trunk's middle, m, along x and z, and its reach's scale along x and along z. Read live. */
  treeZone: ZoneSetting
  /** Where the dead tree's gosling lands, jumping down from it: how far off its trunk's middle, m, along x and z. Read as it jumps. */
  treeLanding: Point
  /** Where the brazier by the dead tree stands: how far off its trunk's middle, m, along x and z. Read live, its light with it. */
  treeFire: Point
  /** Where she unlocks the cage, carrying its key: how far off its middle, m, along x and z, and its reach's scale along x and along z. Read live. */
  cageZone: ZoneSetting
  /** How long the interact key is held at the cage, carrying its key, to unlock it, s. Read live. */
  cageHold: number
  /** Where she picks the cage's key up: how far off where it lies, m, along x and z, and its reach's scale along x and along z. Read live. */
  keyZone: ZoneSetting
  /** Where the cage's key lies, beside the body: how far off its skull, m, along the set's x and z, turned with it. Read live. */
  keyBeside: Point
  /** Where she calls the gosling out of the hollow log: how far off its near end, m, along x and z, and its reach's scale along x and along z. Read live. */
  logZone: ZoneSetting
  /** The hollow log's thunder circle, where coming in calls the strike down on it: how far off its middle, m, along x and z, and LOG_THUNDER's scale along x and along z. Read live. */
  strikeZone: ZoneSetting
  /** Where she fills her torch at each scene's fire, the dead tree's brazier, the cage's campfire and the log's fire, once struck: how far off the fire, m, along x and z, and its dip's scale along x and along z. Read live. */
  fireZones: Record<FireScene, ZoneSetting>
  /** How far each scene's fire holds the rats off, m: its light's reach. Read live. */
  fireReach: Record<FireScene, number>
  /** How far ahead of her start the well stands, m, up the plain, if not beside its brazier: nothing, beside it. Read at the start. */
  wellAhead: number | null
  /** How far ahead of her start the dead tree stands, m, up the plain, if not in its brazier's place: nothing, there. Read at the start. */
  treeAhead: number | null
}

/** The scenes with a fire of their own: the dead tree's brazier, the cage's campfire, the log's fire. */
export type FireScene = 'tree' | 'cage' | 'log'

/** A zone on the ground where the interact key works, as the panel sets it: off its place, m, and its reach scaled along x and along z. */
export interface ZoneSetting {
  x: number
  z: number
  scaleX: number
  scaleY: number
}

/** A zone on the ground: an ellipse round (x, z), reaching `rx` m along x and `rz` m along z. */
export interface Zone extends Point {
  rx: number
  rz: number
}

/** Whether `p` stands in `zone`. */
export const inZone = (zone: Zone, p: Point) => ((p.x - zone.x) / zone.rx) ** 2 + ((p.z - zone.z) / zone.rz) ** 2 <= 1

/** Where a gosling is in the run: waiting at its brazier, in her circle, or taken. */
export type GoslingState = 'waiting' | 'circle' | 'taken'

/** A gosling: where it is, and where it is in the run. */
export interface Gosling extends Point {
  state: GoslingState
  /** When it joined the circle, and when it was taken, s of the play: NaN, not yet. */
  gatheredAt: number
  takenAt: number
}

/**
 * The well, where it stands, its gosling's brazier, by its index, how far the
 * bucket is wound up, 0 at the bottom, 1 out, the gosling with her; and
 * whether she is at it, near enough to winch, its gosling down it.
 */
export interface Well extends Point {
  kind: 'well'
  brazier: number
  wound: number
  near: boolean
}

/**
 * The dead tree, where it stands, in its brazier's stead, by its index; where
 * the brazier by it stands, and its light's index in the level's lights; when
 * she called its gosling down, s of the play, NaN not yet; how far the call is
 * held, 0 to 1; and whether she is at it, near enough to call, her torch lit,
 * its gosling up it.
 */
export interface Tree extends Point {
  kind: 'tree'
  brazier: number
  fire: Point
  fireLight: number
  calledAt: number
  catching: number
  near: boolean
}

/**
 * The cage, where it stands, its gosling's brazier, by its index; how far its
 * set is turned, radians about y, from +z toward +x, so its campfire stands on
 * the brazier (`CAGE_CAMPFIRE`); the dead body's skull, and where its key
 * lies beside the body; whether she carries the key; how far the unlock is
 * held, 0 to 1, and when it came unlocked, s of the play, NaN not yet; whether
 * the cage is open; and whether the interact key would work it where she
 * stands: at the key, lying there, or at the shut cage, carrying it.
 */
export interface Cage extends Point {
  kind: 'cage'
  brazier: number
  turn: number
  skull: Point
  key: Point
  carried: boolean
  unlocking: number
  unlockedAt: number
  open: boolean
  near: boolean
}

/**
 * The hollow log, where its middle is, its gosling deep in it, its brazier's place by
 * its index; its ends; when the strike came and fired it, s of the play, NaN
 * not yet; when she called its gosling out, NaN not yet; how far the hold
 * calling it has come, 0 to 1; and whether she is at its near end, its gosling
 * in it, not yet called.
 */
export interface HollowLog extends Point {
  kind: 'log'
  brazier: number
  ends: Log
  litAt: number
  calledAt: number
  calling: number
  near: boolean
}

export type SceneState = Well | Tree | Cage | HollowLog

/** A body on the ground: its outline from `at`, m, and the middle a gosling goes round it by, from `at`. */
interface Body extends WellBody {
  at: Point
}

/**
 * A gosling climbing out of the well, or jumping down from the tree: which
 * hop, out of the well 0 out of the bucket onto the rim and 1 down to the
 * ground, down from the tree its one hop 0; how far through it, 0 to 1; and
 * from where to where.
 */
export interface Hop {
  hop: 0 | 1
  share: number
  from: Point
  to: Point
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
/**
 * How far round its middle the well's wall stands, m, and how near its middle
 * she works its winch, m: from anywhere there she is out of its brazier's dip
 * and inside its light (plain.ts). How far round its middle the tree's trunk
 * stands, m: the interact key works from the lever's reach past it.
 */
export const WELL_RADIUS = 0.9
export const WELL_REACH = WELL_RADIUS + 0.5
/** How near the middle of the well's lantern's stone foot she stands to fill her torch at it, m: up against the stone, a step off it. */
export const LANTERN_REACH = 1.2
/** How much fuel counts as a full torch, nothing left to fill at a lantern. */
const FULL = 0.99
/**
 * Out of the well: how long each hop takes, s; the share of it the gosling is
 * in the air, from its take-off to its landing, as its jump clip has it
 * (goslings.ts); and how far from the well's middle it stands on the rim, m,
 * and lands beyond it, m.
 */
export const HOP = 1
export const HOP_AIR = [0.27, 0.6] as const
const RIM = WELL_RADIUS - 0.12
const LANDS = WELL_RADIUS + 0.35
/** How far round its middle a gosling keeps off the well's wall, m, as she keeps HOLDER_RADIUS off it. */
export const GOSLING_RADIUS = 0.12
/**
 * The well's body on the ground: the outline of the model's collider
 * (`ColliderWeel`) round its ring, its posts, its crank and the pumpkins at its
 * foot, closed over its notches so no body is caught in one, as the page
 * stands the well, side on to the plain's way, and at its scale
 * (goosescenes.ts): from the well's middle, m.
 */
export const WELL_OUTLINE: readonly Point[] = [
  { x: -1.69, z: -0.16 },
  { x: -0.33, z: -0.89 },
  { x: 0.26, z: -0.89 },
  { x: 1.09, z: -0.43 },
  { x: 1.72, z: -0.05 },
  { x: 1.72, z: 0.09 },
  { x: 1.49, z: 0.93 },
  { x: -1.42, z: 0.93 },
  { x: -1.69, z: 0.28 },
]
/**
 * The stone foot of the well's lantern on the ground, as the model's collider
 * (`ColliderLantern`) has it, from the well's middle, m, as WELL_OUTLINE.
 */
/** The middle of the lantern's stone foot, from the well's middle, m: where she fills her torch, by its post. */
export const LANTERN_BASE: Point = { x: -1.84, z: 1.57 }
export const LANTERN_FOOT: readonly Point[] = [
  { x: -1.33, z: 1.42 },
  { x: -1.67, z: 2.08 },
  { x: -2.36, z: 1.73 },
  { x: -2.02, z: 1.06 },
]
/** A body on the ground at a well: its outline, from the well's middle, m, and the middle a gosling goes round it by. */
export interface WellBody {
  outline: readonly Point[]
  middle: Point
}
/** The well's bodies: the well, and its lantern's foot. */
export const WELL_BODIES: readonly WellBody[] = [
  { outline: WELL_OUTLINE, middle: { x: 0, z: 0 } },
  { outline: LANTERN_FOOT, middle: LANTERN_BASE },
]
/** How far the gosling's way out of the well turns at a time, radians, from her way, until it lands clear of the well's bodies. */
const CLEAR_TURN = 0.1

/**
 * How far out of `body`'s middle its outline stands `angle` radians round from
 * +x toward +z, m: the shore the swarm holds rats off. Every way out of its
 * middle crosses the outline once.
 */
export function shoreOf({ outline, middle }: WellBody): (angle: number) => number {
  return (angle) => {
    const dx = Math.cos(angle)
    const dz = Math.sin(angle)
    let far = 0
    for (let k = 0, j = outline.length - 1; k < outline.length; j = k++) {
      const px = outline[j]!.x - middle.x
      const pz = outline[j]!.z - middle.z
      const ex = outline[k]!.x - outline[j]!.x
      const ez = outline[k]!.z - outline[j]!.z
      const den = dx * ez - dz * ex
      if (Math.abs(den) < 1e-12) continue
      const along = (px * ez - pz * ex) / den
      const share = (px * dz - pz * dx) / den
      if (along > 0 && share >= 0 && share <= 1) far = Math.max(far, along)
    }
    return far
  }
}

/** Whether the way from `a` to `b` passes within `radius` m of `outline`, or through it. */
function crosses(outline: readonly Point[], a: Point, b: Point, radius: number): boolean {
  if (within(outline, a.x, a.z) || within(outline, b.x, b.z)) return true
  const ux = b.x - a.x
  const uz = b.z - a.z
  const length = ux * ux + uz * uz
  for (let k = 0, j = outline.length - 1; k < outline.length; j = k++) {
    const p = outline[j]!
    const q = outline[k]!
    // Its corner near the way, or the way's ends near its side.
    const t = length > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * ux + (p.z - a.z) * uz) / length)) : 0
    if (Math.hypot(p.x - a.x - ux * t, p.z - a.z - uz * t) < radius) return true
    const ex = q.x - p.x
    const ez = q.z - p.z
    for (const e of [a, b]) {
      const s = Math.max(0, Math.min(1, ((e.x - p.x) * ex + (e.z - p.z) * ez) / (ex * ex + ez * ez)))
      if (Math.hypot(e.x - p.x - ex * s, e.z - p.z - ez * s) < radius) return true
    }
    // The way across its side.
    const den = ux * ez - uz * ex
    if (Math.abs(den) < 1e-12) continue
    const along = ((p.x - a.x) * ez - (p.z - a.z) * ex) / den
    const share = ((p.x - a.x) * uz - (p.z - a.z) * ux) / den
    if (along >= 0 && along <= 1 && share >= 0 && share <= 1) return true
  }
  return false
}

/**
 * `body` set back out of `outline` to `radius` m off it, if it is nearer or
 * inside: onto the outline's nearest point and out from it. Whether it was
 * moved.
 */
function outOf(outline: readonly Point[], body: Point, radius: number): boolean {
  let best = Infinity
  let nx = 0
  let nz = 0
  for (let k = 0, j = outline.length - 1; k < outline.length; j = k++) {
    const p = outline[j]!
    const q = outline[k]!
    const ex = q.x - p.x
    const ez = q.z - p.z
    const t = Math.max(0, Math.min(1, ((body.x - p.x) * ex + (body.z - p.z) * ez) / (ex * ex + ez * ez)))
    const d = Math.hypot(body.x - p.x - ex * t, body.z - p.z - ez * t)
    if (d < best) [best, nx, nz] = [d, p.x + ex * t, p.z + ez * t]
  }
  const inside = within(outline, body.x, body.z)
  if (!inside && best >= radius - 1e-9) return false
  // Out from the nearest point: away from the body inside the outline, toward it outside; on the very line, away from the origin.
  let ux = body.x - nx
  let uz = body.z - nz
  if (best < 1e-9) [ux, uz] = [nx, nz]
  else if (inside) [ux, uz] = [-ux, -uz]
  const u = Math.hypot(ux, uz)
  body.x = nx + (ux / u) * radius
  body.z = nz + (uz / u) * radius
  return true
}

/** How far through its flight a hop `share` of the way through is: 0 crouched for it, 1 landed. */
export const airOf = (share: number) => Math.min(1, Math.max(0, (share - HOP_AIR[0]) / (HOP_AIR[1] - HOP_AIR[0])))
export const TRUNK = 0.25
/**
 * The brazier by the dead tree, off the trunk's middle, m: on its right as the
 * camera sees it (+x), turned TREE_FIRE_AHEAD radians up the plain (-z), out
 * as far as its light, leaning its furthest, stops TREE_DARK m short of the
 * trunk: the tree out of its light, the rats round it.
 */
const TREE_FIRE_AHEAD = 0.35
const TREE_DARK = 1.5
/** How far short of a scene's zone a debug key stands her, m (`standBy`). */
const STAND_BY = 0.3
/** How far the shut cage's bars stand from its middle, m, along x and z: a box. */
export const CAGE = 0.3
/**
 * The cage's set as the page draws it (goosescenes.ts, `public/models/cage.glb`
 * at its scale), from the cage's middle, m, unturned: where its campfire
 * stands, the cage's brazier; and its cart's outline on the ground, wheels,
 * bed and shaft, round its middle.
 */
export const CAGE_CAMPFIRE: Point = { x: -1.234, z: 1.834 }
export const CART_OUTLINE: readonly Point[] = [
  { x: -2.606, z: -0.496 },
  { x: -2.38, z: -0.93 },
  { x: -1.134, z: -2.218 },
  { x: 0.32, z: -3.164 },
  { x: 0.878, z: -2.704 },
  { x: 0.14, z: -0.9 },
  { x: -0.8, z: 0.374 },
  { x: -1.2, z: 0.678 },
  { x: -1.554, z: 0.644 },
  { x: -2.514, z: -0.128 },
]
const CART_MIDDLE: Point = { x: -1.1, z: -0.9 }
/** `p`, from the cage's middle, turned with its set by `turn`. */
export const turned = (p: Point, turn: number): Point => ({ x: p.x * Math.cos(turn) + p.z * Math.sin(turn), z: p.z * Math.cos(turn) - p.x * Math.sin(turn) })
/** The cart's outline on the ground by `cage`, from the cage's middle, m, turned with its set. */
export const cartOf = (cage: Cage): Point[] => CART_OUTLINE.map((p) => turned(p, cage.turn))
/** Where the cage's key lies by default, off its skull, m, along the set's x and z: by the dead body's side (`public/models/cage.glb` at its scale). */
const KEY_BESIDE: Point = { x: 0.7, z: 0.5 }
/** A zone left where its scene puts it, at its own reach. */
const STILL_ZONE: ZoneSetting = { x: 0, z: 0, scaleX: 1, scaleY: 1 }
/** How far round its line the hollow log stands, m: made 30% bigger on 2026-10-23, with its length (plain.ts). */
export const LOG_RADIUS = 0.455
/** How far round the log's middle its thunder circle reaches, m, at its settings' scale 1: coming in, the strike comes down on it. */
export const LOG_THUNDER = 7
/** The log, she at its near end: how long until its gosling sets off out of it, s; and how far past the near end it runs before it joins her, m. */
export const LOG_FOLLOW = 1
const LOG_OUT = 0.5
const TREE_FIRE_OUT = BRAZIER_REACH * (1 + FLICKER) + TRUNK + TREE_DARK
export const TREE_FIRE: Point = { x: TREE_FIRE_OUT * Math.cos(TREE_FIRE_AHEAD), z: -TREE_FIRE_OUT * Math.sin(TREE_FIRE_AHEAD) }

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
  /** Each well's bodies as the swarm holds rats off them, after the pond: the well's outline and its lantern's foot's, each a shore round its middle. */
  private readonly wells: FixedLight[]
  /** The bodies she and her goslings keep out of, by scene: each well's, each cage's bars, gone once it opens, and its cart, each log's. */
  private readonly solid: { scene: SceneState; body: Body; bars?: boolean }[]
  /** The torch as the swarm reads it, where she carries it. */
  readonly torchLight: Light = { x: 0, z: 0, strength: 0, on: false }
  /** The scenes in braziers' places, in the route's order, as they stand. */
  readonly scenes: SceneState[]
  /** Whether she stands at a fire, in its dip, or at a well's lantern, with her torch short of full: the interact key would fill it. */
  atRefill = false
  /** How long the interact key has been held at each scene, s, while it is held: a well's hold. */
  private readonly winding: number[]
  /** Each gosling's climb out of the well, if it came up in the bucket: when it started, s of the play, and its three stops: the bucket, the rim, the ground. */
  /** Each gosling's climb out of the well or jump down from the tree, if it is in one: when it set off, s of the play, its stops, and how long each hop takes, s. */
  private readonly climbs: ({ at: number; stops: Point[]; hop: number } | undefined)[] = []
  /** The goslings not taken, as the swarm was last handed them: the rats' pull. None once she is home. */
  targets: Target[] = []
  /** When the torch went out, and when the dark takes the next gosling, s of the play: NaN while it burns. */
  private darkSince = Number.NaN
  private nextTake = Number.NaN
  /** Where each gosling waits to be found: in its brazier's light, down the well or up the tree. */
  private readonly waitsAt: Point[]
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
    // The dead tree's zone and its gosling's jump: set from the panel on 2026-10-22. The hollow log's zones, its fire's dip
    // and strength: on 2026-10-23.
    this.settings = { rats: 2000, grace: 3, interval: 4, pace: LIGHT_SPEED, seed: SEED, sight: 7, wellHold: 4, treeHold: 1, logHold: 1, logTurn: -149, logSize: 1, treeJump: 1.8, refillHold: 2, refillZone: { x: 0.27, z: 0.55, scaleX: 0.7, scaleY: 0.75 }, winchZone: { x: 0, z: 0, scaleX: 1, scaleY: 1 }, treeZone: { x: 0, z: 0, scaleX: 1.1, scaleY: 1.7 }, treeLanding: { x: -0.3, z: 1 }, treeFire: { ...TREE_FIRE }, cageZone: { ...STILL_ZONE }, cageHold: 1.5, keyZone: { ...STILL_ZONE }, keyBeside: { ...KEY_BESIDE }, logZone: { x: 0.79, z: -0.49, scaleX: 1.5, scaleY: 1.55 }, strikeZone: { x: 1.46, z: 3, scaleX: 1.8, scaleY: 2.55 }, fireZones: { tree: { ...STILL_ZONE }, cage: { ...STILL_ZONE }, log: { x: 0.13, z: 0.49, scaleX: 2.75, scaleY: 2.8 } }, fireReach: { tree: BRAZIER_REACH, cage: BRAZIER_REACH, log: 5.2 }, wellAhead: null, treeAhead: null, ...settings }
    this.plain = plain(this.settings.seed, { burnRate: this.runTuning.burnRate, pace: this.settings.pace })
    const { start, braziers, bounds } = this.plain
    const { wellAhead, treeAhead } = this.settings
    const ahead = { well: wellAhead, tree: treeAhead }
    this.waitsAt = braziers.map(({ gosling, scene }) => {
      const by = scene === 'well' || scene === 'tree' ? ahead[scene] : null
      return by === null ? { ...gosling } : { x: start.x, z: start.z - by }
    })
    // The brazier by each dead tree, wherever the tree stands: its light after the braziers'.
    const fires = braziers.flatMap(({ scene, reach }, k) => {
      const at = this.waitsAt[k]!
      return scene === 'tree' ? [{ k, x: at.x + this.settings.treeFire.x, z: at.z + this.settings.treeFire.z, reach }] : []
    })
    this.level = {
      start: { ...start },
      // The dead tree's place holds a light that never burns, so every brazier's light keeps its index. The well's light
      // is its lantern's, in its brazier's place, or by the well wherever it is set ahead. The log's is its fire, on its
      // far end, unlit until the strike.
      lights: [
        ...braziers.map(({ x, z, reach, scene, log }, k) => {
          if (scene === 'tree') return { ...this.waitsAt[k]!, reach, flame: false, on: false }
          if (scene === 'log') return { ...log!.far, reach, flame: true, on: false }
          // The lantern's glass is not dipped into: she fills her torch at it with the interact key (`work`).
          if (scene === 'well' && wellAhead !== null) return { x: this.waitsAt[k]!.x + WELL_LANTERN.x, z: this.waitsAt[k]!.z + WELL_LANTERN.z, reach, flame: false, on: true }
          if (scene === 'well') return { x, z, reach, flame: false, on: true }
          return { x, z, reach, flame: true, on: true }
        }),
        ...fires.map(({ x, z, reach }) => ({ x, z, reach, flame: true, on: true })),
      ],
      walls: [],
      wind: [],
      gates: [],
      keys: [],
      levers: [],
      bounds,
    }
    this.run = new Run(this.level, this.runTuning)
    // Her goslings draw the rats from as far as she does.
    this.tuning = drive.tuning ?? Object.assign(gameTuning(), { notice: NOTICE, pull: NOTICE })
    const { pond } = this.plain
    this.water = shoreLight(pond.x, pond.z, () => pond.radius)
    this.wells = braziers.flatMap(({ scene }, k) => {
      if (scene !== 'well') return []
      const at = this.waitsAt[k]!
      return WELL_BODIES.map((body) => shoreLight(at.x + body.middle.x, at.z + body.middle.z, shoreOf(body)))
    })
    const spawnRing = { ...start, inner: this.runTuning.torchReach + RESTART_ROOM, outer: START_RING }
    const ground: Ground = { walls: [], bounds, lights: this.startLights(), spawnRing }
    this.swarm = drive.swarm?.(ground) ?? (new SteppedSwarm(16384, this.settings.seed, 1, ground) as unknown as S)
    this.swarm.reset(this.settings.rats)
    this.goslings = this.waitsAt.map((at) => ({ ...at, state: 'waiting', gatheredAt: Number.NaN, takenAt: Number.NaN }))
    this.floatAt = this.waitsAt.map((at) => ({ ...at }))
    this.resting = braziers.map(() => false)
    this.vx = braziers.map(() => 0)
    this.vz = braziers.map(() => 0)
    this.scenes = braziers.flatMap(({ scene, skull, log }, brazier): SceneState[] => {
      const at = this.waitsAt[brazier]!
      if (scene === 'well') return [{ kind: 'well', brazier, ...at, wound: 0, near: false }]
      if (scene === 'cage') {
        const fire = braziers[brazier]!
        const turn = Math.atan2(fire.x - at.x, fire.z - at.z) - Math.atan2(CAGE_CAMPFIRE.x, CAGE_CAMPFIRE.z)
        const beside = turned(this.settings.keyBeside, turn)
        return [{ kind: 'cage', brazier, ...at, turn, skull: { ...skull! }, key: { x: skull!.x + beside.x, z: skull!.z + beside.z }, carried: false, unlocking: 0, unlockedAt: Number.NaN, open: false, near: false }]
      }
      if (scene === 'log') return [{ kind: 'log', brazier, ...at, ends: { near: { ...log!.near }, far: { ...log!.far } }, litAt: Number.NaN, calledAt: Number.NaN, calling: 0, near: false }]
      if (scene === 'tree') {
        const fire = fires.findIndex((f) => f.k === brazier)
        const { x, z } = fires[fire]!
        return [{ kind: 'tree', brazier, ...at, fire: { x, z }, fireLight: braziers.length + fire, calledAt: Number.NaN, catching: 0, near: false }]
      }
      return []
    })
    this.winding = this.scenes.map(() => 0)
    const square: Point[] = [
      { x: -CAGE, z: -CAGE },
      { x: CAGE, z: -CAGE },
      { x: CAGE, z: CAGE },
      { x: -CAGE, z: CAGE },
    ]
    this.solid = this.scenes.flatMap((scene): { scene: SceneState; body: Body; bars?: boolean }[] => {
      const middle = { x: 0, z: 0 }
      if (scene.kind === 'well') return WELL_BODIES.map((body) => ({ scene, body: { ...body, at: scene } }))
      if (scene.kind === 'cage') {
        return [
          { scene, body: { outline: square, middle, at: scene }, bars: true },
          { scene, body: { outline: cartOf(scene), middle: turned(CART_MIDDLE, scene.turn), at: scene } },
        ]
      }
      if (scene.kind !== 'log') return []
      // Along its line from its middle to its far end, and across it.
      const ax = scene.ends.far.x - scene.x
      const az = scene.ends.far.z - scene.z
      const length = Math.hypot(ax, az)
      const cx = (-az / length) * LOG_RADIUS
      const cz = (ax / length) * LOG_RADIUS
      const outline = [
        { x: -ax - cx, z: -az - cz },
        { x: ax - cx, z: az - cz },
        { x: ax + cx, z: az + cz },
        { x: -ax + cx, z: -az + cz },
      ]
      return [{ scene, body: { outline, middle, at: scene } }]
    })
  }

  /** The bodies on the ground now: every well's, every cage's bars while shut and its cart, every log's. */
  private bodies(): Body[] {
    return this.solid.flatMap(({ scene, body, bars }) => (bars && scene.kind === 'cage' && scene.open ? [] : [body]))
  }

  /** The lights the swarm holds rats off: the braziers', then the pond's, then the wells'. */
  lights(): FixedLight[] {
    return [...this.run.lights(), this.water, ...this.wells]
  }

  /** The rats start round her, out of the braziers' light, the pond, the wells and her own light, with room to breathe. */
  private startLights(): FixedLight[] {
    return [...this.lights(), { ...this.plain.start, reach: this.runTuning.torchReach + RESTART_ROOM, on: true }]
  }

  /**
   * How far every well's light holds the rats off, m: its lantern's strength
   * times the swarm's ring, as the torch's does (goosescenes.ts). Read live by
   * the run and the swarm, from the next frame.
   */
  setWellLight(reach: number): void {
    for (const scene of this.scenes) if (scene.kind === 'well') this.level.lights[scene.brazier]!.reach = reach
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
    const came: number[] = []
    this.goslings.forEach((g, k) => {
      const was = g.state
      g.takenAt = Number.NaN
      this.vx[k] = this.vz[k] = 0
      this.climbs[k] = undefined
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
        g.x = this.waitsAt[k]!.x
        g.z = this.waitsAt[k]!.z
      }
    })
    // A scene whose gosling is back waiting is set again: the bucket down, the tree's gosling not yet called.
    for (const scene of this.scenes) {
      // A cage whose gosling is out stands open, its key used.
      if (scene.kind === 'cage') {
        scene.open = this.goslings[scene.brazier]!.state !== 'waiting'
        if (!scene.open) scene.unlockedAt = Number.NaN
        else if (Number.isNaN(scene.unlockedAt)) scene.unlockedAt = this.t
        scene.carried = false
        scene.unlocking = 0
      }
      if (this.goslings[scene.brazier]!.state !== 'waiting') continue
      this.winding[this.scenes.indexOf(scene)] = 0
      if (scene.kind === 'well') scene.wound = 0
      else if (scene.kind === 'tree') {
        scene.calledAt = Number.NaN
        scene.catching = 0
      } else if (scene.kind === 'log') {
        scene.litAt = scene.calledAt = Number.NaN
        scene.calling = 0
      }
    }
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
      this.placeScenes()
      // No rats are ever at her, as the run counts them: she is never caught.
      // Nothing fills the torch by itself: she holds the interact key at a fire for it (`work`).
      run.step({ dt, toward, speed: settings.pace, arena: this.swarm.arena, interact: false, reached: 0, dip: false })
      this.keepOffBodies(holder, HOLDER_RADIUS)
      this.gather()
      this.work(dt, input.interact === true)
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
    this.targets = this.ended ? [] : this.goslings.filter((g) => g.state !== 'taken').map(({ x, z }) => ({ x, z }))
    this.report = this.swarm.advance(dt, light, this.tuning, this.lights(), dark, this.targets)
  }

  /** The goslings waiting in the light of a brazier she has walked into join her circle: not a scene's, which its scene gives her. */
  private gather(): void {
    const { holder } = this.run
    this.plain.braziers.forEach((b, k) => {
      if (b.scene !== undefined || Math.hypot(holder.x - b.x, holder.z - b.z) > b.reach) return
      this.join(k)
    })
  }

  /** Gosling `k`, if waiting, joins her circle now. */
  private join(k: number): void {
    const g = this.goslings[k]!
    if (g.state !== 'waiting') return
    g.state = 'circle'
    g.gatheredAt = this.t
  }

  /**
   * The scenes worked with the interact key, `interact` held over `dt`: at the
   * well, held its set time, the bucket wound up and its gosling with her, let
   * go early, the bucket dropped; at the dead tree, the torch lit, held its
   * set time, its gosling called down, jumping; let go early,
   * the next hold starts from none. At the cage's key, lying by the body, picked up,
   * and at the cage, carrying it, the cage opened. The log needs no key: its
   * strike is called as she walks to its near end.
   */
  private work(dt: number, interact: boolean): void {
    const { holder } = this.run
    const { winding } = this
    // At a lit flame, in its dip, or at a lantern, away from any scene the key would work now, the key fills the torch,
    // the burn held off the while; unheld, nothing fills it.
    const atWinch = (well: Point) => inZone(this.winchZoneOf(well), holder)
    const working = this.scenes.some((scene) => this.workable(scene))
    const lantern = this.scenes.some((scene) => scene.kind === 'well' && inZone(this.refillZoneOf(scene), holder))
    const { dip } = this.runTuning
    // A scene's fire through its own zone; any other flame in its dip.
    const owned = new Map(this.scenes.flatMap((scene) => (scene.kind === 'well' ? [] : [[this.fireLightOf(scene), scene] as const])))
    const fire = this.level.lights.some((light, k) => {
      if (!light.flame || !light.on) return false
      const scene = owned.get(k)
      return scene ? inZone(this.fireZoneOf(scene)!, holder) : Math.hypot(holder.x - light.x, holder.z - light.z) <= dip + (light.pad ?? 0)
    })
    const refill = (lantern || fire) && !working
    if (refill && interact) {
      this.run.fuel = Math.min(1, this.run.fuel + dt * (1 / Math.max(this.settings.refillHold, 1e-6) + this.runTuning.burnRate))
    }
    this.atRefill = refill && this.run.fuel < FULL
    this.scenes.forEach((scene, s) => {
      const waiting = this.goslings[scene.brazier]!.state === 'waiting'
      if (scene.kind === 'cage') return this.workCage(scene, s, dt, interact)
      if (scene.kind === 'log') return this.workLog(scene, s, dt, waiting, interact)
      if (scene.kind === 'well' || scene.kind === 'tree') scene.near = this.workable(scene)
      if (!waiting) return
      if (scene.kind === 'well') {
        winding[s] = interact && atWinch(scene) ? winding[s]! + dt : 0
        const hold = Math.max(this.settings.wellHold, 1e-6)
        scene.wound = Math.min(1, winding[s]! / hold)
        if (winding[s]! < hold - 1e-9) return
        scene.wound = 1
        scene.near = false
        winding[s] = 0
        this.join(scene.brazier)
        this.climbOut(scene)
      } else {
        winding[s] = interact && scene.near ? winding[s]! + dt : 0
        const hold = Math.max(this.settings.treeHold, 1e-6)
        scene.catching = Math.min(1, winding[s]! / hold)
        if (winding[s]! < hold - 1e-9) return
        scene.catching = 0
        scene.near = false
        winding[s] = 0
        scene.calledAt = this.t
        this.jumpDown(scene)
      }
    })
  }

  /**
   * At `cage`, scene `s`, over `dt`: at its key, the interact key picks it up;
   * at the cage, carrying it, held its set time, unlocks it, and the cage opens
   * and its gosling joins her; let go early, the next hold starts from none.
   */
  private workCage(cage: Cage, s: number, dt: number, interact: boolean): void {
    const { holder } = this.run
    const atKey = !cage.carried && inZone(this.keyZoneOf(cage), holder)
    const atCage = cage.carried && inZone(this.zoneOf(cage), holder)
    cage.near = this.workable(cage)
    this.winding[s] = cage.near && atCage && interact ? this.winding[s]! + dt : 0
    const hold = Math.max(this.settings.cageHold, 1e-6)
    cage.unlocking = Math.min(1, this.winding[s]! / hold)
    if (!cage.near || !interact) return
    if (atKey) {
      cage.carried = true
      cage.near = false
      return
    }
    if (this.winding[s]! < hold - 1e-9) return
    this.winding[s] = 0
    cage.unlocking = 0
    cage.unlockedAt = this.t
    cage.carried = false
    cage.open = true
    cage.near = false
    this.join(cage.brazier)
  }

  /**
   * `log`, scene `s`, its gosling in it, over `dt`: within its thunder circle, or at its near end, the strike comes down
   * on it and fires it; at its near end, the interact key held its set time calls its gosling out, let go early, the
   * next hold starts from none.
   */
  private workLog(log: HollowLog, s: number, dt: number, waiting: boolean, interact: boolean): void {
    const { holder } = this.run
    if (waiting && Number.isNaN(log.litAt) && (inZone(this.zoneOf(log), holder) || inZone(this.strikeZoneOf(log), holder))) log.litAt = this.t
    log.near = this.workable(log)
    this.winding[s] = log.near && interact ? this.winding[s]! + dt : 0
    const hold = Math.max(this.settings.logHold, 1e-6)
    log.calling = Math.min(1, this.winding[s]! / hold)
    if (this.winding[s]! < hold - 1e-9) return
    this.winding[s] = 0
    log.calling = 0
    log.near = false
    log.calledAt = this.t
  }

  /**
   * Whether the interact key would work `scene` where she stands now, its gosling still in it: winch the well, call the
   * dead tree's gosling down with her torch lit, pick the cage's key up or, carrying it, unlock the cage, call the log's
   * gosling out. Its zone then comes first, over any fire's dip or lantern's it overlaps.
   */
  private workable(scene: SceneState): boolean {
    if (this.goslings[scene.brazier]!.state !== 'waiting') return false
    const { holder } = this.run
    if (scene.kind === 'well') return inZone(this.winchZoneOf(scene), holder)
    if (scene.kind === 'tree') return Number.isNaN(scene.calledAt) && this.run.torch.lit && inZone(this.treeZoneOf(scene), holder)
    if (scene.kind === 'cage') return inZone(scene.carried ? this.zoneOf(scene) : this.keyZoneOf(scene), holder)
    return Number.isNaN(scene.calledAt) && inZone(this.zoneOf(scene), holder)
  }

  /** Where the interact key works `scene`: the well's winch, the dead tree's call, round the cage, at the log's near end; as the settings set them now. */
  zoneOf(scene: SceneState): Zone {
    if (scene.kind === 'well') return this.winchZoneOf(scene)
    if (scene.kind === 'tree') return this.treeZoneOf(scene)
    const reach = this.runTuning.leverReach
    const [at, zone, r] = scene.kind === 'cage' ? [scene, this.settings.cageZone, CAGE + reach] : [scene.ends.near, this.settings.logZone, reach]
    return { x: at.x + zone.x, z: at.z + zone.z, rx: r * zone.scaleX, rz: r * zone.scaleY }
  }

  /**
   * Where `log`'s open end is, the end away from its roots, as it lies now: off its middle by half its length, along its
   * line to the far end turned by `logTurn` as a three.js turn about y is, so 0 puts it at the far end and 180 at the near.
   */
  openEndOf(log: HollowLog): Point {
    const fx = log.ends.far.x - log.x
    const fz = log.ends.far.z - log.z
    const half = Math.hypot(fx, fz) * this.settings.logSize
    const along = Math.atan2(-fz, fx) + (this.settings.logTurn * Math.PI) / 180
    return { x: log.x + Math.cos(along) * half, z: log.z - Math.sin(along) * half }
  }

  /** `log`'s thunder circle, round its middle, as the settings set it now. */
  strikeZoneOf(log: HollowLog): Zone {
    const { x, z, scaleX, scaleY } = this.settings.strikeZone
    return { x: log.x + x, z: log.z + z, rx: LOG_THUNDER * scaleX, rz: LOG_THUNDER * scaleY }
  }

  /** Where she picks `cage`'s key up, lying beside the body, as the settings set it now. */
  keyZoneOf(cage: Cage): Zone {
    const { x, z, scaleX, scaleY } = this.settings.keyZone
    const reach = this.runTuning.keyReach
    return { x: cage.key.x + x, z: cage.key.z + z, rx: reach * scaleX, rz: reach * scaleY }
  }

  /** Where she fills her torch at `scene`'s fire, as the settings set it now: the well's lantern, or the dip of the dead tree's brazier, the cage's campfire or the log's fire. */
  fireZoneOf(scene: SceneState): Zone {
    if (scene.kind === 'well') return this.refillZoneOf(scene)
    const light = this.level.lights[this.fireLightOf(scene)]!
    const { x, z, scaleX, scaleY } = this.settings.fireZones[scene.kind]
    const { dip } = this.runTuning
    return { x: light.x + x, z: light.z + z, rx: dip * scaleX, rz: dip * scaleY }
  }

  /** `scene`'s fire's light, by its index in the level's lights: the dead tree's brazier's, after the braziers'; the cage's and the log's, in their brazier's place's. */
  fireLightOf(scene: Tree | Cage | HollowLog): number {
    return scene.kind === 'tree' ? scene.fireLight : scene.brazier
  }

  /** Where she winches `well`, as the settings set it now. */
  winchZoneOf(well: Point): Zone {
    const { x, z, scaleX, scaleY } = this.settings.winchZone
    return { x: well.x + x, z: well.z + z, rx: WELL_REACH * scaleX, rz: WELL_REACH * scaleY }
  }

  /** Where she fills her torch at `well`'s lantern, as the settings set it now. */
  refillZoneOf(well: Point): Zone {
    const { x, z, scaleX, scaleY } = this.settings.refillZone
    return { x: well.x + LANTERN_BASE.x + x, z: well.z + LANTERN_BASE.z + z, rx: LANTERN_REACH * scaleX, rz: LANTERN_REACH * scaleY }
  }

  /** A debug key's: her stood back where she starts, facing up the plain. Nothing once she is home. */
  standAtStart(): void {
    if (this.ended) return
    const { holder, facing } = this.run
    holder.x = this.plain.start.x
    holder.z = this.plain.start.z
    facing.x = 0
    facing.z = -1
  }

  /**
   * A debug key's: her stood STAND_BY m short of the zone where she works the
   * first scene of `kind`, the well's winch, the dead tree's call, the cage
   * or the log's near end, on the
   * camera's side of it (+z), facing it. Nothing once she is home, or with no
   * such scene.
   */
  standBy(kind: Scene): void {
    const scene = this.scenes.find((s) => s.kind === kind)
    if (this.ended || scene === undefined) return
    const zone = this.zoneOf(scene)
    const { holder, facing } = this.run
    holder.x = zone.x
    holder.z = zone.z + zone.rz + STAND_BY
    facing.x = 0
    facing.z = -1
    this.keepOffBodies(holder, HOLDER_RADIUS)
  }

  /**
   * The scenes' pieces the settings move, where they set them now: the brazier
   * by each dead tree, and its light; each cage's key, beside the body; how
   * far each scene's fire holds the rats off; and each log's fire, lit once struck.
   */
  private placeScenes(): void {
    const { treeFire, keyBeside, fireReach } = this.settings
    for (const scene of this.scenes) {
      if (scene.kind === 'well') continue
      this.level.lights[this.fireLightOf(scene)]!.reach = fireReach[scene.kind]
      if (scene.kind === 'log') this.level.lights[scene.brazier]!.on = !Number.isNaN(scene.litAt)
      if (scene.kind === 'cage') {
        const beside = turned(keyBeside, scene.turn)
        scene.key.x = scene.skull.x + beside.x
        scene.key.z = scene.skull.z + beside.z
      }
      if (scene.kind !== 'tree') continue
      const light = this.level.lights[scene.fireLight]!
      light.x = scene.fire.x = scene.x + treeFire.x
      light.z = scene.fire.z = scene.z + treeFire.z
    }
  }

  /** Where she lights `tree`, as the settings set it now. */
  treeZoneOf(tree: Point): Zone {
    const { x, z, scaleX, scaleY } = this.settings.treeZone
    const reach = TRUNK + this.runTuning.leverReach
    return { x: tree.x + x, z: tree.z + z, rx: reach * scaleX, rz: reach * scaleY }
  }

  /** The way from `scene`'s middle toward her, a unit vector: stood in its very middle, she is in front of it, as she faces. */
  private towardHer(scene: Point): Point {
    const { holder, facing } = this.run
    const ux = holder.x - scene.x
    const uz = holder.z - scene.z
    const d = Math.hypot(ux, uz)
    return d < 1e-6 ? { x: -facing.x, z: -facing.z } : { x: ux / d, z: uz / d }
  }

  /** The tree's gosling, called, jumps down from it to the ground where the settings land it; it joins her once down. */
  private jumpDown(tree: Tree): void {
    const g = this.goslings[tree.brazier]!
    const { x, z } = this.settings.treeLanding
    this.climbs[tree.brazier] = { at: this.t, stops: [{ x: g.x, z: g.z }, { x: tree.x + x, z: tree.z + z }], hop: Math.max(this.settings.treeJump, 1e-3) }
  }

  /** The well's gosling, wound up, climbs out toward her: onto the rim on her side, then down to the ground beyond it. */
  private climbOut(well: Well): void {
    const { x: ux, z: uz } = this.towardHer(well)
    // Its way out turned, each way in turn, as little as lands it clear of the well's body.
    const way = Math.atan2(uz, ux)
    let out = way
    for (let k = 0; k <= Math.ceil(Math.PI / CLEAR_TURN) * 2; k++) {
      out = way + Math.ceil(k / 2) * CLEAR_TURN * (k % 2 === 0 ? 1 : -1)
      const land = { x: well.x + Math.cos(out) * LANDS, z: well.z + Math.sin(out) * LANDS }
      if (WELL_BODIES.every(({ outline }) => !outOf(outline, { x: land.x - well.x, z: land.z - well.z }, GOSLING_RADIUS))) break
    }
    const g = this.goslings[well.brazier]!
    const at = (r: number) => ({ x: well.x + Math.cos(out) * r, z: well.z + Math.sin(out) * r })
    this.climbs[well.brazier] = { at: this.t, stops: [{ x: g.x, z: g.z }, at(RIM), at(LANDS)], hop: HOP }
  }

  /**
   * `body`, `radius` m round, set back out of every body on the ground it
   * walked into, at its outline's edge: it goes round them, sliding along
   * them. Set out at a corner, or into the next, it is set out again, a few
   * times.
   */
  private keepOffBodies(body: Point, radius: number): void {
    const bodies = this.bodies()
    for (let pass = 0; pass < 3; pass++) {
      let moved = false
      for (const { at, outline } of bodies) {
        const local = { x: body.x - at.x, z: body.z - at.z }
        if (!outOf(outline, local, radius)) continue
        body.x = at.x + local.x
        body.z = at.z + local.z
        moved = true
      }
      if (!moved) return
    }
  }

  /**
   * The way `body`, `radius` m round, heads for `to`, a unit vector: straight,
   * or, a body in the way, round that body's middle the shorter way, so
   * it slides along its side to its end and on round, rather than pressing
   * into it. Straight at the far side, it goes round the way `turn` says, 1
   * or -1.
   */
  private wayPast(body: Point, to: Point, radius: number, turn: number): Point {
    const ox = to.x - body.x
    const oz = to.z - body.z
    const d = Math.hypot(ox, oz)
    if (d < 1e-6) return { x: 0, z: 0 }
    for (const { at, outline, middle } of this.bodies()) {
      const a = { x: body.x - at.x, z: body.z - at.z }
      const b = { x: to.x - at.x, z: to.z - at.z }
      if (!crosses(outline, a, b, radius)) continue
      // From the body's middle.
      const ax = a.x - middle.x
      const az = a.z - middle.z
      const bx = b.x - middle.x
      const bz = b.z - middle.z
      const r = Math.hypot(ax, az)
      if (r < 1e-6) continue
      const across = ax * bz - az * bx
      const side = Math.abs(across) > 1e-6 * r * Math.hypot(bx, bz) ? Math.sign(across) : turn
      return { x: (-az / r) * side, z: (ax / r) * side }
    }
    return { x: ox / d, z: oz / d }
  }

  /** Gosling `k` climbing out of the well or jumping down from the tree, if it is: which hop, how far through it, and from where to where. */
  hopOf(k: number): Hop | null {
    const climb = this.climbs[k]
    if (climb === undefined) return null
    const into = (this.t - climb.at) / climb.hop
    if (into >= climb.stops.length - 1 - 1e-9) return null
    const hop = into < 1 ? 0 : 1
    return { hop, share: Math.max(0, into - hop), from: climb.stops[hop]!, to: climb.stops[hop + 1]! }
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
    const { vx, vz, resting } = this
    // Jumping down from the tree, it hops, still waiting, moving only in the air; down, it joins her.
    this.goslings.forEach((g, k) => {
      const climb = this.climbs[k]
      if (g.state !== 'waiting' || climb === undefined) return
      const hop = this.hopOf(k)
      const air = hop === null ? 1 : airOf(hop.share)
      const [from, to] = hop === null ? [climb.stops.at(-2)!, climb.stops.at(-1)!] : [hop.from, hop.to]
      g.x = from.x + (to.x - from.x) * air
      g.z = from.z + (to.z - from.z) * air
      if (hop !== null) return
      this.climbs[k] = undefined
      this.join(k)
    })
    // Deep in a log she called it out of, LOG_FOLLOW s on it runs along the trunk and out of its open end, at its top
    // pace, and joins her.
    for (const log of this.scenes) {
      const g = this.goslings[log.brazier]!
      if (log.kind !== 'log' || g.state !== 'waiting' || Number.isNaN(log.calledAt) || this.ended) continue
      const off = this.t - log.calledAt - LOG_FOLLOW
      if (off < 0) continue
      const open = this.openEndOf(log)
      const ax = open.x - log.x
      const az = open.z - log.z
      const length = Math.hypot(ax, az)
      const way = length + LOG_OUT
      const ran = Math.min(1, (off * GOSLING_TOP[0]!) / way)
      g.x = log.x + (ax / length) * way * ran
      g.z = log.z + (az / length) * way * ran
      if (ran >= 1) this.join(log.brazier)
    }
    const circle = this.goslings.flatMap((g, k) => (g.state === 'circle' ? [k] : []))
    const places = this.ended ? [] : this.places()
    circle.forEach((k, place) => {
      const g = this.goslings[k]!
      // Climbing out of the well or down from the tree, it hops, stop to stop, moving only in the air, nothing else moving it.
      const hop = this.hopOf(k)
      if (hop !== null) {
        const air = airOf(hop.share)
        g.x = hop.from.x + (hop.to.x - hop.from.x) * air
        g.z = hop.from.z + (hop.to.z - hop.from.z) * air
        vx[k] = vz[k] = 0
        return
      }
      // Down, it stands where it landed, and the climb is over.
      const climbed = this.climbs[k]
      if (climbed !== undefined) {
        g.x = climbed.stops.at(-1)!.x
        g.z = climbed.stops.at(-1)!.z
        this.climbs[k] = undefined
      }
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
      const wanted = d > 1e-6 && !resting[k] ? top * Math.min(1, d / arrive) : 0
      // Its way to it: straight, or round a body in the way.
      const way = this.wayPast(g, { x: tx, z: tz }, GOSLING_RADIUS, k % 2 === 0 ? 1 : -1)
      let wx = way.x * wanted
      let wz = way.z * wanted
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
      this.keepOffBodies(g, GOSLING_RADIUS)
    })
  }

  /** Home: the count, and where on the water ahead of her the goslings of her circle swim out to. */
  private end(): void {
    this.ended = true
    for (const scene of this.scenes) scene.near = false
    this.atRefill = false
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
