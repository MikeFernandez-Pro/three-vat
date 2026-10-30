// Trial, `?marker`: the calling gosling's badge, there all the time it calls,
// not just as it honks. The gosling painted, in a ring drawn in the game's own
// hand, as its words are, in their cream ink, the ring boiling a little as a
// drawing's line does; or, with `?marker=doodle`, the gosling itself doodled
// in that ink. A drawn arrow beside it. Out of view it sits at the screen's edge on its side, the arrow
// pointing out to it, the doodle facing that way, the painted gosling always as
// painted; in view it hangs over the
// gosling's head, smaller, bobbing, the arrow pointing down at it, and stays
// there, quiet once it has seen her, till she has it. Each honk pops and tilts
// it a little; the honk's word, small, as said, is written over the gosling
// itself, in view, never by the badge.
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js'
import type { CallAt } from './callhint'

/** The gosling, painted whole (from a ChatGPT image, 2026-10-29), facing right, on nothing. */
const PORTRAIT = `${import.meta.env.BASE_URL}ui/gosling-badge.webp`
/**
 * How the portrait is framed, as its panel sets it (`mountBadgeControls`): how far in it is zoomed, 1 the whole
 * picture across the badge; the point of the picture at the badge's middle, 0 to 1 across and down; as set from the
 * panel on 2026-10-29.
 */
export const portraitLook = { zoom: 1.62, x: 0.53, y: 0.26 }
/**
 * The colours behind each gosling's portrait, at its middle and at its edge, one gosling's from
 * another's at a glance, as set from the panel on 2026-10-29. More goslings than these go round
 * them again.
 */
export const kidBackgrounds = [
  { middle: '#8861a8', edge: '#1f1529' },
  { middle: '#55a5af', edge: '#394e51' },
  { middle: '#ae1e33', edge: '#62273a' },
  { middle: '#9acc85', edge: '#2c4d1f' },
  { middle: '#feab3e', edge: '#b17943' },
  { middle: '#3d5c9e', edge: '#111a2e' },
]
/** The portrait's background, as `portraitLook` frames it now, behind gosling `kid`. */
function framed(kid: number): string {
  const { zoom, x, y } = portraitLook
  const { middle, edge } = kidBackgrounds[kid % kidBackgrounds.length]!
  const across = SIZE * zoom
  return `url(${PORTRAIT}) ${SIZE / 2 - x * across}px ${SIZE / 2 - y * across}px / ${across}px ${across}px no-repeat, radial-gradient(circle, ${middle} 0%, ${edge} 100%)`
}
/** How the badge is drawn: the painted head in a ring, or the doodle. */
export type BadgeLook = 'portrait' | 'doodle'
/** How thick the ring's line is, px. */
const RING = 3.5
/** Its ink, as the words'; the beak in the hold key's amber; the eye and the wing's line. */
const INK = '#f6ead0'
const BEAK = '#e9a23b'
const EYE = '#2a2230'
const WING = '#cdbb98'
/** Its shadow, as the words'. */
const SHADOW = 'drop-shadow(0 2px 4px #000c)'
/** How wide the doodle is, px; how big it all is in view, of that; how high its middle hangs over the gosling's head in view, px. */
const SIZE = 64
const IN_VIEW = 0.62
const LIFT = 50
/** How far the arrow stands off its middle, px. */
const ARROW_OFF = 46
/** How far it bobs in view, px, and how fast, rad/s. */
const BOB = 3
const BOB_RATE = 2.4
/** How many drawings of it it boils through, and how many a second. */
const BOILS = 3
const BOIL_RATE = 7
/** How long it takes to show or hide, s; to go from the edge to over the gosling, s. */
const FADE = 0.3
const SETTLE = 0.2
/** How long a honk's pop lasts, s; how much it grows and tilts at its height, degrees. */
const POP = 0.3
const POP_GROW = 0.14
const POP_TILT = 8

/** A seeded random in 0..1. */
function seeded(seed: number) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

/** A closed blob round (cx, cy), `n` points on the ellipse each pushed in or out up to `wobble`, smoothed. */
function blob(cx: number, cy: number, rx: number, ry: number, n: number, wobble: number, rand: () => number): string {
  const points = Array.from({ length: n }, (_, k) => {
    const a = (k / n) * Math.PI * 2 + (rand() - 0.5) * 0.25
    const w = 1 + ((rand() - 0.5) * 2 * wobble) / Math.max(rx, ry)
    return [cx + Math.cos(a) * rx * w, cy + Math.sin(a) * ry * w] as const
  })
  const mid = (p: readonly [number, number], q: readonly [number, number]) => `${((p[0] + q[0]) / 2).toFixed(1)} ${((p[1] + q[1]) / 2).toFixed(1)}`
  let d = `M${mid(points[n - 1]!, points[0]!)}`
  points.forEach((p, k) => (d += ` Q${p[0].toFixed(1)} ${p[1].toFixed(1)} ${mid(p, points[(k + 1) % n]!)}`))
  return `${d}Z`
}

/** One drawing of the gosling, round and fluffy, facing left, its lines a little off where `seed` puts them. */
function gosling(seed: number): string {
  const rand = seeded(seed)
  const j = (v: number, by = 1) => (v + (rand() - 0.5) * 2 * by).toFixed(1)
  return `<svg viewBox="0 0 64 56" width="${SIZE}" height="${(SIZE * 56) / 64}" style="position:absolute;left:${-SIZE / 2}px;top:${(-SIZE * 28) / 64}px;overflow:visible">
<path d="${blob(36, 37, 18, 14.5, 14, 1.9, rand)}" fill="${INK}"/>
<path d="${blob(22, 20, 11, 10.5, 9, 1, rand)}" fill="${INK}"/>
<path d="M${j(19)} ${j(11)} Q${j(21)} ${j(3)} ${j(26)} ${j(8)}" stroke="${INK}" stroke-width="3.2" stroke-linecap="round" fill="none"/>
<path d="M${j(12.5, 0.6)} ${j(17, 0.6)} L${j(3, 0.8)} ${j(21.5, 0.8)} L${j(12.5, 0.6)} ${j(25, 0.6)}Z" fill="${BEAK}" stroke="${BEAK}" stroke-width="1.5" stroke-linejoin="round"/>
<circle cx="${j(18.5, 0.3)}" cy="${j(18, 0.3)}" r="2.2" fill="${EYE}"/>
<path d="M${j(29)} ${j(34)} Q${j(38)} ${j(44)} ${j(47)} ${j(34)}" stroke="${WING}" stroke-width="2.4" stroke-linecap="round" fill="none"/>
</svg>`
}

/** One drawing of the portrait's ring, its line a little off where `seed` puts it. */
function ring(seed: number): string {
  const r = SIZE / 2
  const reach = r + RING * 2
  return `<svg viewBox="${-reach} ${-reach} ${reach * 2} ${reach * 2}" width="${reach * 2}" height="${reach * 2}" style="position:absolute;left:${-reach}px;top:${-reach}px;overflow:visible">
<path d="${blob(0, 0, r - 0.5, r - 0.5, 12, 1, seeded(seed))}" stroke="${INK}" stroke-width="${RING}" fill="none"/>
</svg>`
}

/** One drawing of the arrow, pointing right, its stroke a little off where `seed` puts it. */
function arrow(seed: number): string {
  const rand = seeded(seed)
  const j = (v: number) => (v + (rand() - 0.5) * 1.6).toFixed(1)
  return `<svg viewBox="-12 -12 24 24" width="24" height="24" style="position:absolute;left:${ARROW_OFF - 12}px;top:-12px;overflow:visible">
<path d="M${j(-5)} ${j(-8)} Q${j(1)} ${j(-3)} ${j(6)} ${j(0)} Q${j(1)} ${j(3)} ${j(-5)} ${j(8)}" stroke="${INK}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`
}

export interface GoslingBadge {
  /**
   * One frame, `dt` s on: the calling gosling's head at `at` on the page (`callAt`'s answer), the badge showing
   * `shown` of the way, 0 to 1, `kid` which gosling it is, for its background; or nothing calling. Where its honks
   * pop from, px.
   */
  update(at: CallAt | null, shown: number, dt: number, kid?: number): { x: number; y: number }
  /** A honk from it: the badge pops. */
  pop(): void
}

export function createGoslingBadge(look: BadgeLook = 'portrait'): GoslingBadge {
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;opacity:0'
  const turn = document.createElement('div')
  turn.style.cssText = `position:absolute;left:0;top:0;width:0;height:0;filter:${SHADOW}`
  const body = document.createElement('div')
  body.style.cssText = `position:absolute;left:0;top:0;width:0;height:0;filter:${SHADOW}`
  let portrait: HTMLDivElement | undefined
  let frame = ''
  if (look === 'portrait') {
    const head = document.createElement('div')
    head.style.cssText = `position:absolute;left:${-SIZE / 2}px;top:${-SIZE / 2}px;width:${SIZE}px;height:${SIZE}px;border-radius:50%`
    body.append(head)
    portrait = head
  }
  // Its drawings, one showing at a time.
  const drawings: HTMLDivElement[] = []
  const arrows: HTMLDivElement[] = []
  for (let k = 0; k < BOILS; k++) {
    const drawing = document.createElement('div')
    drawing.innerHTML = look === 'portrait' ? ring(11 + k * 7919) : gosling(11 + k * 7919)
    body.append(drawing)
    drawings.push(drawing)
    const drawn = document.createElement('div')
    drawn.innerHTML = arrow(23 + k * 104729)
    turn.append(drawn)
    arrows.push(drawn)
  }
  box.append(turn, body)
  document.body.append(box)

  let opacity = 0
  let inView = 0
  let popped = POP
  let popSide = 1
  let clock = 0
  let boil = -1
  let x = 0
  let y = 0
  let way = Math.PI / 2
  let facing = 1
  let shownKid = 0
  return {
    update(at, shown, dt, kid) {
      clock += dt
      popped += dt
      opacity += ((at ? shown : 0) - opacity) * Math.min(1, dt / FADE)
      if (at) {
        inView += ((at.out ? 0 : 1) - inView) * (1 - Math.exp(-dt / SETTLE))
        x = at.x
        y = at.y
        if (kid !== undefined) shownKid = kid
        way = at.out ? Math.atan2(at.out.y, at.out.x) : Math.PI / 2
        // The doodle, facing left, turns to face its gosling; the portrait faces right whichever side it is on.
        if (look === 'doodle' && at.out && Math.abs(at.out.x) > 0.2) facing = at.out.x > 0 ? -1 : 1
      }
      const drawn = Math.floor(clock * BOIL_RATE) % BOILS
      if (drawn !== boil) {
        boil = drawn
        drawings.forEach((d, k) => (d.style.display = k === drawn ? '' : 'none'))
        arrows.forEach((d, k) => (d.style.display = k === drawn ? '' : 'none'))
      }
      if (portrait && frame !== framed(shownKid)) portrait.style.background = frame = framed(shownKid)
      const popping = popped < POP ? Math.sin((Math.PI * popped) / POP) : 0
      const scale = (1 + (IN_VIEW - 1) * inView) * (1 + POP_GROW * popping)
      const middle = { x, y: y - (LIFT + BOB * Math.sin(clock * BOB_RATE)) * inView }
      box.style.opacity = String(opacity)
      box.style.transform = `translate(${middle.x}px, ${middle.y}px) scale(${scale})`
      body.style.transform = `rotate(${popSide * POP_TILT * popping}deg) scaleX(${facing})`
      turn.style.transform = `rotate(${way}rad)`
      return { x: middle.x, y: middle.y - (SIZE / 2) * scale }
    },
    pop() {
      popped = 0
      popSide = Math.random() < 0.5 ? -1 : 1
    },
  }
}

/** The portrait's panel, at the foot of the page by the other trials': its zoom, the point at its middle, each gosling's background. */
export function mountBadgeControls(): void {
  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;bottom:8px;left:780px;z-index:1000'
  document.body.append(container)
  const gui = new GUI({ title: 'gosling badge (prototype)', container, width: 240 } as ConstructorParameters<typeof GUI>[0])
  gui.add(portraitLook, 'zoom', 0.5, 5, 0.01).name('zoom')
  gui.add(portraitLook, 'x', 0, 1, 0.005).name('offset x')
  gui.add(portraitLook, 'y', 0, 1, 0.005).name('offset y')
  kidBackgrounds.forEach((colours, k) => {
    gui.addColor(colours, 'middle').name(`gosling ${k + 1}, middle`)
    gui.addColor(colours, 'edge').name(`gosling ${k + 1}, edge`)
  })
  gui.close()
}
