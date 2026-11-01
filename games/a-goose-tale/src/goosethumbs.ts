// A Goose Tale's touch screen on the page (#198): the shell round the touch
// core (goosetouch.ts), which the controls hold. It hears the pointer events of
// touch type and keeps them for the controls' next frame, a contact landing on
// a button left to the button; lets every contact go on a cancel, the page
// losing focus or hidden, and when the game asks (it pauses); keeps the page
// from scrolling, zooming, selecting or opening a menu under the thumbs; and
// draws them in the hints' ink while they are down: the stick's ring where it
// landed with its knob under the thumb, and a ring under the right thumb. On
// the first play, a faint stick and ring where the thumbs go, each fading for
// good once its thumb has landed while it shows.

import { INK } from './holdhint'
import { STICK_REACH, type TouchContact, type TouchReading } from './goosetouch'

/** The knob's width, px: the hold hint's round button's. */
const KNOB = 46
/** The ring under the right thumb, px across: wider than a thumb, so it shows round it. */
const RING = 76
/** Where the first play's hint stands for each thumb, a share of the screen across and down from its top left; and how faint. */
const HINT_STICK = { x: 0.2, y: 0.72 }
const HINT_RING = { x: 0.8, y: 0.72 }
const HINT_FAINT = 0.35
/** How fast the hint fades, s. */
const HINT_FADE = 0.6
/** What a contact landing on belongs to, never a thumb. */
const BUTTONS = 'button, a, input, select, textarea, label'

export interface Thumbs {
  /** The contacts since the last take, in the order they came, and whether a touch landed on a button: then forgotten. */
  take(): { touches: TouchContact[]; tapped: boolean }
  /** Every contact down let go, as cancelled, at the next take. */
  letGo(): void
  /**
   * The thumbs drawn as `reading` has them while `shown`, else none; the first play's hint while `hinted`, each half of
   * it gone for good once its thumb has landed while it shows.
   */
  draw(reading: TouchReading, shown: boolean, hinted: boolean): void
}

/** A ring `size` px across, centred on where it is put, in the hints' ink; filled faintly with `fill`. */
function ring(size: number, fill: string): HTMLDivElement {
  const element = document.createElement('div')
  element.style.cssText = `position:fixed;left:0;top:0;width:${size}px;height:${size}px;box-sizing:border-box;margin:${-size / 2}px 0 0 ${-size / 2}px;border:3px solid ${INK};border-radius:50%;background:${fill};box-shadow:0 2px 4px #000c;pointer-events:none;z-index:6;display:none`
  document.body.append(element)
  return element
}

/** `element` shown centred at (x, y) on the page, px, or hidden. */
function place(element: HTMLElement, at: { x: number; y: number } | null) {
  element.style.display = at ? '' : 'none'
  if (at) element.style.transform = `translate(${at.x}px,${at.y}px)`
}

/** The page under the thumbs held still: no scrolling, zooming, selecting or long-press menu. */
function holdThePage() {
  for (const style of [document.documentElement.style, document.body.style]) {
    style.touchAction = 'none'
    style.userSelect = 'none'
    style.setProperty('-webkit-user-select', 'none')
    style.setProperty('-webkit-touch-callout', 'none')
  }
  addEventListener('contextmenu', (event) => event.preventDefault())
  document.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false })
  document.addEventListener('gesturestart', (event) => event.preventDefault())
}

/** The shell on the page, listening; the page held still at once where the pointer is a finger, else from the first touch. */
export function createThumbs(): Thumbs {
  let touches: TouchContact[] = []
  let tapped = false
  /** The contacts forwarded and still down, where they last were. */
  const down = new Map<number, { x: number; y: number }>()
  let held = false
  const holdOnce = () => {
    if (held) return
    held = true
    holdThePage()
  }
  if (matchMedia('(pointer: coarse)').matches) holdOnce()

  const heard = (phase: TouchContact['phase']) => (event: PointerEvent) => {
    if (event.pointerType !== 'touch') return
    const { pointerId: id, clientX: x, clientY: y } = event
    if (phase === 'down') {
      holdOnce()
      if (event.target instanceof Element && event.target.closest(BUTTONS)) {
        tapped = true
        return
      }
      down.set(id, { x, y })
    } else if (!down.has(id)) return
    else if (phase === 'move') down.set(id, { x, y })
    else down.delete(id)
    touches.push({ id, x, y, phase })
  }
  addEventListener('pointerdown', heard('down'), { capture: true })
  addEventListener('pointermove', heard('move'), { capture: true })
  addEventListener('pointerup', heard('up'), { capture: true })
  addEventListener('pointercancel', heard('cancel'), { capture: true })

  const letGo = () => {
    for (const [id, { x, y }] of down) touches.push({ id, x, y, phase: 'cancel' })
    down.clear()
  }
  addEventListener('blur', letGo)
  document.addEventListener('visibilitychange', () => document.hidden && letGo())

  const base = ring(STICK_REACH * 2, '#0003')
  const knob = ring(KNOB, `${INK}40`)
  const right = ring(RING, '#0003')
  // The first play's hint: a stick and a ring, faint, where the thumbs go.
  const hintBase = ring(STICK_REACH * 2, '#0003')
  const hintKnob = ring(KNOB, `${INK}40`)
  const hintRing = ring(RING, '#0003')
  const hints = [hintBase, hintKnob, hintRing]
  for (const one of hints) Object.assign(one.style, { display: '', opacity: '0', transition: `opacity ${HINT_FADE}s` })
  const used = { stick: false, ring: false }
  /** The thumbs down while the hint did not show: the skip's hold, kept into the play, uses neither half of it. */
  const before = { stick: -1, ring: -1 }

  return {
    take() {
      const taken = { touches, tapped }
      touches = []
      tapped = false
      return taken
    },
    letGo,
    draw(reading, shown, hinted) {
      place(base, shown ? (reading.stick?.centre ?? null) : null)
      place(knob, shown ? (reading.stick?.knob ?? null) : null)
      place(right, shown ? (reading.right?.at ?? null) : null)
      if (!hinted) {
        before.stick = reading.stick?.id ?? -1
        before.ring = reading.right?.id ?? -1
      }
      if (hinted && reading.stick && reading.stick.id !== before.stick) used.stick = true
      if (hinted && reading.right && reading.right.id !== before.ring) used.ring = true
      const stickAt = { x: innerWidth * HINT_STICK.x, y: innerHeight * HINT_STICK.y }
      for (const one of [hintBase, hintKnob]) {
        one.style.transform = `translate(${stickAt.x}px,${stickAt.y}px)`
        one.style.opacity = hinted && !used.stick ? `${HINT_FAINT}` : '0'
      }
      hintRing.style.transform = `translate(${innerWidth * HINT_RING.x}px,${innerHeight * HINT_RING.y}px)`
      hintRing.style.opacity = hinted && !used.ring ? `${HINT_FAINT}` : '0'
    },
  }
}
