// PROTOTYPE: the sewers in 2D, top-down (2026-10-12), `sewers2d.html`: the
// level's plan, to scale, and its play, to check every place and every timing
// before a single piece is modelled in 3D.
//
// The page plays nothing itself: the play step (sewerplay.ts) plays the
// sewers (sewers.ts), and the page feeds it the keys and draws what it
// reports. The plan reads like an architect's: the floor in pale stone, deep
// water in teal, walls as dark lines, and every piece as a fixed symbol, a
// grid of 5 m always and of 0.5 m close up. Over it, the dark: only the
// lights' pools show the ground, rats' eyes pale in the dark round the child.
// V shows everything; O the designer's overlay: the trail coloured by the
// light left, the vents' and the chandeliers' reach, the triggers and the
// checkpoints, each hole's part of the run. The splits on the right time each
// moment of the run from the start.
//
// Three canvases, one over the other: the plan and its pieces; the rats, drawn
// instanced on WebGL 2 (rats2d.ts); and over them the child, the dark, the
// eyes and the overlay. The follow button, F, or a double click keeps the
// view on the child. A small panel, bottom right, tunes the torch: how long
// it burns, and its light's radius full and last; G hides it.
import { RAT_LENGTH, RAT_SIZE } from './gameplay'
import { RatLayer } from './rats2d'
import GUI from 'three/examples/jsm/libs/lil-gui.module.min.js'
import { SewerPlay } from './sewerplay'
import { smoothed, type Glyph, type Piece, type Point, type Prop } from './sewers'
import { STEP } from './swarm-remote'

const TAU = Math.PI * 2
const play = new SewerPlay()
const { map, swarm } = play

const canvas = document.querySelector<HTMLCanvasElement>('#plan')!
const topCanvas = document.querySelector<HTMLCanvasElement>('#top')!
const planCtx = canvas.getContext('2d')!
const topCtx = topCanvas.getContext('2d')!
/** The canvas being drawn on: the plan's, then the one over the rats. */
let ctx = planCtx
const rats = new RatLayer(document.querySelector<HTMLCanvasElement>('#rats')!, swarm.capacity)
const followButton = document.querySelector<HTMLButtonElement>('#follow')!
const legend = document.querySelector<HTMLDivElement>('#legend')!
const said = document.querySelector<HTMLDivElement>('#said')!
const lifeFill = document.querySelector<HTMLDivElement>('#life .fill')!
const hud = document.querySelector<HTMLDivElement>('#hud')!
const splitsEl = document.querySelector<HTMLDivElement>('#splits')!
const end = document.querySelector<HTMLDivElement>('#end')!

const view = { x: map.level.start.x, z: map.level.start.z, scale: 24 }
const settings = { all: false, overlay: true, legend: true, free: false, paused: false }

// The colours of the plan.
const INK = {
  stone: '#0d1210',
  floor: '#56625c',
  floorEdge: '#7c8a83',
  water: '#1d5557',
  waterLine: '#2f7472',
  bridge: '#7a6448',
  solid: '#20282a',
  wall: '#0a0d0c',
  grid5: 'rgba(255,255,255,0.06)',
  grid05: 'rgba(255,255,255,0.035)',
  label: 'rgba(225,235,228,0.55)',
  flame: '#ffb35a',
  iron: '#a7a39a',
  rust: '#a2532c',
  gas: '#c6d24a',
  danger: '#e8c53a',
}

// Keys by where they sit: ZQSD on AZERTY walks as WASD does.
const MOVE: Record<string, [number, number]> = { KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }
const pressed = new Set<string>()
// The torch: how long it burns, and its light's radius, m, lit full and as it dies, shrinking from one to the other.
const gui = new GUI({ title: 'torch' })
gui.domElement.style.top = 'auto'
gui.domElement.style.bottom = '8px'
gui.add(play, 'torchSeconds', 3, 60, 0.1).name('duration, s')
gui.add(play.runTuning, 'torchReach', 0.2, play.tuning.ringMax, 0.05).name('max radius, m')
gui.add(play.runTuning, 'torchLeast', 0, play.tuning.ringMax, 0.05).name('min radius, m')
gui.add(play.settings, 'everlasting').name('endless torch (L)').listen()
// The far crowd's staggered steps: one step in so many, past so far from him; 1 steps every rat every step.
const far = gui.addFolder('far rats updated less often')
far.add(play.swarm, 'stagger', 1, 8, 1).name('teams taking turns (1 off)')
far.add(play.swarm, 'staggerFrom', 4, 40, 1).name('far = past m from him')

addEventListener('keydown', (event) => {
  // Typing in the panel plays nothing.
  if (event.target instanceof HTMLInputElement) return
  if (event.code in MOVE || event.code === 'Space') event.preventDefault()
  pressed.add(event.code)
  if (event.repeat) return
  if (event.code === 'KeyR' && !event.ctrlKey) restart(0)
  else if (/^Digit[0-5]$/.test(event.code)) restart(Number(event.code.slice(5)))
  else if (event.code === 'KeyV') settings.all = !settings.all
  else if (event.code === 'KeyO') settings.overlay = !settings.overlay
  else if (event.code === 'KeyK') settings.legend = !settings.legend
  else if (event.code === 'KeyP') settings.paused = !settings.paused
  else if (event.code === 'KeyF') follow(settings.free)
  else if (event.code === 'KeyL') play.settings.everlasting = !play.settings.everlasting
  else if (event.code === 'KeyG') gui.show(gui._hidden)
})
addEventListener('keyup', (event) => pressed.delete(event.code))
addEventListener('blur', () => pressed.clear())

function heading(): Point | null {
  let x = 0
  let z = 0
  for (const code of pressed) {
    const move = MOVE[code]
    if (move) {
      x += move[0]
      z += move[1]
    }
  }
  const d = Math.hypot(x, z)
  return d === 0 ? null : { x: x / d, z: z / d }
}

// Exploring the map: dragging pans off the child, the wheel zooms toward the pointer, F follows him again.
let drag: { x: number; y: number } | undefined
canvas.addEventListener('pointerdown', (event) => {
  drag = { x: event.clientX, y: event.clientY }
  canvas.setPointerCapture(event.pointerId)
})
canvas.addEventListener('pointermove', (event) => {
  if (!drag) return
  view.x -= (event.clientX - drag.x) / view.scale
  view.z -= (event.clientY - drag.y) / view.scale
  drag = { x: event.clientX, y: event.clientY }
  settings.free = true
})
canvas.addEventListener('pointerup', () => (drag = undefined))
canvas.addEventListener('dblclick', () => follow(true))
followButton.addEventListener('click', () => follow(settings.free))

/** The view kept on the child, or left where the player pans it. */
function follow(on: boolean): void {
  settings.free = !on
  followButton.blur()
}
canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault()
    const before = toWorld(event.clientX, event.clientY)
    view.scale = Math.min(140, Math.max(3, view.scale * Math.exp(-event.deltaY * 0.0015)))
    const after = toWorld(event.clientX, event.clientY)
    view.x += before.x - after.x
    view.z += before.z - after.z
    settings.free = true
  },
  { passive: false },
)

function toWorld(px: number, py: number): Point {
  return { x: view.x + (px - innerWidth / 2) / view.scale, z: view.z + (py - innerHeight / 2) / view.scale }
}

// The splits: when each moment of the run first came, s from the start.
const splits: [string, number][] = []
const split = (name: string, happened: boolean) => {
  if (happened && !splits.some(([n]) => n === name)) splits.push([name, play.t])
}
const trail: { x: number; z: number; left: number }[] = []
let trailAt = 0

function restart(point: number): void {
  play.skipTo(point)
  splits.length = 0
  trail.length = 0
  trailAt = 0
  end.style.display = 'none'
  // What the skip did already shows as skipped, never as timed.
  track()
  for (const entry of splits) entry[1] = Number.NaN
}

// The dark: drawn on its own canvas, the lights' pools cut out of it.
const dark = document.createElement('canvas')
const darkCtx = dark.getContext('2d')!

let last = performance.now()
let fps = 60
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05
  if (!settings.paused && !play.won) {
    // Two steps a frame at most: a slow frame slows the play rather than piling more steps on the next.
    let left = Math.min(dt, 2 * STEP)
    while (left > 1e-6) {
      const step = Math.min(left, STEP)
      play.frame(step, { heading: heading(), run: pressed.has('ShiftLeft') || pressed.has('ShiftRight'), interact: pressed.has('Space') })
      left -= step
    }
    track()
  }
  if (!settings.free) {
    view.x = play.holder.x
    view.z = play.holder.z
  }
  draw()
  requestAnimationFrame(frame)
}

function track(): void {
  const { holder } = play
  split('stick lit', play.lit)
  split('hub', play.stage >= 1)
  split('gas lever', play.pulled.gas)
  split('key', play.key)
  split('chest', play.chest)
  split('water lever', play.pulled.water)
  split('hub lever', play.pulled.hub)
  split('canal', !Number.isNaN(play.canalAt))
  split('cistern', play.stage >= 2)
  split('symbol door', play.symbolOpen)
  split('ladder', play.climbing)
  split('out', play.won)
  if (play.t - trailAt >= 0.2) {
    trailAt = play.t
    trail.push({ x: holder.x, z: holder.z, left: play.run.torch.lit ? play.left : -1 })
  }
}

// ---------------------------------------------------------------- drawing

const S = () => view.scale
const sx = (x: number) => (x - view.x) * view.scale + innerWidth / 2
const sz = (z: number) => (z - view.z) * view.scale + innerHeight / 2

function draw(): void {
  const dpr = devicePixelRatio || 1
  const w = innerWidth
  const h = innerHeight
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = topCanvas.width = dark.width = Math.round(w * dpr)
    canvas.height = topCanvas.height = dark.height = Math.round(h * dpr)
  }
  ctx = planCtx
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = INK.stone
  ctx.fillRect(0, 0, w, h)

  drawPlan()
  drawGrid(w, h)
  drawPieces()
  rats.draw(swarm, view, { width: w, height: h, dpr }, { length: RAT_BODY, width: RAT_BODY * 0.4, least: 0.6 }, RAT_INK)
  ctx = topCtx
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  drawChild()
  if (!settings.all) drawDark(dpr, w, h)
  drawEyes()
  drawGlows()
  if (settings.overlay) drawOverlay()
  drawLabels()
  drawHud()
}

/** A shape's outline as a canvas path. */
function shapePath(piece: Piece): void {
  const { shape } = piece
  ctx.beginPath()
  if (shape.kind === 'circle') ctx.arc(sx(shape.x), sz(shape.z), shape.r * S(), 0, TAU)
  else if (shape.kind === 'poly') {
    shape.points.forEach((p, k) => (k ? ctx.lineTo(sx(p.x), sz(p.z)) : ctx.moveTo(sx(p.x), sz(p.z))))
    ctx.closePath()
  }
}

/** A path piece stroked at its width, its ends and joints round. */
function strokePath(piece: Piece, color: string, grow = 0): void {
  const { shape } = piece
  if (shape.kind !== 'path') return
  const points = shape.smooth ? smoothed(shape.points) : shape.points
  ctx.strokeStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (shape.widths) {
    // A path whose width breathes: each stretch at its own width.
    const n = points.length
    const widths = shape.widths
    for (let k = 0; k + 1 < n; k++) {
      const share = k / (n - 1)
      const at = share * (widths.length - 1)
      const lo = Math.floor(at)
      const wv = widths[lo]! + (widths[Math.min(widths.length - 1, lo + 1)]! - widths[lo]!) * (at - lo)
      ctx.lineWidth = (wv + grow) * S()
      ctx.beginPath()
      ctx.moveTo(sx(points[k]!.x), sz(points[k]!.z))
      ctx.lineTo(sx(points[k + 1]!.x), sz(points[k + 1]!.z))
      ctx.stroke()
    }
    return
  }
  ctx.lineWidth = (shape.width + grow) * S()
  ctx.beginPath()
  points.forEach((p, k) => (k ? ctx.lineTo(sx(p.x), sz(p.z)) : ctx.moveTo(sx(p.x), sz(p.z))))
  ctx.stroke()
}

function fillPiece(piece: Piece, color: string): void {
  if (piece.shape.kind === 'path') strokePath(piece, color)
  else {
    shapePath(piece)
    ctx.fillStyle = color
    ctx.fill()
  }
}

/** The ground as traced: every loop round what is not stone, filled even-odd, in metres. */
const ground = new Path2D()
for (const loop of map.outlines) {
  loop.forEach((p, k) => (k ? ground.lineTo(p.x, p.z) : ground.moveTo(p.x, p.z)))
  ground.closePath()
}
const stoneWalls = new Path2D()
for (const wall of map.sight) {
  stoneWalls.moveTo(wall.from.x, wall.from.z)
  stoneWalls.lineTo(wall.to.x, wall.to.z)
}
const kerbs = new Path2D()
for (const wall of map.walls) {
  kerbs.moveTo(wall.from.x, wall.from.z)
  kerbs.lineTo(wall.to.x, wall.to.z)
}
const canalKerbs = new Path2D()
for (const wall of map.ratWalls) {
  canalKerbs.moveTo(wall.from.x, wall.from.z)
  canalKerbs.lineTo(wall.to.x, wall.to.z)
}

/** Draw in metres: the canvas set so one unit is a metre where the view stands. */
function inMetres(): void {
  const dpr = devicePixelRatio || 1
  ctx.setTransform(dpr * S(), 0, 0, dpr * S(), dpr * (innerWidth / 2 - view.x * S()), dpr * (innerHeight / 2 - view.z * S()))
}
function inPixels(): void {
  const dpr = devicePixelRatio || 1
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

/** The plan: the ground as traced, the canal's water clipped to it, the bridges, the pillars, then the walls. */
function drawPlan(): void {
  const { pieces } = map
  inMetres()
  ctx.fillStyle = INK.floor
  ctx.fill(ground, 'evenodd')
  ctx.save()
  ctx.clip(ground, 'evenodd')
  inPixels()
  const water = [...pieces.filter((piece) => piece.layer === 'water'), ...map.canal]
  for (const piece of water) fillPiece(piece, INK.water)
  // Ripples on the water: faint lines drifting.
  if (S() >= 10) {
    for (const piece of water) {
      if (piece.shape.kind !== 'poly') continue
      const points = piece.shape.points
      const minX = Math.max(Math.min(...points.map((p) => p.x)), view.x - innerWidth / 2 / S())
      const maxX = Math.min(Math.max(...points.map((p) => p.x)), view.x + innerWidth / 2 / S())
      const minZ = Math.max(Math.min(...points.map((p) => p.z)), view.z - innerHeight / 2 / S())
      const maxZ = Math.min(Math.max(...points.map((p) => p.z)), view.z + innerHeight / 2 / S())
      if (minX >= maxX || minZ >= maxZ) continue
      ctx.save()
      shapePath(piece)
      ctx.clip()
      ctx.strokeStyle = INK.waterLine
      ctx.lineWidth = Math.max(1, 0.05 * S())
      const step = 1.2
      const off = (performance.now() / 1000) * 0.4
      for (let z = Math.floor(minZ / step) * step; z < maxZ + step; z += step) {
        ctx.beginPath()
        for (let x = minX; x < maxX + 0.6; x += 0.6) {
          const y = z + Math.sin(x * 1.3 + off + z) * 0.12
          if (x === minX) ctx.moveTo(sx(x), sz(y))
          else ctx.lineTo(sx(x), sz(y))
        }
        ctx.stroke()
      }
      ctx.restore()
    }
  }
  for (const piece of pieces) if (piece.layer === 'bridge' && piece.shape.kind !== 'path') fillPiece(piece, INK.bridge)
  ctx.restore()
  inPixels()
  for (const piece of pieces) if (piece.layer === 'solid' && piece.shape.kind === 'poly') fillPiece(piece, INK.solid)
  // The walls: against the stone, a line half a wall's thickness out from the face, drawn that thick; at the canal's
  // edge, a kerb, a wall for the rats only.
  inMetres()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = INK.wall
  ctx.lineWidth = 0.3
  ctx.stroke(stoneWalls)
  ctx.strokeStyle = '#2c3633'
  ctx.lineWidth = 0.07
  ctx.stroke(kerbs)
  ctx.stroke(canalKerbs)
  inPixels()
}

function drawGrid(w: number, h: number): void {
  const draw = (step: number, color: string) => {
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.beginPath()
    const x0 = Math.floor((view.x - w / 2 / S()) / step) * step
    const z0 = Math.floor((view.z - h / 2 / S()) / step) * step
    for (let x = x0; x < view.x + w / 2 / S(); x += step) {
      ctx.moveTo(Math.round(sx(x)) + 0.5, 0)
      ctx.lineTo(Math.round(sx(x)) + 0.5, h)
    }
    for (let z = z0; z < view.z + h / 2 / S(); z += step) {
      ctx.moveTo(0, Math.round(sz(z)) + 0.5)
      ctx.lineTo(w, Math.round(sz(z)) + 0.5)
    }
    ctx.stroke()
  }
  if (S() >= 28) draw(0.5, INK.grid05)
  draw(5, INK.grid5)
}

/** Every piece of the run, by its symbol. */
function drawPieces(): void {
  const t = play.t
  for (const prop of map.props) drawProp(prop)
  // The escape holes: dark mouths at the foot of the chandeliers' gallery's walls, rimmed rust. Rats go in, none comes out.
  for (const hole of map.escapes) {
    // A slot along its wall, round at its ends.
    ctx.beginPath()
    ctx.moveTo(sx(hole.x - hole.dx * hole.half), sz(hole.z - hole.dz * hole.half))
    ctx.lineTo(sx(hole.x + hole.dx * hole.half), sz(hole.z + hole.dz * hole.half))
    ctx.lineCap = 'round'
    ctx.lineWidth = 0.66 * S()
    ctx.strokeStyle = '#8a3b2a'
    ctx.stroke()
    ctx.lineWidth = 0.5 * S()
    ctx.strokeStyle = '#030404'
    ctx.stroke()
  }
  // The jets: a pipe's mouth in the wall, a hazard ring round it; jetting, a plume of gas across the way; about to, a few puffs.
  map.jets.forEach((jet, k) => {
    const jetting = play.jetting(k)
    const until = play.untilJet(k)
    const nx = -jet.dz
    const nz = jet.dx
    ctx.beginPath()
    ctx.arc(sx(jet.x), sz(jet.z), 0.32 * S(), 0, TAU)
    ctx.fillStyle = '#121615'
    ctx.fill()
    ctx.strokeStyle = INK.danger
    ctx.lineWidth = Math.max(1, 0.09 * S())
    ctx.stroke()
    if (jetting) {
      const end = { x: jet.x + jet.dx * jet.length, z: jet.z + jet.dz * jet.length }
      const g = ctx.createLinearGradient(sx(jet.x), sz(jet.z), sx(end.x), sz(end.z))
      g.addColorStop(0, 'rgba(198,210,74,0.75)')
      g.addColorStop(1, 'rgba(198,210,74,0.15)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.moveTo(sx(jet.x + nx * 0.3), sz(jet.z + nz * 0.3))
      ctx.lineTo(sx(end.x + nx * jet.half), sz(end.z + nz * jet.half))
      ctx.lineTo(sx(end.x - nx * jet.half), sz(end.z - nz * jet.half))
      ctx.lineTo(sx(jet.x - nx * 0.3), sz(jet.z - nz * 0.3))
      ctx.closePath()
      ctx.fill()
    } else if (until < 0.8) {
      ctx.fillStyle = 'rgba(198,210,74,0.4)'
      for (let p = 0; p < 4; p++) {
        const d = 0.3 + ((t * 2 + p * 0.25) % 1) * 0.8
        ctx.beginPath()
        ctx.arc(sx(jet.x + jet.dx * d + nx * Math.sin(p * 2.3) * 0.2), sz(jet.z + jet.dz * d + nz * Math.sin(p * 2.3) * 0.2), 0.1 * S(), 0, TAU)
        ctx.fill()
      }
    }
  })
  // Doors: a thick bar while shut, the push shown as it builds.
  map.doors.forEach((door, k) => {
    const huge = door.name === 'huge door'
    if (!play.doorsOpen[k]) {
      ctx.strokeStyle = huge ? '#5d4a36' : '#6d5034'
      ctx.lineWidth = (huge ? 0.6 : 0.35) * S()
      ctx.lineCap = 'butt'
      ctx.beginPath()
      ctx.moveTo(sx(door.from.x), sz(door.from.z))
      ctx.lineTo(sx(door.to.x), sz(door.to.z))
      ctx.stroke()
    } else {
      ctx.strokeStyle = 'rgba(109,80,52,0.5)'
      ctx.lineWidth = 0.15 * S()
      ctx.beginPath()
      ctx.moveTo(sx(door.from.x), sz(door.from.z))
      ctx.lineTo(sx(door.from.x + (huge ? -0.3 : 0.3)), sz(door.from.z + (huge ? -1.6 : -1.6)))
      ctx.stroke()
    }
    if (huge) {
      // The three rods across it: the gas branch's, the water branch's, the hub's; drawn back as each lever is pulled.
      const rods: [boolean, number][] = [
        [play.pulled.gas, -1.4],
        [play.pulled.hub, 0],
        [play.pulled.water, 1.4],
      ]
      for (const [out, dx] of rods) {
        ctx.strokeStyle = out ? '#4a524f' : INK.iron
        ctx.lineWidth = 0.14 * S()
        ctx.beginPath()
        ctx.moveTo(sx(dx), sz(door.from.z + (out ? 0.5 : 0.1)))
        ctx.lineTo(sx(dx), sz(door.from.z + (out ? 1.1 : -0.7)))
        ctx.stroke()
      }
    }
    if (!huge && !play.doorsOpen[k] && play.doorHold[k]! > 0) progress(door.at, play.doorHold[k]! / door.hold)
  })
  // The levers.
  for (const lever of map.levers) {
    const pulled = play.pulled[lever.name]
    ctx.beginPath()
    ctx.arc(sx(lever.x), sz(lever.z), 0.3 * S(), 0, TAU)
    ctx.fillStyle = '#2b302e'
    ctx.fill()
    ctx.strokeStyle = pulled ? '#7fb069' : INK.iron
    ctx.lineWidth = Math.max(1.5, 0.1 * S())
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(sx(lever.x), sz(lever.z))
    ctx.lineTo(sx(lever.x + (pulled ? 0.5 : 0)), sz(lever.z + (pulled ? 0.2 : -0.55)))
    ctx.stroke()
    const held = play.leverHold[lever.name]
    if (held > 0) progress(lever, held / lever.hold)
  }
  // The worker's key, the chest.
  if (!play.key) glyph('key', map.corpse.x + 0.4, map.corpse.z - 0.2, 0.3, '#d8c27a')
  ctx.fillStyle = play.chest ? '#4a3a26' : '#6b4c2a'
  ctx.fillRect(sx(map.chest.x - 0.4), sz(map.chest.z - 0.25), 0.8 * S(), 0.5 * S())
  ctx.strokeStyle = '#c8a050'
  ctx.lineWidth = Math.max(1, 0.05 * S())
  ctx.strokeRect(sx(map.chest.x - 0.4), sz(map.chest.z - 0.25), 0.8 * S(), 0.5 * S())
  // The cistern's plates: stone squares, their number and sign shown only in a light.
  map.plates.forEach((plate, k) => {
    ctx.fillStyle = '#6e7a72'
    ctx.fillRect(sx(plate.x - 0.4), sz(plate.z - 0.4), 0.8 * S(), 0.8 * S())
    if (!play.platesSeen[k] && !settings.all) return
    ctx.strokeStyle = '#d9d2b0'
    ctx.lineWidth = Math.max(1, 0.04 * S())
    ctx.strokeRect(sx(plate.x - 0.4), sz(plate.z - 0.4), 0.8 * S(), 0.8 * S())
    glyph(plate.symbol, plate.x + 0.12, plate.z, 0.24, '#e8e0c0')
    ctx.fillStyle = '#e8e0c0'
    ctx.font = `bold ${Math.max(8, 0.26 * S())}px Georgia`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(['I', 'II', 'III', 'IV'][plate.numeral - 1]!, sx(plate.x - 0.22), sz(plate.z))
  })
  // The cistern door and its buttons.
  if (!play.symbolOpen) {
    const d = map.symbolDoor
    ctx.strokeStyle = '#4e4a40'
    ctx.lineWidth = 0.5 * S()
    ctx.lineCap = 'butt'
    ctx.beginPath()
    ctx.moveTo(sx(d.from.x), sz(d.from.z))
    ctx.lineTo(sx(d.to.x), sz(d.to.z))
    ctx.stroke()
  }
  for (const button of map.buttons) {
    ctx.beginPath()
    ctx.arc(sx(button.x), sz(button.z), 0.34 * S(), 0, TAU)
    ctx.fillStyle = '#3a3a34'
    ctx.fill()
    glyph(button.symbol, button.x, button.z, 0.22, '#d9d2b0')
  }
  // The ladder at the end, and the cover pushed.
  ladder(map.ladder.x, map.ladder.z, 0, 1)
  if (play.climbing) progress(map.ladder, play.cover / 3)
  // The lights.
  for (const light of map.lights) {
    if (light.look === 'chandelier') continue
    if (light.look === 'fire') {
      ctx.beginPath()
      ctx.arc(sx(light.x), sz(light.z), 0.6 * S(), 0, TAU)
      ctx.fillStyle = '#2a2420'
      ctx.fill()
      ctx.strokeStyle = '#7d756a'
      ctx.lineWidth = Math.max(2, 0.12 * S())
      ctx.stroke()
      for (let k = 0; k < 5; k++) flame(light.x + Math.cos(k * 1.26) * 0.24, light.z + Math.sin(k * 1.26) * 0.24, 0.15)
      flame(light.x, light.z, 0.22)
      continue
    }
    if (light.look === 'brazier') {
      ctx.beginPath()
      ctx.arc(sx(light.x), sz(light.z), 0.38 * S(), 0, TAU)
      ctx.fillStyle = '#2a2420'
      ctx.fill()
      ctx.strokeStyle = INK.iron
      ctx.lineWidth = Math.max(1, 0.07 * S())
      ctx.stroke()
    }
    flame(light.x, light.z, light.look === 'lamp' ? 0.14 : 0.24)
  }
  // The chandeliers: the chain from where each hangs, its ring of candles; fallen, a broken ring on the floor.
  for (const c of map.chandeliers) {
    const at = play.chandelierAt(c)
    if (!play.fallen) {
      ctx.strokeStyle = 'rgba(167,163,154,0.5)'
      ctx.setLineDash([0.12 * S(), 0.1 * S()])
      ctx.lineWidth = Math.max(1, 0.03 * S())
      ctx.beginPath()
      ctx.moveTo(sx(c.pivot.x), sz(c.pivot.z))
      ctx.lineTo(sx(at.x), sz(at.z))
      ctx.stroke()
      ctx.setLineDash([])
    }
    ctx.beginPath()
    ctx.arc(sx(at.x), sz(at.z), 0.5 * S(), 0, play.fallen ? TAU * 0.8 : TAU)
    ctx.strokeStyle = '#c9b27a'
    ctx.lineWidth = Math.max(1.5, 0.08 * S())
    ctx.stroke()
    for (let k = 0; k < 6; k++) flame(at.x + Math.cos((k * TAU) / 6) * 0.5, at.z + Math.sin((k * TAU) / 6) * 0.5, 0.07)
  }
}

function progress(p: Point, share: number): void {
  ctx.beginPath()
  ctx.arc(sx(p.x), sz(p.z), 0.6 * S(), -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, share))
  ctx.strokeStyle = '#f1e6d2'
  ctx.lineWidth = Math.max(2, 0.08 * S())
  ctx.stroke()
}

function flame(x: number, z: number, r: number): void {
  const flick = 1 + Math.sin(performance.now() / 90 + x * 3 + z) * 0.12
  ctx.beginPath()
  ctx.arc(sx(x), sz(z), r * flick * S(), 0, TAU)
  ctx.fillStyle = INK.flame
  ctx.fill()
}

function ladder(x: number, z: number, angle: number, alpha: number): void {
  ctx.save()
  ctx.translate(sx(x), sz(z))
  ctx.rotate(angle)
  ctx.globalAlpha = alpha
  ctx.strokeStyle = INK.iron
  ctx.lineWidth = Math.max(1, 0.05 * S())
  ctx.beginPath()
  ctx.moveTo(-0.25 * S(), -0.6 * S())
  ctx.lineTo(-0.25 * S(), 0.6 * S())
  ctx.moveTo(0.25 * S(), -0.6 * S())
  ctx.lineTo(0.25 * S(), 0.6 * S())
  for (let k = -2; k <= 2; k++) {
    ctx.moveTo(-0.25 * S(), k * 0.25 * S())
    ctx.lineTo(0.25 * S(), k * 0.25 * S())
  }
  ctx.stroke()
  ctx.restore()
}

/** A sign drawn small: a fish, a wheel, a skull, a key. */
function glyph(kind: Glyph, x: number, z: number, r: number, color: string): void {
  const X = sx(x)
  const Z = sz(z)
  const R = r * S()
  ctx.save()
  ctx.strokeStyle = ctx.fillStyle = color
  ctx.lineWidth = Math.max(1, R * 0.18)
  ctx.beginPath()
  if (kind === 'fish') {
    ctx.ellipse(X - R * 0.15, Z, R * 0.6, R * 0.35, 0, 0, TAU)
    ctx.moveTo(X + R * 0.4, Z)
    ctx.lineTo(X + R * 0.9, Z - R * 0.35)
    ctx.lineTo(X + R * 0.9, Z + R * 0.35)
    ctx.closePath()
    ctx.stroke()
  } else if (kind === 'wheel') {
    ctx.arc(X, Z, R * 0.7, 0, TAU)
    for (let k = 0; k < 3; k++) {
      const a = (k * Math.PI) / 3
      ctx.moveTo(X + Math.cos(a) * R * 0.7, Z + Math.sin(a) * R * 0.7)
      ctx.lineTo(X - Math.cos(a) * R * 0.7, Z - Math.sin(a) * R * 0.7)
    }
    ctx.stroke()
  } else if (kind === 'skull') {
    ctx.arc(X, Z - R * 0.1, R * 0.6, 0, TAU)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(X - R * 0.22, Z - R * 0.1, R * 0.14, 0, TAU)
    ctx.arc(X + R * 0.22, Z - R * 0.1, R * 0.14, 0, TAU)
    ctx.fill()
    ctx.fillRect(X - R * 0.3, Z + R * 0.45, R * 0.6, R * 0.25)
  } else {
    ctx.arc(X - R * 0.45, Z, R * 0.3, 0, TAU)
    ctx.moveTo(X - R * 0.15, Z)
    ctx.lineTo(X + R * 0.8, Z)
    ctx.moveTo(X + R * 0.55, Z)
    ctx.lineTo(X + R * 0.55, Z + R * 0.3)
    ctx.moveTo(X + R * 0.8, Z)
    ctx.lineTo(X + R * 0.8, Z + R * 0.3)
    ctx.stroke()
  }
  ctx.restore()
}

function drawProp(prop: Prop): void {
  const { x, z } = prop
  const angle = prop.angle ?? 0
  const size = prop.size ?? 1
  ctx.save()
  ctx.translate(sx(x), sz(z))
  ctx.rotate(angle)
  const s = S()
  ctx.lineWidth = Math.max(1, 0.05 * s)
  switch (prop.kind) {
    case 'sign':
      ctx.beginPath()
      ctx.moveTo(0, -0.38 * s)
      ctx.lineTo(0.36 * s, 0.26 * s)
      ctx.lineTo(-0.36 * s, 0.26 * s)
      ctx.closePath()
      ctx.fillStyle = INK.danger
      ctx.fill()
      ctx.fillStyle = '#1a1a14'
      ctx.font = `bold ${Math.max(8, 0.42 * s)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('!', 0, 0.02 * s)
      break
    case 'ladder':
      ctx.restore()
      ladder(x, z, angle, 0.7)
      return
    case 'grate':
      ctx.strokeStyle = INK.iron
      ctx.beginPath()
      for (let k = -size / 2; k <= size / 2 + 1e-6; k += 0.25) {
        ctx.moveTo(k * s, -0.12 * s)
        ctx.lineTo(k * s, 0.12 * s)
      }
      ctx.moveTo((-size / 2) * s, 0)
      ctx.lineTo((size / 2) * s, 0)
      ctx.stroke()
      break
    case 'pipes':
      ctx.strokeStyle = '#6a4a3a'
      ctx.lineWidth = 0.35 * s
      ctx.beginPath()
      ctx.moveTo((-size / 2) * s, 0)
      ctx.lineTo((size / 2) * s, 0)
      ctx.stroke()
      ctx.strokeStyle = INK.rust
      ctx.lineWidth = Math.max(1, 0.06 * s)
      ctx.beginPath()
      for (let k = -size / 2 + 0.4; k < size / 2; k += 1.2) {
        ctx.moveTo(k * s, -0.22 * s)
        ctx.lineTo(k * s, 0.22 * s)
      }
      ctx.stroke()
      break
    case 'valve':
      ctx.strokeStyle = INK.rust
      ctx.beginPath()
      ctx.arc(0, 0, 0.3 * s, 0, TAU)
      ctx.moveTo(-0.3 * s, 0)
      ctx.lineTo(0.3 * s, 0)
      ctx.moveTo(0, -0.3 * s)
      ctx.lineTo(0, 0.3 * s)
      ctx.stroke()
      break
    case 'crate':
      ctx.fillStyle = '#5a4630'
      ctx.fillRect(-0.4 * s, -0.4 * s, 0.8 * s, 0.8 * s)
      ctx.strokeStyle = '#2e2418'
      ctx.strokeRect(-0.4 * s, -0.4 * s, 0.8 * s, 0.8 * s)
      ctx.beginPath()
      ctx.moveTo(-0.4 * s, -0.4 * s)
      ctx.lineTo(0.4 * s, 0.4 * s)
      ctx.stroke()
      break
    case 'barrel':
      ctx.beginPath()
      ctx.arc(0, 0, 0.32 * s, 0, TAU)
      ctx.fillStyle = '#4a3a2a'
      ctx.fill()
      ctx.strokeStyle = INK.rust
      ctx.stroke()
      break
    case 'bones':
      ctx.strokeStyle = '#cfc6b0'
      ctx.beginPath()
      ctx.moveTo(-0.3 * s, -0.1 * s)
      ctx.lineTo(0.3 * s, 0.1 * s)
      ctx.moveTo(-0.2 * s, 0.2 * s)
      ctx.lineTo(0.25 * s, -0.15 * s)
      ctx.stroke()
      break
    case 'chains':
      ctx.strokeStyle = INK.iron
      ctx.setLineDash([0.08 * s, 0.06 * s])
      for (const dx of [-0.25, 0, 0.3]) {
        ctx.beginPath()
        ctx.moveTo(dx * s, -0.5 * s)
        ctx.lineTo((dx + Math.sin(performance.now() / 700 + dx * 9) * 0.08) * s, 0.5 * s)
        ctx.stroke()
      }
      ctx.setLineDash([])
      break
  }
  ctx.restore()
}

/** A rat on the plan: its body's length, m, and its colour, #1c1714. */
const RAT_BODY = RAT_LENGTH * 0.55 * Math.sqrt(RAT_SIZE)
const RAT_INK: [number, number, number] = [0x1c / 255, 0x17 / 255, 0x14 / 255]

function drawChild(): void {
  const { holder } = play
  const s = S()
  // The worker's remains, in their corner.
  {
    const c = map.corpse
    ctx.fillStyle = '#3e4a3c'
    ctx.beginPath()
    ctx.ellipse(sx(c.x), sz(c.z), 0.5 * s, 0.25 * s, 0.6, 0, TAU)
    ctx.fill()
    ctx.fillStyle = '#d9d0b8'
    ctx.beginPath()
    ctx.arc(sx(c.x - 0.4), sz(c.z - 0.25), 0.12 * s, 0, TAU)
    ctx.fill()
  }
  ctx.save()
  ctx.translate(sx(holder.x), sz(holder.z))
  ctx.rotate(Math.atan2(play.facing.z, play.facing.x) + Math.PI / 2)
  ctx.fillStyle = '#4b6a6e'
  ctx.beginPath()
  ctx.ellipse(0, 0, 0.2 * s, 0.12 * s, 0, 0, TAU)
  ctx.fill()
  ctx.fillStyle = '#e07a26'
  ctx.beginPath()
  ctx.arc(0, -0.02 * s, 0.14 * s, 0, TAU)
  ctx.fill()
  ctx.restore()
  const torch = play.run.torch
  if (torch.lit) flame(holder.x + play.facing.x * 0.28 + 0.12, holder.z + play.facing.z * 0.28, 0.06 + 0.06 * Math.min(1, play.left / 8))
  else {
    ctx.fillStyle = '#5a3b2a'
    ctx.beginPath()
    ctx.arc(sx(holder.x + play.facing.x * 0.28 + 0.12), sz(holder.z + play.facing.z * 0.28), 0.04 * s, 0, TAU)
    ctx.fill()
  }
}

/** How far a light lights the ground on the plan, m. */
/**
 * The torch's light on the floor: lit full out to the radius the rats keep off, its reach, then gone in TORCH_EDGE m,
 * so the light's edge is the rats' ring.
 */
const TORCH_EDGE = 0.25
const torchPool = () => (play.run.torch.lit ? play.run.torch.reach + TORCH_EDGE : 0)
const placedPool = (reach: number, look: string) => (look === 'chandelier' ? reach * 1.6 : reach * 2.2)

function drawDark(dpr: number, w: number, h: number): void {
  const d = darkCtx
  d.setTransform(dpr, 0, 0, dpr, 0, 0)
  d.globalCompositeOperation = 'source-over'
  d.clearRect(0, 0, w, h)
  d.fillStyle = 'rgba(4,7,6,0.9)'
  d.fillRect(0, 0, w, h)
  d.globalCompositeOperation = 'destination-out'
  /** A pool of light `r` m round (x, z): full to `full` of its radius, a soft fall from 0.6 of it when not given. */
  const pool = (x: number, z: number, r: number, strength = 1, full?: number) => {
    if (r <= 0) return
    const g = d.createRadialGradient(sx(x), sz(z), 0, sx(x), sz(z), r * S())
    g.addColorStop(0, `rgba(0,0,0,${strength})`)
    if (full === undefined) g.addColorStop(0.6, `rgba(0,0,0,${strength * 0.85})`)
    else g.addColorStop(Math.min(0.999, full), `rgba(0,0,0,${strength})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    d.fillStyle = g
    d.beginPath()
    d.arc(sx(x), sz(z), r * S(), 0, TAU)
    d.fill()
  }
  const { holder } = play
  const torchR = torchPool()
  pool(holder.x, holder.z, torchR, 1, torchR > 0 ? play.run.torch.reach / torchR : undefined)
  // Round the child, a little of the dark always shows: his own outline.
  pool(holder.x, holder.z, 1.1, 0.35)
  for (const light of map.lights) if (light.on) pool(light.x, light.z, placedPool(light.reach, light.look))
  for (const [k, jet] of map.jets.entries()) if (play.jetting(k)) pool(jet.x + jet.dx * jet.length * 0.5, jet.z + jet.dz * jet.length * 0.5, 1.6, 0.35)
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(dark, 0, 0)
  ctx.restore()
}

/** Rats' eyes in the dark round the child, where he can see them. */
function drawEyes(): void {
  if (settings.all) return
  const { holder } = play
  const pool = torchPool()
  play.sight.nearTo(holder.x, holder.z, 14)
  ctx.fillStyle = 'rgba(230,220,190,0.75)'
  const s = S()
  const r = Math.max(0.8, 0.025 * s)
  // Every eye in one path, filled once.
  ctx.beginPath()
  for (let i = 0; i < swarm.count; i++) {
    const x = swarm.x[i]!
    const z = swarm.z[i]!
    const d = Math.hypot(x - holder.x, z - holder.z)
    if (d > 12 || d < pool) continue
    if (play.sight.ray(holder.x, holder.z, (x - holder.x) / d, (z - holder.z) / d, d) < d - 0.2) continue
    const a = swarm.heading[i]!
    const fx = Math.cos(a) * 0.1
    const fz = Math.sin(a) * 0.1
    for (const side of [-1, 1]) {
      const X = sx(x + fx - fz * 0.35 * side)
      const Z = sz(z + fz + fx * 0.35 * side)
      ctx.moveTo(X + r, Z)
      ctx.arc(X, Z, r, 0, TAU)
    }
  }
  ctx.fill()
}

/** The glows that read through the dark: flames, the gas. */
function drawGlows(): void {
  const glow = (x: number, z: number, r: number, color: string) => {
    const g = ctx.createRadialGradient(sx(x), sz(z), 0, sx(x), sz(z), r * S())
    g.addColorStop(0, color)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(sx(x), sz(z), r * S(), 0, TAU)
    ctx.fill()
  }
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (const light of map.lights) if (light.on) glow(light.x, light.z, light.look === 'lamp' ? 1 : light.look === 'fire' ? 2.2 : 1.6, 'rgba(255,150,60,0.18)')
  if (play.run.torch.lit) glow(play.holder.x, play.holder.z, 1.4, 'rgba(255,150,60,0.16)')
  ctx.restore()
}

/** The designer overlay's colours, one an indicator, as the legend lists them. */
const OVERLAY = {
  checkpoint: '#7fb0e0',
  light: 'rgba(255,179,90,0.85)',
  chandelier: 'rgba(214,190,130,0.85)',
  jet: 'rgba(232,197,58,0.9)',
  lever: '#e6d48a',
  door: '#c89a6a',
  canal: '#5fc9c0',
  escape: '#d0603e',
  plate: '#cfc6b0',
  marker: '#b8c2bd',
  notice: 'rgba(224,122,122,0.45)',
}
/** The legend: each indicator's colour and what it shows. */
const LEGEND: [string, string][] = [
  [OVERLAY.checkpoint, 'checkpoint (dashed box): where a catch starts you again'],
  [OVERLAY.light, 'fire, brazier, lamp: the ring is the reach rats keep out of'],
  [OVERLAY.chandelier, 'chandelier: its swing and its pool of light (light only)'],
  [OVERLAY.jet, 'gas jet: its reach, and the time to its next burst'],
  [OVERLAY.lever, 'lever: how long to hold it'],
  [OVERLAY.door, 'door: the huge door, the symbol door'],
  [OVERLAY.canal, 'canal: water no rat enters'],
  [OVERLAY.escape, 'escape hole: rats in the light run in, none come out'],
  [OVERLAY.plate, 'plate: its numeral and symbol'],
  [OVERLAY.marker, 'start, corpse with the key, chest, ladder'],
  [OVERLAY.notice, 'red ring round him: 9 m, how far rats notice him'],
  ['#7fb069', 'trail: green torch full, amber under 15 s'],
  ['#e0453a', 'trail: red under 8 s, grey dark'],
]
legend.innerHTML =
  '<b>overlay (O) · legend (K)</b>' + LEGEND.map(([color, text]) => `<div><span style="background:${color}"></span>${text}</div>`).join('')

function drawOverlay(): void {
  const s = S()
  // The trail, coloured by the light left: amber full, red low, grey dark.
  for (const p of trail) {
    ctx.fillStyle = p.left < 0 ? '#777' : p.left < 8 ? '#e0453a' : p.left < 15 ? '#e0a33a' : '#7fb069'
    ctx.fillRect(sx(p.x) - 1.5, sz(p.z) - 1.5, 3, 3)
  }
  ctx.lineWidth = 1
  ctx.font = '11px ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // The jets' reach and when each next jets.
  map.jets.forEach((jet, k) => {
    const nx = -jet.dz
    const nz = jet.dx
    const end = { x: jet.x + jet.dx * jet.length, z: jet.z + jet.dz * jet.length }
    ctx.strokeStyle = OVERLAY.jet
    ctx.beginPath()
    ctx.moveTo(sx(jet.x + nx * jet.half), sz(jet.z + nz * jet.half))
    ctx.lineTo(sx(end.x + nx * jet.half), sz(end.z + nz * jet.half))
    ctx.lineTo(sx(end.x - nx * jet.half), sz(end.z - nz * jet.half))
    ctx.lineTo(sx(jet.x - nx * jet.half), sz(jet.z - nz * jet.half))
    ctx.closePath()
    ctx.stroke()
    ctx.fillStyle = '#e8c53a'
    ctx.fillText(play.pulled.gas ? "off" : `${play.untilJet(k).toFixed(1)}s / ${jet.period}s`, sx(end.x), sz(end.z) + 12)
  })
  // The chandeliers' swing and reach.
  for (const c of map.chandeliers) {
    ctx.strokeStyle = OVERLAY.chandelier
    ctx.beginPath()
    ctx.moveTo(sx(c.pivot.x - c.axis.x * c.amplitude), sz(c.pivot.z - c.axis.z * c.amplitude))
    ctx.lineTo(sx(c.pivot.x + c.axis.x * c.amplitude), sz(c.pivot.z + c.axis.z * c.amplitude))
    ctx.stroke()
    const at = play.chandelierAt(c)
    const light = map.lights[c.light]!
    ctx.beginPath()
    ctx.arc(sx(at.x), sz(at.z), light.reach * s, 0, TAU)
    ctx.stroke()
  }
  // Every light's hard reach: what holds the rats.
  ctx.strokeStyle = OVERLAY.light
  for (const light of map.lights) {
    if (light.look === 'chandelier' || !light.on) continue
    ctx.beginPath()
    ctx.arc(sx(light.x), sz(light.z), light.reach * s, 0, TAU)
    ctx.stroke()
  }
  // Checkpoints, triggers.
  const box = (b: { minX: number; maxX: number; minZ: number; maxZ: number }, color: string, text: string) => {
    ctx.strokeStyle = color
    ctx.setLineDash([4, 3])
    ctx.strokeRect(sx(b.minX), sz(b.minZ), (b.maxX - b.minX) * s, (b.maxZ - b.minZ) * s)
    ctx.setLineDash([])
    ctx.fillStyle = color
    ctx.fillText(text, sx((b.minX + b.maxX) / 2), sz(b.minZ) - 7)
  }
  // Each checkpoint by its name, in the order the level lists them.
  const names = ['hub', 'landing (cistern)', 'gas lever', 'water lever', 'canal', 'cistern middle', 'gas mouth']
  for (const [k, zone] of (map.level.checkpoints ?? []).entries()) box(zone, OVERLAY.checkpoint, `checkpoint: ${names[k] ?? k}`)
  const tag = (x: number, z: number, color: string, text: string, dy = -14) => {
    ctx.fillStyle = color
    ctx.fillText(text, sx(x), sz(z) + dy)
  }
  // Every light: its name and the reach it holds the rats off to; a flame he lights the torch at, or light only.
  for (const light of map.lights) {
    if (!light.on) continue
    tag(light.x, light.z, light.look === 'chandelier' ? OVERLAY.chandelier : OVERLAY.light, `${light.name} · ${light.reach.toFixed(1)} m${light.flame ? '' : ' · light only'}`, -light.reach * s - 8)
  }
  // The levers, their hold; the doors; the canal; the escape holes; the plates; the start, the corpse, the chest, the ladder.
  for (const lever of map.levers) tag(lever.x, lever.z, OVERLAY.lever, `${lever.name} lever · hold ${lever.hold} s${play.pulled[lever.name] ? ' · pulled' : ''}`, 16)
  const huge = map.doors.find((door) => door.name === 'huge door')
  if (huge) tag((huge.from.x + huge.to.x) / 2, (huge.from.z + huge.to.z) / 2, OVERLAY.door, `huge door · 3 rods${play.pulled.hub ? ' · open' : ''}`, -10)
  tag((map.symbolDoor.from.x + map.symbolDoor.to.x) / 2, map.symbolDoor.from.z, OVERLAY.door, `symbol door${play.symbolOpen ? ' · open' : ' · 4 signs in order'}`, -10)
  const canal = map.canalBox
  ctx.textAlign = 'left'
  ctx.fillStyle = OVERLAY.canal
  ctx.fillText('canal: rats keep out', sx(canal.maxX) + 6, sz((canal.minZ + canal.maxZ) / 2))
  ctx.textAlign = 'center'
  for (const hole of map.escapes) tag(hole.x, hole.z, OVERLAY.escape, 'escape', hole.z < play.map.chandeliers[0]!.pivot.z ? -12 : 14)
  for (const plate of map.plates) tag(plate.x, plate.z, OVERLAY.plate, `plate ${['I', 'II', 'III', 'IV'][plate.numeral - 1]} ${plate.symbol}`, -12)
  tag(map.level.start.x, map.level.start.z, OVERLAY.marker, 'start', 16)
  tag(map.corpse.x, map.corpse.z, OVERLAY.marker, 'corpse · key', 16)
  tag(map.chest.x, map.chest.z, OVERLAY.marker, 'chest', 16)
  tag(map.ladder.x, map.ladder.z, OVERLAY.marker, 'ladder · cover 3 s', 16)
  // The notice and the eyes round the child.
  const { holder } = play
  ctx.strokeStyle = OVERLAY.notice
  ctx.beginPath()
  ctx.arc(sx(holder.x), sz(holder.z), 9 * s, 0, TAU)
  ctx.stroke()
}

function drawLabels(): void {
  ctx.fillStyle = INK.label
  ctx.font = `600 ${Math.min(22, Math.max(10, 0.55 * S()))}px ui-sans-serif, system-ui`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const label of map.labels) ctx.fillText(label.text, sx(label.x), sz(label.z))
  // The scale bar.
  const s = S()
  const metres = s > 40 ? 1 : s > 12 ? 5 : 10
  ctx.strokeStyle = ctx.fillStyle = INK.label
  ctx.lineWidth = 2
  const x0 = innerWidth - 30 - metres * s
  const y0 = innerHeight - 30
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x0 + metres * s, y0)
  ctx.stroke()
  ctx.font = '11px ui-monospace, monospace'
  ctx.fillText(`${metres} m`, x0 + (metres * s) / 2, y0 - 9)
}

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

function drawHud(): void {
  const { run } = play
  const torch = run.torch
  const tick = (b: boolean) => (b ? 'x' : ' ')
  hud.textContent = [
    `${clock(play.t)}   torch ${torch.lit ? `${play.left.toFixed(1)} s` : 'out'}${play.settings.everlasting ? ' (endless)' : ''}${play.running ? '   running' : ''}${torch.lit ? `   radius ${torch.reach.toFixed(2)} m` : ''}`,
    `checkpoint ${['start', 'hub', 'cistern'][play.stage]}   caught ${play.caught}`,
    `levers [${tick(play.pulled.gas)}] gas  [${tick(play.pulled.water)}] water  [${tick(play.pulled.hub)}] hub   key [${tick(play.key)}]  chest [${tick(play.chest)}]`,
    `rats ${swarm.count}   step ${(play.report?.ms ?? 0).toFixed(1)} ms   ${fps.toFixed(0)} fps`,
  ].join('\n')
  followButton.textContent = settings.free ? 'follow: off (F)' : 'follow: on (F)'
  said.textContent = play.line()
  // His life, bottom left: full green, red as the rats wear it down.
  const life = Math.max(0, play.life)
  lifeFill.style.width = `${life * 100}%`
  lifeFill.style.background = life > 0.5 ? '#7fae7a' : life > 0.25 ? '#d0a24a' : '#c8503c'
  legend.style.display = settings.overlay && settings.legend ? 'block' : 'none'
  splitsEl.textContent = ['splits', ...splits.map(([name, t]) => `${name.padEnd(13)} ${Number.isNaN(t) ? 'skipped' : clock(t)}`)].join('\n')
  if (play.won) {
    end.style.display = 'block'
    end.textContent = `Out.\n\n${clock(play.t)} · caught ${play.caught}${play.chest ? ' · the secret found' : ''}\n\nR to start again`
  }
}

requestAnimationFrame(frame)
