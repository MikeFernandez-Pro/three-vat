// PROTOTYPE: the goose game in 2D, top-down (2026-10-24), `goose2d.html`: its
// route laid by hand and played, to place each scene, the pond and any dying
// light, and to time the run between them, before it is looked at in 3D.
//
// The page plays nothing itself: the goose play (gooseplay.ts) plays the route
// (plain.ts), and the page feeds it the keys and draws what it reports. E
// switches to editing: the play stops, every piece shows a handle, and
// dragging one moves it alone: the well apart from its brazier's place, the dead tree
// apart from its brazier, the cage, its campfire, its cart and the skull each
// on their own; Shift-dragging one carries its whole scene. Dragging the
// ground draws a box, as in a strategy game: every handle in it is selected,
// and dragging any of them moves them all together. The play starts again on
// the new route as it is let go.
//
// The old road (road.ts) shows as a band, the more of it left the
// stronger. Laid from the fires, it follows them as they move; laid by hand
// (the panel's "lay the road by hand"), it is edited on its own: in the road's
// edit, T or the panel, its points are the only handles, in their order along
// it, so nothing else moves with them: drag one to move the road,
// double-click by the road to add a point there, Delete takes out the points
// picked or the last one dragged. The panel saves the
// route over src/gooseroute.json through the dev server, and `#goose` plays
// it on its next load. Each leg is labelled with its length, the seconds it
// takes at her walk and the share of a full torch that burns over it.
//
// Three canvases, one over the other: the plan and its pieces; the rats, drawn
// instanced on WebGL 2 (rats2d.ts); and over them the dark, the goose, her
// goslings and the handles.
import GUI from 'three/examples/jsm/libs/lil-gui.module.min.js'
import { RAT_LENGTH, RAT_SIZE } from './gameplay'
import { CAGE, GoosePlay, LOG_RADIUS, TRUNK, WELL_RADIUS, cartMiddleOf, cartOf, type GooseSettings, type SceneState, type Zone } from './gooseplay'
import { ROUTE, toSave, type Brazier, type Point, type Route } from './plain'
import { defaultRoadShape, roadLine, roadPoints } from './road'
import { RatLayer } from './rats2d'
import { STEP } from './swarm-remote'

const TAU = Math.PI * 2

/** The route being laid: the saved one until edited. */
let route: Route = structuredClone(ROUTE)
/** The play's knobs the panel sets, carried into each play started again. */
const knobs: Partial<GooseSettings> & { rats: number; pace: number } = { rats: 2000, pace: 2 }
/** How long a full torch burns, s, and over how many of its last seconds its light shrinks to nothing, in a straight line. */
const torch = { seconds: 13, shrinks: 13 }
/** The road's way as the 3D page lays it to start; and how wide it is drawn, m, as the floor lays it (ground.ts, defaultRoadLook). */
const roadShape = defaultRoadShape()
const ROAD_WIDTH = 2.2
/** The road's point last dragged, for Delete: none yet. */
let roadPicked: Point | undefined
/** When she first came into the pond, s of the play: NaN, not yet. */
let pondAt = Number.NaN
let play = build()

/** A play on the route as it is laid now, from the start; the pieces the route leaves where the files have them pinned where they stand. */
function build(): GoosePlay {
  const p = new GoosePlay({ ...knobs, route })
  burn(p)
  pondAt = Number.NaN
  pin(p)
  return p
}

/** `p`'s torch burning as the panel sets it. */
function burn(p: GoosePlay): void {
  p.runTuning.burnRate = 1 / torch.seconds
  p.runTuning.fade = Math.min(1, torch.shrinks / torch.seconds)
}

/**
 * The dead tree's brazier and the cage's cart, where the route leaves them to the files, written into it where `p`
 * stands them, so each has a handle of its own and stays put as the rest of its scene moves.
 */
function pin(p: GoosePlay): void {
  for (const b of route.braziers) {
    const k = p.plain.braziers.findIndex((laid) => laid.x === b.x && laid.z === b.z && laid.scene === b.scene)
    const scene = p.scenes.find((s) => s.brazier === k)
    if (scene?.kind === 'tree' && !b.fire) b.fire = { ...scene.place }
    if (scene?.kind === 'cage' && !b.cart) {
      const m = cartMiddleOf(scene)
      b.cart = { x: scene.x + m.x, z: scene.z + m.z }
    }
  }
}

const planCanvas = document.querySelector<HTMLCanvasElement>('#plan')!
const topCanvas = document.querySelector<HTMLCanvasElement>('#top')!
const planCtx = planCanvas.getContext('2d')!
const topCtx = topCanvas.getContext('2d')!
let ctx = planCtx
const rats = new RatLayer(document.querySelector<HTMLCanvasElement>('#rats')!, play.swarm.capacity)
const hud = document.querySelector<HTMLDivElement>('#hud')!
const splitsEl = document.querySelector<HTMLDivElement>('#splits')!
const modeButton = document.querySelector<HTMLButtonElement>('#mode')!

const view = { x: play.holder.x, z: play.holder.z, scale: 14 }
/** `road`: editing the hand road alone, its points the only handles. */
const settings = { edit: false, road: false, dark: true, free: false, paused: false }
/** The dying light the panel edits, picked by a click on it. */
let picked: Brazier | undefined
/** A word for the page, and until when it shows, ms. */
let note = { text: '', until: 0 }

const INK = {
  ground: '#141a14',
  grid1: 'rgba(255,255,255,0.03)',
  grid5: 'rgba(255,255,255,0.07)',
  route: 'rgba(240,230,200,0.35)',
  road: '150,160,175',
  roadHandle: '#9fd0ff',
  label: 'rgba(235,240,230,0.85)',
  warn: '#ffb347',
  over: '#ff5a4a',
  water: '#1d5557',
  waterLine: '#3d8f8a',
  flame: '#ffb35a',
  stone: '#8d918c',
  wood: '#7a5a3a',
  iron: '#a7a39a',
  bone: '#e8e2d0',
  key: '#ffd84a',
  thunder: '#b9a4ff',
  dying: '#ff8a3a',
  zone: 'rgba(255,255,255,0.45)',
  gosling: '#ffe36a',
  goose: '#f4f1ea',
  handle: '#ffd27a',
  selected: '#78c8ff',
}
const RAT_BODY = RAT_LENGTH * 0.55 * Math.sqrt(RAT_SIZE)
const RAT_INK: [number, number, number] = [0x8a / 255, 0x7c / 255, 0x6e / 255]

// ---------------------------------------------------------------- the panel

const gui = new GUI({ title: 'goose route' })
const routeFolder = gui.addFolder('route')
routeFolder.add({ save }, 'save').name('save (to gooseroute.json)')
routeFolder.add({ copy: () => void navigator.clipboard?.writeText(routeJson()).then(() => say('route copied')) }, 'copy').name('copy as JSON')
routeFolder.add({ revert: () => ((route = structuredClone(ROUTE)), selected.clear(), pick(undefined), restart()) }, 'revert').name('back to the saved route')
routeFolder.add({ addDying }, 'addDying').name('add a dying light')
routeFolder.add({ handRoad }, 'handRoad').name('lay the road by hand (from the fires)')
routeFolder.add({ firesRoad }, 'firesRoad').name('road from the fires again')
routeFolder.add({ road: () => editRoad(!settings.road) }, 'road').name('edit the road alone (T)')
const torchFolder = gui.addFolder('her and her torch')
torchFolder.add(torch, 'seconds', 5, 60, 0.5).name('torch burns, s').onChange(() => burn(play))
torchFolder.add(torch, 'shrinks', 0.5, 60, 0.5).name('light shrinks over the last, s').onChange(() => burn(play))
torchFolder.add(knobs, 'pace', 0.5, 5, 0.1).name('walk, m/s').onChange(() => (play.settings.pace = knobs.pace))
torchFolder.add(knobs, 'rats', 0, 8000, 100).name('rats').onFinishChange(restart)
let dyingFolder: GUI | undefined

/** `b` picked for the panel's dying light folder, or none. */
function pick(b: Brazier | undefined): void {
  picked = b
  dyingFolder?.destroy()
  dyingFolder = undefined
  if (b?.dying === undefined) return
  dyingFolder = gui.addFolder('dying light (picked)')
  dyingFolder.add(b.dying, 'trigger', 0.5, 20, 0.1).name('starts within, m').onFinishChange(restart)
  dyingFolder.add(b.dying, 'after', 0, 30, 0.1).name('burns on, s').onFinishChange(restart)
  dyingFolder.add(b.dying, 'lasts', 0.1, 30, 0.1).name('dies over, s').onFinishChange(restart)
  dyingFolder.add(b, 'reach', 0.5, 8, 0.1).name('light reaches, m').onFinishChange(restart)
  dyingFolder.add({ remove: () => removeDying(b) }, 'remove').name('remove it')
}

/** A dying light at the middle of the view, its gosling beside it, picked. */
function addDying(): void {
  const b: Brazier = { x: view.x, z: view.z, reach: 3, gosling: { x: view.x + 1.3, z: view.z }, dying: { trigger: 6, after: 3, lasts: 4 } }
  route.braziers.push(b)
  pick(b)
  restart()
}

function removeDying(b: Brazier): void {
  route.braziers = route.braziers.filter((other) => other !== b)
  pick(undefined)
  restart()
}

/** The road laid by hand, its points where the fires lay it now, and edited alone. */
function handRoad(): void {
  route.road = roadPoints({ ...play.plain, road: undefined }, roadShape)
  editRoad(true)
}

/** The road edited alone, laid by hand first if it is not; or the route's edit again. */
function editRoad(on: boolean): void {
  if (on && !route.road) route.road = roadPoints({ ...play.plain, road: undefined }, roadShape)
  setEdit(true, on)
  if (on) say('editing the road alone: drag its points, double-click by it to add one, Delete to take one out, T to stop')
}

/** The hand road forgotten: laid from the fires again. */
function firesRoad(): void {
  delete route.road
  roadPicked = undefined
  if (settings.road) setEdit(true)
  say('the road is laid from the fires')
}

/** A point added to the hand road at `p`, in the leg it lies nearest, laying the road by hand first if it is not. */
function addRoadPoint(p: Point): void {
  if (!route.road) route.road = roadPoints({ ...play.plain, road: undefined }, roadShape)
  const road = route.road
  let best = 0
  let nearest = Infinity
  for (let k = 0; k + 1 < road.length; k++) {
    const a = road[k]!
    const b = road[k + 1]!
    const abx = b.x - a.x
    const abz = b.z - a.z
    const t = Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.z - a.z) * abz) / Math.max(abx * abx + abz * abz, 1e-9)))
    const d = Math.hypot(p.x - a.x - abx * t, p.z - a.z - abz * t)
    if (d < nearest) {
      nearest = d
      best = k
    }
  }
  const added = { ...p }
  road.splice(best + 1, 0, added)
  roadPicked = added
}

/** The hand road's points picked, or else the last one dragged, taken out: two are always left. */
function removeRoadPoints(): void {
  const road = route.road
  if (!road) return
  const going = road.filter((p) => selected.has(p) || (selected.size === 0 && p === roadPicked))
  if (going.length === 0) return
  if (road.length - going.length < 2) return say('a road keeps two points at least')
  route.road = road.filter((p) => !going.includes(p))
  for (const p of going) selected.delete(p)
  roadPicked = undefined
}

/** The route as saved: to the millimetre. */
function routeJson(): string {
  return JSON.stringify(toSave(route), (_, v: unknown) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v), 2)
}

/** The route written over gooseroute.json by the dev server: the page loads again on it. */
async function save(): Promise<void> {
  const response = await fetch('/goose-route', { method: 'POST', body: routeJson() }).catch(() => undefined)
  say(response?.ok ? 'route saved' : 'not saved: is this the dev server?')
}

function say(text: string): void {
  note = { text, until: performance.now() + 2500 }
}

function restart(): void {
  play = build()
}

// ---------------------------------------------------------------- the keys

// Keys by where they sit: ZQSD on AZERTY walks as WASD does.
const MOVE: Record<string, [number, number]> = { KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }
const pressed = new Set<string>()
addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement) return
  if (event.code in MOVE || event.code === 'Space') event.preventDefault()
  pressed.add(event.code)
  if (event.repeat) return
  if (event.code === 'KeyR') restart()
  else if (event.code === 'KeyP') settings.paused = !settings.paused
  else if (event.code === 'KeyE') setEdit(!settings.edit)
  else if (event.code === 'KeyT') editRoad(!settings.road)
  else if (event.code === 'KeyV') settings.dark = !settings.dark
  else if (event.code === 'KeyF') settings.free = false
  else if (/^Digit[1-5]$/.test(event.code)) standAt(Number(event.code.slice(5)))
  else if ((event.code === 'Delete' || event.code === 'Backspace') && settings.road) {
    event.preventDefault()
    removeRoadPoints()
  }
})

/** Her stood by the `n`th zone, 1 to 4 the scenes in the order she meets them, a step short of where she works each, 5 the pond's edge. */
function standAt(n: number): void {
  settings.free = false
  if (n <= 4) {
    const scene = [...play.scenes].sort((a, b) => a.brazier - b.brazier)[n - 1]
    if (scene) play.standBy(scene.kind)
    return
  }
  play.standByPond()
}
addEventListener('keyup', (event) => pressed.delete(event.code))
addEventListener('blur', () => pressed.clear())
modeButton.addEventListener('click', () => {
  setEdit(!settings.edit)
  modeButton.blur()
})

/** Editing the route or, `road`, the hand road alone; or playing. */
function setEdit(on: boolean, road = false): void {
  settings.edit = on
  settings.road = on && road
  modeButton.textContent = settings.road ? 'editing the road alone (T for the route, E to play)' : on ? 'editing the route (E to play)' : 'play (E to edit)'
  modeButton.classList.toggle('edit', on)
  selected.clear()
  if (!on) restart()
}

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

// ---------------------------------------------------------------- the handles

/** A piece of the route to drag: where it is, and moving it by (dx, dz), alone or, `whole`, with its scene's pieces. */
interface Handle {
  at: Point
  /** A scene's or a light's own handle; or one of its pieces. */
  main: boolean
  move: (dx: number, dz: number, whole: boolean) => void
  /** The points it carries when it moves in a selection, with every other selected handle's, each point once. */
  owns: Point[]
  /** The brazier it belongs to, if any. */
  brazier?: Brazier
  /** Whether it is a point of the hand road. */
  road?: boolean
}

const shift = (dx: number, dz: number, ...points: (Point | undefined)[]) => {
  for (const p of points) {
    if (!p) continue
    p.x += dx
    p.z += dz
  }
}

/** Every handle on the route as laid now: the pieces before the scenes' own, so a piece on top of its scene is found first. */
function handles(): Handle[] {
  const pieces: Handle[] = []
  const mains: Handle[] = [
    { at: route.start, main: true, owns: [route.start], move: (dx, dz) => shift(dx, dz, route.start) },
    { at: route.pond, main: true, owns: [route.pond], move: (dx, dz) => shift(dx, dz, route.pond) },
  ]
  // The hand road's points, the only handles while it is edited alone, and none otherwise: nothing else moves with them.
  const road: Handle[] = (route.road ?? []).map((p) => ({ at: p, main: false, road: true, owns: [p], move: (dx, dz) => shift(dx, dz, p) }))
  if (settings.road) return road
  for (const b of route.braziers) {
    const all = (dx: number, dz: number) => shift(dx, dz, b, b.gosling, b.skull, b.fire, b.cart, b.log?.near, b.log?.far)
    /** A piece moved alone, its `owns`, or, Shift held, its whole scene. */
    const piece = (at: Point, owns: (Point | undefined)[], main = false) => {
      const points = owns.filter((p) => p !== undefined)
      ;(main ? mains : pieces).push({ at, main, brazier: b, owns: points, move: (dx, dz, whole) => (whole ? all(dx, dz) : shift(dx, dz, ...points)) })
    }
    // A scene's gosling is always there: only a plain brazier may have none.
    const g = b.gosling!
    if (b.scene === 'well') {
      // The well where its gosling is; its brazier's place, unlit, where its lantern stood.
      piece(g, [g], true)
      piece(b, [b])
    } else if (b.scene === 'tree') {
      // The tree at the brazier's place and its gosling's; the brazier by it at its `fire`.
      piece(g, [b, g], true)
      if (b.fire) piece(b.fire, [b.fire])
    } else if (b.scene === 'cage') {
      piece(g, [g], true)
      piece(b, [b])
      piece(b.skull!, [b.skull])
      if (b.cart) piece(b.cart, [b.cart])
    } else if (b.scene === 'log') {
      const log = b.log!
      mains.push({ at: g, main: true, brazier: b, owns: [b, g, log.near, log.far], move: all })
      // Its far end turns it about its middle, its length kept, the brazier's place turning with it. In a selection it
      // carries nothing: the log moves with its middle.
      pieces.push({
        at: log.far,
        main: false,
        brazier: b,
        owns: [],
        move: (dx, dz) => {
          const m = g
          const was = Math.atan2(log.far.z - m.z, log.far.x - m.x)
          const now = Math.atan2(log.far.z + dz - m.z, log.far.x + dx - m.x)
          const half = Math.hypot(log.far.x - m.x, log.far.z - m.z)
          log.far = { x: m.x + Math.cos(now) * half, z: m.z + Math.sin(now) * half }
          log.near = { x: m.x - Math.cos(now) * half, z: m.z - Math.sin(now) * half }
          const turn = now - was
          const bx = b.x - m.x
          const bz = b.z - m.z
          b.x = m.x + bx * Math.cos(turn) - bz * Math.sin(turn)
          b.z = m.z + bx * Math.sin(turn) + bz * Math.cos(turn)
        },
      })
    } else {
      // A light carries its gosling, if it has one; its gosling moves alone.
      mains.push({ at: b, main: true, brazier: b, owns: [b, ...(b.gosling ? [b.gosling] : [])], move: all })
      const { gosling } = b
      if (gosling) pieces.push({ at: gosling, main: false, brazier: b, owns: [gosling], move: (dx, dz) => shift(dx, dz, gosling) })
    }
  }
  return [...pieces, ...mains]
}

/** The handles picked with the box, by the point each stands on. */
const selected = new Set<Point>()

/** The selection moved by (dx, dz): every point any selected handle carries, each once. */
function moveSelection(dx: number, dz: number): void {
  const points = new Set<Point>()
  for (const h of handles()) if (selected.has(h.at)) for (const p of h.owns) points.add(p)
  for (const p of points) shift(dx, dz, p)
}

// In edit, dragging a handle moves it, or the whole selection if it is in one; dragging the ground draws a box that
// selects every handle in it, a click there clearing the selection; the right or middle button pans. In play any
// drag pans. The wheel zooms toward the pointer.
let drag:
  | { kind: 'handle'; x: number; y: number; handle: Handle; whole: boolean; moved: boolean }
  | { kind: 'selection'; x: number; y: number; moved: boolean }
  | { kind: 'box'; x0: number; y0: number; x: number; y: number }
  | { kind: 'pan'; x: number; y: number }
  | undefined
const toPlan = (sx: number, sy: number): Point => ({ x: (sx - innerWidth / 2) / view.scale + view.x, z: (sy - innerHeight / 2) / view.scale + view.z })
planCanvas.addEventListener('contextmenu', (event) => event.preventDefault())
planCanvas.addEventListener('pointerdown', (event) => {
  const { clientX: x, clientY: y } = event
  planCanvas.setPointerCapture(event.pointerId)
  if (!settings.edit || event.button !== 0) {
    drag = { kind: 'pan', x, y }
    return
  }
  const p = toPlan(x, y)
  const handle = handles().find((h) => Math.hypot(h.at.x - p.x, h.at.z - p.z) * view.scale <= 10)
  if (!handle) {
    drag = { kind: 'box', x0: x, y0: y, x, y }
    return
  }
  if (handle.main) pick(handle.brazier?.dying ? handle.brazier : undefined)
  if (handle.road) roadPicked = handle.at
  if (selected.has(handle.at) && selected.size > 1) {
    drag = { kind: 'selection', x, y, moved: false }
    return
  }
  selected.clear()
  drag = { kind: 'handle', x, y, handle, whole: event.shiftKey, moved: false }
})
planCanvas.addEventListener('pointermove', (event) => {
  if (!drag) return
  const { clientX: x, clientY: y } = event
  if (drag.kind === 'box') {
    drag.x = x
    drag.y = y
    return
  }
  const dx = (x - drag.x) / view.scale
  const dz = (y - drag.y) / view.scale
  drag.x = x
  drag.y = y
  if (drag.kind === 'pan') {
    view.x -= dx
    view.z -= dz
    settings.free = true
    return
  }
  drag.moved = true
  if (drag.kind === 'handle') drag.handle.move(dx, dz, drag.whole)
  else moveSelection(dx, dz)
})
planCanvas.addEventListener('pointerup', () => {
  if (drag?.kind === 'box') {
    selected.clear()
    const [left, right] = [Math.min(drag.x0, drag.x), Math.max(drag.x0, drag.x)]
    const [top, bottom] = [Math.min(drag.y0, drag.y), Math.max(drag.y0, drag.y)]
    if (right - left > 3 || bottom - top > 3) {
      for (const h of handles()) {
        const hx = sx(h.at.x)
        const hy = sz(h.at.z)
        if (hx >= left && hx <= right && hy >= top && hy <= bottom) selected.add(h.at)
      }
    }
  } else if ((drag?.kind === 'handle' || drag?.kind === 'selection') && drag.moved) restart()
  drag = undefined
})
// In edit, a double-click by the road adds a point to it there.
planCanvas.addEventListener('dblclick', (event) => {
  if (!settings.road) return
  const p = toPlan(event.clientX, event.clientY)
  // Not on a handle: that was a click on it twice.
  if (handles().some((h) => Math.hypot(h.at.x - p.x, h.at.z - p.z) * view.scale <= 10)) return
  addRoadPoint(p)
})
planCanvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault()
    const before = toPlan(event.clientX, event.clientY)
    view.scale = Math.min(120, Math.max(3, view.scale * Math.exp(-event.deltaY * 0.0015)))
    const after = toPlan(event.clientX, event.clientY)
    view.x += before.x - after.x
    view.z += before.z - after.z
  },
  { passive: false },
)

// ---------------------------------------------------------------- the frame

let last = performance.now()
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  if (!settings.paused && !settings.edit) {
    // Two steps a frame at most: a slow frame slows the play rather than piling more steps on the next.
    let left = Math.min(dt, 2 * STEP)
    while (left > 1e-6) {
      const step = Math.min(left, STEP)
      play.frame(step, { heading: heading(), interact: pressed.has('Space') })
      left -= step
    }
    const { pond } = play.plain
    if (Number.isNaN(pondAt) && Math.hypot(play.holder.x - pond.x, play.holder.z - pond.z) <= pond.radius) pondAt = play.t
  }
  if (!settings.free && !settings.edit) {
    view.x = play.holder.x
    view.z = play.holder.z
  }
  draw()
  requestAnimationFrame(frame)
}

// ---------------------------------------------------------------- drawing

const sx = (x: number) => (x - view.x) * view.scale + innerWidth / 2
const sz = (z: number) => (z - view.z) * view.scale + innerHeight / 2

function draw(): void {
  const dpr = devicePixelRatio || 1
  const w = innerWidth
  const h = innerHeight
  if (planCanvas.width !== Math.round(w * dpr) || planCanvas.height !== Math.round(h * dpr)) {
    planCanvas.width = topCanvas.width = Math.round(w * dpr)
    planCanvas.height = topCanvas.height = Math.round(h * dpr)
  }
  ctx = planCtx
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = INK.ground
  ctx.fillRect(0, 0, w, h)
  drawGrid(w, h)
  drawRoad()
  drawPond()
  drawLights()
  drawScenes()
  drawLegs()
  rats.draw(play.swarm, view, { width: w, height: h, dpr }, { length: RAT_BODY, width: RAT_BODY * 0.4, least: 0.6 }, RAT_INK)
  ctx = topCtx
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  if (settings.dark && !settings.edit) drawDark(w, h)
  drawGoslings()
  drawGoose()
  if (settings.edit) drawHandles()
  drawHud()
}

function drawGrid(w: number, h: number): void {
  const lines = (step: number, ink: string) => {
    ctx.strokeStyle = ink
    ctx.lineWidth = 1
    ctx.beginPath()
    const x0 = Math.floor(toPlan(0, 0).x / step) * step
    const z0 = Math.floor(toPlan(0, 0).z / step) * step
    for (let x = x0; sx(x) < w; x += step) {
      ctx.moveTo(sx(x), 0)
      ctx.lineTo(sx(x), h)
    }
    for (let z = z0; sz(z) < h; z += step) {
      ctx.moveTo(0, sz(z))
      ctx.lineTo(w, sz(z))
    }
    ctx.stroke()
  }
  if (view.scale > 12) lines(1, INK.grid1)
  lines(5, INK.grid5)
}

function circle(p: Point, r: number): void {
  ctx.beginPath()
  ctx.arc(sx(p.x), sz(p.z), Math.max(0.5, r * view.scale), 0, TAU)
}

function ellipse(zone: Zone): void {
  ctx.beginPath()
  ctx.ellipse(sx(zone.x), sz(zone.z), zone.rx * view.scale, zone.rz * view.scale, 0, 0, TAU)
}

function label(text: string, p: Point, ink = INK.label, dy = 0): void {
  ctx.font = '11px ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(0,0,0,0.6)'
  const width = ctx.measureText(text).width
  ctx.fillRect(sx(p.x) - width / 2 - 3, sz(p.z) + dy - 9, width + 6, 13)
  ctx.fillStyle = ink
  ctx.fillText(text, sx(p.x), sz(p.z) + dy + 1)
}

/** The road as the 3D page lays it: a band, the stronger the more of it is left; laid by hand, in edit, the line through its points. */
function drawRoad(): void {
  const { points } = roadLine({ ...play.plain, road: route.road }, roadShape)
  ctx.lineWidth = ROAD_WIDTH * view.scale
  ctx.lineCap = 'butt'
  for (let k = 0; k + 1 < points.length; k++) {
    const a = points[k]!
    const b = points[k + 1]!
    ctx.strokeStyle = `rgba(${INK.road},${(0.06 + 0.3 * (a.left + b.left)) / 2 + 0.03})`
    ctx.beginPath()
    ctx.moveTo(sx(a.x), sz(a.z))
    ctx.lineTo(sx(b.x), sz(b.z))
    ctx.stroke()
  }
  if (!settings.road || !route.road) return
  ctx.setLineDash([2, 4])
  ctx.strokeStyle = INK.roadHandle
  ctx.lineWidth = 1
  ctx.beginPath()
  route.road.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, sx(p.x), sz(p.z)))
  ctx.stroke()
  ctx.setLineDash([])
}

function drawPond(): void {
  const { pond, home } = play.plain
  circle(pond, pond.radius)
  ctx.fillStyle = INK.water
  ctx.fill()
  ctx.strokeStyle = INK.waterLine
  ctx.lineWidth = 2
  ctx.stroke()
  circle(home, 0.15)
  ctx.fillStyle = INK.waterLine
  ctx.fill()
  label('pond', pond)
}

function drawLights(): void {
  const { lights } = play.level
  lights.forEach((light, k) => {
    const b = play.plain.braziers[k]
    if (light.on && light.reach > 0) {
      const g = ctx.createRadialGradient(sx(light.x), sz(light.z), 0, sx(light.x), sz(light.z), light.reach * view.scale)
      g.addColorStop(0, 'rgba(255,190,110,0.32)')
      g.addColorStop(1, 'rgba(255,170,90,0.06)')
      circle(light, light.reach)
      ctx.fillStyle = g
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,190,110,0.5)'
      ctx.lineWidth = 1
      ctx.stroke()
    } else {
      circle(light, b?.reach ?? 3)
      ctx.setLineDash([3, 4])
      ctx.strokeStyle = 'rgba(255,190,110,0.25)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.setLineDash([])
    }
    if (light.flame) {
      circle(light, 0.18)
      ctx.fillStyle = light.on ? INK.flame : '#4a3a2a'
      ctx.fill()
    }
    if (b?.dying) drawDying(b, k)
  })
}

function drawDying(b: Brazier, k: number): void {
  const { trigger, after, lasts } = b.dying!
  circle(b, trigger)
  ctx.setLineDash([6, 5])
  ctx.strokeStyle = b === pickedOf() ? INK.handle : INK.dying
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.setLineDash([])
  label(`dying light: ${dyingState(k)}`, b, INK.dying, -b.reach * view.scale - 8)
  label(`starts within ${trigger} m · burns ${after} s · dies over ${lasts} s`, b, INK.dying, -b.reach * view.scale + 7)
}

/** The picked dying light as the play has it: picked is the route's, the play holds a copy. */
function pickedOf(): Brazier | undefined {
  if (!picked) return undefined
  return play.plain.braziers.find((b) => b.x === picked!.x && b.z === picked!.z)
}

function dyingState(k: number): string {
  const b = play.plain.braziers[k]!
  const at = play.dyingAt[k]!
  if (Number.isNaN(at)) return 'waiting for her'
  const since = play.t - at
  if (since < b.dying!.after) return `dies in ${(b.dying!.after - since).toFixed(1)} s`
  const light = play.level.lights[k]!
  return light.on ? `dying, ${Math.round((light.reach / b.reach) * 100)}%` : 'out'
}

function drawScenes(): void {
  for (const scene of play.scenes) drawScene(scene)
}

function drawScene(scene: SceneState): void {
  ctx.lineWidth = 1.5
  if (scene.kind === 'well') {
    circle(scene, WELL_RADIUS)
    ctx.fillStyle = '#2a2e2c'
    ctx.fill()
    ctx.strokeStyle = INK.stone
    ctx.stroke()
    label(scene.wound > 0 && scene.wound < 1 ? `well ${Math.round(scene.wound * 100)}%` : 'well', scene, INK.label, WELL_RADIUS * view.scale + 12)
    zone(play.zoneOf(scene))
  } else if (scene.kind === 'tree') {
    circle(scene, 1.4)
    ctx.fillStyle = 'rgba(90,70,50,0.25)'
    ctx.fill()
    circle(scene, TRUNK)
    ctx.fillStyle = INK.wood
    ctx.fill()
    label('dead tree', scene, INK.label, 1.4 * view.scale + 10)
    zone(play.zoneOf(scene))
    zone(play.fireZoneOf(scene))
  } else if (scene.kind === 'cage') {
    if (!scene.open) {
      ctx.strokeStyle = INK.iron
      ctx.strokeRect(sx(scene.x - CAGE), sz(scene.z - CAGE), 2 * CAGE * view.scale, 2 * CAGE * view.scale)
    }
    ctx.beginPath()
    cartOf(scene).forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, sx(scene.x + p.x), sz(scene.z + p.z)))
    ctx.closePath()
    ctx.strokeStyle = INK.wood
    ctx.stroke()
    circle(scene.skull, 0.15)
    ctx.fillStyle = INK.bone
    ctx.fill()
    if (!scene.carried && !scene.open) {
      circle(scene.key, 0.1)
      ctx.fillStyle = INK.key
      ctx.fill()
    }
    label(scene.open ? 'cage, open' : scene.carried ? 'cage, key carried' : 'cage', scene, INK.label, CAGE * view.scale + 14)
    label('skull', scene.skull, INK.bone, 14)
    zone(play.zoneOf(scene))
    zone(play.keyZoneOf(scene))
    zone(play.fireZoneOf(scene))
  } else {
    const { near, far } = scene.ends
    ctx.strokeStyle = Number.isNaN(scene.litAt) ? INK.wood : '#c0602a'
    ctx.lineWidth = 2 * LOG_RADIUS * view.scale
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(sx(near.x), sz(near.z))
    ctx.lineTo(sx(far.x), sz(far.z))
    ctx.stroke()
    ctx.lineCap = 'butt'
    ctx.lineWidth = 1.5
    const strike = play.strikeZoneOf(scene)
    ellipse(strike)
    ctx.setLineDash([2, 5])
    ctx.strokeStyle = INK.thunder
    ctx.stroke()
    ctx.setLineDash([])
    label(Number.isNaN(scene.litAt) ? 'hollow log' : 'hollow log, struck', scene, INK.label, LOG_RADIUS * view.scale + 14)
    label('thunder', { x: strike.x, z: strike.z - strike.rz }, INK.thunder, 12)
    zone(play.zoneOf(scene))
    if (!Number.isNaN(scene.litAt)) zone(play.fireZoneOf(scene))
  }
}

/** A zone where the interact key works, dashed. */
function zone(z: Zone): void {
  ellipse(z)
  ctx.setLineDash([3, 3])
  ctx.strokeStyle = INK.zone
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.setLineDash([])
}

/**
 * The route's legs, from fire to fire, where she fills her torch: the start, the well's fire pit, the dead tree's
 * brazier, the cage's campfire, any other brazier or dying light; the hollow log itself, its fire unlit till she comes;
 * and the pond's edge. Each labelled with its length, its time at her walk and the torch it burns.
 */
function drawLegs(): void {
  const { start, braziers, pond } = play.plain
  const fires: Point[] = braziers.map((_, k) => {
    const scene = play.scenes.find((s) => s.brazier === k)
    if (scene?.kind === 'tree') return scene.fire
    if (scene?.kind === 'log') return scene
    const pit = play.wellFires.find((f) => f.brazier === k)
    return play.level.lights[pit ? pit.light : k]!
  })
  // The pond's edge, on the side toward the last stop before it.
  const last = fires.at(-1) ?? start
  const away = Math.hypot(last.x - pond.x, last.z - pond.z) || 1
  const edge = { x: pond.x + ((last.x - pond.x) / away) * pond.radius, z: pond.z + ((last.z - pond.z) / away) * pond.radius }
  const stops: Point[] = [start, ...fires, edge]
  ctx.setLineDash([8, 6])
  ctx.strokeStyle = INK.route
  ctx.lineWidth = 1.5
  ctx.beginPath()
  stops.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, sx(p.x), sz(p.z)))
  ctx.stroke()
  ctx.setLineDash([])
  for (let k = 1; k < stops.length; k++) {
    const a = stops[k - 1]!
    const b = stops[k]!
    const d = Math.hypot(b.x - a.x, b.z - a.z)
    const seconds = d / play.settings.pace
    const share = seconds / torch.seconds
    const ink = share > 1 ? INK.over : share > 0.75 ? INK.warn : INK.label
    label(`${d.toFixed(1)} m · ${seconds.toFixed(1)} s · ${Math.round(share * 100)}% torch`, { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, ink)
  }
}

/** The dark over all but the lights and her torch. */
function drawDark(w: number, h: number): void {
  ctx.fillStyle = 'rgba(4,6,5,0.78)'
  ctx.fillRect(0, 0, w, h)
  ctx.globalCompositeOperation = 'destination-out'
  const hole = (p: Point, r: number) => {
    const g = ctx.createRadialGradient(sx(p.x), sz(p.z), 0, sx(p.x), sz(p.z), r * view.scale)
    g.addColorStop(0.7, 'rgba(0,0,0,1)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    circle(p, r)
    ctx.fill()
  }
  for (const light of play.level.lights) if (light.on && light.reach > 0) hole(light, light.reach)
  const { torch: t } = play.run
  if (t.lit) hole(t, t.reach)
  hole(play.plain.pond, play.plain.pond.radius * 0.4)
  ctx.globalCompositeOperation = 'source-over'
}

function drawGoslings(): void {
  for (const g of play.goslings) {
    if (!g) continue
    circle(g, 0.14)
    ctx.fillStyle = INK.gosling
    ctx.fill()
    if (g.state === 'waiting') {
      circle(g, 0.32)
      ctx.strokeStyle = INK.gosling
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }
}

function drawGoose(): void {
  const { holder, facing } = play
  const t = play.run.torch
  if (t.lit) {
    circle(t, t.reach)
    ctx.strokeStyle = 'rgba(255,190,110,0.7)'
    ctx.lineWidth = 1
    ctx.stroke()
  }
  circle(holder, 0.3)
  ctx.fillStyle = INK.goose
  ctx.fill()
  ctx.strokeStyle = INK.flame
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(sx(holder.x), sz(holder.z))
  ctx.lineTo(sx(holder.x + facing.x * 0.55), sz(holder.z + facing.z * 0.55))
  ctx.stroke()
}

function drawHandles(): void {
  for (const h of handles()) {
    if (h.road) {
      // A road point: a diamond, the last dragged white.
      const isSelected = selected.has(h.at)
      ctx.beginPath()
      ctx.moveTo(sx(h.at.x), sz(h.at.z) - 6)
      ctx.lineTo(sx(h.at.x) + 6, sz(h.at.z))
      ctx.lineTo(sx(h.at.x), sz(h.at.z) + 6)
      ctx.lineTo(sx(h.at.x) - 6, sz(h.at.z))
      ctx.closePath()
      ctx.fillStyle = h.at === roadPicked ? '#fff' : INK.roadHandle
      ctx.fill()
      ctx.strokeStyle = isSelected ? INK.selected : '#000'
      ctx.lineWidth = isSelected ? 2.5 : 1
      ctx.stroke()
      continue
    }
    const size = h.main ? 6 : 4
    const isPicked = h.main && h.brazier !== undefined && h.brazier === picked
    const isSelected = selected.has(h.at)
    ctx.fillStyle = isPicked ? '#fff' : h.main ? INK.handle : 'rgba(255,210,122,0.6)'
    ctx.strokeStyle = isSelected ? INK.selected : '#000'
    ctx.lineWidth = isSelected ? 2.5 : 1
    ctx.fillRect(sx(h.at.x) - size, sz(h.at.z) - size, size * 2, size * 2)
    ctx.strokeRect(sx(h.at.x) - size, sz(h.at.z) - size, size * 2, size * 2)
  }
  if (drag?.kind === 'box') {
    ctx.fillStyle = 'rgba(120,200,255,0.08)'
    ctx.strokeStyle = INK.selected
    ctx.lineWidth = 1
    const x = Math.min(drag.x0, drag.x)
    const y = Math.min(drag.y0, drag.y)
    ctx.fillRect(x, y, Math.abs(drag.x - drag.x0), Math.abs(drag.y - drag.y0))
    ctx.strokeRect(x, y, Math.abs(drag.x - drag.x0), Math.abs(drag.y - drag.y0))
  }
  label('start', route.start, INK.label, 18)
}

function drawHud(): void {
  const circleCount = play.goslings.filter((g) => g?.state === 'circle').length
  const lines = [
    `${settings.edit ? 'EDITING' : settings.paused ? 'PAUSED' : 'playing'}   t ${play.t.toFixed(1)} s   at ${play.holder.x.toFixed(1)}, ${play.holder.z.toFixed(1)}`,
    `torch ${play.run.torch.lit ? `${play.left.toFixed(1)} s left` : 'OUT'}   (a full torch ${torch.seconds} s)`,
    `goslings ${circleCount} / ${play.goslings.filter((g) => g).length}`,
    ...(play.atRefill ? ['Space: fill the torch'] : []),
    ...(play.scenes.some((s) => s.near) ? ['Space: work the scene'] : []),
  ]
  if (performance.now() < note.until) lines.push('', note.text)
  hud.textContent = lines.join('\n')
  // Each moment of the run, from the start.
  const splits: [string, number][] = []
  play.plain.braziers.forEach((b, k) => {
    const g = play.goslings[k]
    if (g && !Number.isNaN(g.gatheredAt)) splits.push([`gosling: ${b.scene ?? (b.dying ? 'dying light' : 'brazier')}`, g.gatheredAt])
    if (b.dying && !Number.isNaN(play.dyingAt[k]!)) splits.push(['dying light starts', play.dyingAt[k]!])
  })
  for (const s of play.scenes) if (s.kind === 'log' && !Number.isNaN(s.litAt)) splits.push(['thunder strikes', s.litAt])
  if (!Number.isNaN(pondAt)) splits.push(['pond', pondAt])
  splits.sort((a, b) => a[1] - b[1])
  splitsEl.textContent = splits.map(([what, t]) => `${what}  ${t.toFixed(1)} s`).join('\n')
}

requestAnimationFrame(frame)
