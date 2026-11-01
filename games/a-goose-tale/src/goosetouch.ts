// A Goose Tale's touch screen (#198), without the page: the contacts the
// page forwards turned into two thumbs, as Ho Ho No plays (#132). Under the
// left, a stick centred where it landed on the left half of the screen; under
// the right, anywhere on the right half, a thumb held down. Which thumb a
// contact is, is decided once, as it lands: it keeps that role till it lifts or
// is cancelled, wherever it drifts, and any contact beyond the two is ignored.
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

/** How far the stick reaches from where its thumb landed, px: Ho Ho No's, to tune by playing. */
export const STICK_REACH = 60
/** Where the left half ends and the right begins, a share of the screen's width from its left. */
const SPLIT = 0.5

/** A point on the screen, px. */
export interface ScreenPoint {
  x: number
  y: number
}

/** The thumbs this frame, as the controls read them and the page draws them. */
export interface TouchReading {
  /**
   * The stick: its contact, where it landed, its knob (the thumb, held to the stick's reach), and the push, the knob's
   * offset as a share of the reach, screen right x and down y; or none.
   */
  stick: { id: number; centre: ScreenPoint; knob: ScreenPoint; push: ScreenPoint } | null
  /** The right thumb: its contact, and where it is; or none. */
  right: { id: number; at: ScreenPoint } | null
  /** Whether any contact landed this frame, one ignored included. */
  landed: boolean
}

interface Thumb {
  id: number
  x: number
  y: number
}

export class GooseTouch {
  /** The stick's thumb, and where it landed. */
  private stick: (Thumb & { fromX: number; fromY: number }) | null = null
  private right: Thumb | null = null
  /** The thumbs that landed and lifted in one frame: kept through it, so a quick tap still counts, and let go on the next. */
  private lifting: number[] = []

  /** The thumbs after this frame's `contacts`, in the order they came, on `viewport`. */
  frame(contacts: readonly TouchContact[], viewport: Viewport): TouchReading {
    for (const id of this.lifting) this.letGo(id)
    this.lifting = []
    const landed = new Set<number>()
    for (const contact of contacts) {
      const { id, x, y } = contact
      if (contact.phase === 'down') {
        landed.add(id)
        if (this.stick?.id === id || this.right?.id === id) continue
        const left = x < viewport.width * SPLIT
        if (left && !this.stick) this.stick = { id, x, y, fromX: x, fromY: y }
        else if (!left && !this.right) this.right = { id, x, y }
        continue
      }
      const thumb = this.stick?.id === id ? this.stick : this.right?.id === id ? this.right : null
      if (!thumb) continue
      thumb.x = x
      thumb.y = y
      if (contact.phase === 'up' && landed.has(id)) this.lifting.push(id)
      else if (contact.phase !== 'move') this.letGo(id)
    }
    return { stick: this.stickReading(), right: this.right && { id: this.right.id, at: { x: this.right.x, y: this.right.y } }, landed: landed.size > 0 }
  }

  /** Contact `id`'s thumb let go, if it is one. */
  private letGo(id: number) {
    if (this.stick?.id === id) this.stick = null
    if (this.right?.id === id) this.right = null
  }

  private stickReading(): TouchReading['stick'] {
    if (!this.stick) return null
    const { id, x, y, fromX, fromY } = this.stick
    const dx = x - fromX
    const dy = y - fromY
    const held = Math.min(1, STICK_REACH / (Math.hypot(dx, dy) || 1))
    return {
      id,
      centre: { x: fromX, y: fromY },
      knob: { x: fromX + dx * held, y: fromY + dy * held },
      push: { x: (dx * held) / STICK_REACH, y: (dy * held) / STICK_REACH },
    }
  }
}
