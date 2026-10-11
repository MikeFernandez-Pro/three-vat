// PROTOTYPE: Last Light in 2D, top-down, to test the new level's play before
// it is built in 3D (design/level.html). `2d.html`.
//
// The play is the game's own: the run (run.ts) burns and refuels the torch and
// catches the player, the swarm (swarm.ts) runs the rats, the walls and the lit
// areas stop them and the light, all tuned as the 3D page tunes them
// (gameplay.ts). What is new is scripted here, on top, for now: the opening
// with control locked, the two lightning strikes, the cracked tree knocked
// down burning, crawling under it, the low growth that stops the child but not
// the rats, the light or the eye, the river that stops all three but the eye,
// the cart pushed over the bridge, the text lines, the checkpoints, and where
// the rats are set down. If the play holds, they move into the run as rules
// of their own.
//
// The cart rolls on only while the child walks into its back, at the push's
// pace, the share of his walk that goes along the bridge, and never back. It
// stops him, never the rats or the light: its brazier's light covers him as
// he pushes. Its brazier is a light the run reads where the cart now is,
// dipped into like any flame, and only its east side comes close enough.
//
// The gate is the run's own, opened by the key and left open; its bars stop
// the child alone, so the swarm never reads it. Up on the beam the child is
// out of the rats' reach: no catch counts there, and he goes slowly.
//
// Past the pine the stick is damp: caught again, it burns a short time and
// dims as fast. When it dies he panics and runs by himself, the player still
// steering: a bolt for a second and a half, which is what gets him clear of
// the rats on his heels, then a panicked run, faster than his walk. The tangle across the drive is crawled through,
// as the trunk is; leaving either stands him up again.
//
// The rats are a budget, not a crowd spread over the level: every one is
// meant to be chasing the child. They start in the bushes round the clearing,
// but for the groups the level has wait further on, still until the child
// comes within their notice; a rat left further behind than the eye reaches is set down again at a spawn
// spot near the child, inside a bush or the thicket where nothing shows it,
// and comes out running. A spot wakes only within the rats' notice of the
// child, never in a light.
//
// The view stands in for the 3D one: dark but for the lights the child can
// see, the ground lit as far as each light sees it, rats' eyes pale in the dark
// round the child but never in the growth, glowing mushrooms faint along the
// ways round, and any flame in sight glowing through the dark however far: at
// the screen's edge, if it is off the screen. Rats and the child are drawn at
// their 3D sizes. V shows everything, O the designer's overlay: the trail the
// child walked, coloured by the light left, and the light left at each flame.
//
// WASD (by where the keys sit: ZQSD on AZERTY) walk; C crawls, on and off, and
// left Ctrl crawls while held; R starts again; P pauses.
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js'
import { ANGLES } from './litareas'
import { defaultRunTuning, Run } from './run'
import { Swarm, walkLight, type Bounds, type Light, type StepReport } from './swarm'
import { STEP } from './swarm-remote'
import { HOLDER_RADIUS, WALL_THICKNESS, Walls, type Wall } from './walls'
import { LIGHT_SPEED, NOTICE, RAT_LENGTH, RAT_SIZE, RESTART_ROOM, SIZE_BY_SPEED, gameTuning } from './gameplay'
import { sides, woods, type Circle, type Point } from './woods.prototype'

const TAU = Math.PI * 2
const SEED = 7
/** How far the 3D torch's lamp lights the ground at full strength, m, as the look sets it: the 2D pool round the child is as wide. */
const LAMP_REACH = 6.9
/** How far past a placed light's hard edge its glow lights the ground, as a share of its reach. */
const GLOW = 1.5
/** The most swarm steps a frame takes: a hitch slows the swarm rather than stalling the page. */
const MOST_STEPS = 3
/** The share of the rats a second that may be set down again at the spawn spots: a stream, never a wall. */
const RESPAWN_RATE = 0.3
/** Seconds after the first strike no catch counts: the rats on the child run out of the new light. */
const GRACE = 1.5
/** How bright a rat's eyes show through the growth it is in, against in the open. */
const THROUGH_LEAVES = 0.35
/** How near the child a spot may wake, m: never on top of him; and how far, ahead of him: a rat set down past the rats' notice waits there for him. */
const SPOT_NEAR = 3
const SPOT_FAR = 12
/** Seconds the eyes take to open, in the first strike's flash. */
const OPENING = 0.4
/** How far off a light's reach a spot stays asleep, m. */
const SPOT_LIGHT = 1
/** Seconds between the trail's marks. */
const TRAIL_EVERY = 0.2
/** The child seen from above, m: shoulders across and deep, the pumpkin's radius, and on all fours. */
const SHOULDERS = 0.4
const CHEST = 0.24
const PUMPKIN = 0.14
const CRAWL_LENGTH = 0.8
/** How far off the cart's back the child still pushes it, m, past where its wall keeps him. */
const CART_TOUCH = WALL_THICKNESS / 2 + HOLDER_RADIUS + 0.08

const map = woods()
const { level } = map
const start = { ...level.start }
const tuning = gameTuning()
const runTuning = defaultRunTuning()
/** How fast a dry stick burns: the run's own. */
const DRY = runTuning.burnRate

/** The page's knobs. */
const settings = {
  rats: 1000,
  crawlSpeed: 1.5,
  pushSpeed: map.cart.speed,
  beamSpeed: 0.8,
  damp: map.dampBurn,
  bolt: 4,
  boltHold: 1.5,
  boltFor: 1.5,
  runSpeed: 2.5,
  designer: false,
  overlay: true,
  night: 0.94,
  eyes: 12,
  zoom: 18,
  mushrooms: false,
}

const swarm = new Swarm(16384, SEED, 1, { walls: level.walls, bounds: level.bounds })

// What stops the child: the level's walls, the low growth and the cart as it stands; and the trunk once it is down, unless crawling.
const trunkWall: Wall = { from: map.trunk.root, to: map.trunk.crown }
const growthWalls = map.thickets.flatMap(sides)
let walking!: Walls
let blocked!: Walls
const trunkOnly = new Walls([trunkWall])
// The tangle's two ends across the drive: they stop him standing, never crawling; the hedges are its sides.
const [ta, tb, tc, td] = map.tangle.zone as [Point, Point, Point, Point]
const tangleWalls: Wall[] = [
  { from: ta, to: tb },
  { from: tc, to: td },
]
const tangleOnly = new Walls(tangleWalls)
/** What stops him standing: what stops him crawling, and the tangle's ends. */
let upright!: Walls
const gateOnly = new Walls([level.gates[0]!])
/** What the eye stops at: what stops the light, but the water's edge and the bridge's rails. */
const sight = new Walls(level.walls.filter((wall) => !map.banks.includes(wall)))

/** The cart: where its back now stands, z, and where it stood at the last checkpoint. */
const cart = { back: map.cart.back, saved: map.cart.back }
const jammed = () => cart.back <= map.cart.jam + 1e-6

const inBox = (b: Bounds, p: Point) => p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ
/** Whether the child is on the fallen pine, over the ravine: out of the rats' reach, and slow. */
function onPine(p: Point): boolean {
  if (!inBox(map.overRavine, p)) return false
  const { from, to, half } = map.pine
  const dx = to.x - from.x
  const dz = to.z - from.z
  const along = Math.max(0, Math.min(1, ((p.x - from.x) * dx + (p.z - from.z) * dz) / (dx * dx + dz * dz)))
  return Math.hypot(p.x - from.x - dx * along, p.z - from.z - dz * along) <= half + 0.1
}

/** The cart's outline as it now stands: its back's two corners, then its front's. */
function cartOutline(): Point[] {
  const { x, half, length } = map.cart
  return [
    { x: x - half, z: cart.back },
    { x: x + half, z: cart.back },
    { x: x + half, z: cart.back - length },
    { x: x - half, z: cart.back - length },
  ]
}

/** The level's walls as the run has them standing, the gate among them while it is shut; and the run's count of changes they were last taken at. */
let standing: Wall[] = level.walls
let wallsSeen = -1

/** The cart where its back now stands: its brazier there, and its sides among what stops the child. */
function placeCart(): void {
  const brazier = level.lights[map.brazier]!
  brazier.x = map.cart.x + map.cart.across
  brazier.z = cart.back - map.cart.along
  const body = sides(cartOutline())
  walking = new Walls([...standing, ...growthWalls, ...body])
  upright = new Walls([...walking.walls, ...tangleWalls])
  blocked = new Walls([...upright.walls, trunkWall])
}

/** The walls again, if the run opened the gate since they were last taken: for the child only, since the gate's bars stop neither the rats nor the light. */
function takeWalls(): void {
  if (run.wallsVersion === wallsSeen) return
  wallsSeen = run.wallsVersion
  standing = run.walls()
  placeCart()
}

/** Whether (x, z) is inside `outline`. */
function within(outline: Point[], x: number, z: number): boolean {
  let inside = false
  for (let k = 0, j = outline.length - 1; k < outline.length; j = k++) {
    const p = outline[k]!
    const q = outline[j]!
    if (p.z > z !== q.z > z && x < ((q.x - p.x) * (z - p.z)) / (q.z - p.z) + p.x) inside = !inside
  }
  return inside
}
/** Where a rat is out of sight: 2 in a rock, 1 in the growth, where its eyes show dimly through the leaves; 0 in the open. */
const coverAt = (x: number, z: number) => (map.rocks.some((rock) => within(rock, x, z)) ? 2 : map.thickets.some((growth) => within(growth, x, z)) ? 1 : 0)

// ---------------------------------------------------------------- the play
let run!: Run
/** The script's time, s from the start. */
let t = 0
/** Whether the torch has been lit: the intro is done, and a catch starts the run again at the trunk. */
let lit = false
let crawlOn = false
let crawling = false
let startsSeen = 0
let report: StepReport | undefined
let behind = 0
let paused = false
let atTrunk = 0
let crawlHint = false
let through = false
let caught = 0
/** Whether the rats round the clearing have come: at the first strike, out of the bushes; till then only the groups waiting further on are there. */
let come = false
/** When the second strike came, when the stick first caught, and when the cart jammed, s of the script: NaN, not yet. */
let fellAt = Number.NaN
let litAt = Number.NaN
let jammedAt = Number.NaN
/** The last checkpoint passed: 0 the trunk, 1 the faint flame, 2 the cart's brazier, 3 the gate, where the rain starts, 4 the far side of the pine, where it stops. */
let stage = 0
/** Whether the child pushes the cart this frame. */
let pushing = false
/** When the rain started, when it stopped, and when the manor was first seen, s of the script: NaN, not yet. */
let rainAt = Number.NaN
let rainStopped = Number.NaN
let manorAt = Number.NaN
/** When the brazier went out in the rain, s of the script: NaN, not yet. */
let guttered = Number.NaN
/** When the damp stick last caught, when the drowned lanterns were passed, and when the stick died and he bolted, s of the script: NaN, not yet. */
let dampAt = Number.NaN
let drownedAt = Number.NaN
let panicAt = Number.NaN
/** Whether the stick burned last frame; whether he was in a place he can only crawl through; and whether he stands at the tangle, not crawling. */
let wasLit = false
let wasUnder = false
let atTangle = false
/** Whether it rains: from the gate to the far side of the pine. The stick is wet, and won't catch. */
const raining = () => stage === 3
/** The trail: where the child was, and the light left there, s; and what happened where: a refuel, a catch. */
let trail: { x: number; z: number; left: number }[] = []
let marks: { x: number; z: number; text: string }[] = []
let sinceMark = 0
let owed = 0
let cursor = 0
const facing = { x: 0, z: -1 }
const swarmLight: Light = { x: 0, z: 0, strength: 0, on: false }

/** Which side of the trunk's line (x, z) is on. */
const sideOf = (p: Point) => Math.sign((map.trunk.crown.x - map.trunk.root.x) * (p.z - map.trunk.root.z) - (map.trunk.crown.z - map.trunk.root.z) * (p.x - map.trunk.root.x))
const south = sideOf(start)

/** Whether a spot at (x, z) is in a light, or near enough one: the torch's or a placed one's. */
function lightNear(x: number, z: number): boolean {
  const torch = run.torch
  if (torch.lit && Math.hypot(x - torch.x, z - torch.z) < torch.reach + RESTART_ROOM) return true
  return run.lights().some((light) => light.on && Math.hypot(x - light.x, z - light.z) < light.reach + SPOT_LIGHT)
}

/** Set rat `i` down somewhere in `spot`, off the walls. */
function setDownAt(i: number, spot: Circle): void {
  let x = spot.x
  let z = spot.z
  for (let tries = 0; tries < 8; tries++) {
    const a = Math.random() * TAU
    const r = Math.sqrt(Math.random()) * spot.r
    x = spot.x + Math.cos(a) * r
    z = spot.z + Math.sin(a) * r
    if (!swarm.walls.inside(x, z, 0.15)) break
  }
  swarm.setDown(i, x, z)
}

/** The spots within `far` of the child, not on top of him, out of every light, and, if `ahead`, not behind the way he faces. */
function spotsNear(far: number, ahead: boolean): Circle[] {
  const holder = run.holder
  return map.spots.filter((spot) => {
    const dx = spot.x - holder.x
    const dz = spot.z - holder.z
    const d = Math.hypot(dx, dz)
    if (d < SPOT_NEAR || d > far || lightNear(spot.x, spot.z)) return false
    return !ahead || dx * facing.x + dz * facing.z >= -0.25 * d
  })
}
/** The spots awake: ahead of the child, up to SPOT_FAR. */
const wakeful = () => spotsNear(SPOT_FAR, true)

/** Which rats wait where the level put them, left to themselves until the child comes within their notice: the group's index and one, 0 for none. */
const waiting = new Uint8Array(swarm.capacity)

/**
 * The beats whose waiting groups wait, by the last checkpoint passed: from the
 * trunk the burning tree's; from the faint flame the far bank's; from the
 * cart's side the far bank's and the hill's; past the gate, and past the
 * gate the hill's and the ravine's (4.5), which wait for the far bank's to be
 * let go; past the pine, the ravine's and the far side's wood's, which follow
 * him into the park. The budget never holds the whole level's groups at once.
 */
const BEATS = [[1], [3], [3, 4], [4, 4.5], [4.5, 6]]

/** The level's waiting groups of the beats waiting now set down, those further than a spot wakes and out of the light, as the swarm's first rats: how many. */
function setWaitingDown(): number {
  waiting.fill(0)
  const holder = run.holder
  let i = 0
  map.waiting.forEach((group, g) => {
    const { spot } = group
    if (!BEATS[stage]!.includes(group.beat) || Math.hypot(spot.x - holder.x, spot.z - holder.z) < SPOT_NEAR || lightNear(spot.x, spot.z)) return
    for (let k = 0; k < group.count && i < swarm.count; k++, i++) {
      setDownAt(i, spot)
      waiting[i] = g + 1
    }
  })
  return i
}

/** Whether rat `i` may be set down elsewhere: past its notice of the child, and out of his sight, further than the eyes show, in the growth or a rock, or behind what stops the eye. `sight` near the child first. */
function spare(i: number): boolean {
  const holder = run.holder
  const x = swarm.x[i]!
  const z = swarm.z[i]!
  const d = Math.hypot(x - holder.x, z - holder.z)
  if (d <= NOTICE) return false
  return d > settings.eyes || coverAt(x, z) > 0 || sight.ray(holder.x, holder.z, (x - holder.x) / d, (z - holder.z) / d, d) < d - 0.3
}

/** A checkpoint passed: the groups of beats left behind wait no more, and those of the beats now waiting that are not yet there are set down, out of the rats to spare. */
function reachStage(next: number): void {
  const was = BEATS[stage]!
  stage = next
  if (next === 3) rainAt = t
  if (next === 4) rainStopped = t
  const now = BEATS[stage]!
  for (let i = 0; i < swarm.count; i++) if (waiting[i] && !now.includes(map.waiting[waiting[i]! - 1]!.beat)) waiting[i] = 0
  const holder = run.holder
  sight.nearTo(holder.x, holder.z, Math.hypot(level.bounds.maxX - level.bounds.minX, level.bounds.maxZ - level.bounds.minZ))
  let i = 0
  map.waiting.forEach((group, g) => {
    if (was.includes(group.beat) || !now.includes(group.beat)) return
    for (let k = 0; k < group.count; k++) {
      while (i < swarm.count && (waiting[i] || !spare(i))) i++
      if (i === swarm.count) return
      setDownAt(i, group.spot)
      waiting[i++] = g + 1
    }
  })
}

/** The rats from `from` on set down at the spots within notice of the child, or the nearest out of the light if none is. */
function setRestDown(from: number): void {
  let spots = spotsNear(NOTICE - 0.5, false)
  if (spots.length === 0) {
    const holder = run.holder
    const dark = map.spots.filter((spot) => !lightNear(spot.x, spot.z))
    dark.sort((a, b) => Math.hypot(a.x - holder.x, a.z - holder.z) - Math.hypot(b.x - holder.x, b.z - holder.z))
    spots = dark.slice(0, 4)
  }
  if (spots.length === 0) return
  for (let i = from, k = 0; i < swarm.count; i++, k++) setDownAt(i, spots[k % spots.length]!)
}

/** Every rat set down at once: the waiting groups, and the rest round the child. */
const setAllDown = () => setRestDown(setWaitingDown())

/**
 * The rats doing nothing set down again at the spots awake, a share of them a
 * second: past their notice of the child, so not chasing him, and out of his
 * sight, further than the eyes show, in the growth or a rock, or behind what
 * stops the eye. A waiting group is left to wait.
 */
function respawn(dt: number): void {
  const spots = wakeful()
  if (spots.length === 0) return
  owed = Math.min(owed + swarm.count * RESPAWN_RATE * dt, swarm.count)
  let n = Math.floor(owed)
  owed -= n
  const holder = run.holder
  sight.nearTo(holder.x, holder.z, Math.hypot(level.bounds.maxX - level.bounds.minX, level.bounds.maxZ - level.bounds.minZ))
  for (let seen = 0; seen < swarm.count && n > 0; seen++) {
    const i = cursor
    cursor = (cursor + 1) % swarm.count
    if (waiting[i] || !spare(i)) continue
    setDownAt(i, spots[Math.floor(Math.random() * spots.length)]!)
    n--
  }
}

/** From the very start: the opening again, the stick unlit, the tree standing, the cart at the bridge's south end, the rats in the bushes. */
function begin(): void {
  // Every light burns from the start but the two trees, which the strikes light.
  level.lights.forEach((light, k) => (light.on = k !== map.bigTree && k !== map.crown))
  cart.back = cart.saved = map.cart.back
  level.start = { ...start }
  run = new Run(level, runTuning)
  wallsSeen = -1
  takeWalls()
  run.fuel = 0
  startsSeen = run.starts
  t = 0
  lit = false
  crawlOn = false
  crawling = false
  atTrunk = 0
  crawlHint = false
  through = false
  caught = 0
  behind = 0
  owed = 0
  report = undefined
  trail = []
  marks = []
  come = false
  fellAt = Number.NaN
  litAt = Number.NaN
  jammedAt = Number.NaN
  rainAt = Number.NaN
  rainStopped = Number.NaN
  manorAt = Number.NaN
  guttered = Number.NaN
  dampAt = Number.NaN
  drownedAt = Number.NaN
  panicAt = Number.NaN
  wasLit = false
  wasUnder = false
  atTangle = false
  stage = 0
  pushing = false
  swarm.reset(map.waiting.reduce((sum, group) => sum + (BEATS[0]!.includes(group.beat) ? group.count : 0), 0))
  swarm.setCount(Math.min(swarm.count, settings.rats))
  setWaitingDown()
}

/** Straight to a checkpoint, the intro skipped: both trees burning, the torch lit; 0 at the trunk, 1 at the faint flame, the bridge ahead, 2 at the cart's side, jammed across it, the gate ahead, 3 past the gate, the beam ahead, 4 past the pine, the damp stick just caught at the far side's brazier. */
function skipTo(checkpoint: number): void {
  begin()
  t = map.strike + 5
  fellAt = t - map.falling - 0.5
  lit = true
  stage = checkpoint
  through = checkpoint > 0
  level.start = { ...[map.checkpoint, map.flameCheckpoint, map.cartCheckpoint, map.cartCheckpoint][checkpoint]! }
  if (checkpoint >= 2) {
    cart.back = cart.saved = map.cart.jam
    jammedAt = t
  }
  if (checkpoint >= 3) rainAt = t
  if (checkpoint === 4) rainStopped = t
  level.lights[map.bigTree]!.on = true
  level.lights[map.crown]!.on = true
  run.startAt(checkpoint >= 3 ? 0 : -1)
  if (checkpoint === 4) {
    run.holder.x = map.farCheckpoint.x
    run.holder.z = map.farCheckpoint.z
  }
  takeWalls()
  startsSeen = run.starts
  come = true
  swarm.setCount(settings.rats)
  setAllDown()
}

const MOVE: Record<string, [number, number]> = {
  KeyW: [0, -1],
  KeyS: [0, 1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
}
const pressed = new Set<string>()
addEventListener('keydown', (event) => {
  if (event.code in MOVE || event.code === 'KeyC' || event.code === 'ControlLeft' || event.code === 'Space') event.preventDefault()
  pressed.add(event.code)
  if (event.repeat) return
  if (event.code === 'KeyC') crawlOn = !crawlOn
  else if (event.code === 'KeyR' && !event.ctrlKey) begin()
  else if (event.code === 'KeyV') settings.designer = !settings.designer
  else if (event.code === 'KeyO') settings.overlay = !settings.overlay
  else if (event.code === 'KeyP') paused = !paused
  gui.controllersRecursive().forEach((c) => c.updateDisplay())
})
addEventListener('keyup', (event) => pressed.delete(event.code))
addEventListener('blur', () => pressed.clear())

/** Where the keys send the child, a unit direction, or nothing held. */
function heading(): Point | null {
  let x = 0
  let z = 0
  for (const code of pressed) {
    const move = MOVE[code]
    if (move === undefined) continue
    x += move[0]
    z += move[1]
  }
  const d = Math.hypot(x, z)
  return d === 0 ? null : { x: x / d, z: z / d }
}

/** One frame of the play: the script, the child's walk, the run, the rats set down again, and the swarm stepped at the worker's pace. */
function play(dt: number): void {
  if (run.won) return
  t += dt
  const holder = run.holder
  // The script.
  const trigger = map.fallTrigger
  const walkedOut = holder.x >= trigger.minX && holder.x <= trigger.maxX && holder.z >= trigger.minZ && holder.z <= trigger.maxZ
  if (Number.isNaN(fellAt) && (t >= litAt + map.afterLit || walkedOut)) fellAt = t
  const down = t >= fellAt + map.falling
  level.lights[map.bigTree]!.on = t >= map.strike
  level.lights[map.crown]!.on = down
  tuning.notice = t < map.rush ? 0 : NOTICE
  const locked = t < map.strike
  // The first strike: the rats round the clearing come, in the bushes, and burst out of them.
  if (!come && !locked) {
    come = true
    const was = swarm.count
    swarm.setCount(settings.rats)
    setRestDown(was)
  }
  // Crawling: on while C has it on or left Ctrl is held, and always under the trunk or the tangle, where there is no standing
  // up; out from under either, he stands up again.
  const under = down && trunkOnly.inside(holder.x, holder.z, HOLDER_RADIUS + 0.05)
  const tangled = tangleOnly.inside(holder.x, holder.z, HOLDER_RADIUS + 0.05) || within(map.tangle.zone, holder.x, holder.z)
  if (wasUnder && !under && !tangled) crawlOn = false
  wasUnder = under || tangled
  crawling = crawlOn || pressed.has('ControlLeft') || under || tangled
  atTangle = !crawling && tangleOnly.inside(holder.x, holder.z, 1.2)
  // The stick dead past the pine: he runs by himself, the way he faces, the keys steering him.
  const panicking = !Number.isNaN(panicAt)
  pushing = false
  if (!locked) {
    const toward = heading() ?? (panicking ? { ...facing } : null)
    if (toward !== null) {
      facing.x = toward.x
      facing.z = toward.z
      // Walking into the cart's back, north along the bridge, rolls it on ahead of him, as far as it jams.
      const off = holder.z - cart.back
      pushing = !jammed() && toward.z < 0 && off > 0 && off < CART_TOUCH && Math.abs(holder.x - map.cart.x) < map.cart.half + WALL_THICKNESS / 2
      if (pushing) {
        cart.back = Math.max(map.cart.jam, cart.back + toward.z * settings.pushSpeed * dt)
        placeCart()
        if (jammed()) jammedAt = t
      }
      const pace = crawling ? settings.crawlSpeed : onPine(holder) ? settings.beamSpeed : panicking ? running() : LIGHT_SPEED
      const speed = pushing ? Math.min(pace, settings.pushSpeed) : pace
      const ox = holder.x
      const oz = holder.z
      walkLight(swarm.arena, holder, { x: holder.x + toward.x, z: holder.z + toward.z }, dt, speed, crawling ? walking : down ? blocked : upright)
      run.pass(ox, oz)
    }
  }
  if (!through && down && sideOf(holder) !== south && !under) through = true
  // The run: the torch burns, a flame lights or refuels it, and the rats at a child with no light catch the player; never
  // in the opening, nor while the rats on him run out of the first strike's light.
  // Past the pine the stick is damp: it burns short, and dims as fast.
  runTuning.burnRate = stage >= 4 ? 1 / settings.damp : DRY
  const before = run.fuel / runTuning.burnRate
  // On the pine, high over the ravine, no rat reaches him.
  const spared = t < map.strike + GRACE || onPine(holder)
  run.step({ dt, toward: null, speed: 0, arena: swarm.arena, interact: pressed.has('Space'), reached: spared ? 0 : (report?.reached ?? 0) })
  takeWalls()
  // In the rain the stick is wet: it neither burns nor catches, whatever flame it is dipped into.
  if (raining()) run.fuel = 0
  if (run.starts !== startsSeen) {
    startsSeen = run.starts
    caught++
    panicAt = Number.NaN
    if (!lit) {
      const times = caught
      begin()
      caught = times
    } else {
      marks.push({ x: holder.x, z: holder.z, text: 'caught' })
      // The cart as it stood at the checkpoint.
      cart.back = cart.saved
      placeCart()
      // Past the pine, the run starts again there, not at the gate: the run's own last checkpoint.
      if (stage >= 4) {
        holder.x = map.farCheckpoint.x
        holder.z = map.farCheckpoint.z
      }
      setAllDown()
    }
  } else if (lit && run.fuel / runTuning.burnRate > before + 1) marks.push({ x: holder.x, z: holder.z, text: `refuelled with ${before.toFixed(1)} s left` })
  if (!lit && run.fuel > 0) {
    lit = true
    litAt = t
    level.start = { ...map.checkpoint }
  }
  // The checkpoints further on: the torch dipped at the faint flame, and at the cart's brazier once it has jammed.
  const dipped = (k: number) => {
    const light = level.lights[k]!
    return Math.hypot(holder.x - light.x, holder.z - light.z) <= runTuning.dip
  }
  if (lit && stage < 1 && dipped(map.faint)) {
    reachStage(1)
    level.start = { ...map.flameCheckpoint }
    cart.saved = cart.back
  }
  if (lit && stage < 2 && jammed() && dipped(map.brazier)) {
    reachStage(2)
    level.start = { ...map.cartCheckpoint }
    cart.saved = cart.back
  }
  // Past the gate: the run's own checkpoint from now on.
  if (stage < 3 && run.checkpoint === 0) reachStage(3)
  // Over the pine: the rain stops.
  if (stage === 3 && inBox(map.farSide, holder)) reachStage(4)
  if (Number.isNaN(manorAt) && inBox(map.hilltop, holder)) manorAt = t
  // The damp stick: caught again, past the drowned lanterns, and dead.
  if (stage >= 4 && run.torch.lit && !wasLit) dampAt = t
  if (stage >= 4 && Number.isNaN(drownedAt) && inBox(map.pastLanterns, holder)) drownedAt = t
  if (stage >= 4 && wasLit && !run.torch.lit && Number.isNaN(panicAt)) panicAt = t
  wasLit = run.torch.lit
  // The brazier gone in the rain; lit again, a run started again from the gate, it may go again.
  const guttering = !run.lights()[map.gutters]!.on
  if (guttering && Number.isNaN(guttered)) guttered = t
  else if (!guttering) guttered = Number.NaN
  // The trail, while the torch burns.
  sinceMark += dt
  if (lit && run.torch.lit && sinceMark >= TRAIL_EVERY) {
    sinceMark = 0
    trail.push({ x: holder.x, z: holder.z, left: run.fuel / runTuning.burnRate })
  }
  // The crawl hint: standing at the fallen trunk, south of it, three seconds without crawling.
  const nearTrunk = down && !through && trunkOnly.inside(holder.x, holder.z, 1.6)
  atTrunk = nearTrunk && !crawling ? atTrunk + dt : nearTrunk ? atTrunk : 0
  if (atTrunk >= 3) crawlHint = true
  // A waiting rat the child has come within notice of is one of the swarm's like any other.
  for (let i = 0; i < swarm.count; i++) if (waiting[i] && Math.hypot(swarm.x[i]! - holder.x, swarm.z[i]! - holder.z) <= NOTICE) waiting[i] = 0
  respawn(dt)
  // The swarm at the worker's pace, reading the torch where the child carries it.
  const torch = run.torch
  swarmLight.x = torch.x
  swarmLight.z = torch.z
  swarmLight.strength = torch.reach / tuning.ringMax
  swarmLight.on = torch.lit
  const placed = run.lights()
  behind = Math.min(behind + dt, MOST_STEPS * STEP)
  while (behind >= STEP) {
    behind -= STEP
    report = swarm.step(STEP, swarmLight, tuning, undefined, placed)
  }
}

/** How fast he runs, s after the stick died: a bolt, held, then slowing to his panicked run. */
function running(): number {
  const since = t - panicAt - settings.boltHold
  return settings.runSpeed + (settings.bolt - settings.runSpeed) * Math.min(1, Math.max(0, 1 - since / settings.boltFor))
}

/** The line the child says now, or none. Placeholders, every one. */
function line(): string {
  if (run.won) return ''
  if (t > 0.6 && t < map.strike - 0.2) return 'Where... where am I?'
  if (!lit && t >= map.strike + 6) return 'The fire... my stick could catch.'
  if (crawlHint && !through) return 'Too high to climb. Crawl under it: C'
  if (stage < 2 && t >= jammedAt + 2 && run.torch.lit) return 'Stuck. Its fire... from the side.'
  const holder = run.holder
  const carrying = run.carrying[0]
  if (!carrying && !run.open[0] && gateOnly.inside(holder.x, holder.z, 1.2)) return "Locked. Where's the guard?"
  if (!carrying && Math.hypot(holder.x - map.guard.x, holder.z - map.guard.z) < 1.2) return 'A guard... his key. [Space]'
  if (t - rainAt < 3) return 'Rain... no, my stick!'
  if (t - rainAt < 6.5) return 'The braziers. Stay in their light.'
  if (t - manorAt < 4) return 'Home... the manor!'
  if (stage === 3 && !run.lights()[map.gutters]!.on && t - guttered < 2.5) return "It's out... keep going!"
  if (t - panicAt < 2.5) return 'No... no, no!'
  if (atTangle) return 'The branches... crawl under! C'
  if (t - drownedAt < 3) return "They're all out..."
  if (stage === 4 && run.torch.lit && t - dampAt < 3) return "It's still wet..."
  if (stage === 4 && !run.torch.lit && Number.isNaN(panicAt) && t - rainStopped < 8) return 'The rain stopped. The fire, quick.'
  return ''
}

// ---------------------------------------------------------------- the drawing
const canvas = document.querySelector('canvas')!
const ctx = canvas.getContext('2d')!
const shade = document.createElement('canvas')
const shadeCtx = shade.getContext('2d')!
const hud = document.getElementById('hud')!
const said = document.getElementById('said')!
const end = document.getElementById('end')!
let dpr = 1
function resize(): void {
  dpr = Math.min(devicePixelRatio, 2)
  canvas.width = shade.width = Math.round(innerWidth * dpr)
  canvas.height = shade.height = Math.round(innerHeight * dpr)
}
addEventListener('resize', resize)
resize()
addEventListener('wheel', (event) => {
  settings.zoom = Math.min(80, Math.max(6, settings.zoom * Math.exp(-event.deltaY * 0.001)))
  gui.controllersRecursive().forEach((c) => c.updateDisplay())
})

const cam = { x: start.x, z: start.z }
/** The forest's own trees, scattered everywhere: drawn only, under the ground that can be walked. */
const forest = Array.from({ length: 900 }, (_, k) => {
  const r = (n: number) => {
    const s = Math.sin(k * 127.1 + n * 311.7) * 43758.5453
    return s - Math.floor(s)
  }
  const b = level.bounds
  return { x: b.minX + r(1) * (b.maxX - b.minX), z: b.minZ + r(2) * (b.maxZ - b.minZ), r: 0.3 + r(3) * 0.6 }
})
/** Each strike's bolt, jagged once. */
const bolt = (to: Point) => {
  const points: Point[] = []
  for (let k = 0; k <= 10; k++) points.push({ x: to.x + (k === 10 ? 0 : Math.sin(k * 12.9 + to.x) * 1.2) + (10 - k) * 0.6, z: to.z - (10 - k) * 3 })
  return points
}
/** The strikes: the first at its time, the second when the child sets it off. */
const strikes = () => [
  { at: map.strike, path: firstBolt },
  { at: fellAt, path: secondBolt },
]
const firstBolt = bolt(level.lights[map.bigTree]!)
const secondBolt = bolt(map.trunk.root)
// Each rat's size by its place between the slowest and the fastest, as the 3D page draws it: the mean rat the usual size.
const smallest = 2 / (1 + SIZE_BY_SPEED)
const span = (2 * (SIZE_BY_SPEED - 1)) / (1 + SIZE_BY_SPEED)

function polyline(c: CanvasRenderingContext2D, points: Point[]): void {
  c.beginPath()
  points.forEach((p, k) => (k === 0 ? c.moveTo(p.x, p.z) : c.lineTo(p.x, p.z)))
}

function polygon(c: CanvasRenderingContext2D, points: Point[]): void {
  c.beginPath()
  points.forEach((p, k) => (k === 0 ? c.moveTo(p.x, p.z) : c.lineTo(p.x, p.z)))
  c.closePath()
}

let hatch: CanvasPattern | null = null
function growthPattern(): CanvasPattern {
  if (hatch !== null) return hatch
  const tile = document.createElement('canvas')
  tile.width = tile.height = 8
  const tc = tile.getContext('2d')!
  tc.fillStyle = '#1f2e1b'
  tc.fillRect(0, 0, 8, 8)
  tc.strokeStyle = '#4b6a3b'
  tc.lineWidth = 2
  tc.beginPath()
  tc.moveTo(0, 8)
  tc.lineTo(8, 0)
  tc.stroke()
  hatch = ctx.createPattern(tile, 'repeat')!
  return hatch
}

function draw(dt: number): void {
  const holder = run.holder
  const w = canvas.width
  const h = canvas.height
  const s = settings.zoom * dpr
  const follow = Math.min(1, dt * 6)
  cam.x += (holder.x - cam.x) * follow
  cam.z += (holder.z - cam.z) * follow
  const world = (c: CanvasRenderingContext2D) => c.setTransform(s, 0, 0, s, w / 2 - cam.x * s, h / 2 - cam.z * s)
  const px = (p: Point) => ({ x: (p.x - cam.x) * s + w / 2, y: (p.z - cam.z) * s + h / 2 })

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#070a07'
  ctx.fillRect(0, 0, w, h)
  world(ctx)
  // The forest, the ground that can be walked, and what stands on it.
  const b = level.bounds
  ctx.fillStyle = '#0e140f'
  ctx.fillRect(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ)
  ctx.fillStyle = '#1b2318'
  polygon(ctx, map.lawn)
  ctx.fill()
  ctx.fillStyle = '#16201a'
  ctx.beginPath()
  for (const tree of forest) {
    if (within(map.lawn, tree.x, tree.z)) continue
    ctx.moveTo(tree.x + tree.r, tree.z)
    ctx.arc(tree.x, tree.z, tree.r, 0, TAU)
  }
  ctx.fill()
  ctx.fillStyle = '#0f1d27'
  polygon(ctx, map.river)
  ctx.fill()
  ctx.fillStyle = '#2b241b'
  polygon(ctx, map.treeline)
  ctx.fill()
  drawHill()
  drawPark()
  // The bridge: its planks, and its rails.
  const br = map.bridge
  ctx.fillStyle = '#3d2d1d'
  ctx.fillRect(br.minX, br.minZ - 0.4, br.maxX - br.minX, br.maxZ - br.minZ + 0.8)
  ctx.strokeStyle = '#2a1f14'
  ctx.lineWidth = 0.04
  ctx.beginPath()
  for (let z = br.minZ - 0.4; z <= br.maxZ + 0.4; z += 0.45) {
    ctx.moveTo(br.minX, z)
    ctx.lineTo(br.maxX, z)
  }
  ctx.stroke()
  ctx.strokeStyle = '#6b4f33'
  ctx.lineWidth = WALL_THICKNESS
  ctx.beginPath()
  for (const rail of [br.minX, br.maxX]) {
    ctx.moveTo(rail, br.minZ)
    ctx.lineTo(rail, br.maxZ)
  }
  ctx.stroke()
  ctx.fillStyle = '#5f5a54'
  ctx.strokeStyle = '#857e75'
  ctx.lineWidth = 0.1
  for (const rock of map.rocks) {
    polygon(ctx, rock)
    ctx.fill()
    ctx.stroke()
  }
  ctx.fillStyle = '#1d2718'
  ctx.strokeStyle = '#33422a'
  for (const tree of map.trees) {
    ctx.beginPath()
    ctx.arc(tree.x, tree.z, tree.r, 0, TAU)
    ctx.fill()
    ctx.stroke()
  }
  const big = level.lights[map.bigTree]!
  ctx.fillStyle = '#4a321e'
  ctx.beginPath()
  ctx.arc(big.x, big.z, 0.9, 0, TAU)
  ctx.fill()

  // The rats, at their 3D size: a body and a tail, facing the way they go. Those in a rock or the growth are not seen,
  // and none at all before the first strike: the child is alone, and its flash shows them.
  const n = settings.designer || t >= map.strike ? swarm.count : 0
  const opening = Math.min(1, Math.max(0, (t - map.strike) / OPENING))
  const hidden = new Uint8Array(n)
  for (let i = 0; i < n; i++) hidden[i] = coverAt(swarm.x[i]!, swarm.z[i]!)
  ctx.fillStyle = '#5b463b'
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    if (hidden[i] && !settings.designer) continue
    const length = RAT_LENGTH * RAT_SIZE * (smallest + span * swarm.place(i))
    const body = length * 0.55
    const hd = swarm.heading[i]!
    ctx.moveTo(swarm.x[i]! + Math.cos(hd) * body * 0.5, swarm.z[i]! + Math.sin(hd) * body * 0.5)
    ctx.ellipse(swarm.x[i]!, swarm.z[i]!, body * 0.5, body * 0.2, hd, 0, TAU)
  }
  ctx.fill()
  ctx.strokeStyle = '#5b463b'
  ctx.lineWidth = 0.025
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    if (hidden[i] && !settings.designer) continue
    const length = RAT_LENGTH * RAT_SIZE * (smallest + span * swarm.place(i))
    const hd = swarm.heading[i]!
    const back = length * 0.275
    ctx.moveTo(swarm.x[i]! - Math.cos(hd) * back, swarm.z[i]! - Math.sin(hd) * back)
    ctx.lineTo(swarm.x[i]! - Math.cos(hd) * length * 0.72, swarm.z[i]! - Math.sin(hd) * length * 0.72)
  }
  ctx.stroke()

  // The low growth over the rats in it.
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = growthPattern()
  for (const growth of map.thickets) {
    ctx.beginPath()
    growth.forEach((p, k) => {
      const q = px(p)
      if (k === 0) ctx.moveTo(q.x, q.y)
      else ctx.lineTo(q.x, q.y)
    })
    ctx.closePath()
    ctx.globalAlpha = settings.designer ? 0.55 : 1
    ctx.fill()
  }
  ctx.restore()

  // The cracked tree: standing, knocked down burning, down.
  const { root, crown } = map.trunk
  const under = crawling && trunkOnly.inside(holder.x, holder.z, HOLDER_RADIUS + 0.2)
  const fall = Number.isNaN(fellAt) ? 0 : Math.min(1, Math.max(0, (t - fellAt) / map.falling))
  const f = fall * fall
  const tip = { x: root.x + (crown.x - root.x) * f, z: root.z + (crown.z - root.z) * f }
  const drawTrunk = () => {
    if (!(t >= fellAt)) {
      ctx.fillStyle = '#3b2a1c'
      ctx.beginPath()
      ctx.arc(root.x, root.z, 0.55, 0, TAU)
      ctx.fill()
      return
    }
    ctx.strokeStyle = '#5a412a'
    ctx.lineCap = 'round'
    ctx.lineWidth = 0.7
    ctx.beginPath()
    ctx.moveTo(root.x, root.z)
    ctx.lineTo(tip.x, tip.z)
    ctx.stroke()
    ctx.fillStyle = '#3a2a1a'
    ctx.beginPath()
    ctx.arc(tip.x, tip.z, 0.4 + 0.7 * f, 0, TAU)
    ctx.fill()
  }
  const inTangle = crawling && (tangleOnly.inside(holder.x, holder.z, HOLDER_RADIUS + 0.2) || within(map.tangle.zone, holder.x, holder.z))
  if (!under) drawTrunk()
  if (!inTangle) drawTangle()
  drawCart()
  drawGate()
  drawPine()
  drawChild(holder)
  if (under) drawTrunk()
  if (inTangle) drawTangle()

  // Which lights the child has a line of sight to: only those light the ground, and glow, as a camera behind the child would see.
  const seenFrom = (p: Point) => {
    const d = Math.hypot(p.x - holder.x, p.z - holder.z)
    if (settings.designer || d < 0.5) return true
    sight.nearTo(holder.x, holder.z, d)
    return sight.ray(holder.x, holder.z, (p.x - holder.x) / d, (p.z - holder.z) / d, d) >= d - 0.6
  }
  // A light the run has put out, the brazier gone in the rain, neither lights nor glows.
  const burning = run.lights().map((light) => light.on)
  const seen = level.lights.map((light, k) => burning[k]! && seenFrom(light))

  // The dark, and the ground each light sees, as far as it sees it.
  if (!settings.designer) {
    shadeCtx.setTransform(1, 0, 0, 1, 0, 0)
    shadeCtx.globalCompositeOperation = 'source-over'
    shadeCtx.clearRect(0, 0, w, h)
    shadeCtx.fillStyle = `rgba(4, 2, 9, ${settings.night})`
    shadeCtx.fillRect(0, 0, w, h)
    shadeCtx.globalCompositeOperation = 'destination-out'
    world(shadeCtx)
    const torch = run.torch
    // The torch's pool: as wide as its reach, dimming steadily as it burns.
    if (torch.lit) pool(0, swarmLight.x, swarmLight.z, LAMP_REACH * swarmLight.strength, 0.55 + 0.45 * run.fuel)
    let row = 1
    run.lights().forEach((light, k) => {
      if (!light.on || !(light.reach > 0)) return
      if (seen[k]) pool(row, light.x, light.z, light.reach * GLOW, 0.95)
      row++
    })
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(shade, 0, 0)
    // The rats' eyes, pale in the dark round the child, fading out with distance; dim through the leaves, none in a rock.
    ctx.fillStyle = '#e9e0cf'
    const e = Math.max(1, 1.3 * dpr)
    for (let i = 0; i < n; i++) {
      if (hidden[i] === 2) continue
      const x = swarm.x[i]!
      const z = swarm.z[i]!
      const d = Math.hypot(x - holder.x, z - holder.z)
      if (d > settings.eyes) continue
      ctx.globalAlpha = Math.min(1, (settings.eyes - d) / (settings.eyes * 0.5)) * (hidden[i] === 1 ? THROUGH_LEAVES : 1) * opening
      const length = RAT_LENGTH * RAT_SIZE * (smallest + span * swarm.place(i))
      const hd = swarm.heading[i]!
      const cx = Math.cos(hd)
      const cz = Math.sin(hd)
      const nose = length * 0.24
      const apart = length * 0.05
      const a = px({ x: x + cx * nose - cz * apart, z: z + cz * nose + cx * apart })
      const c = px({ x: x + cx * nose + cz * apart, z: z + cz * nose - cx * apart })
      ctx.fillRect(a.x - e / 2, a.y - e / 2, e, e)
      ctx.fillRect(c.x - e / 2, c.y - e / 2, e, e)
    }
    ctx.globalAlpha = 1
  }

  // The mushrooms, on trial, off to start: glowing faint along the way round, as far as the eye can make them out.
  ctx.globalCompositeOperation = 'lighter'
  for (const mushroom of settings.mushrooms ? map.mushrooms : []) {
    const d = Math.hypot(mushroom.x - holder.x, mushroom.z - holder.z)
    if (d > 15 || !seenFrom(mushroom)) continue
    const at = px(mushroom)
    const r = 0.35 * s
    const g = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, r)
    const a = Math.min(1, (15 - d) / 6) * 0.55
    g.addColorStop(0, `rgba(170, 255, 220, ${a})`)
    g.addColorStop(0.3, `rgba(90, 220, 190, ${a * 0.5})`)
    g.addColorStop(1, 'rgba(60, 200, 180, 0)')
    ctx.fillStyle = g
    ctx.fillRect(at.x - r, at.y - r, r * 2, r * 2)
  }

  // The flames: each one the child can see glows through the dark, however far: off the screen, at its edge.
  level.lights.forEach((light, k) => {
    if (!light.on || !seen[k]) return
    const d = Math.hypot(light.x - holder.x, light.z - holder.z)
    const at = px(light)
    const m = 24 * dpr
    if (at.x >= m && at.x <= w - m && at.y >= m && at.y <= h - m) glow(at, light.reach * s * 0.5, 1)
    else {
      const dx = at.x - w / 2
      const dy = at.y - h / 2
      const edge = Math.min(dx === 0 ? Infinity : ((dx > 0 ? w - m : m) - w / 2) / dx, dy === 0 ? Infinity : ((dy > 0 ? h - m : m) - h / 2) / dy)
      glow({ x: w / 2 + dx * edge, y: h / 2 + dy * edge }, 26 * dpr, Math.max(0.35, 1 - d / 60))
    }
  })
  // The cracked tree's crown burning as it falls.
  if (t >= fellAt && t < fellAt + map.falling) glow(px(tip), 1.5 * s, 1)
  if (run.torch.lit) glow(px(stickTip(holder)), 0.6 * s * (0.4 + 0.6 * run.fuel), 0.5 + 0.5 * run.fuel)
  ctx.globalCompositeOperation = 'source-over'

  // The strikes: a bolt and a flash.
  for (const strike of strikes()) {
    const since = t - strike.at
    if (!(since >= 0 && since <= 0.35)) continue
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = `rgba(235, 240, 255, ${0.8 * (1 - since / 0.35)})`
    ctx.fillRect(0, 0, w, h)
    world(ctx)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 0.18
    ctx.beginPath()
    strike.path.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.z) : ctx.lineTo(p.x, p.z)))
    ctx.stroke()
  }

  // The manor, from the hilltop: its lit windows at the screen's edge, the first sight of home.
  if (inBox(map.hilltop, holder)) {
    const at = px(map.manor)
    const m = 24 * dpr
    const dx = at.x - w / 2
    const dy = at.y - h / 2
    const edge = Math.min(1, dx === 0 ? Infinity : ((dx > 0 ? w - m : m) - w / 2) / dx, dy === 0 ? Infinity : ((dy > 0 ? h - m : m) - h / 2) / dy)
    ctx.globalCompositeOperation = 'lighter'
    glow({ x: w / 2 + dx * edge, y: h / 2 + dy * edge }, 30 * dpr, 0.8)
    ctx.globalCompositeOperation = 'source-over'
  }
  // The rain, from the gate to the far side of the pine: streaks falling across the screen, the night a shade darker.
  if (raining()) {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = 'rgba(10, 14, 24, 0.18)'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = 'rgba(156, 195, 255, 0.28)'
    ctx.lineWidth = dpr
    ctx.beginPath()
    for (let k = 0; k < 220; k++) {
      const x = (((k * 7919) % 1000) / 1000) * (w + 200) - 100
      const y = ((((k * 104729) % 1000) / 1000) * h + t * 900 * dpr) % h
      const fall = (x + y * 0.25) % (w + 200)
      ctx.moveTo(fall, y)
      ctx.lineTo(fall - 4 * dpr, y + 16 * dpr)
    }
    ctx.stroke()
  }

  if (settings.designer || settings.overlay) overlay(px, s)
}

/** Light `row`'s pool from (x, z), as far as its lit area sees each way and `radius` at most, brightest at the light. */
function pool(row: number, x: number, z: number, radius: number, strength: number): void {
  if (!(radius > 0)) return
  const table = swarm.areas.table
  const o = row * ANGLES
  shadeCtx.beginPath()
  for (let b = 0; b < ANGLES; b += 2) {
    const theta = (b / ANGLES) * TAU - Math.PI
    const d = Math.min(table[o + b]!, radius)
    const qx = x + Math.cos(theta) * d
    const qz = z + Math.sin(theta) * d
    if (b === 0) shadeCtx.moveTo(qx, qz)
    else shadeCtx.lineTo(qx, qz)
  }
  shadeCtx.closePath()
  const g = shadeCtx.createRadialGradient(x, z, 0, x, z, radius)
  g.addColorStop(0, `rgba(0,0,0,${strength})`)
  g.addColorStop(0.6, `rgba(0,0,0,${strength * 0.75})`)
  g.addColorStop(1, 'rgba(0,0,0,0)')
  shadeCtx.fillStyle = g
  shadeCtx.fill()
}

/** A flame's glow at a point on screen, `radius` px. */
function glow(at: { x: number; y: number }, radius: number, strength: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  const g = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, Math.max(radius, 4))
  g.addColorStop(0, `rgba(255, 220, 150, ${strength})`)
  g.addColorStop(0.25, `rgba(242, 150, 50, ${0.6 * strength})`)
  g.addColorStop(1, 'rgba(242, 120, 30, 0)')
  ctx.fillStyle = g
  ctx.fillRect(at.x - radius, at.y - radius, radius * 2, radius * 2)
}

/** Where the stick's end is: held out ahead and to the right. */
const stickTip = (holder: Point): Point => {
  const reach = crawling ? 0.55 : 0.4
  return { x: holder.x + facing.x * reach - facing.z * 0.15, z: holder.z + facing.z * reach + facing.x * 0.15 }
}

/** The hill, under the rats: the ravine, the estate wall, the stone steps, and the braziers' pits. */
function drawHill(): void {
  ctx.fillStyle = '#0b0907'
  ctx.strokeStyle = '#5f5a54'
  ctx.lineWidth = 0.12
  polygon(ctx, map.ravine)
  ctx.fill()
  ctx.stroke()
  ctx.strokeStyle = '#8d877f'
  ctx.lineWidth = 0.5
  ctx.lineCap = 'butt'
  ctx.beginPath()
  for (const { from, to } of map.wall) {
    ctx.moveTo(from.x, from.z)
    ctx.lineTo(to.x, to.z)
  }
  ctx.stroke()
  // The steps: a band of stone along the road, a step every 0.35 m across it.
  ctx.strokeStyle = '#5c5448'
  ctx.lineWidth = 1.5
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  polyline(ctx, map.path)
  ctx.stroke()
  ctx.strokeStyle = '#3a342c'
  ctx.lineWidth = 0.05
  ctx.beginPath()
  for (let k = 1; k < map.path.length; k++) {
    const a = map.path[k - 1]!
    const b = map.path[k]!
    const length = Math.hypot(b.x - a.x, b.z - a.z)
    const ux = (b.x - a.x) / length
    const uz = (b.z - a.z) / length
    for (let d = 0.35; d < length; d += 0.35) {
      const x = a.x + ux * d
      const z = a.z + uz * d
      ctx.moveTo(x - uz * 0.7, z + ux * 0.7)
      ctx.lineTo(x + uz * 0.7, z - ux * 0.7)
    }
  }
  ctx.stroke()
  ctx.fillStyle = '#26221f'
  for (let k = map.gateTorch + 1; k <= map.farBrazier; k++) {
    const fire = level.lights[k]!
    ctx.beginPath()
    ctx.arc(fire.x, fire.z, 0.35, 0, TAU)
    ctx.fill()
  }
  ctx.lineCap = 'butt'
}

/** The park, under the rats: the road down to the drive, the drive, the yew hedges, the drowned lanterns, the park's trees, the steps and their lanterns, and the manor's front with its door ajar. */
function drawPark(): void {
  ctx.strokeStyle = '#3b3328'
  ctx.lineWidth = 1.6
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  polyline(ctx, map.road)
  ctx.stroke()
  ctx.lineCap = 'butt'
  const rect = (b: Bounds) => ctx.fillRect(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ)
  ctx.fillStyle = '#3b3328'
  rect(map.drive)
  ctx.fillStyle = '#22361f'
  ctx.strokeStyle = '#2f4a2a'
  ctx.lineWidth = 0.08
  for (const hedge of map.hedges) {
    rect(hedge)
    ctx.strokeRect(hedge.minX, hedge.minZ, hedge.maxX - hedge.minX, hedge.maxZ - hedge.minZ)
  }
  ctx.fillStyle = '#1d2718'
  ctx.strokeStyle = '#33422a'
  for (const tree of map.parkTrees) {
    ctx.beginPath()
    ctx.arc(tree.x, tree.z, tree.r, 0, TAU)
    ctx.fill()
    ctx.stroke()
  }
  // The drowned lanterns: dark pumpkins, their candles out.
  for (const lantern of map.drowned) {
    ctx.fillStyle = '#5a3418'
    ctx.beginPath()
    ctx.arc(lantern.x, lantern.z, 0.2, 0, TAU)
    ctx.fill()
    ctx.fillStyle = '#1a120c'
    ctx.beginPath()
    ctx.arc(lantern.x, lantern.z, 0.08, 0, TAU)
    ctx.fill()
  }
  // The steps, a step every 0.35 m, their lanterns lit either side.
  const { steps, front } = map
  ctx.fillStyle = '#5c5448'
  rect(steps)
  ctx.strokeStyle = '#3a342c'
  ctx.lineWidth = 0.05
  ctx.beginPath()
  for (let z = steps.maxZ - 0.35; z > steps.minZ; z -= 0.35) {
    ctx.moveTo(steps.minX, z)
    ctx.lineTo(steps.maxX, z)
  }
  ctx.stroke()
  ctx.fillStyle = '#e8792a'
  for (const z of [steps.maxZ - 0.5, steps.minZ + 0.6]) {
    for (const x of [steps.minX + 0.35, steps.maxX - 0.35]) {
      ctx.beginPath()
      ctx.arc(x, z, 0.2, 0, TAU)
      ctx.fill()
    }
  }
  // The manor's front, its windows lit, and the door ajar, light spilling through it.
  ctx.fillStyle = '#4a4540'
  rect(front)
  const door = level.exit!
  ctx.fillStyle = '#ffd99a'
  ctx.fillRect(door.x - 0.7, front.maxZ - 0.3, 1.4, 0.3)
  for (let x = front.minX + 2; x < front.maxX - 1; x += 4) {
    if (Math.abs(x - door.x) < 2) continue
    ctx.fillRect(x, front.maxZ - 0.35, 1, 0.25)
  }
  ctx.strokeStyle = '#2b1d10'
  ctx.lineWidth = 0.1
  ctx.beginPath()
  ctx.moveTo(door.x + 0.7, front.maxZ)
  ctx.lineTo(door.x + 0.3, front.maxZ + 0.9)
  ctx.stroke()
}

/** The tree down across the drive: its root plate on the lawn, its trunk over the west hedge, and its crown's branches from hedge to hedge. */
function drawTangle(): void {
  const { root, crown, zone } = map.tangle
  ctx.fillStyle = '#3a2a1a'
  ctx.beginPath()
  ctx.arc(root.x, root.z, 1.3, 0, TAU)
  ctx.fill()
  ctx.strokeStyle = '#6b4f33'
  ctx.lineCap = 'round'
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.moveTo(root.x, root.z)
  ctx.lineTo(crown.x, crown.z)
  ctx.stroke()
  // Its branches, spread from the crown over the tangle, the same every frame.
  const [a, , c] = zone as [Point, Point, Point]
  ctx.lineWidth = 0.12
  ctx.strokeStyle = '#4e3a26'
  ctx.beginPath()
  for (let k = 0; k < 14; k++) {
    const u = Math.sin(k * 12.9898) * 43758.5453
    const v = Math.sin(k * 78.233) * 12345.6789
    const x = a.x + (c.x - a.x) * (u - Math.floor(u))
    const z = a.z + (c.z - a.z) * (v - Math.floor(v))
    ctx.moveTo(crown.x + (x - crown.x) * 0.2, crown.z + (z - crown.z) * 0.2)
    ctx.lineTo(x, z)
  }
  ctx.stroke()
  ctx.lineCap = 'butt'
  ctx.fillStyle = 'rgba(29, 39, 24, 0.55)'
  polygon(ctx, zone)
  ctx.fill()
}

/** The fallen pine over the rats in the ravine: its root plate on the near side, its trunk, its crown past the far side. */
function drawPine(): void {
  const { from, to } = map.pine
  const dx = to.x - from.x
  const dz = to.z - from.z
  const length = Math.hypot(dx, dz)
  ctx.fillStyle = '#3a2a1a'
  ctx.beginPath()
  ctx.arc(from.x - (dx / length) * 0.4, from.z - (dz / length) * 0.4, 1, 0, TAU)
  ctx.fill()
  ctx.strokeStyle = '#7a5a3a'
  ctx.lineWidth = 0.7
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(from.x, from.z)
  ctx.lineTo(to.x, to.z)
  ctx.stroke()
  ctx.lineCap = 'butt'
  ctx.fillStyle = 'rgba(29, 39, 24, 0.85)'
  ctx.beginPath()
  ctx.arc(to.x - (dx / length) * 0.6, to.z - (dz / length) * 0.6, 1.4, 0, TAU)
  ctx.fill()
}

/** The gate, shut across its gap or swung open, with the torch behind it; and the guard who fell near it, the key on him until it is taken. Under the dark: seen only in a light. */
function drawGate(): void {
  const gate = level.gates[0]!
  const { from, to } = gate
  ctx.strokeStyle = '#7a7a82'
  ctx.lineCap = 'butt'
  ctx.lineWidth = WALL_THICKNESS * 0.6
  ctx.beginPath()
  if (run.open[0]) {
    // Swung open, toward the stairs, on its west hinge.
    const length = Math.hypot(to.x - from.x, to.z - from.z)
    ctx.moveTo(from.x, from.z)
    ctx.lineTo(from.x + length * 0.2, from.z - length * 0.95)
  } else {
    ctx.moveTo(from.x, from.z)
    ctx.lineTo(to.x, to.z)
  }
  ctx.stroke()
  // The torch behind the gate, on its post.
  const torch = level.lights[map.gateTorch]!
  ctx.fillStyle = '#3b2a1c'
  ctx.beginPath()
  ctx.arc(torch.x, torch.z, 0.16, 0, TAU)
  ctx.fill()
  ctx.fillStyle = '#f2a541'
  ctx.beginPath()
  ctx.arc(torch.x, torch.z, 0.1, 0, TAU)
  ctx.fill()
  // The guard: a helmet, a skull, the bones of an arm flung out.
  const { x, z } = map.guard
  ctx.strokeStyle = '#cfc6b0'
  ctx.lineWidth = 0.06
  ctx.beginPath()
  ctx.moveTo(x - 0.1, z + 0.15)
  ctx.lineTo(x - 0.15, z + 0.8)
  ctx.moveTo(x + 0.1, z + 0.15)
  ctx.lineTo(x + 0.45, z + 0.5)
  ctx.stroke()
  ctx.fillStyle = '#4a4d52'
  ctx.beginPath()
  ctx.arc(x - 0.35, z - 0.15, 0.17, 0, TAU)
  ctx.fill()
  ctx.fillStyle = '#e4dccb'
  ctx.beginPath()
  ctx.arc(x, z, 0.12, 0, TAU)
  ctx.fill()
  if (!run.carrying[0]) {
    ctx.fillStyle = '#e8c35a'
    ctx.fillRect(x + 0.42, z + 0.45, 0.2, 0.07)
    ctx.beginPath()
    ctx.arc(x + 0.42, z + 0.485, 0.07, 0, TAU)
    ctx.fill()
  }
}

/** The cart seen from above: its bed, its back panel, its wheels and its brazier. */
function drawCart(): void {
  const outline = cartOutline()
  const [backLeft, backRight] = outline as [Point, Point]
  const { x, half, length } = map.cart
  ctx.fillStyle = '#4e3520'
  polygon(ctx, outline)
  ctx.fill()
  ctx.fillStyle = '#1c1610'
  for (const side of [-1, 1]) {
    for (const along of [0.35, length - 0.35]) ctx.fillRect(x + side * (half - 0.1) - 0.07, cart.back - along - 0.22, 0.14, 0.44)
  }
  ctx.strokeStyle = '#2b1d10'
  ctx.lineWidth = WALL_THICKNESS
  ctx.beginPath()
  ctx.moveTo(backLeft.x, backLeft.z)
  ctx.lineTo(backRight.x, backRight.z)
  ctx.stroke()
  const brazier = level.lights[map.brazier]!
  ctx.fillStyle = '#26221f'
  ctx.beginPath()
  ctx.arc(brazier.x, brazier.z, 0.3, 0, TAU)
  ctx.fill()
  ctx.fillStyle = '#f2a541'
  ctx.beginPath()
  ctx.arc(brazier.x, brazier.z, 0.17, 0, TAU)
  ctx.fill()
}

/** The child at his 3D size, seen from above: pyjamas, a pumpkin head, and the stick; on all fours, crawling. */
function drawChild(holder: Point): void {
  const tip = stickTip(holder)
  ctx.strokeStyle = '#8a6a48'
  ctx.lineWidth = 0.04
  ctx.beginPath()
  ctx.moveTo(holder.x - facing.z * 0.15, holder.z + facing.x * 0.15)
  ctx.lineTo(tip.x, tip.z)
  ctx.stroke()
  ctx.save()
  ctx.translate(holder.x, holder.z)
  ctx.rotate(Math.atan2(facing.z, facing.x))
  ctx.fillStyle = '#c9c3e0'
  ctx.beginPath()
  if (crawling) ctx.ellipse(-CRAWL_LENGTH * 0.2, 0, CRAWL_LENGTH * 0.5, SHOULDERS * 0.45, 0, 0, TAU)
  else ctx.ellipse(0, 0, CHEST / 2, SHOULDERS / 2, 0, 0, TAU)
  ctx.fill()
  ctx.fillStyle = '#e8792a'
  ctx.beginPath()
  ctx.arc(crawling ? CRAWL_LENGTH * 0.3 : 0.02, 0, PUMPKIN, 0, TAU)
  ctx.fill()
  ctx.restore()
}

/** The designer's overlay: the trail the child walked, coloured by the light left; what happened where; the lights' hard edges; the spawn spots, the awake ones lit. */
function overlay(px: (p: Point) => { x: number; y: number }, s: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.font = `${12 * dpr}px system-ui, sans-serif`
  ctx.lineWidth = 1.5 * dpr
  ctx.strokeStyle = 'rgba(242, 165, 65, 0.6)'
  ctx.setLineDash([4 * dpr, 4 * dpr])
  for (const light of run.lights()) {
    if (!light.on) continue
    const at = px(light)
    ctx.beginPath()
    ctx.arc(at.x, at.y, light.reach * s, 0, TAU)
    ctx.stroke()
  }
  const torch = run.torch
  if (torch.lit) {
    const at = px(torch)
    ctx.strokeStyle = 'rgba(255, 220, 150, 0.7)'
    ctx.beginPath()
    ctx.arc(at.x, at.y, torch.reach * s, 0, TAU)
    ctx.stroke()
  }
  ctx.setLineDash([])
  // The trail: green with plenty of light left, through yellow, to red with none.
  const r = 2.2 * dpr
  for (const point of trail) {
    const at = px(point)
    const hue = Math.min(120, (point.left / 15) * 120)
    ctx.fillStyle = `hsl(${hue}, 80%, 55%)`
    ctx.fillRect(at.x - r / 2, at.y - r / 2, r, r)
  }
  ctx.fillStyle = '#e9e2d6'
  for (const mark of marks) {
    const at = px(mark)
    ctx.beginPath()
    ctx.arc(at.x, at.y, 4 * dpr, 0, TAU)
    ctx.fill()
    ctx.fillText(mark.text, at.x + 8 * dpr, at.y + 4 * dpr)
  }
  if (settings.designer) {
    const awake = new Set(wakeful())
    for (const spot of map.spots) {
      const at = px(spot)
      ctx.strokeStyle = awake.has(spot) ? '#d9534f' : 'rgba(156, 195, 255, 0.5)'
      ctx.beginPath()
      ctx.arc(at.x, at.y, Math.max(spot.r * s, 4 * dpr), 0, TAU)
      ctx.stroke()
    }
    ctx.fillStyle = '#f2a541'
    for (const group of map.waiting) {
      const at = px(group.spot)
      ctx.fillText(`${group.count} wait`, at.x + 8 * dpr, at.y + 4 * dpr)
    }
  }
}

// ---------------------------------------------------------------- the panel and the loop
const gui = new GUI({ title: 'Last Light 2D' })
gui.add(settings, 'designer').name('see everything (V)')
gui.add(settings, 'overlay').name('overlay (O)')
gui.add(settings, 'night', 0.5, 1, 0.01).name('dark')
gui.add(settings, 'eyes', 0, 30, 0.5).name('eyes seen to m')
gui.add(settings, 'zoom', 6, 80, 1).name('px a metre')
gui.add(settings, 'crawlSpeed', 0.3, 2, 0.05).name('crawl m/s')
gui.add(settings, 'pushSpeed', 0.3, 2, 0.05).name('cart pushed m/s')
gui.add(settings, 'beamSpeed', 0.3, 2, 0.05).name('on the pine m/s')
gui.add(settings, 'damp', 4, 30, 0.5).name('damp stick burns s')
gui.add(settings, 'bolt', 2, 5, 0.05).name('bolt m/s')
gui.add(settings, 'boltHold', 0, 8, 0.25).name('bolt held s')
gui.add(settings, 'boltFor', 0, 8, 0.25).name('bolt slows over s')
gui.add(settings, 'runSpeed', 1.5, 3, 0.05).name('dark run m/s')
gui.add(settings, 'mushrooms').name('glowing mushrooms (trial)')
gui.add(settings, 'rats', 0, 8000, 50).name('rats').onFinishChange(() => begin())
gui.add({ begin }, 'begin').name('start again (R)')
gui.add({ fromTrunk: () => skipTo(0) }, 'fromTrunk').name('start at the trunk')
gui.add({ fromFlame: () => skipTo(1) }, 'fromFlame').name('start at the faint flame')
gui.add({ fromCart: () => skipTo(2) }, 'fromCart').name('start at the cart, across')
gui.add({ fromGate: () => skipTo(3) }, 'fromGate').name('start past the gate')
gui.add({ fromFar: () => skipTo(4) }, 'fromFar').name('start past the pine')

begin()
let last = performance.now()
function frame(now: number): void {
  const dt = paused ? 0 : Math.min((now - last) / 1000, 1 / 30)
  last = now
  if (dt > 0) play(dt)
  draw(dt)
  const left = run.fuel / runTuning.burnRate
  const minutes = Math.floor(t / 60)
  const seconds = Math.floor(t % 60)
  let chasing = 0
  for (let i = 0; i < swarm.count; i++) if (Math.hypot(swarm.x[i]! - run.holder.x, swarm.z[i]! - run.holder.z) <= tuning.notice) chasing++
  hud.textContent = settings.overlay
    ? [
        `${minutes}:${String(seconds).padStart(2, '0')}${paused ? ' paused' : ''}`,
        run.torch.lit ? `light ${left.toFixed(1)} s` : 'no light',
        crawling ? 'crawling' : pushing ? 'pushing the cart' : onPine(run.holder) ? 'on the pine, out of reach' : Number.isNaN(panicAt) ? 'walking' : `running ${running().toFixed(1)} m/s`,
        raining() ? 'raining: the stick is wet' : stage >= 4 ? 'past the pine: the stick is damp' : '',
        run.carrying[0] ? 'carrying the key' : run.open[0] ? 'gate open' : 'gate locked',
        `caught ${caught}`,
        `rats ${swarm.count}: ${chasing} within notice, ${report?.reached ?? 0} at the child`,
        `swarm step ${(report?.ms ?? 0).toFixed(1)} ms`,
      ]
        .filter((row) => row !== '')
        .join('\n')
    : ''
  said.textContent = line()
  end.style.display = run.won ? 'block' : 'none'
  if (run.won) end.textContent = `Home: the door shuts behind him.\n${minutes}:${String(seconds).padStart(2, '0')}, caught ${caught} time${caught === 1 ? '' : 's'}.\nR to play again.`
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
