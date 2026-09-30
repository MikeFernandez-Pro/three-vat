// The player's thumbs, on a touch device: the shell round the touch controls'
// rules (touch-sticks.ts). It forwards pointer events, lets every thumb go on
// blur, keeps the page from scrolling, zooming or opening a menu under them,
// and draws a base and a knob under each thumb down. The rules are all
// touch-sticks.ts's; nothing here decides anything.
import type { SimulationInput } from './simulation/simulation'
import { STICK_RADIUS, TouchSticks, type ContactPhase, type Stick, type TouchRun } from './touch-sticks'

/**
 * Whether the game plays on the touch controls: where the primary pointer is
 * coarse. A touch-screen laptop's is fine, so it keeps the keyboard and the
 * mouse. Read once, at load, so the start screen shows the controls Play gives.
 */
export const TOUCH = window.matchMedia('(pointer: coarse)').matches
// The start screen's hint, and the page's guards (style.css), hang on it.
document.documentElement.classList.toggle('is-touch', TOUCH)

const PHASES: Record<string, ContactPhase> = {
  pointerdown: 'down',
  pointermove: 'move',
  pointerup: 'up',
  pointercancel: 'cancel',
}

export class TouchInput {
  private readonly sticks: TouchSticks
  private readonly drawn: Record<'move' | 'throw', StickElements>

  /** Thumbs land on `surface`, the canvas: the HUD over it and the overlays' buttons are not the game's. */
  constructor(run: TouchRun, surface: HTMLElement) {
    this.sticks = new TouchSticks(run, viewport())

    // Just over the canvas, so the HUD after it in the page stays on top.
    const layer = document.createElement('div')
    layer.className = 'touch-sticks'
    surface.after(layer)
    const stick = () => {
      const base = document.createElement('div')
      const knob = document.createElement('div')
      base.className = 'touch-stick'
      base.style.setProperty('--radius', `${STICK_RADIUS}px`)
      knob.className = 'touch-stick__knob'
      base.append(knob)
      layer.append(base)
      return { base, knob }
    }
    this.drawn = { move: stick(), throw: stick() }

    surface.addEventListener('pointerdown', this.onPointer)
    window.addEventListener('pointermove', this.onPointer)
    window.addEventListener('pointerup', this.onPointer)
    window.addEventListener('pointercancel', this.onPointer)
    window.addEventListener('blur', () => this.sticks.letGo())
    window.addEventListener('resize', () => this.sticks.resize(viewport()))
    surface.addEventListener('contextmenu', (event) => event.preventDefault())
  }

  /** This frame's input; the sticks are drawn as it was read. */
  sample(): SimulationInput {
    const input = this.sticks.sample()
    const down = this.sticks.down
    draw(this.drawn.move, down.move)
    draw(this.drawn.throw, down.throw)
    return input
  }

  private readonly onPointer = (event: PointerEvent) => {
    if (event.type === 'pointerdown') event.preventDefault()
    this.sticks.touch(PHASES[event.type], { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp })
  }
}

/** A stick as the page draws it. */
interface StickElements {
  base: HTMLElement
  knob: HTMLElement
}

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight })

function draw({ base, knob }: StickElements, stick: Stick | null): void {
  base.hidden = !stick
  if (!stick) return
  base.style.translate = `${stick.origin.x - STICK_RADIUS}px ${stick.origin.y - STICK_RADIUS}px`
  knob.style.translate = `${stick.offset.x}px ${stick.offset.y}px`
}
