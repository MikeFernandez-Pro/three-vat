// The goose play (#187): the goose game, one frame at a time, headless, as the
// 3D page drives it at `#goose`. The page builds one, hands it its swarm,
// feeds it the keys and draws what it reports: the goose, her torch, the
// braziers, the goslings waiting or in her circle, and the pond. Nothing
// here draws.
//
// The plain (plain.ts) is the route laid by hand: braziers heading north to
// the pond. The run (run.ts) walks the goose, burns her torch, its flame shrinking
// over the last of its fuel; nothing fills it but the interact key held at a
// fire, in its dip (`work`), over its set time; the
// swarm (swarm.ts) runs the rats, which start round her, out of her light,
// and those left behind out of her sight are brought round ahead of her, so
// the goslings waiting ahead meet them as she does. The rest is the goose
// play's own:
//
// - Each brazier has a gosling waiting in its light, which joins her circle as
//   she walks into that light; or none, a fire alone (plain.ts). A gosling walks by itself, on its own legs, at
//   its own top pace, a little over her walk: it comes over to her, then
//   follows its place in an arc close round her back and sides, a moment behind it and
//   swaying a little, each its own way. Nothing moves it but its own steps:
//   walking, she keeps them in her light; running, she leaves them behind.
// - A debug key, a number, gives her that many goslings at once; others stand
//   her back where she starts (`standAtStart`), by the well's zone and by the
//   dead tree's (`standBy`).
// - A searching gosling (plain.ts) paces the edge of its brazier's light, on
//   an arc round where it waits, SEARCH_ARC m each way: it stands looking out
//   into the dark, glancing one way and the other, then darts to the next
//   stop, each stop and each stand its own and the same every run. It joins
//   her circle as she comes within SEARCH_SEES m of it, not as she walks
//   into its light, which she may start in. Starting `unlit`, she has her
//   torch to light at a fire first: held there, it catches only once filled
//   full, out until then; let go before, what was filled goes again, at a
//   steady pace. A torch burnt out is lit again the same way.
// - A dying light (plain.ts) burns on its set time once she first comes near
//   it, then its light shrinks to nothing and is out: its gosling joins her
//   circle as she walks into its light while it lasts, or, once it is out, as
//   her torch's light reaches it where it waits in the dark.
// - She is never caught: the run is handed no rats at her, so it never starts
//   again, and there are no checkpoints. Her life is the play's own (`bite`):
//   each rat at her takes some off it, and with none at her for a while it
//   comes back; at none she wakes at the fire she last filled her torch at,
//   with her life and her torch full, her circle round her and the rats placed
//   again (`wake`). Only she has a life: no rat ever bites a gosling.
// - The pond is water no rat enters: the swarm holds rats off its shore as off
//   a light (`water`), the shore the page draws once it hands its own over.
//   She wades and swims in it, her goslings after her; it ends nothing.
// - The well is a body no rat, nor she, nor a gosling walks into: its outline
//   on the ground, the model's collider seen from above (WELL_OUTLINE). The
//   swarm holds rats off it as off the pond's water, a shore round its middle,
//   so it throws no shadow in a light; she and her goslings are set back out
//   of it, sliding along it, and her goslings go round it. Its light is its
//   fire pit's; its brazier's place, where its lantern stood, is unlit.
// - The rats' pull (#188): each frame the swarm is handed every gosling,
//   waiting or in her circle, and a rat runs at the nearest of her and them,
//   held off at the edge of any light as it is held off her. With the torch
//   out nothing holds them off her circle.
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
// - The burning tree's trunk on the spawn's light, the fire pit by each well,
//   each dead tree's roots and the
//   brazier by it, each cage's campfire and its dead body, round the skull,
//   are bodies as the well is, their outlines the
//   models' seen from above, on their lights wherever they stand. A pit's light
//   is dipped into from round its legs (PIT_PAD); the campfire's fire zone
//   reaches past its stones. Rats walk through them all.
// - Where a scene's zone, the key working it now, overlaps a fire's dip, the
//   scene comes first: the key works it, and fills no torch.
//
// Nothing is drawn at random: the same route, seed and inputs give the same run.
import { LIGHT_SPEED, NOTICE, RESTART_ROOM, gameTuning } from './gameplay'
import { SteppedSwarm, type PlayDrive, type PlaySwarm } from './play'
import { HOLDER_RADIUS, within } from './walls'
import { BRAZIER_REACH, ROUTE, WADE, laid, type Plain, type Point, type Route, type Scene } from './plain'
import { defaultRunTuning, Run, type Level } from './run'
import { FLICKER, shoreLight, type Dark, type FixedLight, type Ground, type Light, type StepReport, type Target, type Tuning } from './swarm'

/** How far from her start the rats start, m: the plain's margin, so none is set down off it. */
const START_RING = 12

/** How her fall goes: how long it lasts, s, before she wakes; and how long her torch takes to die out, s. */
export interface Fall {
  lasts: number
  dims: number
}

/** A frame of the player's input. */
export interface GooseInput {
  /** Where the keys send her, a unit direction, or nothing held. */
  heading: Point | null
  /** The interact key held: winches the well, calls the tree's gosling down, picks the cage's key up and opens it. */
  interact?: boolean
  /** The way the camera looks along the ground, a unit direction, which she turns to while she stands: the chase camera's. */
  look?: Point | null
}

/** The play's knobs: the panel's. */
export interface GooseSettings {
  /** The rats' budget, read at the start. */
  rats: number
  /** How fast she walks, m/s. Read live; the plain is laid for the pace it starts at. */
  pace: number
  /** The rats' seed, read at the start. */
  seed: number
  /** How long a full torch burns, s, read at the start. */
  torch: number
  /** The route, read at the start: the one saved from the 2D page unless given another. */
  route: Route
  /** Whether the last gosling, found, leads her on home ahead of her instead of joining her circle. Read at the start. */
  lastGuides: boolean
  /** How far she sees round her, m: rats left behind further are brought round ahead, on a swarm the play steps itself. */
  sight: number
  /** How long the interact key is held at the well to winch its gosling up, s. Read live. */
  wellHold: number
  /** How long the interact key is held at the dead tree to call its gosling down, s. Read live. */
  treeHold: number
  /** How long the dead tree's gosling's jump down from it takes, s, its jump clip stretched over it. Read as it jumps. */
  treeJump: number
  /** How long the interact key is held at a fire to fill an empty torch, s; held less, it fills that share. Read live. */
  refillHold: number
  /** How long her torch, the key let go before it is first lit full, takes to go back out from full, s, at a steady pace. Read live. */
  lightLetGo: number
  /** Where she winches a well: how far off its middle, m, along x and z, and its reach's scale along x and along z. Read live. */
  winchZone: ZoneSetting
  /** Where she calls the dead tree's gosling down: how far off its trunk's middle, m, along x and z, and its reach's scale along x and along z. Read live. */
  treeZone: ZoneSetting
  /** Where the dead tree's gosling lands, jumping down from it: how far off its trunk's middle, m, along x and z. Read as it jumps. */
  treeLanding: Point
  /** Where the brazier by the dead tree stands: how far off the route's place for it, m, along x and z. Read live, its light with it. */
  treeFire: Point
  /** Where the fire pit by each well stands: how far off its place across the well from its brazier's, m, along x and z. Read live, its light with it. */
  wellFire: Point
  /** How far the fire pit by each well holds the rats off, m: its light's reach. Read live. */
  wellFireReach: number
  /** How far the spawn's brazier, the one she starts by, holds the rats off, m: its light's reach. Read live. */
  spawnReach: number
  /** How far the rats keep off the spawn's brazier, a share of its reach: 1 at its light's edge, under 1 into its light, over 1 short of it. Read live. */
  spawnFear: number
  /** Where she unlocks the cage, carrying its key: how far off its middle, m, along x and z, and its reach's scale along x and along z. Read live. */
  cageZone: ZoneSetting
  /** How long the interact key is held at the cage, carrying its key, to unlock it, s. Read live. */
  cageHold: number
  /** Where the cage's campfire stands: how far off its brazier's place, m, along x and z. Read live, its light with it. */
  cageFire: Point
  /** Where she picks the cage's key up: how far off where it lies, m, along x and z, and its reach's scale along x and along z. Read live. */
  keyZone: ZoneSetting
  /** Where the cage's key lies, beside the body: how far off its skull, m, along the set's x and z, turned with it. Read live. */
  keyBeside: Point
  /** Where she fills her torch at each scene's fire, the dead tree's brazier and the cage's campfire: how far off the fire, m, along x and z, and its dip's scale along x and along z. Read live. */
  fireZones: Record<FireScene, ZoneSetting>
  /** How far each scene's fire holds the rats off, m: its light's reach. Read live. */
  fireReach: Record<FireScene, number>
  /** How far ahead of her start the well stands, m, up the plain, if not beside its brazier: nothing, beside it. Read at the start. */
  wellAhead: number | null
  /** How far ahead of her start the dead tree stands, m, up the plain, if not in its brazier's place: nothing, there. Read at the start. */
  treeAhead: number | null
  /** How much of her life each rat at her takes a second, of a full life. Read live. */
  herBite: number
  /** How long nothing has to bite her before her life comes back, s. Read live. */
  healAfter: number
  /** How fast life comes back, of a full life a second. Read live. */
  heal: number
  /** How her fall goes, read as she falls: the page's death's (main.ts DEATHS). */
  fall: Fall
}

/** The scenes with a fire of their own: the dead tree's brazier, the cage's campfire. */
export type FireScene = 'tree' | 'cage'

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

/** Where a gosling is in the run: waiting at its brazier, in her circle, or found, leading her on home (`lastGuides`). */
export type GoslingState = 'waiting' | 'circle' | 'guiding'

/** A gosling: where it is, and where it is in the run. */
export interface Gosling extends Point {
  state: GoslingState
  /** When it joined the circle, s of the play: NaN, not yet. */
  gatheredAt: number
}

/**
 * The well, where it stands, its gosling's brazier, by its index, how far the
 * bucket is wound up, 0 at the bottom, 1 out, the gosling with her; and
 * whether she is at it, near enough to winch, its gosling down it.
 */
export interface Well extends Point {
  kind: 'well'
  brazier: number
  /** How far it is turned, radians, as `turned` turns: its body and the drawing with it. */
  turn: number
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
  /** Where the route stands the brazier by it; `fire`, where it stands now, the settings' `treeFire` off that. */
  place: Point
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
  /** How far its cart stands off where the set has it, m: the route moves it on its own. */
  cart: Point
  skull: Point
  key: Point
  carried: boolean
  unlocking: number
  unlockedAt: number
  open: boolean
  near: boolean
}

export type SceneState = Well | Tree | Cage

/** A body on the ground: its outline from `at`, m, and the middle a gosling goes round it by, from `at`. */
interface Body extends WellBody {
  at: Point
}

/** A dead tree's trunk on the ground, or anything round as one, a pumpkin: round `at`, `radius` m. */
export interface Trunk {
  at: Point
  radius: number
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

/** How far short of the pond's water a debug key stands her, m. */
const POND_BY = 1.5
/** How far ahead of her the guiding gosling keeps, m; how fast it goes at the most, m/s, and how much of the way to its place it closes a second. */
const GUIDE_LEAD = 3.5
const GUIDE_FASTEST = 2.6
const GUIDE_EASE = 2.5
/** How near its place the guide stands to be waiting there for her, m. */
const GUIDE_STILL = 0.1
/** How far behind its place the guide may fall before it is put there at once, m: only when she is moved by a debug key. */
const GUIDE_LOST = 12
/** How long a full torch burns, s, unless the settings say otherwise. */
export const TORCH = 13
/**
 * The torch: burns out in TORCH s, its reach with the fuel in it, in a straight line, from 3 m full, the light at
 * its full strength as set from the panel on 2026-10-26, to nothing as it goes out; filled, it grows back the same way.
 */
export const gooseRunTuning = () => ({ ...defaultRunTuning(), burnRate: 1 / TORCH, fade: 1, fadeCurve: 1, torchReach: 3, torchLeast: 0 })

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
/** How long she takes to turn, standing, to the way the camera looks, s. */
const LOOK_TURN = 0.2
/**
 * A searching gosling: how far round its light's edge it paces each way from where it waits, m; how fast it darts
 * from stop to stop, m/s; how long it stands at each, s, drawn between these; how far it glances aside, radians; and
 * how near she comes for it to see her and run to her, m.
 */
const SEARCH_ARC = 1.1
const SEARCH_PACE = 1.3
const SEARCH_STANDS = [1.4, 2.6] as const
const SEARCH_GLANCE = 0.55
export const SEARCH_SEES = 2.5
/** A searching gosling's stop `n`: how far round its light's edge from where it waits, m, a golden-ratio spread, the same every run. */
const searchStop = (n: number) => (n === 0 ? 0 : SEARCH_ARC * (2 * ((n * 0.618034 + 0.5) % 1) - 1))
/** How long it stands at stop `n`, s. */
const searchStands = (n: number) => SEARCH_STANDS[0] + (SEARCH_STANDS[1] - SEARCH_STANDS[0]) * ((n * 0.381966 + 0.2) % 1)
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
/**
 * How far round its middle the well's wall stands, m, and how near its middle
 * she works its winch, m. How far round its middle the tree's trunk
 * stands, m: the interact key works from the lever's reach past it.
 */
export const WELL_RADIUS = 0.9
export const WELL_REACH = WELL_RADIUS + 0.5
/** How much fuel counts as a full torch, nothing left to fill at a fire. */
const FULL = 0.99
/** Her life (`bite`): the most rats that bite her at once, the rest crowding behind; she is bitten as near as the swarm counts a rat at her (`holderReach`). */
export const MOST_BITERS = 6
/**
 * Her life run out, she falls (`fall`), unless the settings' `fall` says otherwise: FALL s, the keys hers no more, her torch dying to nothing over FALL_DIM, eased,
 * the rats closing in on her as it goes, and her circle huddling into her: the first arc FALL_CLOSE m out, the places
 * FALL_PLACE apart and all round her, FALL_ROUND radians, each gosling keeping FALL_SPACE off a sibling or her. Then she
 * wakes (`wake`), RISE s: still without the keys, her torch out, catching from the fire over RISE_CATCH s of it, eased.
 * The page blacks the fall out at its end and lifts it over the wake, the fire flaring, her colour coming back.
 */
export const FALL = 1.6
const FALL_DIM = 1.2
/**
 * How long his run carries him on as he falls, s, slowing to a stop: no dead stop from a run. As main.ts plays his
 * death clip, he keeps most of his pace through its sway, slows through its stagger and is still as it collapses.
 */
export const FALL_CARRY = 1
const FALL_CLOSE = 0.26
const FALL_PLACE = 0.24
const FALL_ROUND = Math.PI * 1.9
const FALL_SPACE = 0.22
export const RISE = 2.2
export const RISE_CATCH = [0.9, 1.4] as const
/** 0 to 1 over [from, to], eased in and out. */
export const eased = (at: number, from: number, to: number) => {
  if (to <= from) return at >= to ? 1 : 0
  const s = Math.min(1, Math.max(0, (at - from) / (to - from)))
  return s * s * (3 - 2 * s)
}
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
/** A body on the ground at a well: its outline, from the well's middle, m, and the middle a gosling goes round it by. */
export interface WellBody {
  outline: readonly Point[]
  middle: Point
}
/** The well's bodies: the well alone. */
export const WELL_BODIES: readonly WellBody[] = [{ outline: WELL_OUTLINE, middle: { x: 0, z: 0 } }]
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
 * The cage's door, in the face of its bars toward +z, unturned: how far along x its middle is from the cage's, m, and
 * how wide it is, m (`public/models/cage.glb`'s door at its scale). Unlocked, its gosling waits CAGE_DOOR_OPENS s for
 * the padlock to drop and the door to swing open, as the page draws them, then walks out through it at CAGE_WALK m/s,
 * CAGE_STEP_OUT m past it, and only then runs to her.
 */
export const CAGE_DOOR_X = 0.005
export const CAGE_DOOR_WIDTH = 0.27
export const CAGE_DOOR_OPENS = 0.9
export const CAGE_WALK = 0.9
const CAGE_STEP_OUT = 0.4
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
export const CART_MIDDLE: Point = { x: -1.1, z: -0.9 }
/** A body's middle on its own place. */
const ORIGIN: Point = { x: 0, z: 0 }
/**
 * The fire pit's outline on the ground, its iron bowl's legs, as the page draws
 * it (goosescenes.ts, `public/models/firePit.glb` at its scale), round its
 * light, m: the one by each well. PIT_PAD m round at
 * most, the torch dipped into it from that much further.
 */
export const PIT_OUTLINE: readonly Point[] = [
  { x: -0.372, z: -0.144 },
  { x: -0.326, z: -0.224 },
  { x: -0.013, z: -0.4 },
  { x: 0.081, z: -0.394 },
  { x: 0.353, z: -0.199 },
  { x: 0.353, z: 0.196 },
  { x: 0.081, z: 0.394 },
  { x: -0.013, z: 0.4 },
  { x: -0.326, z: 0.224 },
  { x: -0.372, z: 0.144 },
]
export const PIT_PAD = 0.4
/** The burning tree's trunk on the spawn's light (goosescenes.ts), an octagon round it, m: its foot at the height it is drawn. */
export const SPAWN_TRUNK: readonly Point[] = Array.from({ length: 8 }, (_, k) => ({ x: 0.25 * Math.cos((k * Math.PI) / 4), z: 0.25 * Math.sin((k * Math.PI) / 4) }))
/**
 * The cage's set's outlines on the ground as the page draws it (goosescenes.ts,
 * `public/models/cage.glb`, the campfire at the cage folder's 0.8 of the set's
 * size), m, unturned: its campfire's ring of stones round its light, and the
 * dead body round its skull, lying away from it along +z, and that body's
 * middle.
 */
export const CAMPFIRE_OUTLINE: readonly Point[] = [
  { x: -0.533, z: -0.067 },
  { x: -0.333, z: -0.405 },
  { x: 0.129, z: -0.526 },
  { x: 0.34, z: -0.407 },
  { x: 0.521, z: -0.106 },
  { x: 0.52, z: 0.222 },
  { x: 0.416, z: 0.367 },
  { x: 0.097, z: 0.533 },
  { x: -0.335, z: 0.419 },
  { x: -0.482, z: 0.206 },
]
export const CORPSE_OUTLINE: readonly Point[] = [
  { x: -0.247, z: -0.111 },
  { x: -0.155, z: -0.243 },
  { x: 0.034, z: -0.288 },
  { x: 0.177, z: -0.212 },
  { x: 0.39, z: 0.168 },
  { x: 0.296, z: 0.861 },
  { x: 0.066, z: 0.979 },
  { x: 0.009, z: 0.966 },
  { x: -0.163, z: 0.679 },
  { x: -0.181, z: 0.582 },
]
const CORPSE_MIDDLE: Point = { x: 0.07, z: 0.35 }
/** A round outline `radius` m round its middle, of `sides` sides, its corners on the circle. */
const round = (radius: number, sides = 10): Point[] => Array.from({ length: sides }, (_, k) => ({ x: radius * Math.cos((2 * Math.PI * k) / sides), z: radius * Math.sin((2 * Math.PI * k) / sides) }))
/**
 * The dead tree's outlines on the ground as the page draws them
 * (`public/models/spookyTrees/spooky-663.glb` at its height): its roots round the trunk's
 * middle, 0.34 to 0.35 m out; and its brazier round its light, a square 0.3 m
 * to a side's middle, 0.4 to a corner. Round, as the page turns them its own
 * way.
 */
export const TREE_OUTLINE: readonly Point[] = round(0.35)
export const TREE_FIRE_OUTLINE: readonly Point[] = round(0.33)
/** `p`, from the cage's middle, turned with its set by `turn`. */
export const turned = (p: Point, turn: number): Point => ({ x: p.x * Math.cos(turn) + p.z * Math.sin(turn), z: p.z * Math.cos(turn) - p.x * Math.sin(turn) })
/** The cart's outline on the ground by `cage`, from the cage's middle, m, turned with its set. */
export const cartOf = (cage: Cage): Point[] =>
  CART_OUTLINE.map((p) => {
    const q = turned(p, cage.turn)
    return { x: q.x + cage.cart.x, z: q.z + cage.cart.z }
  })

/** The middle of `cage`'s cart, from the cage's middle, m. */
export const cartMiddleOf = (cage: Cage): Point => {
  const q = turned(CART_MIDDLE, cage.turn)
  return { x: q.x + cage.cart.x, z: q.z + cage.cart.z }
}

/** `well`'s bodies, each from its middle, turned with the well. */
export const wellBodiesOf = (well: Well): WellBody[] =>
  WELL_BODIES.map((body) => {
    const placed = (p: Point) => turned(p, well.turn)
    return { outline: body.outline.map(placed), middle: placed(body.middle) }
  })
/** Where the cage's key lies by default, off its skull, m, along the set's x and z: by the dead body's side (`public/models/cage.glb` at its scale). */
const KEY_BESIDE: Point = { x: 0.7, z: 1.02 }
/** A zone left where its scene puts it, at its own reach. */
const STILL_ZONE: ZoneSetting = { x: 0, z: 0, scaleX: 1, scaleY: 1 }
/** The cage's campfire's fire zone, reaching past its ring of stones (CAMPFIRE_OUTLINE), where she stands. */
const CAMPFIRE_ZONE: ZoneSetting = { x: 0, z: 0, scaleX: 1.5, scaleY: 1.5 }
const TREE_FIRE_OUT = BRAZIER_REACH * (1 + FLICKER) + TRUNK + TREE_DARK
/** How far from a well's middle its fire pit stands, m, across it from its brazier's place: clear of its stone and its winch. */
export const WELL_FIRE = 2.2
/** How far the spawn's brazier lights and holds the rats off, m: 3 since 2026-10-27. */
const SPAWN_REACH = 3
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
  /** Whether she has set off: her torch burns only from her first step. */
  started = false
  /** How far the key held at a fire has got to lighting her torch while it is out, 0 to 1: it catches only at full. */
  kindled = 0
  /**
   * When her torch last caught full at a fire, s of the play, lit from out or topped up: NaN, never; and how full it
   * was as the key went down for it, 0 to 1, 0 lit from out. Not her wake's catch, which no key fills.
   */
  caughtAt = Number.NaN
  caughtFrom = 0
  /** How full her torch was as the key went down at a fire, while it is held there: NaN, not filling. */
  private fillFrom = Number.NaN
  /** The play's time, s. */
  t = 0
  /** The goslings, one to a brazier, in the route's order: none at a brazier with no gosling. */
  readonly goslings: (Gosling | undefined)[]
  /** The gosling that leads her home once found, the last one, with `lastGuides`; -1, none. */
  readonly guide: number
  /** How long the guide has stood waiting for her, at its place or further on, s; 0 while it goes. */
  guideWaits = 0
  /**
   * Where the guiding gosling makes for with her at `holder`: GUIDE_LEAD m ahead of her toward the pond's middle,
   * unless the page says otherwise (toward the island, kept off it).
   */
  guideTo: (holder: Point) => Point = (holder) => {
    const { pond } = this.plain
    const d = Math.hypot(pond.x - holder.x, pond.z - holder.z) || 1
    const lead = Math.min(GUIDE_LEAD, d)
    return { x: holder.x + ((pond.x - holder.x) * lead) / d, z: holder.z + ((pond.z - holder.z) * lead) / d }
  }
  report: StepReport | undefined
  /**
   * The pond as the swarm holds rats off it, after the flames: a round one at
   * the plain's pond, until the page hands over the shore it draws (`setWater`).
   */
  water: FixedLight
  /** Each well's bodies as the swarm holds rats off them, after the pond: the well's outline, a shore round its middle. */
  private readonly wells: FixedLight[]
  /** The bodies she and her goslings keep out of that stand still with their scene: each well's, each cage's bars, gone once it opens, and its cart. The rest are laid live (`bodies`). */
  private readonly solid: { scene: SceneState; body: Body; bars?: boolean }[]
  /** And what the old road's arches stand on, as the page lays them (`setStones`): none until it does. */
  private stones: Body[] = []
  /** And the dead trees' trunks by the road, each round its middle, as the page lays them (`setTrunks`): none until it does. */
  private trunks: readonly Trunk[] = []
  /** And the pumpkins round each scene's dead tree, round as the trunks, as the page lays them (`setPumpkins`). */
  private pumpkins: readonly Trunk[] = []
  /** The torch as the swarm reads it, where she carries it. */
  readonly torchLight: Light = { x: 0, z: 0, strength: 0, on: false }
  /** The scenes in braziers' places, in the route's order, as they stand. */
  readonly scenes: SceneState[]
  /** Whether she stands at a fire, in its dip, with her torch short of full: the interact key would fill it. */
  atRefill = false
  /** How long the interact key has been held at each scene, s, while it is held: a well's hold. */
  private readonly winding: number[]
  /** Each gosling's climb out of the well, if it came up in the bucket: when it started, s of the play, and its three stops: the bucket, the rim, the ground. */
  /** Each gosling's climb out of the well or jump down from the tree, if it is in one: when it set off, s of the play, its stops, and how long each hop takes, s. */
  private readonly climbs: ({ at: number; stops: Point[]; hop: number } | undefined)[] = []
  /** The cage's gosling walking out of it: from when it sets off, s of the play, and its stops, out through the door. */
  private readonly exits: ({ at: number; stops: Point[] } | undefined)[] = []
  /** The fire pit by each well: its well's brazier, where it stands before the settings' `wellFire` moves it (the edit mode moves that), and its light, after the trees' fires'. */
  readonly wellFires: { brazier: number; place: Point; light: number }[]
  /** The goslings, as the swarm was last handed them: the rats' pull. */
  targets: Target[] = []
  /**
   * Where the gosling up `tree` lands jumping down, off its trunk's middle, m, along x and z, as the page has it from
   * where it draws it sitting. None, or none for that tree, it lands where the settings land it (`treeLanding`).
   */
  landingOf?: (tree: Tree) => Point | undefined
  /** Where each gosling waits to be found: in its brazier's light, down the well or up the tree; none at a brazier with no gosling. The edit mode moves them. */
  readonly waitsAt: (Point | undefined)[]
  /** Each searching gosling's search: the stop it is at, how far round its light's edge from where it waits it stands there, m, and how long since it got there, s. */
  private readonly searches: { stop: number; at: number; since: number }[]
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
  /** When each dying light's script started, s of the play, she first near it: NaN, not yet, or no dying light. */
  readonly dyingAt: number[]
  /** Her life, 0 to 1: at 0 she wakes at `restAt`. */
  life = 1
  /** When a rat last bit her, s of the play. */
  bittenAt = Number.NEGATIVE_INFINITY
  /** How many rats bit him this frame, MOST_BITERS at most: none while unbitten, falling or waking. */
  biters = 0
  /** Which way the rats biting him this frame are from him, on the ground, a unit vector: (0, 0) unbitten, or bitten from all round evenly. */
  readonly biteFrom = { x: 0, z: 0 }
  /** Where she last stood filling her torch at a fire, where she wakes: where she starts, till she has. */
  readonly restAt: Point
  /** How many times her life has run out; and when she last woke, s of the play, NaN not yet. */
  deaths = 0
  wokeAt = Number.NaN
  /** When her life last ran out, s of the play, while she falls; NaN, not falling. And the fuel her torch had then. */
  private fellAt = Number.NaN
  private fellFuel = 0
  /** How he last walked, m/s on the ground, his own step's, not the keys': what carries him on as he falls. */
  private readonly moving = { x: 0, z: 0 }
  /** How he was moving as he fell, m/s on the ground. */
  private readonly fellMoving = { x: 0, z: 0 }

  constructor(settings: Partial<GooseSettings> = {}, drive: PlayDrive<S> = {}) {
    // The dead tree's zone and its gosling's jump: set from the panel on 2026-10-22.
    this.settings = { herBite: 0.12, healAfter: 2, heal: 0.25, fall: { lasts: FALL, dims: FALL_DIM }, spawnReach: SPAWN_REACH, spawnFear: 1, wellFireReach: BRAZIER_REACH, rats: 2000, pace: LIGHT_SPEED, seed: SEED, torch: TORCH, sight: 7, wellHold: 4, treeHold: 2, treeJump: 1.8, refillHold: 1.4, lightLetGo: 0.7, winchZone: { x: 0, z: 0, scaleX: 1, scaleY: 1 }, treeZone: { x: 0, z: 0, scaleX: 1.1, scaleY: 1.7 }, treeLanding: { x: -0.3, z: 1 }, treeFire: { x: 0, z: 0 }, wellFire: { x: 0, z: 0 }, cageZone: { ...STILL_ZONE }, cageHold: 1.5, cageFire: { x: 0, z: 0 }, keyZone: { ...STILL_ZONE }, keyBeside: { ...KEY_BESIDE }, fireZones: { tree: { ...STILL_ZONE }, cage: { ...CAMPFIRE_ZONE } }, fireReach: { tree: 2, cage: BRAZIER_REACH }, wellAhead: null, treeAhead: null, route: ROUTE, lastGuides: false, ...settings }
    this.runTuning.burnRate = 1 / this.settings.torch
    this.plain = laid(this.settings.route)
    const { start, braziers, bounds } = this.plain
    const { wellAhead, treeAhead } = this.settings
    const ahead = { well: wellAhead, tree: treeAhead }
    this.waitsAt = braziers.map(({ gosling, scene }) => {
      if (gosling === undefined) return undefined
      const by = scene === 'well' || scene === 'tree' ? ahead[scene] : null
      return by === null ? { ...gosling } : { x: start.x, z: start.z - by }
    })
    // The brazier by each dead tree, where the route stands it from the tree, wherever the tree stands: its light after
    // the braziers'.
    const fires = braziers.flatMap(({ scene, reach, gosling, fire }, k) => {
      if (scene !== 'tree') return []
      const at = this.waitsAt[k]!
      const off = fire ? { x: fire.x - gosling!.x, z: fire.z - gosling!.z } : TREE_FIRE
      const place = { x: at.x + off.x, z: at.z + off.z }
      return [{ k, place, x: place.x + this.settings.treeFire.x, z: place.z + this.settings.treeFire.z, reach }]
    })
    // The fire pit by each well, where the route stands it from the well, or else across it from its brazier's place, WELL_FIRE
    // from its middle, wherever the well stands: its light after the trees' fires'.
    const wellFires = braziers.flatMap(({ scene, x, z, gosling, fire }, k) => {
      if (scene !== 'well') return []
      const at = this.waitsAt[k]!
      if (fire) return [{ k, place: { x: at.x + fire.x - gosling!.x, z: at.z + fire.z - gosling!.z } }]
      const away = { x: gosling!.x - x, z: gosling!.z - z }
      const d = Math.hypot(away.x, away.z) || 1
      return [{ k, place: { x: at.x + (away.x / d) * WELL_FIRE, z: at.z + (away.z / d) * WELL_FIRE } }]
    })
    this.wellFires = wellFires.map(({ k, place }, w) => ({ brazier: k, place, light: braziers.length + fires.length + w }))
    this.level = {
      start: { ...start },
      // The dead tree's place holds a light that never burns, so every brazier's light keeps its index. The well's
      // brazier's place holds one too, its lantern gone: its fire pit lights it.
      lights: [
        ...braziers.map(({ x, z, reach, scene }, k) => {
          if (scene === 'tree') return { ...this.waitsAt[k]!, reach, flame: false, on: false }
          if (scene === 'well') return { x: this.waitsAt[k]!.x + x - braziers[k]!.gosling!.x, z: this.waitsAt[k]!.z + z - braziers[k]!.gosling!.z, reach, flame: false, on: false }
          // The spawn's brazier is the burning tree, a body: the torch dipped into the fire at its foot from round its trunk.
          return { x, z, reach, flame: true, on: true, ...(k === 0 && scene === undefined ? { pad: PIT_PAD } : {}) }
        }),
        ...fires.map(({ x, z, reach }) => ({ x, z, reach, flame: true, on: true })),
        ...wellFires.map(({ place }) => ({ x: place.x + this.settings.wellFire.x, z: place.z + this.settings.wellFire.z, reach: this.settings.wellFireReach, flame: true, on: true, pad: PIT_PAD })),
      ],
      walls: [],
      wind: [],
      gates: [],
      keys: [],
      levers: [],
      bounds,
    }
    this.run = new Run(this.level, this.runTuning)
    if (this.plain.start.unlit) this.run.fuel = 0
    this.restAt = { x: start.x, z: start.z }
    // Her goslings draw the rats from as far as she does.
    this.tuning = drive.tuning ?? Object.assign(gameTuning(), { notice: NOTICE, pull: NOTICE })
    const { pond } = this.plain
    this.water = shoreLight(pond.x, pond.z, () => pond.radius)
    this.goslings = this.waitsAt.map((at) => at && { ...at, state: 'waiting', gatheredAt: Number.NaN })
    // The last gosling no scene holds.
    let last = -1
    if (this.settings.lastGuides) this.goslings.forEach((g, k) => g && braziers[k]!.scene === undefined && (last = k))
    this.guide = last
    this.resting = braziers.map(() => false)
    this.vx = braziers.map(() => 0)
    this.vz = braziers.map(() => 0)
    this.dyingAt = braziers.map(() => Number.NaN)
    this.searches = braziers.map(() => ({ stop: 0, at: 0, since: 0 }))
    this.scenes = braziers.flatMap(({ scene, skull }, brazier): SceneState[] => {
      const at = this.waitsAt[brazier]!
      if (scene === 'well') {
        const b = braziers[brazier]!
        const turn = ((b.turn ?? 0) * Math.PI) / 180
        return [{ kind: 'well', brazier, ...at, turn, wound: 0, near: false }]
      }
      if (scene === 'cage') {
        const fire = braziers[brazier]!
        const turn = fire.turn !== undefined ? (fire.turn * Math.PI) / 180 : Math.atan2(fire.x - at.x, fire.z - at.z) - Math.atan2(CAGE_CAMPFIRE.x, CAGE_CAMPFIRE.z)
        const beside = turned(this.settings.keyBeside, turn)
        const set = turned(CART_MIDDLE, turn)
        const placed = braziers[brazier]!.cart
        const cart = placed ? { x: placed.x - at.x - set.x, z: placed.z - at.z - set.z } : { x: 0, z: 0 }
        return [{ kind: 'cage', brazier, ...at, turn, cart, skull: { ...skull! }, key: { x: skull!.x + beside.x, z: skull!.z + beside.z }, carried: false, unlocking: 0, unlockedAt: Number.NaN, open: false, near: false }]
      }
      if (scene === 'tree') {
        const fire = fires.findIndex((f) => f.k === brazier)
        const { x, z, place } = fires[fire]!
        return [{ kind: 'tree', brazier, ...at, place, fire: { x, z }, fireLight: braziers.length + fire, calledAt: Number.NaN, catching: 0, near: false }]
      }
      return []
    })
    this.winding = this.scenes.map(() => 0)
    this.wells = this.scenes.flatMap((scene) => (scene.kind === 'well' ? wellBodiesOf(scene).map((body) => shoreLight(scene.x + body.middle.x, scene.z + body.middle.z, shoreOf(body))) : []))
    // The rats set down once every body is on the ground, out of them all.
    const spawnRing = { ...start, inner: this.runTuning.torchReach + RESTART_ROOM, outer: START_RING }
    const ground: Ground = { walls: [], bounds, lights: this.startLights(), spawnRing }
    this.swarm = drive.swarm?.(ground) ?? (new SteppedSwarm(16384, this.settings.seed, 1, ground) as unknown as S)
    this.swarm.reset(this.settings.rats)
    const square: Point[] = [
      { x: -CAGE, z: -CAGE },
      { x: CAGE, z: -CAGE },
      { x: CAGE, z: CAGE },
      { x: -CAGE, z: CAGE },
    ]
    this.solid = this.scenes.flatMap((scene): { scene: SceneState; body: Body; bars?: boolean }[] => {
      const middle = { x: 0, z: 0 }
      if (scene.kind === 'well') return wellBodiesOf(scene).map((body) => ({ scene, body: { ...body, at: scene } }))
      if (scene.kind === 'cage') {
        return [
          { scene, body: { outline: square, middle, at: scene }, bars: true },
          { scene, body: { outline: cartOf(scene), middle: cartMiddleOf(scene), at: scene } },
        ]
      }
      return []
    })
  }

  /**
   * The bodies on the ground now: every well's, every cage's bars while shut
   * and its cart; the burning tree's trunk, the fire pit by each well, and each cage's
   * campfire, on their lights wherever they stand; each dead tree and the
   * brazier by it; each dead body, round its
   * skull; and the arches' stones.
   */
  private bodies(): Body[] {
    const { lights } = this.level
    const pits = this.wellFires.map(({ light }) => lights[light]!)
    const sets = this.scenes.flatMap((scene): Body[] => {
      const turn = (outline: readonly Point[], by: number) => outline.map((p) => turned(p, by))
      if (scene.kind === 'cage') {
        return [
          { at: lights[scene.brazier]!, outline: turn(CAMPFIRE_OUTLINE, scene.turn), middle: ORIGIN },
          { at: scene.skull, outline: turn(CORPSE_OUTLINE, scene.turn), middle: turned(CORPSE_MIDDLE, scene.turn) },
        ]
      }
      if (scene.kind === 'tree') {
        return [
          { at: scene, outline: TREE_OUTLINE, middle: ORIGIN },
          { at: scene.fire, outline: TREE_FIRE_OUTLINE, middle: ORIGIN },
        ]
      }
      return []
    })
    return [
      ...this.solid.flatMap(({ scene, body, bars }) => (bars && scene.kind === 'cage' && scene.open ? [] : [body])),
      ...(this.spawnPit() ? [{ at: lights[0]!, outline: SPAWN_TRUNK, middle: ORIGIN }] : []),
      ...pits.map((at) => ({ at, outline: PIT_OUTLINE, middle: ORIGIN })),
      ...sets,
      ...this.stones,
    ]
  }

  /** Whether the plain's first brazier is the spawn's, a fire alone with no scene: the burning tree stands on it (goosescenes.ts). */
  private spawnPit(): boolean {
    return this.plain.braziers[0] !== undefined && this.plain.braziers[0].scene === undefined
  }

  /** What the old road's arches stand on (arches.ts), each its middle and its outline from that: she and her goslings keep out of them, from the next step. */
  setStones(stones: readonly { at: Point; outline: readonly Point[] }[]): void {
    this.stones = stones.map(({ at, outline }) => ({ at, outline, middle: ORIGIN }))
  }

  /** The dead trees' trunks by the road (deadtrees.ts): she and her goslings keep out of them, from the next step. */
  setTrunks(trunks: readonly Trunk[]): void {
    this.trunks = trunks
  }

  /** The pumpkins round each scene's dead tree (goosescenes.ts): she and her goslings keep out of them as out of the trunks, from the next step. */
  setPumpkins(pumpkins: readonly Trunk[]): void {
    this.pumpkins = pumpkins
  }

  /** What is round on the ground: the trunks and the pumpkins. */
  private rounds(): Trunk[] {
    return [...this.trunks, ...this.pumpkins]
  }

  /** The lights the swarm holds rats off: the braziers', the spawn's as far as the rats fear it, then the pond's, then the wells'. */
  lights(): FixedLight[] {
    const lights = this.run.lights()
    if (this.spawnPit() && lights[0]) lights[0] = { ...lights[0], reach: lights[0].reach * this.settings.spawnFear }
    return [...lights, this.water, ...this.wells]
  }

  /** The rats start round her, out of the braziers' light, the pond, the wells and her own light, with room to breathe. */
  private startLights(): FixedLight[] {
    return [...this.lights(), { ...this.plain.start, reach: this.runTuning.torchReach + RESTART_ROOM, on: true }]
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

  /** How long she has been falling, s, her life run out: NaN, not falling. */
  get fallen(): number {
    return this.t - this.fellAt
  }

  /** How long since she woke, s, while she wakes: NaN, past RISE or never fallen. */
  get woken(): number {
    const since = this.t - this.wokeAt
    return since < RISE ? since : Number.NaN
  }

  /** Whether she is falling or waking: the keys are not hers. */
  get down(): boolean {
    return !Number.isNaN(this.fallen) || !Number.isNaN(this.woken)
  }

  /** How many goslings are in her circle. */
  get circle(): number {
    return this.goslings.filter((g) => g?.state === 'circle').length
  }

  /**
   * A debug key's: her circle made the first `n` goslings, in the route's
   * order, each come in at its place behind her; the rest back waiting at
   * their braziers.
   */
  giveGoslings(n: number): void {
    const came: number[] = []
    let given = 0
    this.goslings.forEach((g, k) => {
      if (!g) return
      const was = g.state
      this.vx[k] = this.vz[k] = 0
      this.climbs[k] = undefined
      this.exits[k] = undefined
      this.resting[k] = false
      this.searches[k] = { stop: 0, at: 0, since: 0 }
      if (given++ < n) {
        g.state = k === this.guide ? 'guiding' : 'circle'
        if (was === 'waiting') {
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
      }
    }
    const places = this.places()
    const circle = this.goslings.flatMap((g, k) => (g?.state === 'circle' ? [k] : []))
    for (const k of came) Object.assign(this.goslings[k]!, places[circle.indexOf(k)]!)
  }

  /** One frame of the play: her walk and the run, the goslings gathered and placed, and the swarm moved on. */
  frame(dt: number, keys: GooseInput): void {
    const { run, settings } = this
    this.t += dt
    if (this.fallen >= settings.fall.lasts) this.wake()
    // Falling or waking, the keys do nothing.
    const input: GooseInput = this.down ? { heading: null } : keys
    const way = input.heading
    const holder = run.holder
    let toward = way === null ? null : { x: holder.x + way.x, z: holder.z + way.z }
    let speed = settings.pace
    // Falling, his run carries him on the way he was going, slowing to a stop over FALL_CARRY s, eased at both ends:
    // hardly slowed at first, coming to rest gently.
    const carried = this.fallen < FALL_CARRY ? 1 - eased(this.fallen, 0, FALL_CARRY) : 0
    const fellPace = Math.hypot(this.fellMoving.x, this.fellMoving.z)
    if (carried > 0 && fellPace > 1e-6) {
      toward = { x: holder.x + this.fellMoving.x / fellPace, z: holder.z + this.fellMoving.z / fellPace }
      speed = fellPace * carried
    }
    const fromX = holder.x
    const fromZ = holder.z
    this.placeScenes()
    this.burnDown()
    // No rats are ever at her, as the run counts them: she is never caught.
    // Nothing fills the torch by itself: she holds the interact key at a fire for it (`work`). Nor does it burn until
    // her first step.
    if (way !== null) this.started = true
    const fuel = run.fuel
    run.step({ dt, toward, speed, arena: this.swarm.arena, interact: false, reached: 0, dip: false })
    if (dt > 0) {
      this.moving.x = (holder.x - fromX) / dt
      this.moving.z = (holder.z - fromZ) / dt
    }
    if (!this.started) run.fuel = fuel
    // Falling, her torch dies; waking, it catches from the fire.
    if (!Number.isNaN(this.fallen)) run.fuel = this.fellFuel * (1 - eased(this.fallen, 0, settings.fall.dims))
    else if (!Number.isNaN(this.woken)) run.fuel = eased(this.woken, RISE_CATCH[0], RISE_CATCH[1])
    if (way === null && input.look) this.turnTo(input.look, dt)
    this.keepOffBodies(holder, HOLDER_RADIUS)
    this.search(dt)
    this.gather()
    this.lead(dt)
    this.work(dt, input.interact === true)
    this.walkGoslings(dt)
    const torch = run.torch
    const light = this.torchLight
    light.x = torch.x
    light.z = torch.z
    light.strength = torch.reach / this.tuning.ringMax
    light.on = torch.lit
    const dark: Dark = { x: run.holder.x, z: run.holder.z, radius: settings.sight }
    this.targets = this.goslings.flatMap((g) => (g ? [{ x: g.x, z: g.z }] : []))
    this.report = this.swarm.advance(dt, light, this.tuning, this.lights(), dark, this.targets)
    this.bite(dt)
  }

  /**
   * The rats' bites, where the swarm last placed them: each rat at her takes some of her life, MOST_BITERS at most at
   * once; with none at her for `healAfter` s, it comes back. With none left she falls (`fall`). Not while she falls or
   * wakes. Her goslings are never bitten.
   */
  private bite(dt: number): void {
    if (dt > 0) {
      this.biters = 0
      this.biteFrom.x = this.biteFrom.z = 0
    }
    if (dt <= 0 || this.down) return
    const { holder } = this.run
    const { settings, t } = this
    const reach = this.tuning.holderReach
    const { x, z, count } = this.swarm
    let atHer = 0
    let fromX = 0
    let fromZ = 0
    for (let i = 0; i < count; i++) {
      const dx = x[i]! - holder.x
      const dz = z[i]! - holder.z
      if (Math.abs(dx) < reach && Math.abs(dz) < reach && dx * dx + dz * dz < reach * reach) {
        atHer++
        fromX += dx
        fromZ += dz
      }
    }
    if (atHer > 0) {
      this.biters = Math.min(atHer, MOST_BITERS)
      const from = Math.hypot(fromX, fromZ)
      if (from >= 1e-9) {
        this.biteFrom.x = fromX / from
        this.biteFrom.z = fromZ / from
      }
      this.life -= this.biters * settings.herBite * dt
      this.bittenAt = t
    } else if (t - this.bittenAt >= settings.healAfter) this.life = Math.min(1, this.life + settings.heal * dt)
    if (this.life <= 0) this.fall()
  }

  /** Her life run out: she falls, carried on a moment by her run, her torch dying from what it had, her circle huddling into her (`places`). */
  private fall(): void {
    this.life = 0
    this.fellAt = this.t
    this.fellFuel = this.run.fuel
    this.fellMoving.x = this.moving.x
    this.fellMoving.z = this.moving.z
    this.resting.fill(false)
  }

  /**
   * Her fall over: she wakes where she last filled her torch at a fire, her life full, her torch out to catch from it,
   * her circle round her, whole, the guide ahead of her, and every rat placed again out of the lights and her room.
   */
  private wake(): void {
    const { holder } = this.run
    holder.x = this.restAt.x
    holder.z = this.restAt.z
    this.life = 1
    this.bittenAt = Number.NEGATIVE_INFINITY
    this.fellAt = Number.NaN
    this.run.fuel = 0
    this.kindled = 0
    this.deaths++
    this.wokeAt = this.t
    this.stoodAt.x = this.stoodAt.z = Number.NaN
    const places = this.places()
    let place = 0
    this.goslings.forEach((g, k) => {
      if (g?.state !== 'circle' && g?.state !== 'guiding') return
      Object.assign(g, g.state === 'circle' ? places[place++]! : this.guideTo(holder))
      this.vx[k] = this.vz[k] = 0
      this.resting[k] = false
    })
    this.swarm.restart([...this.lights(), { x: holder.x, z: holder.z, reach: this.runTuning.torchReach + RESTART_ROOM, on: true }])
  }

  /**
   * The goslings waiting in the light of a brazier she has walked into join her circle, as it reaches now; and one left
   * in the dark, its light dead, as her lit torch's light reaches it; one waiting out in the pond, as soon as she is in
   * its water, swimming to her. Not a scene's, which its scene gives her.
   */
  private gather(): void {
    const { holder, torch } = this.run
    this.plain.braziers.forEach((b, k) => {
      const g = this.goslings[k]
      if (b.scene !== undefined || !g) return
      const light = this.level.lights[k]!
      if (b.searching) {
        if (Math.hypot(holder.x - g.x, holder.z - g.z) <= SEARCH_SEES) this.join(k)
        return
      }
      const inLight = light.on && Math.hypot(holder.x - light.x, holder.z - light.z) <= light.reach
      const found = torch.lit && Math.hypot(holder.x - g.x, holder.z - g.z) <= torch.reach
      const { pond } = this.plain
      const inPond = (p: Point) => Math.hypot(p.x - pond.x, p.z - pond.z) <= pond.radius
      const swimsTo = inPond(this.waitsAt[k]!) && inPond(holder)
      if (inLight || found || swimsTo) this.join(k)
    })
  }

  /** Each searching gosling still waiting, `dt` s on: standing at its stop, or darting to the next, along its light's edge. */
  private search(dt: number): void {
    this.plain.braziers.forEach((b, k) => {
      const g = this.goslings[k]
      if (!b.searching || g?.state !== 'waiting') return
      const s = this.searches[k]!
      s.since += dt
      const stands = searchStands(s.stop)
      let at = s.at
      if (s.since > stands) {
        const to = searchStop(s.stop + 1)
        const ran = (s.since - stands) * SEARCH_PACE
        if (ran >= Math.abs(to - s.at)) {
          s.stop++
          s.at = at = to
          s.since = 0
        } else at = s.at + Math.sign(to - s.at) * ran
      }
      const edge = this.edgeOf(k, at)
      g.x = edge.x
      g.z = edge.z
    })
  }

  /** Where on searching gosling `k`'s arc a point `along` m round its light's edge from where it waits lies, and its angle round the light, radians from +x. */
  private edgeOf(k: number, along: number): Point & { angle: number } {
    const light = this.level.lights[k]!
    const home = this.waitsAt[k]!
    const radius = Math.max(Math.hypot(home.x - light.x, home.z - light.z), 1e-6)
    const angle = Math.atan2(home.z - light.z, home.x - light.x) + along / radius
    return { x: light.x + Math.cos(angle) * radius, z: light.z + Math.sin(angle) * radius, angle }
  }

  /**
   * Which way searching gosling `k`, still waiting, looks while it stands, its yaw as the page turns a bird (from +z
   * toward +x): out into the dark from its light, glancing one way then the other. Nothing while it darts. The guide
   * looks back at her. Nothing for any other gosling.
   */
  lookOf(k: number): number | undefined {
    const g = this.goslings[k]
    if (g?.state === 'guiding') return Math.atan2(this.run.holder.x - g.x, this.run.holder.z - g.z)
    if (!this.plain.braziers[k]?.searching || this.goslings[k]?.state !== 'waiting') return undefined
    const s = this.searches[k]!
    const stands = searchStands(s.stop)
    if (s.since > stands) return undefined
    const { angle } = this.edgeOf(k, s.at)
    const share = s.since / stands
    const side = s.stop % 2 === 0 ? 1 : -1
    const glance = share < 0.3 ? 0 : share < 0.65 ? side * SEARCH_GLANCE : -side * SEARCH_GLANCE * 0.8
    return Math.atan2(Math.cos(angle), Math.sin(angle)) + glance
  }

  /** Each dying light's script: started as she first comes within its trigger, burning on its set time, then shrinking to nothing over its last. */
  private burnDown(): void {
    const { holder } = this.run
    this.plain.braziers.forEach((b, k) => {
      if (b.dying === undefined) return
      const { trigger, after, lasts } = b.dying
      if (Number.isNaN(this.dyingAt[k]!) && Math.hypot(holder.x - b.x, holder.z - b.z) <= trigger) this.dyingAt[k] = this.t
      const since = this.t - this.dyingAt[k]! - after
      const share = Number.isNaN(since) || since <= 0 ? 1 : Math.max(0, 1 - since / Math.max(lasts, 1e-6))
      const light = this.level.lights[k]!
      light.reach = b.reach * share
      light.on = share > 0
    })
  }

  /** Her turned, standing, toward `look`, eased over LOOK_TURN. */
  private turnTo(look: Point, dt: number): void {
    const { facing } = this.run
    const from = Math.atan2(facing.z, facing.x)
    let turn = Math.atan2(look.z, look.x) - from
    turn -= Math.PI * 2 * Math.round(turn / (Math.PI * 2))
    const to = from + turn * (1 - Math.exp(-dt / LOOK_TURN))
    facing.x = Math.cos(to)
    facing.z = Math.sin(to)
  }

  /** Gosling `k`, if waiting, joins her circle now; the guide goes on ahead of her instead. */
  private join(k: number): void {
    const g = this.goslings[k]!
    if (g.state !== 'waiting') return
    g.state = k === this.guide ? 'guiding' : 'circle'
    g.gatheredAt = this.t
  }

  /**
   * The guiding gosling `dt` s on: found, making at once for its place ahead of her, easing in as it nears it; there,
   * or anywhere further on than it, it waits for her, never coming back to her: she follows it.
   */
  private lead(dt: number): void {
    const g = this.goslings[this.guide]
    if (g?.state !== 'guiding') {
      this.guideWaits = 0
      return
    }
    const { holder } = this.run
    const to = this.guideTo(holder)
    const ax = to.x - holder.x
    const az = to.z - holder.z
    const further = (g.x - holder.x) * ax + (g.z - holder.z) * az >= ax * ax + az * az
    const d = Math.hypot(to.x - g.x, to.z - g.z)
    this.guideWaits = further || d <= GUIDE_STILL ? this.guideWaits + dt : 0
    if (further || d < 1e-4) return
    const go = d > GUIDE_LOST ? d : Math.min(d, Math.min(GUIDE_FASTEST, d * GUIDE_EASE) * dt)
    g.x += ((to.x - g.x) * go) / d
    g.z += ((to.z - g.z) * go) / d
  }

  /**
   * The scenes worked with the interact key, `interact` held over `dt`: at the
   * well, held its set time, the bucket wound up and its gosling with her, let
   * go early, the bucket dropped; at the dead tree, the torch lit, held its
   * set time, its gosling called down, jumping; let go early,
   * the next hold starts from none. At the cage's key, lying by the body, picked up,
   * and at the cage, carrying it, the cage opened.
   */
  private work(dt: number, interact: boolean): void {
    const { holder } = this.run
    const { winding } = this
    // At a lit flame, in its dip, away from any scene the key would work now, the key fills the torch,
    // the burn held off the while; unheld, nothing fills it.
    const atWinch = (well: Point) => inZone(this.winchZoneOf(well), holder)
    const working = this.scenes.some((scene) => this.workable(scene))
    const { dip } = this.runTuning
    // A scene's fire through its own zone; any other flame in its dip.
    const owned = new Map(this.scenes.flatMap((scene) => (scene.kind === 'well' ? [] : [[this.fireLightOf(scene), scene] as const])))
    const fire = this.level.lights.some((light, k) => {
      if (!light.flame || !light.on) return false
      const scene = owned.get(k)
      return scene ? inZone(this.fireZoneOf(scene)!, holder) : Math.hypot(holder.x - light.x, holder.z - light.z) <= dip + (light.pad ?? 0)
    })
    const refill = fire && !working
    // Filling at a fire, she will wake there.
    if (refill && interact) {
      this.restAt.x = holder.x
      this.restAt.z = holder.z
    }
    // Out, it fills unlit and catches full; let go, what was filled goes again. Lit, it tops up.
    const out = this.run.fuel <= 0
    if (!(refill && interact)) this.fillFrom = Number.NaN
    else if (Number.isNaN(this.fillFrom)) this.fillFrom = this.run.fuel
    const caught = () => {
      this.caughtAt = this.t
      this.caughtFrom = this.fillFrom
    }
    if (out) {
      this.kindled =
        refill && interact
          ? Math.min(1, this.kindled + dt / Math.max(this.settings.refillHold, 1e-6))
          : Math.max(0, this.kindled - dt / Math.max(this.settings.lightLetGo, 1e-6))
      if (this.kindled >= FULL) {
        this.run.fuel = 1
        this.kindled = 0
        caught()
      }
    } else {
      this.kindled = 0
      const was = this.run.fuel
      if (refill && interact) this.run.fuel = Math.min(1, this.run.fuel + dt * (1 / Math.max(this.settings.refillHold, 1e-6) + this.runTuning.burnRate))
      if (was < FULL && this.run.fuel >= FULL) caught()
    }
    this.atRefill = refill && (out || this.run.fuel < FULL)
    this.scenes.forEach((scene, s) => {
      const waiting = this.goslings[scene.brazier]!.state === 'waiting'
      if (scene.kind === 'cage') return this.workCage(scene, s, dt, interact)
      scene.near = this.workable(scene)
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
    this.walkOut(cage)
  }

  /** The cage's gosling, let out: waits for the door to open, then walks out through it; it joins her once out. */
  private walkOut(cage: Cage): void {
    const g = this.goslings[cage.brazier]!
    const at = (x: number, z: number) => {
      const p = turned({ x, z }, cage.turn)
      return { x: cage.x + p.x, z: cage.z + p.z }
    }
    this.exits[cage.brazier] = { at: this.t + CAGE_DOOR_OPENS, stops: [{ x: g.x, z: g.z }, at(CAGE_DOOR_X, CAGE - GOSLING_RADIUS), at(CAGE_DOOR_X, CAGE + CAGE_STEP_OUT)] }
  }

  /**
   * Whether the interact key would work `scene` where she stands now, its gosling still in it: winch the well, call the
   * dead tree's gosling down with her torch lit, pick the cage's key up or, carrying it, unlock the cage. Its zone then
   * comes first, over any fire's dip it overlaps.
   */
  private workable(scene: SceneState): boolean {
    if (this.goslings[scene.brazier]!.state !== 'waiting') return false
    // Open, its gosling on its way out, there is nothing more to do at it.
    if (scene.kind === 'cage' && scene.open) return false
    const { holder } = this.run
    if (scene.kind === 'well') return inZone(this.winchZoneOf(scene), holder)
    if (scene.kind === 'tree') return Number.isNaN(scene.calledAt) && this.run.torch.lit && inZone(this.treeZoneOf(scene), holder)
    return inZone(scene.carried ? this.zoneOf(scene) : this.keyZoneOf(scene), holder)
  }

  /** Where the interact key works `scene`: the well's winch, the dead tree's call, round the cage; as the settings set them now. */
  zoneOf(scene: SceneState): Zone {
    if (scene.kind === 'well') return this.winchZoneOf(scene)
    if (scene.kind === 'tree') return this.treeZoneOf(scene)
    const zone = this.settings.cageZone
    const r = CAGE + this.runTuning.leverReach
    return { x: scene.x + zone.x, z: scene.z + zone.z, rx: r * zone.scaleX, rz: r * zone.scaleY }
  }

  /** Where she picks `cage`'s key up, lying beside the body, as the settings set it now. */
  keyZoneOf(cage: Cage): Zone {
    const { x, z, scaleX, scaleY } = this.settings.keyZone
    const reach = this.runTuning.keyReach
    return { x: cage.key.x + x, z: cage.key.z + z, rx: reach * scaleX, rz: reach * scaleY }
  }

  /** Where she fills her torch at `scene`'s fire, as the settings set it now: the dip of the dead tree's brazier or the cage's campfire. */
  fireZoneOf(scene: Tree | Cage): Zone {
    const light = this.level.lights[this.fireLightOf(scene)]!
    const { x, z, scaleX, scaleY } = this.settings.fireZones[scene.kind]
    const { dip } = this.runTuning
    return { x: light.x + x, z: light.z + z, rx: dip * scaleX, rz: dip * scaleY }
  }

  /** `scene`'s fire's light, by its index in the level's lights: the dead tree's brazier's, after the braziers'; the cage's, in its brazier's place's. */
  fireLightOf(scene: Tree | Cage): number {
    return scene.kind === 'tree' ? scene.fireLight : scene.brazier
  }

  /** Where she winches `well`, as the settings set it now. */
  winchZoneOf(well: Point): Zone {
    const { x, z, scaleX, scaleY } = this.settings.winchZone
    return { x: well.x + x, z: well.z + z, rx: WELL_REACH * scaleX, rz: WELL_REACH * scaleY }
  }

  /** A debug key's: her stood back where she starts, facing up the plain. */
  standAtStart(): void {
    const { holder, facing } = this.run
    holder.x = this.plain.start.x
    holder.z = this.plain.start.z
    facing.x = 0
    facing.z = -1
  }

  /** A debug key's: her stood POND_BY m short of the pond's water, on the side she comes from, facing it. */
  standByPond(): void {
    const { pond, home } = this.plain
    const { holder, facing } = this.run
    const away = Math.hypot(home.x - pond.x, home.z - pond.z) || 1
    const ux = (home.x - pond.x) / away
    const uz = (home.z - pond.z) / away
    holder.x = home.x + ux * (WADE + POND_BY)
    holder.z = home.z + uz * (WADE + POND_BY)
    facing.x = -ux
    facing.z = -uz
  }

  /**
   * A debug key's: her stood STAND_BY m short of the zone where she works the
   * first scene of `kind`, the well's winch, the dead tree's call or the
   * cage, on the camera's side of it (+z), facing it. Nothing with no such scene.
   */
  standBy(kind: Scene): void {
    const scene = this.scenes.find((s) => s.kind === kind)
    if (scene === undefined) return
    const zone = this.zoneOf(scene)
    const { holder, facing } = this.run
    holder.x = zone.x
    holder.z = zone.z + zone.rz + STAND_BY
    facing.x = 0
    facing.z = -1
    this.keepOffBodies(holder, HOLDER_RADIUS)
  }

  /**
   * The scenes' pieces the settings move, where they set them now: the fire pit
   * by each well, and its light and how far it holds the rats off; how far the spawn's brazier does; the brazier by each dead tree, and its light; each cage's campfire, and its light, and
   * its key, beside the body; and how
   * far each scene's fire holds the rats off.
   */
  /** The settings' pieces placed now, the play not stepped: for the opening, which plays before the play does. */
  place(): void {
    this.placeScenes()
  }

  private placeScenes(): void {
    const { treeFire, wellFire, wellFireReach, spawnReach, cageFire, keyBeside, fireReach } = this.settings
    for (const { place, light } of this.wellFires) {
      this.level.lights[light]!.x = place.x + wellFire.x
      this.level.lights[light]!.z = place.z + wellFire.z
      this.level.lights[light]!.reach = wellFireReach
    }
    if (this.plain.braziers[0] && this.plain.braziers[0].scene === undefined) this.level.lights[0]!.reach = spawnReach
    for (const scene of this.scenes) {
      if (scene.kind === 'well') continue
      this.level.lights[this.fireLightOf(scene)]!.reach = fireReach[scene.kind]
      if (scene.kind === 'cage') {
        const beside = turned(keyBeside, scene.turn)
        scene.key.x = scene.skull.x + beside.x
        scene.key.z = scene.skull.z + beside.z
        const place = this.plain.braziers[scene.brazier]!
        const light = this.level.lights[scene.brazier]!
        light.x = place.x + cageFire.x
        light.z = place.z + cageFire.z
      }
      if (scene.kind !== 'tree') continue
      const light = this.level.lights[scene.fireLight]!
      light.x = scene.fire.x = scene.place.x + treeFire.x
      light.z = scene.fire.z = scene.place.z + treeFire.z
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

  /** The tree's gosling, called, jumps down from it to the ground where the page or the settings land it; it joins her once down. */
  private jumpDown(tree: Tree): void {
    const g = this.goslings[tree.brazier]!
    const { x, z } = this.landingOf?.(tree) ?? this.settings.treeLanding
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
      if (wellBodiesOf(well).every(({ outline }) => !outOf(outline, { x: land.x - well.x, z: land.z - well.z }, GOSLING_RADIUS))) break
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
      // The trunks and the pumpkins, round: set out along the line from the middle.
      for (const { at, radius: trunk } of this.rounds()) {
        const dx = body.x - at.x
        const dz = body.z - at.z
        const least = trunk + radius
        const d = Math.hypot(dx, dz)
        if (d >= least) continue
        const [ux, uz] = d > 1e-9 ? [dx / d, dz / d] : [1, 0]
        body.x = at.x + ux * least
        body.z = at.z + uz * least
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
    // The nearest trunk on the way, gone round as a body is, round its middle.
    let nearest: Trunk | undefined
    let first = Infinity
    for (const trunk of this.rounds()) {
      const ax = trunk.at.x - body.x
      const az = trunk.at.z - body.z
      const t = Math.max(0, Math.min(1, (ax * ox + az * oz) / (d * d)))
      if (Math.hypot(ax - ox * t, az - oz * t) >= trunk.radius + radius || t >= first) continue
      nearest = trunk
      first = t
    }
    if (nearest !== undefined) {
      const ax = body.x - nearest.at.x
      const az = body.z - nearest.at.z
      const r = Math.hypot(ax, az)
      if (r > 1e-6) {
        const across = ax * (to.z - nearest.at.z) - az * (to.x - nearest.at.x)
        const side = Math.abs(across) > 1e-6 * r * d ? Math.sign(across) : turn
        return { x: (-az / r) * side, z: (ax / r) * side }
      }
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

  /**
   * Where each gosling of her circle, in its order, is to stand: in the arcs
   * round her back, turned after the way she faces, each place swaying a
   * little while she walks; falling, drawn in tight and round her (FALL_CLOSE).
   */
  private places(): Point[] {
    const { holder } = this.run
    const circle = this.goslings.flatMap((g, k) => (g?.state === 'circle' ? [k] : []))
    const huddle = this.huddle()
    const close = Math.max(HUDDLE, Math.min(CLOSE, this.run.torch.reach - RING_MARGIN))
    const first = close + (FALL_CLOSE - close) * huddle
    const apart = PLACE + (FALL_PLACE - PLACE) * huddle
    const round = BEHIND + (FALL_ROUND - BEHIND) * huddle
    const places: Point[] = []
    for (let row = 0, from = 0; from < circle.length; row++) {
      const radius = first + row * ROW
      const step = apart / radius
      const fits = Math.floor(round / step + 1e-9) + 1
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

  /** How far her circle has huddled into her, 0 to 1: over her torch's dying as she falls; none otherwise. */
  private huddle(): number {
    return Number.isNaN(this.fallen) ? 0 : eased(this.fallen, 0, FALL_DIM)
  }

  /**
   * The goslings of her circle walk, each by itself: for its place in the
   * arcs close round her back (`places`), the arcs turning after the way she
   * faces, each place swaying a little. Each goes at its own top pace at most,
   * gathering pace and slowing as its legs allow, slowing as it nears where it
   * is going, so it trails a moment behind as she walks, and stepping away
   * from a sibling or her that comes too close. Nothing else moves it.
   */
  private walkGoslings(dt: number): void {
    if (dt <= 0) return
    const { holder, facing } = this.run
    const way = Math.atan2(facing.z, facing.x)
    const turn = Math.atan2(Math.sin(way - this.ringYaw), Math.cos(way - this.ringYaw))
    this.ringYaw += turn * (1 - Math.exp(-dt / RING_TURN))
    // Whether she walks: the places sway only while she does, and only then do the goslings at rest set off.
    const { stoodAt } = this
    const walking = !Number.isNaN(stoodAt.x) && Math.hypot(holder.x - stoodAt.x, holder.z - stoodAt.z) / dt > STILL
    stoodAt.x = holder.x
    stoodAt.z = holder.z
    this.swaying += ((walking ? 1 : 0) - this.swaying) * (1 - Math.exp(-dt / SWAY_FADE))
    const { vx, vz, resting } = this
    // Let out of the cage, it waits for its door, then walks out through it, stop to stop; out, it joins her.
    this.goslings.forEach((g, k) => {
      const exit = this.exits[k]
      if (g?.state !== 'waiting' || exit === undefined) return
      let left = Math.max(0, this.t - exit.at) * CAGE_WALK
      for (let s = 1; s < exit.stops.length; s++) {
        const from = exit.stops[s - 1]!
        const to = exit.stops[s]!
        const length = Math.hypot(to.x - from.x, to.z - from.z)
        if (left < length) {
          g.x = from.x + ((to.x - from.x) * left) / length
          g.z = from.z + ((to.z - from.z) * left) / length
          return
        }
        left -= length
      }
      g.x = exit.stops.at(-1)!.x
      g.z = exit.stops.at(-1)!.z
      this.exits[k] = undefined
      this.join(k)
    })
    // Jumping down from the tree, it hops, still waiting, moving only in the air; down, it joins her.
    this.goslings.forEach((g, k) => {
      const climb = this.climbs[k]
      if (g?.state !== 'waiting' || climb === undefined) return
      const hop = this.hopOf(k)
      const air = hop === null ? 1 : airOf(hop.share)
      const [from, to] = hop === null ? [climb.stops.at(-2)!, climb.stops.at(-1)!] : [hop.from, hop.to]
      g.x = from.x + (to.x - from.x) * air
      g.z = from.z + (to.z - from.z) * air
      if (hop !== null) return
      this.climbs[k] = undefined
      this.join(k)
    })
    const circle = this.goslings.flatMap((g, k) => (g?.state === 'circle' ? [k] : []))
    const places = this.places()
    const huddle = this.huddle()
    const huddling = !Number.isNaN(this.fallen)
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
      const { x: tx, z: tz } = places[place]!
      const top = GOSLING_TOP[0]! + (GOSLING_TOP[1]! - GOSLING_TOP[0]!) * own
      const arrive = ARRIVE[0]! + (ARRIVE[1]! - ARRIVE[0]!) * (1 - own)
      const ox = tx - g.x
      const oz = tz - g.z
      const d = Math.hypot(ox, oz)
      // At rest it stays so, wanting no pace, until its place has gone off; come to its place with her standing, it rests.
      // Huddling into her as she falls, it never rests.
      if (huddling) resting[k] = false
      else if (resting[k] && d > GO) resting[k] = false
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
        for (const j of circle) if (j !== k) away(this.goslings[j]!.x, this.goslings[j]!.z, SPACE + (FALL_SPACE - SPACE) * huddle)
        away(holder.x, holder.z, HER_SPACE + (FALL_SPACE - HER_SPACE) * huddle)
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
}
