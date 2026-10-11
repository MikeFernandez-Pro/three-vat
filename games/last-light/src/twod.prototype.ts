// PROTOTYPE: Last Light in 2D, top-down, to test the new level's play before
// it is built in 3D (design/level.html). `2d.html`.
//
// The page plays nothing itself: the play step (play.ts) plays the woods
// (woods.ts), the 3D page's play, and the page feeds it the keys every frame
// and draws what it reports.
//
// The view stands in for the 3D one: dark but for the lights the child can
// see, the ground lit as far as each light sees it, rats' eyes pale in the dark
// round the child but never in the growth, glowing mushrooms faint along the
// ways round, and any flame in sight glowing through the dark however far: at
// the screen's edge, if it is off the screen. Rats and the child are drawn at
// their 3D sizes. Dragging pans the view over the map, the wheel zooms, F (or a
// double click) follows the child again. V shows everything, O the designer's
// overlay: the trail the child walked, coloured by the light left, and the
// light left at each flame.
//
// WASD (by where the keys sit: ZQSD on AZERTY) walk; C crawls, on and off, and
// left Ctrl crawls while held; R starts again; P pauses.
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js'
import { ANGLES, LitAreas } from './litareas'
import { Play, inBox, within } from './play'
import { type Bounds } from './swarm'
import { HOLDER_RADIUS, WALL_THICKNESS, Walls } from './walls'
import { RAT_LENGTH, RAT_SIZE, SIZE_BY_SPEED } from './gameplay'
import { type Point } from './woods'

const TAU = Math.PI * 2
/** How far the 3D torch's lamp lights the ground at full strength, m, as the look sets it: the 2D pool round the child is as wide. */
const LAMP_REACH = 6.9
/** How far past a placed light's hard edge its glow lights the ground, as a share of its reach. */
const GLOW = 1.5
/** How bright a rat's eyes show through the growth it is in, against in the open. */
const THROUGH_LEAVES = 0.35
/** Seconds the eyes take to open, in the first strike's flash. */
const OPENING = 0.4
/** Seconds between the trail's marks. */
const TRAIL_EVERY = 0.2
/** The child seen from above, m: shoulders across and deep, the pumpkin's radius, and on all fours. */
const SHOULDERS = 0.4
const CHEST = 0.24
const PUMPKIN = 0.14
const CRAWL_LENGTH = 0.8

const play = new Play()
const { woods: map, swarm, sight, cart, facing } = play
const { level } = map
const swarmLight = play.torchLight
/**
 * The ground each light sees, against every wall the rats meet, for the
 * drawing: the swarm's own tables see only the walls nearest the child, so a
 * far light's pool would spill past walls by it. Near him the two agree.
 */
const seenAreas = new LitAreas(new Walls([...level.walls, ...map.pineEnds]))

/** The view's knobs. */
const settings = {
  designer: false,
  overlay: true,
  night: 0.94,
  zoom: 18,
  mushrooms: false,
}

/** The trunk and the tangle, for drawing the child under them while he is. */
const trunkOnly = new Walls([{ from: map.trunk.root, to: map.trunk.crown }])
const [ta, tb, tc, td] = map.tangle.zone as [Point, Point, Point, Point]
const tangleOnly = new Walls([
  { from: ta, to: tb },
  { from: tc, to: td },
])

/** The trail: where the child was, and the light left there, s; and what happened where: a refuel, a catch. */
let trail: { x: number; z: number; left: number }[] = []
let marks: { x: number; z: number; text: string }[] = []
let sinceMark = 0
let paused = false
/** Whether C was pressed since the last frame. */
let toggleCrawl = false

/** Start again, from the start or a checkpoint: the trail and its marks wiped. */
function restart(checkpoint?: number): void {
  if (checkpoint === undefined) play.begin()
  else play.skipTo(checkpoint)
  trail = []
  marks = []
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
  if (event.code === 'KeyC') toggleCrawl = !toggleCrawl
  else if (event.code === 'KeyR' && !event.ctrlKey) restart()
  else if (event.code === 'KeyV') settings.designer = !settings.designer
  else if (event.code === 'KeyO') settings.overlay = !settings.overlay
  else if (event.code === 'KeyP') paused = !paused
  else if (event.code === 'KeyF') free = false
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

/** One frame of the play, fed the keys; and the trail, and what happened where, kept for the overlay. */
function step(dt: number): void {
  const { x, z } = play.holder
  const before = play.left
  const caught = play.caught
  play.frame(dt, { heading: heading(), toggleCrawl, crawlHeld: pressed.has('ControlLeft'), interact: pressed.has('Space') })
  toggleCrawl = false
  if (play.caught !== caught) {
    // Caught before the torch was lit, the play starts over from the opening.
    if (!play.lit) {
      trail = []
      marks = []
    } else marks.push({ x, z, text: 'caught' })
  } else if (play.lit && play.left > before + 1) marks.push({ x: play.holder.x, z: play.holder.z, text: `refuelled with ${before.toFixed(1)} s left` })
  sinceMark += dt
  if (play.lit && play.run.torch.lit && sinceMark >= TRAIL_EVERY) {
    sinceMark = 0
    trail.push({ x: play.holder.x, z: play.holder.z, left: play.left })
  }
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
// Exploring the map: dragging pans the view off the child, the wheel zooms toward the pointer, and F follows him again.
/** Whether the view is left where the player dragged it, rather than following the child. */
let free = false
let dragging: { x: number; y: number } | null = null
canvas.addEventListener('pointerdown', (event) => {
  dragging = { x: event.clientX, y: event.clientY }
  canvas.setPointerCapture(event.pointerId)
})
canvas.addEventListener('pointermove', (event) => {
  if (dragging === null) return
  free = true
  cam.x -= (event.clientX - dragging.x) / settings.zoom
  cam.z -= (event.clientY - dragging.y) / settings.zoom
  dragging = { x: event.clientX, y: event.clientY }
})
canvas.addEventListener('pointerup', () => (dragging = null))
canvas.addEventListener('dblclick', () => (free = false))
canvas.addEventListener('wheel', (event) => {
  event.preventDefault()
  // The ground under the pointer stays under it; following the child, the zoom is about him.
  const ax = free ? event.clientX - innerWidth / 2 : 0
  const ay = free ? event.clientY - innerHeight / 2 : 0
  const was = settings.zoom
  settings.zoom = Math.min(80, Math.max(2, settings.zoom * Math.exp(-event.deltaY * 0.001)))
  cam.x += ax / was - ax / settings.zoom
  cam.z += ay / was - ay / settings.zoom
  gui.controllersRecursive().forEach((c) => c.updateDisplay())
}, { passive: false })

const cam = { x: play.holder.x, z: play.holder.z }
/** The forest's own trees, scattered everywhere: drawn only, under the ground that can be walked. */
/** How far past the ground that can be walked the forest is drawn, m: beyond, nothing, so the map is the level's own shape. */
const FOREST_MARGIN = 5
/**
 * The forest drawn: the ground that can be walked, and every point within
 * FOREST_MARGIN of its edge, as discs along it. The outline turned to wind as
 * the discs do, so nonzero filling takes them all as one.
 */
const forestShape = (() => {
  const shape = new Path2D()
  let area = 0
  map.treeline.forEach((p, k) => {
    const q = map.treeline[(k + 1) % map.treeline.length]!
    area += p.x * q.z - q.x * p.z
  })
  const outline = area > 0 ? map.treeline : [...map.treeline].reverse()
  outline.forEach((p, k) => (k === 0 ? shape.moveTo(p.x, p.z) : shape.lineTo(p.x, p.z)))
  shape.closePath()
  map.treeline.forEach((p, k) => {
    const q = map.treeline[(k + 1) % map.treeline.length]!
    const length = Math.hypot(q.x - p.x, q.z - p.z)
    for (let d = 0; d < length; d += 1) {
      const x = p.x + ((q.x - p.x) * d) / length
      const z = p.z + ((q.z - p.z) * d) / length
      shape.moveTo(x + FOREST_MARGIN, z)
      shape.arc(x, z, FOREST_MARGIN, 0, TAU)
    }
  })
  return shape
})()
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
  { at: play.fellAt, path: secondBolt },
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
  const holder = play.run.holder
  const w = canvas.width
  const h = canvas.height
  const s = settings.zoom * dpr
  const follow = free ? 0 : Math.min(1, dt * 6)
  cam.x += (holder.x - cam.x) * follow
  cam.z += (holder.z - cam.z) * follow
  const world = (c: CanvasRenderingContext2D) => c.setTransform(s, 0, 0, s, w / 2 - cam.x * s, h / 2 - cam.z * s)
  const px = (p: Point) => ({ x: (p.x - cam.x) * s + w / 2, y: (p.z - cam.z) * s + h / 2 })

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#070a07'
  ctx.fillRect(0, 0, w, h)
  world(ctx)
  // The forest, the ground that can be walked, and what stands on it.
  ctx.save()
  ctx.clip(forestShape)
  ctx.fillStyle = '#0e140f'
  ctx.fill(forestShape)
  ctx.fillStyle = '#16201a'
  ctx.beginPath()
  for (const tree of forest) {
    ctx.moveTo(tree.x + tree.r, tree.z)
    ctx.arc(tree.x, tree.z, tree.r, 0, TAU)
  }
  ctx.fill()
  ctx.fillStyle = '#0f1d27'
  polygon(ctx, map.river)
  ctx.fill()
  ctx.restore()
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
  const n = settings.designer || play.t >= map.strike ? swarm.count : 0
  const opening = Math.min(1, Math.max(0, (play.t - map.strike) / OPENING))
  const hidden = new Uint8Array(n)
  for (let i = 0; i < n; i++) hidden[i] = play.coverAt(swarm.x[i]!, swarm.z[i]!)
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
  const under = play.crawling && trunkOnly.inside(holder.x, holder.z, HOLDER_RADIUS + 0.2)
  const fall = Number.isNaN(play.fellAt) ? 0 : Math.min(1, Math.max(0, (play.t - play.fellAt) / map.falling))
  const f = fall * fall
  const tip = { x: root.x + (crown.x - root.x) * f, z: root.z + (crown.z - root.z) * f }
  const drawTrunk = () => {
    if (!(play.t >= play.fellAt)) {
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
  const inTangle = play.crawling && (tangleOnly.inside(holder.x, holder.z, HOLDER_RADIUS + 0.2) || within(map.tangle.zone, holder.x, holder.z))
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
  const burning = play.run.lights().map((light) => light.on)
  seenAreas.update(swarmLight, play.run.lights())
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
    const torch = play.run.torch
    // The torch's pool: as wide as its reach, dimming steadily as it burns.
    if (torch.lit) pool(0, swarmLight.x, swarmLight.z, LAMP_REACH * swarmLight.strength, 0.55 + 0.45 * play.run.fuel)
    let row = 1
    play.run.lights().forEach((light, k) => {
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
      if (d > play.settings.eyes) continue
      ctx.globalAlpha = Math.min(1, (play.settings.eyes - d) / (play.settings.eyes * 0.5)) * (hidden[i] === 1 ? THROUGH_LEAVES : 1) * opening
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
    drawPosts(px, s, seenFrom)
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
  if (play.t >= play.fellAt && play.t < play.fellAt + map.falling) glow(px(tip), 1.5 * s, 1)
  if (play.run.torch.lit) glow(px(stickTip(holder)), 0.6 * s * (0.4 + 0.6 * play.run.fuel), 0.5 + 0.5 * play.run.fuel)
  ctx.globalCompositeOperation = 'source-over'

  // The strikes: a bolt and a flash.
  for (const strike of strikes()) {
    const since = play.t - strike.at
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
  // The rain, from the cart jammed past the bridge to the far side of the pine: streaks falling across the screen, the night a shade darker.
  if (play.raining) {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = 'rgba(10, 14, 24, 0.18)'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = 'rgba(156, 195, 255, 0.28)'
    ctx.lineWidth = dpr
    ctx.beginPath()
    for (let k = 0; k < 220; k++) {
      const x = (((k * 7919) % 1000) / 1000) * (w + 200) - 100
      const y = ((((k * 104729) % 1000) / 1000) * h + play.t * 900 * dpr) % h
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
  const table = seenAreas.table
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
  const reach = play.crawling ? 0.55 : 0.4
  return { x: holder.x + facing.x * reach - facing.z * 0.15, z: holder.z + facing.z * reach + facing.x * 0.15 }
}

/** Under the rats: the estate wall, and on the hill the ravine, the stone steps, and the braziers' pits. */
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

/** The way to the manor, under the rats: the trodden road and path, the lawn at the steps, the steps and their lanterns, and the manor's front with its door ajar. */
function drawPark(): void {
  ctx.fillStyle = '#1b2318'
  polygon(ctx, map.lawn)
  ctx.fill()
  ctx.strokeStyle = '#3b3328'
  ctx.lineWidth = 1.2
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  polyline(ctx, map.trail)
  ctx.stroke()
  ctx.lineCap = 'butt'
  const rect = (b: Bounds) => ctx.fillRect(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ)
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

/** The posts along the path, whitewashed, each with its drowned lantern: over the dark, pale as far as the eye makes them out, as a camera behind the child would. */
function drawPosts(px: (p: Point) => { x: number; y: number }, s: number, seenFrom: (p: Point) => boolean): void {
  const holder = play.run.holder
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  for (const post of map.posts) {
    const d = Math.hypot(post.x - holder.x, post.z - holder.z)
    if (d > play.settings.eyes || !seenFrom(post)) continue
    const at = px(post)
    ctx.globalAlpha = Math.min(1, (play.settings.eyes - d) / (play.settings.eyes * 0.5)) * 0.7
    ctx.fillStyle = '#d8d2c4'
    ctx.fillRect(at.x - 0.09 * s, at.y - 0.09 * s, 0.18 * s, 0.18 * s)
    ctx.fillStyle = '#5a3418'
    ctx.beginPath()
    ctx.arc(at.x, at.y, 0.13 * s, 0, TAU)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

/** The tree down across the path: its root plate in the wood, its trunk, and its crown's branches over the path. */
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
  if (play.run.open[0]) {
    // Swung open, toward the bridge, on its west hinge.
    const length = Math.hypot(to.x - from.x, to.z - from.z)
    ctx.moveTo(from.x, from.z)
    ctx.lineTo(from.x + length * 0.2, from.z - length * 0.95)
  } else {
    ctx.moveTo(from.x, from.z)
    ctx.lineTo(to.x, to.z)
  }
  ctx.stroke()
  // The torches on their posts: either side of the gate outside, and behind it.
  for (const k of [...map.entrance, map.gateTorch]) {
    const torch = level.lights[k]!
    ctx.fillStyle = '#3b2a1c'
    ctx.beginPath()
    ctx.arc(torch.x, torch.z, 0.16, 0, TAU)
    ctx.fill()
    ctx.fillStyle = '#f2a541'
    ctx.beginPath()
    ctx.arc(torch.x, torch.z, 0.1, 0, TAU)
    ctx.fill()
  }
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
  if (!play.run.carrying[0]) {
    ctx.fillStyle = '#e8c35a'
    ctx.fillRect(x + 0.42, z + 0.45, 0.2, 0.07)
    ctx.beginPath()
    ctx.arc(x + 0.42, z + 0.485, 0.07, 0, TAU)
    ctx.fill()
  }
}

/** The cart seen from above: its bed, its back panel, its wheels and its brazier. */
function drawCart(): void {
  const outline = play.cartOutline()
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
  // Its coals: burning, or drowned by the rain, dark and wet.
  ctx.fillStyle = play.run.lights()[map.brazier]!.on ? '#f2a541' : '#3a3530'
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
  if (play.crawling) ctx.ellipse(-CRAWL_LENGTH * 0.2, 0, CRAWL_LENGTH * 0.5, SHOULDERS * 0.45, 0, 0, TAU)
  else ctx.ellipse(0, 0, CHEST / 2, SHOULDERS / 2, 0, 0, TAU)
  ctx.fill()
  ctx.fillStyle = '#e8792a'
  ctx.beginPath()
  ctx.arc(play.crawling ? CRAWL_LENGTH * 0.3 : 0.02, 0, PUMPKIN, 0, TAU)
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
  for (const light of play.run.lights()) {
    if (!light.on) continue
    const at = px(light)
    ctx.beginPath()
    ctx.arc(at.x, at.y, light.reach * s, 0, TAU)
    ctx.stroke()
  }
  const torch = play.run.torch
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
    const awake = new Set(play.wakeful())
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
gui.add(play.settings, 'eyes', 0, 30, 0.5).name('eyes seen to m')
gui.add(settings, 'zoom', 2, 80, 1).name('px a metre')
gui.add(play.settings, 'crawlSpeed', 0.3, 2, 0.05).name('crawl m/s')
gui.add(play.settings, 'pushSpeed', 0.3, 2, 0.05).name('cart pushed m/s')
gui.add(play.settings, 'beamSpeed', 0.3, 2, 0.05).name('on the pine m/s')
gui.add(play.settings, 'damp', 4, 30, 0.5).name('damp stick burns s')
gui.add(play.settings, 'grip', 0, 3, 0.05).name('dark run: rats drag him down in s')
gui.add(settings, 'mushrooms').name('glowing mushrooms (trial)')
gui.add(play.settings, 'rats', 0, 8000, 50).name('rats').onFinishChange(() => restart())
gui.add({ begin: () => restart() }, 'begin').name('start again (R)')
gui.add({ fromTrunk: () => restart(0) }, 'fromTrunk').name('start at the trunk')
gui.add({ fromEntrance: () => restart(1) }, 'fromEntrance').name("start at the gate's torches")
gui.add({ fromGate: () => restart(2) }, 'fromGate').name('start past the gate')
gui.add({ fromCart: () => restart(3) }, 'fromCart').name('start at the cart, across')
gui.add({ fromFar: () => restart(4) }, 'fromFar').name('start past the pine')

let last = performance.now()
function frame(now: number): void {
  const dt = paused ? 0 : Math.min((now - last) / 1000, 1 / 30)
  last = now
  if (dt > 0) step(dt)
  draw(dt)
  const { run, t, caught } = play
  const minutes = Math.floor(t / 60)
  const seconds = Math.floor(t % 60)
  let chasing = 0
  for (let i = 0; i < swarm.count; i++) if (Math.hypot(swarm.x[i]! - run.holder.x, swarm.z[i]! - run.holder.z) <= play.tuning.notice) chasing++
  hud.textContent = settings.overlay
    ? [
        `${minutes}:${String(seconds).padStart(2, '0')}${paused ? ' paused' : ''}`,
        run.torch.lit ? `light ${play.left.toFixed(1)} s` : 'no light',
        play.crawling ? 'crawling' : play.pushing ? 'pushing the cart' : play.onPine(run.holder) ? 'on the pine, out of reach' : play.panicking ? 'running' : 'walking',
        play.raining ? 'raining: the stick is wet' : play.stage >= 4 ? 'past the pine: the stick is damp' : '',
        run.carrying[0] ? 'carrying the key' : run.open[0] ? 'gate open' : 'gate locked',
        `caught ${caught}`,
        `rats ${swarm.count}: ${chasing} within notice, ${play.report?.reached ?? 0} at the child`,
        `swarm step ${(play.report?.ms ?? 0).toFixed(1)} ms`,
      ]
        .filter((row) => row !== '')
        .join('\n')
    : ''
  said.textContent = play.line()
  end.style.display = run.won ? 'block' : 'none'
  if (run.won) end.textContent = `Home: the door shuts behind him.\n${minutes}:${String(seconds).padStart(2, '0')}, caught ${caught} time${caught === 1 ? '' : 's'}.\nR to play again.`
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
