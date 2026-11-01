// A Goose Tale's touch screen (#198), without the page: the contacts the
// page forwards turned into two thumbs. A small stick stands fixed at the
// screen's bottom left, a round button at its bottom right, the button doing
// all the space bar does: interact, the skip, confirm and resume. A contact
// landing near the stick takes it, its push measured from the stick's middle
// whatever the spot it landed on; one landing near the button holds it. Which
// thumb a contact is, is decided once, as it lands: it keeps that role till it
// lifts or is cancelled, wherever it drifts, and any other contact is ignored.
// The controls (goosecontrols.ts) hold one and read it as they read a pad.

/** A contact as the page saw it this frame, at (x, y) on the screen, px: landing, moving, lifting or cancelled. */
export interface TouchContact {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly phase: 'down' | 'move' | 'up' | 'cancel'
}

/** The screen the contacts are on, px. */
export interface Viewport {
  readonly width: number
  readonly height: number
}

/** How far in from the screen's sides and foot the stick and the button stand, px. */
const EDGE = 28
/** How far the stick reaches from its middle, px: its ring's radius. */
export const STICK_REACH = 44
/** How far from the stick's middle a thumb landing takes it, px. */
const STICK_CATCH = STICK_REACH * 2
/** The button's radius, px; how far from its middle a thumb landing holds it, px, past its edge for a thumb's slop. */
export const BUTTON_RADIUS = 32
const BUTTON_CATCH = BUTTON_RADIUS * 1.8

/** A point on the screen, px. */
export interface ScreenPoint {
  x: number
  y: number
}

/** Where the stick's middle and the button's stand on `viewport`, px. */
export function touchLayout(viewport: Viewport): { stick: ScreenPoint; button: ScreenPoint } {
  return {
    stick: { x: EDGE + STICK_REACH, y: viewport.height - EDGE - STICK_REACH },
    button: { x: viewport.width - EDGE - BUTTON_RADIUS, y: viewport.height - EDGE - BUTTON_RADIUS },
  }
}

/** The thumbs this frame, as the controls read them and the page draws them. */
export interface TouchReading {
  /**
   * The stick: its contact, its knob (the thumb, held to the stick's reach), and the push, the knob's offset from the
   * stick's middle as a share of the reach, screen right x and down y; or none.
   */
  stick: { id: number; knob: ScreenPoint; push: ScreenPoint } | null
  /** The button's thumb, held; or none. */
  button: { id: number } | null
  /** Whether a thumb landed on the button this frame. */
  pressed: boolean
  /** Whether any contact landed this frame, one ignored included. */
  landed: boolean
}

interface Thumb {
  id: number
  x: number
  y: number
}

export class GooseTouch {
  private stick: Thumb | null = null
  private button: Thumb | null = null
  /** The thumbs that landed and lifted in one frame: kept through it, so a quick tap still counts, and let go on the next. */
  private lifting: number[] = []

  /** The thumbs after this frame's `contacts`, in the order they came, on `viewport`. */
  frame(contacts: readonly TouchContact[], viewport: Viewport): TouchReading {
    for (const id of this.lifting) this.letGo(id)
    this.lifting = []
    const layout = touchLayout(viewport)
    const landed = new Set<number>()
    let pressed = false
    for (const contact of contacts) {
      const { id, x, y } = contact
      if (contact.phase === 'down') {
        landed.add(id)
        if (this.stick?.id === id || this.button?.id === id) continue
        if (!this.stick && Math.hypot(x - layout.stick.x, y - layout.stick.y) <= STICK_CATCH) this.stick = { id, x, y }
        else if (!this.button && Math.hypot(x - layout.button.x, y - layout.button.y) <= BUTTON_CATCH) {
          this.button = { id, x, y }
          pressed = true
        }
        continue
      }
      const thumb = this.stick?.id === id ? this.stick : this.button?.id === id ? this.button : null
      if (!thumb) continue
      thumb.x = x
      thumb.y = y
      if (contact.phase === 'up' && landed.has(id)) this.lifting.push(id)
      else if (contact.phase !== 'move') this.letGo(id)
    }
    return { stick: this.stickReading(layout.stick), button: this.button && { id: this.button.id }, pressed, landed: landed.size > 0 }
  }

  /** Contact `id`'s thumb let go, if it is one. */
  private letGo(id: number) {
    if (this.stick?.id === id) this.stick = null
    if (this.button?.id === id) this.button = null
  }

  private stickReading(middle: ScreenPoint): TouchReading['stick'] {
    if (!this.stick) return null
    const { id, x, y } = this.stick
    const dx = x - middle.x
    const dy = y - middle.y
    const held = Math.min(1, STICK_REACH / (Math.hypot(dx, dy) || 1))
    return {
      id,
      knob: { x: middle.x + dx * held, y: middle.y + dy * held },
      push: { x: (dx * held) / STICK_REACH, y: (dy * held) / STICK_REACH },
    }
  }
}
