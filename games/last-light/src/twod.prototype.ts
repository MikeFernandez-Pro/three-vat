// PROTOTYPE: Last Light in 2D, top-down, to test the new level's play before
// it is built in 3D (design/level.html). `2d.html`.
//
// The play is the game's own: the run (run.ts) burns and refuels the torch and
// catches the player, the swarm (swarm.ts) runs the rats, the walls and the lit
// areas stop them and the light, all tuned as the 3D page tunes them
// (gameplay.ts). What is new is scripted here, on top, for now: the opening
// with control locked, the two lightning strikes, the cracked tree falling,
// crawling under it, the thicket that stops the child but not the rats, the
// light or the eye, and the text lines. If the play holds, they move into the
// run as rules of their own.
//
// The view stands in for the 3D one: dark but for the lights, the ground lit
// as far as each light sees it, rats' eyes pale in the dark round the child,
// and any flame the child has a line of sight to glowing through the dark at
// any distance, as the fog will have to let it: at the screen's edge, if it is
// off the screen. V shows everything, O the designer's overlay: the seconds of
// light left at each route point, against what the map planned.
//
// WASD (by where the keys sit: ZQSD on AZERTY) walk; C crawls, on and off, and
// left Ctrl crawls while held; R starts again; P pauses.
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js'
import { blockout } from './level'
import { ANGLES } from './litareas'
import { defaultRunTuning, Run } from './run'
import { Swarm, walkLight, type Bounds, type Dark, type Light, type StepReport } from './swarm'
import { STEP } from './swarm-remote'
import { HOLDER_RADIUS, Walls, type Wall } from './walls'
import { LIGHT_SPEED, NOTICE, RATS, RESTART_ROOM, gameTuning } from './gameplay'
import { woods, type Point } from './woods.prototype'

const TAU = Math.PI * 2
const SEED = 7
/** How far the 3D torch's lamp lights the ground at full strength, m, as the look sets it: the 2D pool round the child is as wide. */
const LAMP_REACH = 6.9
/** How far past a placed light's hard edge its glow lights the ground, as a share of its reach. */
const GLOW = 1.5
/** The most swarm steps a frame takes: a hitch slows the swarm rather than stalling the page. */
const MOST_STEPS = 3

const map = woods()
const { level } = map
const start = { ...level.start }
const tuning = gameTuning()
const runTuning = defaultRunTuning()

const area = (b: Bounds) => (b.maxX - b.minX) * (b.maxZ - b.minZ)
/** The page's knobs; the rats as thick on the ground as the 3D game's first section has them. */
const settings = {
  rats: Math.round((RATS * area(level.bounds)) / area(blockout().bounds)),
  crawlSpeed: 1,
  designer: false,
  overlay: true,
  night: 0.94,
  eyes: 12,
  zoom: 18,
  bringRound: 28,
}

const swarm = new Swarm(16384, SEED, 1, { walls: level.walls, bounds: level.bounds, lights: [{ ...map.emptyAtStart, on: true }] })

// What stops the child: the level's walls and the thickets; and the trunk once it is down, unless crawling.
const sides = (outline: Point[]): Wall[] => outline.map((from, k) => ({ from, to: outline[(k + 1) % outline.length]! }))
const trunkWall: Wall = { from: map.trunk.root, to: map.trunk.crown }
const thicketWalls = map.thickets.flatMap(sides)
const walking = new Walls([...level.walls, ...thicketWalls])
const blocked = new Walls([...level.walls, ...thicketWalls, trunkWall])
const trunkOnly = new Walls([trunkWall])
/** What the eye stops at: what stops the light. */
const sight = new Walls(level.walls)

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
/** The light left, s, the first time each route point was reached; and how long the child has stood at the trunk without crawling. */
let arrivals: (number | undefined)[] = []
let atTrunk = 0
let crawlHint = false
let through = false
let caught = 0
const facing = { x: 0, z: -1 }
const swarmLight: Light = { x: 0, z: 0, strength: 0, on: false }

/** Which side of the trunk's line (x, z) is on. */
const sideOf = (p: Point) => Math.sign((map.trunk.crown.x - map.trunk.root.x) * (p.z - map.trunk.root.z) - (map.trunk.crown.z - map.trunk.root.z) * (p.x - map.trunk.root.x))
const south = sideOf(start)

/** From the very start: the opening again, the stick unlit, the tree standing, the rats placed again. */
function begin(): void {
  for (const light of level.lights) light.on = false
  level.lights[map.faint]!.on = true
  level.start = { ...start }
  run = new Run(level, runTuning)
  run.fuel = 0
  startsSeen = run.starts
  t = 0
  lit = false
  crawlOn = false
  crawling = false
  arrivals = map.route.map(() => undefined)
  atTrunk = 0
  crawlHint = false
  through = false
  caught = 0
  behind = 0
  report = undefined
  swarm.reset(settings.rats)
}

/** Straight to the trunk, the intro skipped: both trees burning, the torch lit, the rats placed out of the light. */
function fromTrunk(): void {
  begin()
  t = map.secondStrike + 1
  lit = true
  level.start = { ...map.checkpoint }
  level.lights[map.bigTree]!.on = true
  level.lights[map.crown]!.on = true
  run.startAt(-1)
  startsSeen = run.starts
  placeAgain()
}

/** The rats placed again out of the lights and the room round the child, as the 3D page does on a catch. */
function placeAgain(): void {
  const torch = run.torch
  swarm.restart([...run.lights(), { x: torch.x, z: torch.z, reach: torch.reach + RESTART_ROOM, on: true }])
  behind = 0
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
  if (event.code in MOVE || event.code === 'KeyC' || event.code === 'ControlLeft') event.preventDefault()
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

/** One frame of the play: the script, the child's walk, the run, and the swarm stepped at the worker's pace. */
function play(dt: number): void {
  if (run.won) return
  t += dt
  const holder = run.holder
  // The script.
  level.lights[map.bigTree]!.on = t >= map.strike
  level.lights[map.crown]!.on = t >= map.secondStrike
  tuning.notice = t < map.rush ? 0 : NOTICE
  const down = t >= map.fall + map.falling
  const locked = t < map.strike
  // Crawling: on while C has it on or left Ctrl is held, and kept on while under the trunk, where there is no standing up.
  const under = down && trunkOnly.inside(holder.x, holder.z, HOLDER_RADIUS + 0.05)
  crawling = crawlOn || pressed.has('ControlLeft') || (crawling && under)
  if (!locked) {
    const toward = heading()
    if (toward !== null) {
      facing.x = toward.x
      facing.z = toward.z
      const speed = crawling ? settings.crawlSpeed : LIGHT_SPEED
      walkLight(swarm.arena, holder, { x: holder.x + toward.x, z: holder.z + toward.z }, dt, speed, down && !crawling ? blocked : walking)
    }
  }
  // The light left at each route point, read before a flame there refuels it.
  const left = run.fuel / runTuning.burnRate
  if (lit) {
    const last = map.route.length - 1
    map.route.forEach((point, k) => {
      if (arrivals[k] !== undefined || k === 0) return
      const reach = k === last ? runTuning.dip : 2.5
      if (Math.hypot(holder.x - point.x, holder.z - point.z) <= reach) arrivals[k] = left
    })
    if (!through && sideOf(holder) !== south && !under) {
      through = true
      arrivals[0] = left
    }
  }
  // The run: the torch burns, a flame lights or refuels it, and the rats at a child with no light catch the player; never
  // in the opening, before the first strike.
  run.step({ dt, toward: null, speed: 0, arena: swarm.arena, interact: false, reached: locked ? 0 : (report?.reached ?? 0) })
  if (run.starts !== startsSeen) {
    startsSeen = run.starts
    caught++
    if (!lit) {
      const times = caught
      begin()
      caught = times
    } else placeAgain()
  }
  if (!lit && run.fuel > 0) {
    lit = true
    level.start = { ...map.checkpoint }
  }
  // The crawl hint: standing at the fallen trunk, south of it, three seconds without crawling.
  const nearTrunk = down && !through && trunkOnly.inside(holder.x, holder.z, 1.6)
  atTrunk = nearTrunk && !crawling ? atTrunk + dt : nearTrunk ? atTrunk : 0
  if (atTrunk >= 3) crawlHint = true
  // The swarm at the worker's pace, reading the torch where the child carries it.
  const torch = run.torch
  swarmLight.x = torch.x
  swarmLight.z = torch.z
  swarmLight.strength = torch.reach / tuning.ringMax
  swarmLight.on = torch.lit
  const placed = run.lights()
  const dark: Dark | undefined = settings.bringRound > 0 ? { x: holder.x, z: holder.z, radius: settings.bringRound } : undefined
  behind = Math.min(behind + dt, MOST_STEPS * STEP)
  while (behind >= STEP) {
    behind -= STEP
    report = swarm.step(STEP, swarmLight, tuning, dark, placed)
  }
}

/** The line the child says now, or none. Placeholders, every one. */
function line(): string {
  if (run.won) return ''
  if (t > 0.8 && t < 4) return 'Where... where am I?'
  if (!lit && t >= map.strike + 6) return 'The fire... my stick could catch.'
  if (crawlHint && !through) return 'Too high to climb. Crawl under it: C'
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
/** The forest's own trees, scattered where nothing can be walked: drawn only. */
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
const strikes = [
  { at: map.strike, to: level.lights[map.bigTree]!, path: bolt(level.lights[map.bigTree]!) },
  { at: map.secondStrike, to: level.lights[map.crown]!, path: bolt(level.lights[map.crown]!) },
]

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
/** Rats set down inside a rock: hidden, as the rock would hide them. */
const inRock = (x: number, z: number) => map.rocks.some((rock) => within(rock, x, z))

function polygon(c: CanvasRenderingContext2D, points: Point[]): void {
  c.beginPath()
  points.forEach((p, k) => (k === 0 ? c.moveTo(p.x, p.z) : c.lineTo(p.x, p.z)))
  c.closePath()
}

let hatch: CanvasPattern | null = null
function thicketPattern(): CanvasPattern {
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
  ctx.fillStyle = '#16201a'
  ctx.beginPath()
  for (const tree of forest) {
    ctx.moveTo(tree.x + tree.r, tree.z)
    ctx.arc(tree.x, tree.z, tree.r, 0, TAU)
  }
  ctx.fill()
  ctx.fillStyle = '#2b241b'
  polygon(ctx, map.treeline)
  ctx.fill()
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = thicketPattern()
  for (const thicket of map.thickets) {
    ctx.beginPath()
    thicket.forEach((p, k) => {
      const q = px(p)
      if (k === 0) ctx.moveTo(q.x, q.y)
      else ctx.lineTo(q.x, q.y)
    })
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
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
  // The big tree.
  const big = level.lights[map.bigTree]!
  ctx.fillStyle = '#4a321e'
  ctx.beginPath()
  ctx.arc(big.x, big.z, 0.9, 0, TAU)
  ctx.fill()

  // The rats' bodies: seen only where a light reaches, under the dark, or everywhere in the designer's view.
  const n = swarm.count
  const r = tuning.ratRadius
  ctx.fillStyle = '#5b463b'
  ctx.beginPath()
  const hidden = new Uint8Array(n)
  for (let i = 0; i < n; i++) hidden[i] = inRock(swarm.x[i]!, swarm.z[i]!) ? 1 : 0
  for (let i = 0; i < n; i++) {
    if (hidden[i]) continue
    ctx.moveTo(swarm.x[i]! + r, swarm.z[i]!)
    ctx.arc(swarm.x[i]!, swarm.z[i]!, r, 0, TAU)
  }
  ctx.fill()

  // The cracked tree: standing, falling, down, and its crown.
  const { root, crown } = map.trunk
  const under = crawling && trunkOnly.inside(holder.x, holder.z, HOLDER_RADIUS + 0.2)
  const drawTrunk = () => {
    if (t < map.fall) {
      ctx.fillStyle = '#3b2a1c'
      ctx.beginPath()
      ctx.arc(root.x, root.z, 0.55, 0, TAU)
      ctx.fill()
      return
    }
    const p = Math.min(1, (t - map.fall) / map.falling)
    const f = p * p
    const tip = { x: root.x + (crown.x - root.x) * f, z: root.z + (crown.z - root.z) * f }
    ctx.strokeStyle = '#5a412a'
    ctx.lineCap = 'round'
    ctx.lineWidth = 0.7
    ctx.beginPath()
    ctx.moveTo(root.x, root.z)
    ctx.lineTo(tip.x, tip.z)
    ctx.stroke()
    ctx.fillStyle = '#3a2a1a'
    ctx.beginPath()
    ctx.arc(tip.x, tip.z, 1.1 * f, 0, TAU)
    ctx.fill()
  }
  if (!under) drawTrunk()
  drawChild(holder)
  if (under) drawTrunk()

  // Which lights the child has a line of sight to: only those light the ground, and glow, as a camera behind the child would see.
  const seen = level.lights.map((light) => {
    const d = Math.hypot(light.x - holder.x, light.z - holder.z)
    if (settings.designer || d < 0.5) return true
    sight.nearTo(holder.x, holder.z, d)
    return sight.ray(holder.x, holder.z, (light.x - holder.x) / d, (light.z - holder.z) / d, d) >= d - 0.6
  })

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
    // The rats' eyes, pale in the dark round the child, fading out with distance.
    ctx.fillStyle = '#e9e0cf'
    const e = Math.max(1, 1.3 * dpr)
    for (let i = 0; i < n; i++) {
      const x = swarm.x[i]!
      const z = swarm.z[i]!
      const d = Math.hypot(x - holder.x, z - holder.z)
      if (d > settings.eyes || hidden[i]) continue
      ctx.globalAlpha = Math.min(1, (settings.eyes - d) / (settings.eyes * 0.5))
      const hd = swarm.heading[i]!
      const cx = Math.cos(hd)
      const cz = Math.sin(hd)
      const hx = x + cx * r * 0.9
      const hz = z + cz * r * 0.9
      const a = px({ x: hx - cz * 0.05, z: hz + cx * 0.05 })
      const c = px({ x: hx + cz * 0.05, z: hz - cx * 0.05 })
      ctx.fillRect(a.x - e / 2, a.y - e / 2, e, e)
      ctx.fillRect(c.x - e / 2, c.y - e / 2, e, e)
    }
    ctx.globalAlpha = 1
  }

  // The flames: each one the child can see glows through the dark, however far.
  ctx.globalCompositeOperation = 'lighter'
  level.lights.forEach((light, k) => {
    if (!light.on || !light.flame || !seen[k]) return
    const d = Math.hypot(light.x - holder.x, light.z - holder.z)
    // Off the screen, it glows at the screen's edge in its direction, as a 3D camera would see it toward the horizon.
    const at = px(light)
    const m = 24 * dpr
    if (at.x >= m && at.x <= w - m && at.y >= m && at.y <= h - m) glow(at, light.reach * s * 0.5, 1)
    else {
      const dx = at.x - w / 2
      const dy = at.y - h / 2
      const e = Math.min(dx === 0 ? Infinity : ((dx > 0 ? w - m : m) - w / 2) / dx, dy === 0 ? Infinity : ((dy > 0 ? h - m : m) - h / 2) / dy)
      glow({ x: w / 2 + dx * e, y: h / 2 + dy * e }, 26 * dpr, Math.max(0.35, 1 - d / 60))
    }
  })
  if (run.torch.lit) {
    const tip = stickTip(holder)
    glow(px(tip), 0.6 * s * (0.4 + 0.6 * run.fuel), 0.5 + 0.5 * run.fuel)
  }
  ctx.globalCompositeOperation = 'source-over'

  // The strikes: a bolt and a flash.
  for (const strike of strikes) {
    const since = t - strike.at
    if (since < 0 || since > 0.35) continue
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

const stickTip = (holder: Point): Point => ({ x: holder.x + facing.x * 0.45 + facing.z * 0.15, z: holder.z + facing.z * 0.45 - facing.x * 0.15 })

/** The child: pyjamas, a pumpkin head, and the stick, flat to the ground when crawling. */
function drawChild(holder: Point): void {
  const tip = stickTip(holder)
  ctx.strokeStyle = '#8a6a48'
  ctx.lineWidth = 0.06
  ctx.beginPath()
  ctx.moveTo(holder.x + facing.z * 0.15, holder.z - facing.x * 0.15)
  ctx.lineTo(tip.x, tip.z)
  ctx.stroke()
  ctx.save()
  ctx.translate(holder.x, holder.z)
  ctx.rotate(Math.atan2(facing.z, facing.x))
  ctx.fillStyle = '#c9c3e0'
  ctx.beginPath()
  if (crawling) ctx.ellipse(-0.15, 0, 0.42, 0.2, 0, 0, TAU)
  else ctx.ellipse(0, 0, 0.18, 0.28, 0, 0, TAU)
  ctx.fill()
  ctx.fillStyle = '#e8792a'
  ctx.beginPath()
  ctx.arc(crawling ? 0.2 : 0.05, 0, 0.17, 0, TAU)
  ctx.fill()
  ctx.restore()
}

/** The designer's overlay: the route points and the light left at each, against the map's plan; the lights' hard edges. */
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
  map.route.forEach((point, k) => {
    const at = px(point)
    const got = arrivals[k]
    ctx.strokeStyle = got === undefined ? '#9cc3ff' : got < 0.05 ? '#d9534f' : '#7fae86'
    ctx.beginPath()
    ctx.arc(at.x, at.y, 6 * dpr, 0, TAU)
    ctx.stroke()
    ctx.fillStyle = '#e9e2d6'
    const you = got === undefined ? '' : ` · you ${got.toFixed(1)} s`
    ctx.fillText(`${point.name}: planned ${point.planned.toFixed(1)} s${you}`, at.x + 10 * dpr, at.y + 4 * dpr)
  })
}

// ---------------------------------------------------------------- the panel and the loop
const gui = new GUI({ title: 'Last Light 2D' })
gui.add(settings, 'designer').name('see everything (V)')
gui.add(settings, 'overlay').name('overlay (O)')
gui.add(settings, 'night', 0.5, 1, 0.01).name('dark')
gui.add(settings, 'eyes', 0, 30, 0.5).name('eyes seen to m')
gui.add(settings, 'zoom', 6, 80, 1).name('px a metre')
gui.add(settings, 'crawlSpeed', 0.3, 2, 0.05).name('crawl m/s')
gui.add(settings, 'bringRound', 0, 40, 1).name('rats brought round past m')
gui.add(settings, 'rats', 0, 16384, 100).name('rats').onFinishChange(() => begin())
gui.add({ begin }, 'begin').name('start again (R)')
gui.add({ fromTrunk }, 'fromTrunk').name('start at the trunk')

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
  hud.textContent = settings.overlay
    ? [
        `${minutes}:${String(seconds).padStart(2, '0')}${paused ? ' paused' : ''}`,
        run.torch.lit ? `light ${left.toFixed(1)} s` : 'no light',
        crawling ? 'crawling' : 'walking',
        `caught ${caught}`,
        `rats ${swarm.count}, at the child ${report?.reached ?? 0}`,
        `swarm step ${(report?.ms ?? 0).toFixed(1)} ms`,
      ].join('\n')
    : ''
  said.textContent = line()
  end.style.display = run.won ? 'block' : 'none'
  if (run.won) end.textContent = `End of the prototype: the bridge is next.\n${minutes}:${String(seconds).padStart(2, '0')}, caught ${caught} time${caught === 1 ? '' : 's'}.\nR to play again.`
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
