import { describe, expect, it } from 'vitest'
import { GooseControls, type ControlsFrame, type PadSnapshot, type TouchContact } from './goosecontrols'
import { STICK_REACH, touchLayout } from './goosetouch'

/** The screen the thumbs are on, px: a phone held sideways. */
const WIDTH = 800
const HEIGHT = 400

/** A frame of input: nothing held, pressed, clicked or touched, no pad, in the play; `over` what the frame changes. */
function frame(over: Partial<ControlsFrame> = {}): ControlsFrame {
  return { keys: new Set(), pressed: new Set(), clicked: false, pads: [], touches: [], tapped: false, viewport: { width: WIDTH, height: HEIGHT }, state: 'play', ...over }
}

/** Contact `id` at (x, y) on the screen, px: landing, moving, lifting or cancelled. */
const down = (id: number, x: number, y: number): TouchContact => ({ id, x, y, phase: 'down' })
const move = (id: number, x: number, y: number): TouchContact => ({ id, x, y, phase: 'move' })
const up = (id: number, x: number, y: number): TouchContact => ({ id, x, y, phase: 'up' })
const cancel = (id: number, x: number, y: number): TouchContact => ({ id, x, y, phase: 'cancel' })
/** The stick's middle and the button's on the screen, px. */
const { stick, button } = touchLayout({ width: WIDTH, height: HEIGHT })
const STICK: readonly [number, number] = [stick.x, stick.y]
const BUTTON: readonly [number, number] = [button.x, button.y]

/** The W3C standard layout's buttons: the bottom face button, Start, and the d-pad's up, down, left and right. */
const SOUTH = 0
const START = 9
const UP = 12
const DOWN = 13
const LEFT = 14
const RIGHT = 15
/** The top face button, the bumpers and the triggers, which nothing binds. */
const UNBOUND = [3, 4, 5, 6, 7]

/** A pad in the standard layout, at rest but for `down`'s buttons and the left stick at `stick`. */
function pad(down: number[] = [], stick: [number, number] = [0, 0], id = 'Xbox Wireless Controller (STANDARD GAMEPAD)'): PadSnapshot {
  const buttons = Array.from({ length: 17 }, (_, k) => ({ value: down.includes(k) ? 1 : 0 }))
  return { id, mapping: 'standard', buttons, axes: [stick[0], stick[1], 0, 0] }
}

describe('GooseControls', () => {
  it("walks the way the stick's thumb drags from the stick's middle, its strength 0 at the dead zone to 1 at the stick's reach", () => {
    const controls = new GooseControls()
    const [x, y] = STICK
    controls.frame(frame({ touches: [down(1, x, y)] }))
    // Dragged 0.6 of the stick's reach, up and to the right at 30 degrees: 0.5 of the way past the dead zone.
    const drag = 0.6 * STICK_REACH
    const walk = controls.frame(frame({ touches: [move(1, x + drag * Math.cos(Math.PI / 6), y - drag * Math.sin(Math.PI / 6))] })).walk!
    expect(walk.x).toBeCloseTo(Math.cos(Math.PI / 6))
    expect(walk.y).toBeCloseTo(-0.5)
    expect(walk.strength).toBeCloseTo(0.5)
    // A thumb resting a little off the middle, inside the dead zone: no walk.
    expect(controls.frame(frame({ touches: [move(1, x + 5, y + 4)] })).walk).toBeNull()
  })

  it('pushes the fixed stick from its middle wherever near it the thumb lands, and ignores a thumb landing far from it', () => {
    const controls = new GooseControls()
    const [x, y] = STICK
    // Landed a reach to the right of the middle: a full push right at once.
    const walk = controls.frame(frame({ touches: [down(1, x + STICK_REACH, y)] })).walk!
    expect(walk.x).toBeCloseTo(1)
    expect(walk.strength).toBe(1)
    controls.frame(frame({ touches: [up(1, x + STICK_REACH, y)] }))
    // Landed up by the screen's middle: no stick, and dragged, no walk.
    controls.frame(frame({ touches: [down(2, WIDTH / 2, HEIGHT / 4)] }))
    expect(controls.frame(frame({ touches: [move(2, WIDTH / 2 + 200, HEIGHT / 4)] })).walk).toBeNull()
  })

  it("walks at full strength on a drag past the stick's reach, and stands him when the stick's thumb lifts", () => {
    const controls = new GooseControls()
    const [x, y] = STICK
    controls.frame(frame({ touches: [down(1, x, y)] }))
    const walk = controls.frame(frame({ touches: [move(1, x + 300, y)] })).walk!
    expect(walk.x).toBeCloseTo(1)
    expect(walk.strength).toBe(1)
    expect(controls.frame(frame({ touches: [up(1, x + 300, y)] })).walk).toBeNull()
  })

  it('holds interact while a thumb is on the button, a tap for a frame though it lifts within it; elsewhere, none', () => {
    const controls = new GooseControls()
    const [x, y] = BUTTON
    expect(controls.frame(frame({ touches: [down(2, x, y)] })).interact).toBe(true)
    expect(controls.frame(frame({ touches: [move(2, x - 60, y - 60)] })).interact).toBe(true)
    expect(controls.frame(frame()).interact).toBe(true)
    expect(controls.frame(frame({ touches: [up(2, x - 60, y - 60)] })).interact).toBe(false)
    // Down and up between two frames: interact for the one.
    expect(controls.frame(frame({ touches: [down(3, x, y), up(3, x, y)] })).interact).toBe(true)
    expect(controls.frame(frame()).interact).toBe(false)
    // A thumb on the right half, away from the button: nothing.
    expect(controls.frame(frame({ touches: [down(4, WIDTH * 0.75, HEIGHT / 4)] })).interact).toBe(false)
  })

  it('walks and interacts at once, a thumb each', () => {
    const controls = new GooseControls()
    controls.frame(frame({ touches: [down(1, ...STICK), down(2, ...BUTTON)] }))
    const { walk, interact } = controls.frame(frame({ touches: [move(1, STICK[0], STICK[1] - STICK_REACH)] }))
    expect(walk!.y).toBeCloseTo(-1)
    expect(interact).toBe(true)
  })

  it('keeps each thumb to its role till it lifts, ignoring a second on the stick, one elsewhere, and a cancelled one', () => {
    const controls = new GooseControls()
    const [x, y] = STICK
    controls.frame(frame({ touches: [down(1, x, y)] }))
    // Dragged far across, onto the button, it still walks, and holds no button.
    let commands = controls.frame(frame({ touches: [move(1, ...BUTTON)] }))
    expect(commands.walk!.x).toBeCloseTo(1, 1)
    expect(commands.interact).toBe(false)
    // A second contact on the stick, one on the button, and one up top: the button is taken, the others ignored.
    commands = controls.frame(frame({ touches: [down(2, x, y), down(3, ...BUTTON), down(4, 700, 60)] }))
    expect(commands.walk!.x).toBeCloseTo(1, 1)
    expect(commands.interact).toBe(true)
    // The ignored ones lifting change nothing; the second dragged walks nothing.
    commands = controls.frame(frame({ touches: [move(2, x, 0), up(4, 700, 60)] }))
    expect(commands.walk!.x).toBeCloseTo(1, 1)
    expect(commands.interact).toBe(true)
    // Cancelled, both thumbs are let go, and what is left down never takes a role it did not land with.
    commands = controls.frame(frame({ touches: [cancel(1, ...BUTTON), cancel(3, ...BUTTON), move(2, x + STICK_REACH, y)] }))
    expect(commands.walk).toBeNull()
    expect(commands.interact).toBe(false)
  })

  it('skips the opening on a hold of the stick or the button, never as interact, nor in the play till it is let go', () => {
    for (const at of [STICK, BUTTON]) {
      const controls = new GooseControls()
      const held = controls.frame(frame({ touches: [down(1, ...at)], state: 'opening' }))
      expect(held.skip, `${at}`).toBe(true)
      expect(held.interact, `${at}`).toBe(false)
      expect(controls.frame(frame({ state: 'opening' })).skip, `${at}`).toBe(true)
      // Skipped: the play comes in with it still held.
      expect(controls.frame(frame()).interact, `${at}`).toBe(false)
      controls.frame(frame({ touches: [up(1, ...at)] }))
      expect(controls.frame(frame({ touches: [down(2, ...BUTTON)] })).interact, `${at}`).toBe(true)
    }
  })

  it('lets only what the state takes through from the thumbs, the button confirming and resuming as the space bar does', () => {
    /** The commands the stick pushed up and the button pressed give in the state. */
    const all = (state: ControlsFrame['state']) => {
      const controls = new GooseControls()
      const { walk, interact, skip, confirm, pause, resume } = controls.frame(frame({ touches: [down(1, ...STICK), move(1, STICK[0], 0), down(2, ...BUTTON)], state }))
      return { walk: walk !== null, interact, skip, confirm, pause, resume }
    }
    const nothing = { walk: false, interact: false, skip: false, confirm: false, pause: false, resume: false }
    expect(all('loading')).toEqual({ ...nothing, confirm: true })
    expect(all('opening')).toEqual({ ...nothing, skip: true })
    expect(all('play')).toEqual({ ...nothing, walk: true, interact: true })
    expect(all('ending')).toEqual(nothing)
    expect(all('playAgain')).toEqual({ ...nothing, confirm: true })
    expect(all('paused')).toEqual({ ...nothing, resume: true })
    expect(all('none')).toEqual(nothing)
  })

  it('confirms once on the button landing, not while it is held', () => {
    const controls = new GooseControls()
    expect(controls.frame(frame({ touches: [down(1, ...BUTTON)], state: 'playAgain' })).confirm).toBe(true)
    expect(controls.frame(frame({ state: 'playAgain' })).confirm).toBe(false)
  })

  it('switches the device to touch on a contact landing or a button tapped, and back on a key or a pad', () => {
    const controls = new GooseControls()
    expect(controls.frame(frame({ touches: [down(1, ...BUTTON)] })).device).toBe('touch')
    expect(controls.frame(frame()).device).toBe('touch')
    expect(controls.frame(frame({ pressed: new Set(['KeyW']), keys: new Set(['KeyW']) })).device).toBe('keyboard')
    // A second finger on the button, its thumb still down, is ignored as a thumb but still a touch; so is a tap on a page's button.
    expect(controls.frame(frame({ touches: [down(5, ...BUTTON)] })).device).toBe('touch')
    expect(controls.frame(frame({ pads: [pad([SOUTH])] })).device).toBe('gamepad')
    expect(controls.frame(frame({ tapped: true })).device).toBe('touch')
    // A thumb moving or lifting is not one landing.
    controls.frame(frame({ pads: [pad()], pressed: new Set(['KeyM']) }))
    expect(controls.frame(frame({ touches: [move(5, 10, 10), up(1, ...BUTTON)] })).device).toBe('keyboard')
  })

  it('walks by the stick on touch over keys still held, the keys taking over once pressed', () => {
    const controls = new GooseControls()
    const keys = new Set(['KeyA'])
    expect(controls.frame(frame({ keys, pressed: keys })).walk!.x).toBeCloseTo(-1)
    controls.frame(frame({ keys, touches: [down(1, ...STICK)] }))
    expect(controls.frame(frame({ keys, touches: [move(1, STICK[0], STICK[1] + STICK_REACH)] })).walk!.y).toBeCloseTo(1)
    // The stick at rest at its middle: the key held walks him.
    expect(controls.frame(frame({ keys, touches: [move(1, ...STICK)] })).walk!.x).toBeCloseTo(-1)
    // A key pressed with the stick pushed: the keys walk him; let go of them, the stick does.
    controls.frame(frame({ keys, touches: [move(1, STICK[0], STICK[1] + STICK_REACH)] }))
    const right = new Set(['KeyD'])
    expect(controls.frame(frame({ keys: right, pressed: right })).walk!.x).toBeCloseTo(1)
    expect(controls.frame(frame()).walk!.y).toBeCloseTo(1)
  })

  it('walks at full strength the way the held keys point, up the screen as -y', () => {
    const controls = new GooseControls()
    const walk = controls.frame(frame({ keys: new Set(['KeyW', 'KeyD']) })).walk
    expect(walk!.x).toBeCloseTo(Math.SQRT1_2)
    expect(walk!.y).toBeCloseTo(-Math.SQRT1_2)
    expect(walk!.strength).toBe(1)
  })

  it('reads a stick resting inside the dead zone as no walk', () => {
    const controls = new GooseControls()
    expect(controls.frame(frame({ pads: [pad([], [0.12, -0.12])] })).walk).toBeNull()
  })

  it('walks the stick any way, its strength 0 at the dead zone and 1 at a full push', () => {
    const controls = new GooseControls()
    // Pushed 0.6 of the way, up and to the right at 30 degrees: 0.5 of the way past the dead zone.
    const walk = controls.frame(frame({ pads: [pad([], [0.6 * Math.cos(Math.PI / 6), -0.6 * Math.sin(Math.PI / 6)])] })).walk!
    expect(walk.x).toBeCloseTo(Math.cos(Math.PI / 6))
    expect(walk.y).toBeCloseTo(-0.5)
    expect(walk.strength).toBeCloseTo(0.5)
    expect(controls.frame(frame({ pads: [pad([], [0, 1])] })).walk!.strength).toBeCloseTo(1)
    expect(controls.frame(frame({ pads: [pad([], [0.21, 0])] })).walk!.strength).toBeCloseTo(0.0125)
  })

  it('walks the d-pad as the keys, at full strength in eight directions', () => {
    const controls = new GooseControls()
    const ways: [number[], number, number][] = [
      [[UP], 0, -1],
      [[UP, RIGHT], Math.SQRT1_2, -Math.SQRT1_2],
      [[RIGHT], 1, 0],
      [[DOWN, RIGHT], Math.SQRT1_2, Math.SQRT1_2],
      [[DOWN], 0, 1],
      [[DOWN, LEFT], -Math.SQRT1_2, Math.SQRT1_2],
      [[LEFT], -1, 0],
      [[UP, LEFT], -Math.SQRT1_2, -Math.SQRT1_2],
    ]
    for (const [down, x, y] of ways) {
      const walk = controls.frame(frame({ pads: [pad(down)] })).walk!
      expect(walk.x).toBeCloseTo(x)
      expect(walk.y).toBeCloseTo(y)
      expect(walk.strength).toBe(1)
    }
  })

  it('holds interact in the play while the space bar or the bottom face button is held', () => {
    const controls = new GooseControls()
    expect(controls.frame(frame({ keys: new Set(['Space']) })).interact).toBe(true)
    expect(controls.frame(frame()).interact).toBe(false)
    expect(controls.frame(frame({ pads: [pad([SOUTH])] })).interact).toBe(true)
    expect(controls.frame(frame({ pads: [pad([SOUTH])] })).interact).toBe(true)
    expect(controls.frame(frame({ pads: [pad()] })).interact).toBe(false)
  })

  it('lets through only what the state takes', () => {
    /** The commands a fresh press of everything gives in the state: walk keys held, the space bar and Enter down, a pad's every bound button down. */
    const all = (state: ControlsFrame['state'], on: 'keys' | 'pad') => {
      const keys = new Set(['KeyW', 'Space', 'Enter'])
      const input = on === 'keys' ? frame({ keys, pressed: keys, state }) : frame({ pads: [pad([SOUTH, START, UP])], state })
      const { walk, interact, skip, confirm, pause } = new GooseControls().frame(input)
      return { walk: walk !== null, interact, skip, confirm, pause }
    }
    for (const on of ['keys', 'pad'] as const) {
      // The keys' pause is P's, outside the controls.
      const pad = on === 'pad'
      expect(all('loading', on)).toEqual({ walk: false, interact: false, skip: false, confirm: true, pause: false })
      expect(all('opening', on)).toEqual({ walk: false, interact: false, skip: true, confirm: false, pause: pad })
      expect(all('play', on)).toEqual({ walk: true, interact: true, skip: false, confirm: false, pause: pad })
      expect(all('ending', on)).toEqual({ walk: false, interact: false, skip: false, confirm: false, pause: pad })
      expect(all('playAgain', on)).toEqual({ walk: false, interact: false, skip: false, confirm: true, pause: false })
      expect(all('none', on)).toEqual({ walk: false, interact: false, skip: false, confirm: false, pause: false })
    }
  })

  it('resumes, paused, on the space bar, Enter, the bottom face button or Start, and lets nothing else through', () => {
    const resumes = (input: Partial<ControlsFrame>) => {
      const { walk, interact, skip, confirm, pause, resume } = new GooseControls().frame(frame({ state: 'paused', ...input }))
      expect({ walk, interact, skip, confirm, pause }).toEqual({ walk: null, interact: false, skip: false, confirm: false, pause: false })
      return resume
    }
    expect(resumes({ pressed: new Set(['Space']), keys: new Set(['Space', 'KeyW']) })).toBe(true)
    expect(resumes({ pressed: new Set(['Enter']) })).toBe(true)
    expect(resumes({ pressed: new Set(['KeyW']) })).toBe(false)
    expect(resumes({ pads: [pad([SOUTH], [1, 0])] })).toBe(true)
    expect(resumes({ pads: [pad([START])] })).toBe(true)
    expect(resumes({ pads: [pad(UNBOUND)] })).toBe(false)
    // Not out of the pause, nor where there is none.
    for (const state of ['play', 'none'] as const) expect(new GooseControls().frame(frame({ state, pressed: new Set(['Space']) })).resume).toBe(false)
  })

  it('pauses on Escape where Start pauses, and goes on on it again, but never confirms on it', () => {
    const escape = (state: ControlsFrame['state']) => {
      const { pause, resume, confirm } = new GooseControls().frame(frame({ state, keys: new Set(['Escape']), pressed: new Set(['Escape']) }))
      return { pause, resume, confirm }
    }
    for (const state of ['opening', 'play', 'ending'] as const) expect(escape(state), state).toEqual({ pause: true, resume: false, confirm: false })
    expect(escape('paused')).toEqual({ pause: false, resume: true, confirm: false })
    for (const state of ['loading', 'playAgain', 'none'] as const) expect(escape(state), state).toEqual({ pause: false, resume: false, confirm: false })
  })

  it('confirms on Enter, the space bar, the bottom face button or Start', () => {
    const confirms = (input: Partial<ControlsFrame>) => new GooseControls().frame(frame({ state: 'loading', ...input })).confirm
    expect(confirms({ pressed: new Set(['Enter']) })).toBe(true)
    expect(confirms({ pressed: new Set(['NumpadEnter']) })).toBe(true)
    expect(confirms({ pressed: new Set(['Space']) })).toBe(true)
    expect(confirms({ pressed: new Set(['KeyW']) })).toBe(false)
    expect(confirms({ pads: [pad([SOUTH])] })).toBe(true)
    expect(confirms({ pads: [pad([START])] })).toBe(true)
    expect(confirms({ pads: [pad(UNBOUND)] })).toBe(false)
  })

  it('confirms only on the frame the button goes down', () => {
    const controls = new GooseControls()
    const ending = (down: number[]) => controls.frame(frame({ pads: [pad(down)], state: 'playAgain' })).confirm
    expect(ending([SOUTH])).toBe(true)
    expect(ending([SOUTH])).toBe(false)
    expect(ending([])).toBe(false)
    expect(ending([START])).toBe(true)
  })

  it('takes no press for a button held from before the state took it', () => {
    const controls = new GooseControls()
    // Held while the ending's card is still up, then Play again shows.
    controls.frame(frame({ pads: [pad([SOUTH])], state: 'ending' }))
    expect(controls.frame(frame({ pads: [pad([SOUTH])], state: 'playAgain' })).confirm).toBe(false)
  })

  it('never lets the skip held in the opening through as interact, till it is let go', () => {
    for (const [held, keys, pads] of [
      ['the space bar', new Set(['Space']), []],
      ['the bottom face button', new Set<string>(), [pad([SOUTH])]],
    ] as const) {
      const controls = new GooseControls()
      expect(controls.frame(frame({ keys, pads, state: 'opening' })).skip, held).toBe(true)
      // Skipped: the play comes in with it still held.
      expect(controls.frame(frame({ keys, pads, state: 'play' })).interact, held).toBe(false)
      expect(controls.frame(frame({ keys, pads, state: 'play' })).interact, held).toBe(false)
      expect(controls.frame(frame({ state: 'play' })).interact, held).toBe(false)
      expect(controls.frame(frame({ keys, pads, state: 'play' })).interact, held).toBe(true)
    }
  })

  it('takes a skip only from a hold begun in the opening, not the one that entered it', () => {
    const controls = new GooseControls()
    const keys = new Set(['Space'])
    expect(controls.frame(frame({ keys, pressed: keys, state: 'loading' })).confirm).toBe(true)
    expect(controls.frame(frame({ keys, state: 'opening' })).skip).toBe(false)
    controls.frame(frame({ state: 'opening' }))
    expect(controls.frame(frame({ keys, state: 'opening' })).skip).toBe(true)
  })

  it('keeps a hold across edit mode as it was', () => {
    const controls = new GooseControls()
    const keys = new Set(['Space'])
    expect(controls.frame(frame({ keys })).interact).toBe(true)
    expect(controls.frame(frame({ keys, state: 'none' })).interact).toBe(false)
    expect(controls.frame(frame({ keys })).interact).toBe(true)
  })

  it('keeps a hold across a pause as it was, but never lets the press that resumes it through as interact', () => {
    for (const [held, keys, pads] of [
      ['the space bar', new Set(['Space']), []],
      ['the bottom face button', new Set<string>(), [pad([SOUTH])]],
    ] as const) {
      const kept = new GooseControls()
      expect(kept.frame(frame({ keys, pads })).interact, held).toBe(true)
      expect(kept.frame(frame({ keys, pads, state: 'paused' })).interact, held).toBe(false)
      expect(kept.frame(frame({ keys, pads })).interact, held).toBe(true)
      const resumed = new GooseControls()
      resumed.frame(frame({ state: 'paused' }))
      expect(resumed.frame(frame({ keys, pressed: keys, pads, state: 'paused' })).resume, held).toBe(true)
      expect(resumed.frame(frame({ keys, pads })).interact, held).toBe(false)
      resumed.frame(frame())
      expect(resumed.frame(frame({ keys, pads })).interact, held).toBe(true)
    }
  })

  it('is driven by whichever pad last pressed a button or pushed its stick', () => {
    const controls = new GooseControls()
    const other = (down: number[] = [], stick: [number, number] = [0, 0]) => pad(down, stick, 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')
    // The first pad listed rests a little off centre, never past the dead zone: the second, pushed, drives.
    const resting = pad([], [0.1, 0.1])
    expect(controls.frame(frame({ pads: [resting, other([], [1, 0])] })).walk!.x).toBeCloseTo(1)
    // The first pad's button: it drives, and the second's stick, still pushed but no new push, is not read.
    const commands = controls.frame(frame({ pads: [pad([SOUTH], [0.1, 0.1]), other([], [1, 0])] }))
    expect(commands.walk).toBeNull()
    expect(commands.interact).toBe(true)
    // The second pushed again, from rest: it drives again.
    controls.frame(frame({ pads: [resting, other()] }))
    expect(controls.frame(frame({ pads: [resting, other([], [0, 1])] })).walk!.y).toBeCloseTo(1)
  })

  it('takes a pad the browser lists twice, one a frame behind the other, as one: a press is one press', () => {
    // Chrome on Windows lists a DualSense twice, here with a headset between them.
    const id = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'
    const headset: PadSnapshot = { id: 'HyperX Cloud III Wireless (Vendor: 03f0 Product: 05b7)', mapping: '', buttons: [], axes: [] }
    const both = (first: number[], second: number[]) => [pad(first, [0, 0], id), headset, pad(second, [0, 0], id)]
    const controls = new GooseControls()
    controls.frame(frame({ pads: both([], []) }))
    expect(controls.frame(frame({ pads: both([START], []) })).pause).toBe(true)
    expect(controls.frame(frame({ pads: both([START], [START]), state: 'paused' })).resume).toBe(false)
    controls.frame(frame({ pads: both([], [START]), state: 'paused' }))
    controls.frame(frame({ pads: both([], []), state: 'paused' }))
    // The bottom face button that goes on, a frame late on the second, never reaches the play as interact.
    expect(controls.frame(frame({ pads: both([SOUTH], []), state: 'paused' })).resume).toBe(true)
    expect(controls.frame(frame({ pads: both([SOUTH], [SOUTH]) })).interact).toBe(false)
    expect(controls.frame(frame({ pads: both([], [SOUTH]) })).interact).toBe(false)
    controls.frame(frame({ pads: both([], []) }))
    expect(controls.frame(frame({ pads: both([], [SOUTH]) })).interact).toBe(true)
    // One of the two gone, the other still there: the pad is not gone.
    expect(controls.frame(frame({ pads: [pad([], [0, 0], id), headset, null] })).pause).toBe(false)
  })

  it('stands him still when the pad driving him vanishes, and takes a pad back from its first press', () => {
    const controls = new GooseControls()
    expect(controls.frame(frame({ pads: [pad([SOUTH], [1, 0])] })).walk).not.toBeNull()
    const gone = controls.frame(frame({ pads: [null] }))
    expect(gone.walk).toBeNull()
    expect(gone.interact).toBe(false)
    expect(controls.frame(frame({ pads: [] })).walk).toBeNull()
    expect(controls.frame(frame({ pads: [pad([], [0, -1])] })).walk!.y).toBeCloseTo(-1)
  })

  it('pauses when the pad in use vanishes, where the game pauses', () => {
    const unplugged = (state: ControlsFrame['state'], last: 'pad' | 'keys' = 'pad') => {
      const controls = new GooseControls()
      controls.frame(frame({ pads: [pad([], [1, 0])], state }))
      if (last === 'keys') controls.frame(frame({ pads: [pad([], [1, 0])], pressed: new Set(['KeyW']), state }))
      return controls.frame(frame({ pads: [null], state })).pause
    }
    expect(unplugged('play')).toBe(true)
    expect(unplugged('opening')).toBe(true)
    expect(unplugged('ending')).toBe(true)
    // Back on the keys, the pad was not in use; and where there is no pause.
    expect(unplugged('play', 'keys')).toBe(false)
    expect(unplugged('loading')).toBe(false)
    expect(unplugged('paused')).toBe(false)
  })

  it('switches the device on keys, clicks and pads, and not on a pad resting or the mouse moving', () => {
    const controls = new GooseControls()
    expect(controls.frame(frame()).device).toBe('keyboard')
    expect(controls.frame(frame({ pads: [pad([], [0.1, 0])] })).device).toBe('keyboard')
    expect(controls.frame(frame({ pads: [pad([], [0.5, 0])] })).device).toBe('gamepad')
    // A frame with nothing new from the keys, the mouse alone having moved: still the pad.
    expect(controls.frame(frame({ pads: [pad([], [0.5, 0])] })).device).toBe('gamepad')
    expect(controls.frame(frame({ pressed: new Set(['KeyM']), keys: new Set(['KeyM']) })).device).toBe('keyboard')
    expect(controls.frame(frame({ pads: [pad([7])] })).device).toBe('gamepad')
    expect(controls.frame(frame({ clicked: true })).device).toBe('keyboard')
  })

  it('shows A, or ✕ on a PlayStation pad, by the pad last used', () => {
    const controls = new GooseControls()
    expect(controls.frame(frame()).glyph).toBe('A')
    expect(controls.frame(frame({ pads: [pad([SOUTH], [0, 0], 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')] })).glyph).toBe('✕')
    expect(controls.frame(frame({ pads: [null, pad([SOUTH])] })).glyph).toBe('A')
    expect(controls.frame(frame({ pads: [pad([SOUTH], [0, 0], 'Sony PLAYSTATION(R)3 Controller')] })).glyph).toBe('✕')
    expect(controls.frame(frame({ pads: [pad([SOUTH], [0, 0], 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 05c4) DUALSHOCK')] })).glyph).toBe('✕')
    // Back on the keyboard, the pad's glyph is kept for when it comes back.
    expect(controls.frame(frame({ clicked: true })).glyph).toBe('✕')
  })

  it('walks by the device last used, the other taking over while it has no walk', () => {
    const controls = new GooseControls()
    const keys = new Set(['KeyA'])
    expect(controls.frame(frame({ keys, pressed: keys })).walk!.x).toBeCloseTo(-1)
    // The stick pushed, the key still held: the stick walks him.
    expect(controls.frame(frame({ keys, pads: [pad([], [0, 0.6])] })).walk!.y).toBeCloseTo(1)
    // Let go: the key held walks him again.
    expect(controls.frame(frame({ keys, pads: [pad()] })).walk!.x).toBeCloseTo(-1)
    // A key pressed while the stick is pushed: the keys walk him; let go of them, the stick does.
    controls.frame(frame({ pads: [pad([], [0, 0.6])] }))
    const right = new Set(['KeyD'])
    expect(controls.frame(frame({ keys: right, pressed: right, pads: [pad([], [0, 0.6])] })).walk!.x).toBeCloseTo(1)
    expect(controls.frame(frame({ pads: [pad([], [0, 0.6])] })).walk!.y).toBeCloseTo(1)
  })

  it('plays a PlayStation pad in Firefox, on Windows or macOS, as the standard layout', () => {
    // Its d-pad as one axis, by the way it is pushed; at rest, past them all.
    const HAT: Record<string, number> = { '': 1.2857, U: -1, UR: -0.7143, R: -0.4286, DR: -0.1429, D: 0.1429, DL: 0.4286, L: 0.7143, UL: 1 }
    const STANDARD: Record<string, number[]> = { '': [], U: [UP], UR: [UP, RIGHT], R: [RIGHT], DR: [DOWN, RIGHT], D: [DOWN], DL: [DOWN, LEFT], L: [LEFT], UL: [UP, LEFT] }
    /** The pad Firefox reports for a DualSense on `os`, with no layout: ✕ is its button 1, square its 0, Start its 9, the d-pad on an axis. */
    const firefox = (os: 'windows' | 'macos', down: ('cross' | 'square' | 'start')[], hat: string, stick: [number, number] = [0, 0]): PadSnapshot => {
      const index = { square: 0, cross: 1, start: 9 }
      const buttons = Array.from({ length: os === 'windows' ? 16 : 15 }, (_, k) => ({ value: down.some((one) => index[one] === k) ? 1 : 0 }))
      // Windows: the triggers at rest on axes 3 and 4, the d-pad on 9; macOS: the triggers on 4 and 5, the d-pad on 6.
      const axes = os === 'windows' ? [stick[0], stick[1], 0, -1, -1, 0, 0, 0, 0, HAT[hat]!] : [stick[0], stick[1], 0, 0, -1, -1, HAT[hat]!]
      return { id: '054c-0ce6-Wireless Controller', mapping: '', buttons, axes }
    }
    const asked = (pads: PadSnapshot[], state: ControlsFrame['state'] = 'play') => {
      const { walk, interact, skip, confirm, device, glyph } = new GooseControls().frame(frame({ pads, state }))
      return { walk: walk && { x: +walk.x.toFixed(3), y: +walk.y.toFixed(3), strength: +walk.strength.toFixed(3) }, interact, skip, confirm, device, glyph }
    }
    const dualsense = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'
    for (const os of ['windows', 'macos'] as const) {
      for (const hat of Object.keys(HAT)) expect(asked([firefox(os, [], hat)]), `${os} ${hat}`).toEqual(asked([pad(STANDARD[hat], [0, 0], dualsense)]))
      expect(asked([firefox(os, [], '', [0.4, -0.5])]), os).toEqual(asked([pad([], [0.4, -0.5], dualsense)]))
      expect(asked([firefox(os, ['cross'], '')]), os).toEqual(asked([pad([SOUTH], [0, 0], dualsense)]))
      expect(asked([firefox(os, ['cross'], '')], 'opening'), os).toEqual(asked([pad([SOUTH], [0, 0], dualsense)], 'opening'))
      expect(asked([firefox(os, ['start'], '')], 'loading'), os).toEqual(asked([pad([START], [0, 0], dualsense)], 'loading'))
      // Square, its button 0, is the standard layout's bottom face button, and here unbound.
      expect(asked([firefox(os, ['square'], '')], 'loading').confirm, os).toBe(false)
    }
  })
})
