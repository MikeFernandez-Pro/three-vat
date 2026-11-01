// A Goose Tale's touch screen on the page (#198): the shell round the touch
// core (goosetouch.ts), which the controls hold. It hears the pointer events of
// touch type and keeps them for the controls' next frame, a contact landing on
// a button left to the button; lets every contact go on a cancel, the page
// losing focus or hidden, and when the game asks (it pauses); keeps the page
// from scrolling, zooming, selecting or opening a menu under the thumbs; and
// draws, in the hints' ink, the small stick fixed at the screen's bottom left,
// its knob under the thumb, and the round button at its bottom right, filling
// while held.

import { INK } from './holdhint'
import { BUTTON_RADIUS, STICK_REACH, touchLayout, type TouchContact, type TouchReading } from './goosetouch'

/** The knob's width, px. */
const KNOB = 38
/** How strong they show untouched, and with a thumb on them. */
const RESTING = 0.45
const TOUCHED = 0.9
/** What a contact landing on belongs to, never a thumb. */
const BUTTONS = 'button, a, input, select, textarea, label'

export interface Thumbs {
  /** The contacts since the last take, in the order they came, and whether a touch landed on a button: then forgotten. */
  take(): { touches: TouchContact[]; tapped: boolean }
  /** Every contact down let go, as cancelled, at the next take. */
  letGo(): void
  /** The stick and the button drawn as `reading` has them while `shown`, else hidden. */
  draw(reading: TouchReading, shown: boolean): void
}

/** A ring `size` px across, centred on where it is put, in the hints' ink; filled faintly with `fill`. */
function ring(size: number, fill: string): HTMLDivElement {
  const element = document.createElement('div')
  element.style.cssText = `position:fixed;left:0;top:0;width:${size}px;height:${size}px;box-sizing:border-box;margin:${-size / 2}px 0 0 ${-size / 2}px;border:3px solid ${INK};border-radius:50%;background:${fill};box-shadow:0 2px 4px #000c;pointer-events:none;z-index:30;display:none`
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
  const button = ring(BUTTON_RADIUS * 2, '#0003')

  return {
    take() {
      const taken = { touches, tapped }
      touches = []
      tapped = false
      return taken
    },
    letGo,
    draw(reading, shown) {
      const layout = touchLayout({ width: innerWidth, height: innerHeight })
      place(base, shown ? layout.stick : null)
      place(knob, shown ? (reading.stick?.knob ?? layout.stick) : null)
      place(button, shown ? layout.button : null)
      const stickHeld = `${reading.stick ? TOUCHED : RESTING}`
      base.style.opacity = knob.style.opacity = stickHeld
      button.style.opacity = `${reading.button ? TOUCHED : RESTING}`
      button.style.background = reading.button ? `${INK}55` : '#0003'
    },
  }
}
