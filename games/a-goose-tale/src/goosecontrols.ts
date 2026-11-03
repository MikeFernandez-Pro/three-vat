// The goose game's controls (#194): the keys held, the pads connected and,
// since #198, the thumbs on a touch screen (goosetouch.ts), turned once a
// frame into what the player asks of the game, whatever the device: walk, interact, skip and confirm, each let through only where the
// game takes it. Written for this game on the model of Bruno Simon's
// folio-2025 input layer (https://github.com/brunosimon/folio-2025, at
// 41046b5: sources/Game/Inputs/), its commands, sources and device mode, with
// none of its singleton, events or frame loop. Borrowed from its
// sources/Game/Inputs/Gamepad.js: the dead zone and a button's press, and the
// layout of a PlayStation pad in Firefox, which reports no standard one; under
// its MIT licence:
//
// MIT License
//
// Copyright (c) 2025 Bruno Simon
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import { GooseTouch, type TouchContact, type TouchReading, type Viewport } from './goosetouch'

export type { TouchContact }

/**
 * Where the game is, which decides what the controls let through: the ending while its card is up, then at Play again;
 * paused; none in edit mode or typing in a field.
 */
export type ControlsState = 'loading' | 'opening' | 'play' | 'ending' | 'playAgain' | 'paused' | 'none'

/** A pad as the browser reports it, as plain data: a Gamepad is one. */
export interface PadSnapshot {
  readonly id: string
  readonly mapping: string
  readonly buttons: readonly { readonly value: number }[]
  readonly axes: readonly number[]
}

/** A frame of input, as the page gathered it. */
export interface ControlsFrame {
  /** The keys held, by code. */
  keys: ReadonlySet<string>
  /** The keys gone down since the last frame, by code, repeats left out. */
  pressed: ReadonlySet<string>
  /** Whether the page was clicked since the last frame. */
  clicked: boolean
  /** The pads as navigator.getGamepads() lists them, a gap where one was. */
  pads: readonly (PadSnapshot | null)[]
  /** The touch contacts since the last frame, in the order they came: those landing on a button left out. */
  touches: readonly TouchContact[]
  /** Whether a touch landed on a button since the last frame: it belongs to the button, but tells the controls touch is in use. */
  tapped: boolean
  /** The screen the contacts are on. */
  viewport: Viewport
  state: ControlsState
}

/** A walk: a way on the screen, x right and y down it, of length 1; and how hard, 0 to 1. */
export interface Walk {
  x: number
  y: number
  strength: number
}

/** What the player asks of the game this frame. */
export interface Commands {
  walk: Walk | null
  /** Interact, held. */
  interact: boolean
  /** The opening's skip, held. */
  skip: boolean
  /** Pressed this frame. */
  confirm: boolean
  /** The game asked to pause this frame: Start or Escape pressed, or the pad in use gone. P's pause is outside the controls. */
  pause: boolean
  /** Paused, the game asked to go on this frame: the space bar, Enter, Escape, the bottom face button, Start or the touch button pressed. P's is outside the controls. */
  resume: boolean
  /** The device last used, and the button a pad's prompts show. */
  device: 'keyboard' | 'gamepad' | 'touch'
  glyph: 'A' | '✕'
}

/** The space bar: interact, skip and confirm, as the touch button is. */
export const SPACE = 'Space'

/** The walking keys, each a way on the screen. */
export const WALK_KEYS: Record<string, readonly [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
}

/** A way of length 1 at full strength, or none if it has no length. */
function fullWalk(x: number, y: number): Walk | null {
  const d = Math.hypot(x, y)
  return d === 0 ? null : { x: x / d, y: y / d, strength: 1 }
}

/** How far a stick is pushed before it counts, a share of its travel: folio-2025's. */
const DEAD_ZONE = 0.2

/** The left stick's walk: none inside the dead zone, its strength 0 at the zone's edge to 1 at a full push. */
function stickWalk(x: number, y: number): Walk | null {
  const pushed = Math.hypot(x, y)
  if (pushed <= DEAD_ZONE) return null
  return { x: x / pushed, y: y / pushed, strength: Math.min(1, (pushed - DEAD_ZONE) / (1 - DEAD_ZONE)) }
}

/** The thumb's stick's walk: none inside the dead zone, past it his one pace, as on the keys: a thumb has nothing to feel a full push by. */
function thumbWalk(x: number, y: number): Walk | null {
  return Math.hypot(x, y) <= DEAD_ZONE ? null : fullWalk(x, y)
}

/** How far a button is pressed before it counts as down, a share of its travel: folio-2025's. */
const BUTTON_DOWN = 0.2

/** A pad read through its layout: the buttons the game binds, down or not, and the left stick; and every button as it lies, down or not. */
interface PadReading {
  buttons: readonly boolean[]
  south: boolean
  start: boolean
  up: boolean
  down: boolean
  left: boolean
  right: boolean
  stickX: number
  stickY: number
}

/**
 * The d-pad of a PlayStation pad in Firefox, one axis: where it lies for each way it can be pushed, up, up and right,
 * on round to up and left, a step of 2/7 apart; at rest, past them all. Each of its four buttons is down at its own way
 * and the two beside it.
 */
const HAT = [-1, -5 / 7, -3 / 7, -1 / 7, 1 / 7, 3 / 7, 5 / 7, 1]
const HAT_NEAR = 0.1
const HAT_UP = [7, 0, 1]
const HAT_RIGHT = [1, 2, 3]
const HAT_DOWN = [3, 4, 5]
const HAT_LEFT = [5, 6, 7]

/**
 * A pad through its layout: the W3C standard one wherever the browser reports it; else a PlayStation pad in Firefox,
 * ✕ its button 1 and the d-pad an axis, axis 9 on Windows (10 axes) and 6 on macOS (7); else taken as standard.
 */
function readPad(pad: PadSnapshot): PadReading {
  const down = (k: number) => (pad.buttons[k]?.value ?? 0) > BUTTON_DOWN
  const common = { buttons: pad.buttons.map((_, k) => down(k)), start: down(9), stickX: pad.axes[0] ?? 0, stickY: pad.axes[1] ?? 0 }
  const hat = pad.mapping === 'standard' ? undefined : pad.axes.length === 10 ? 9 : pad.axes.length === 7 ? 6 : undefined
  if (hat === undefined) return { ...common, south: down(0), up: down(12), down: down(13), left: down(14), right: down(15) }
  const at = pad.axes[hat] ?? 0
  const way = HAT.findIndex((one) => Math.abs(one - at) < HAT_NEAR)
  return { ...common, south: down(1), up: HAT_UP.includes(way), down: HAT_DOWN.includes(way), left: HAT_LEFT.includes(way), right: HAT_RIGHT.includes(way) }
}

/** Whether the pad was just used: a button gone down, or its left stick pushed out past its dead zone, since `was`. */
function used(pad: PadReading, was: PadReading | undefined): boolean {
  if (pad.buttons.some((down, k) => down && !was?.buttons[k])) return true
  if ((['up', 'down', 'left', 'right'] as const).some((way) => pad[way] && !was?.[way])) return true
  const out = (one: PadReading | undefined) => !!one && Math.hypot(one.stickX, one.stickY) > DEAD_ZONE
  return out(pad) && !out(was)
}

/** Two readings of one pad as one: each button down on either, the stick the further pushed. */
function merged(a: PadReading, b: PadReading): PadReading {
  const stick = Math.hypot(b.stickX, b.stickY) > Math.hypot(a.stickX, a.stickY) ? b : a
  return {
    buttons: Array.from({ length: Math.max(a.buttons.length, b.buttons.length) }, (_, k) => !!a.buttons[k] || !!b.buttons[k]),
    south: a.south || b.south,
    start: a.start || b.start,
    up: a.up || b.up,
    down: a.down || b.down,
    left: a.left || b.left,
    right: a.right || b.right,
    stickX: stick.stickX,
    stickY: stick.stickY,
  }
}

/** The pad's walk: the left stick past its dead zone, else the d-pad at full strength. */
function padWalk(pad: PadReading): Walk | null {
  return stickWalk(pad.stickX, pad.stickY) ?? fullWalk(+pad.right - +pad.left, +pad.down - +pad.up)
}

/** A PlayStation pad, by its name or, where it has none, as in Firefox, Sony's vendor number: its bottom face button is ✕. */
const PLAYSTATION = /playstation|dualshock|dualsense|\b054c\b/i

/** The keys that confirm. */
const CONFIRM_KEYS = ['Enter', 'NumpadEnter', SPACE]
/** The key that pauses, as Start does. */
const PAUSE_KEY = 'Escape'

/** What each state lets through. */
const LIVE: Record<ControlsState, { walk?: true; interact?: true; skip?: true; confirm?: true; pause?: true; resume?: true }> = {
  loading: { confirm: true },
  opening: { skip: true, pause: true },
  play: { walk: true, interact: true, pause: true },
  ending: { pause: true },
  playAgain: { confirm: true },
  paused: { resume: true },
  none: {},
}

export class GooseControls {
  /** Each pad as read last frame, by its name. */
  private readonly padsWere = new Map<string, PadReading>()
  /** The pad that drives, by its name: the last used. */
  private driver = ''
  /**
   * For interact and skip, what holds them was held already when the state did not take them, and is held still: it
   * counts again only once let go, so the hold that skips the opening never reaches the play, nor the press that entered
   * it the skip. Paused or in edit mode, holds are kept as they were, and a press there, the one that resumes too,
   * counts once let go.
   */
  private readonly spent = { interact: new Set<string>(), skip: new Set<string>() }
  /** What held interact or skip last frame. */
  private holdingWas = new Set<string>()
  /** The glyph of the pad last used. */
  private glyph: Commands['glyph'] = 'A'
  private readonly touch = new GooseTouch()
  private thumbsAre: TouchReading = { stick: null, button: null, pressed: false, landed: false }

  /** `device`, the device last used till another is: a phone's prompts are for its thumbs from the first. */
  constructor(private device: Commands['device'] = 'keyboard') {}

  /** The thumbs on the touch screen as of the last frame, for the page to draw. */
  get thumbs(): TouchReading {
    return this.thumbsAre
  }

  /** This frame's commands, from the keys and the pads as `input` has them now and as they were last frame. */
  frame(input: ControlsFrame): Commands {
    const live = LIVE[input.state]
    let x = 0
    let y = 0
    for (const code of input.keys) {
      const way = WALK_KEYS[code]
      if (!way) continue
      x += way[0]
      y += way[1]
    }
    // A pad listed twice under one name, as Chrome on Windows lists a DualSense, one a frame behind the other, is read
    // as one: its buttons down on either, its stick the further pushed. Else the late one's press would be a second.
    const read = new Map<string, PadReading>()
    for (const one of input.pads) {
      if (!one) continue
      const reading = readPad(one)
      const other = read.get(one.id)
      read.set(one.id, other ? merged(other, reading) : reading)
    }
    let padUsed = false
    for (const [k, one] of read) {
      if (!used(one, this.padsWere.get(k))) continue
      this.driver = k
      padUsed = true
    }
    const at = this.driver
    const pad = read.get(at)
    const was = this.padsWere.get(at)
    const lost = this.device === 'gamepad' && !pad && !!was
    this.padsWere.clear()
    for (const [k, one] of read) this.padsWere.set(k, one)
    if (padUsed) {
      this.device = 'gamepad'
      this.glyph = PLAYSTATION.test(at) ? '✕' : 'A'
    }
    const thumbs = (this.thumbsAre = this.touch.frame(input.touches, input.viewport))
    if (thumbs.landed || input.tapped) this.device = 'touch'
    if (input.pressed.size > 0 || input.clicked) this.device = 'keyboard'
    // The device last used walks him; the others, while it has no walk.
    const keysWalk = fullWalk(x, y)
    const padWay = pad ? padWalk(pad) : null
    const stickWay = thumbs.stick && thumbWalk(thumbs.stick.push.x, thumbs.stick.push.y)
    const walk =
      this.device === 'touch' ? (stickWay ?? keysWalk ?? padWay) : this.device === 'gamepad' ? (padWay ?? keysWalk ?? stickWay) : (keysWalk ?? padWay ?? stickWay)
    const holding = new Set<string>()
    if (input.keys.has(SPACE)) holding.add(SPACE)
    if (pad?.south) holding.add(`pad ${at}`)
    if (thumbs.button) holding.add(`touch ${thumbs.button.id}`)
    const holdingWas = this.holdingWas
    this.holdingWas = holding
    const start = !!pad && pad.start && !was?.start
    const escape = input.pressed.has(PAUSE_KEY)
    const pressed = CONFIRM_KEYS.some((code) => input.pressed.has(code)) || (!!pad && pad.south && !was?.south) || start || thumbs.pressed
    return {
      walk: live.walk ? walk : null,
      interact: this.hold('interact', holding, holdingWas, input.state),
      skip: this.hold('skip', holding, holdingWas, input.state),
      confirm: !!live.confirm && pressed,
      pause: !!live.pause && (start || escape || lost),
      resume: !!live.resume && (pressed || escape),
      device: this.device,
      glyph: this.glyph,
    }
  }

  /** Whether `command` is held this frame by any of `holding` not spent, `holdingWas` what held it last frame. */
  private hold(command: 'interact' | 'skip', holding: ReadonlySet<string>, holdingWas: ReadonlySet<string>, state: ControlsState): boolean {
    const spent = this.spent[command]
    for (const one of spent) if (!holding.has(one)) spent.delete(one)
    if (state === 'paused' || state === 'none') {
      for (const one of holding) if (!holdingWas.has(one)) spent.add(one)
      return false
    }
    if (!LIVE[state][command]) {
      for (const one of holding) spent.add(one)
      return false
    }
    for (const one of holding) if (!spent.has(one)) return true
    return false
  }
}
