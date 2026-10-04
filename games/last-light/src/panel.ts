// The settings panel and the readouts: what makes the swarm tunable and
// measurable. The panel is three's own copy of lil-gui, so the game installs
// nothing for it; the readouts are one line of text, top-left.
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js'

/** The camera zoom's range: from twice as far as usual to two and a half times as close. */
export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 2.5

/** What the panel edits. The page reads it, and is told when a group of it changes. */
export interface Settings {
  rats: number
  minSpeed: number
  maxSpeed: number
  strength: number
  /** How far past the light's edge the rats still care about it, in metres. */
  spread: number
  on: boolean
  shadows: boolean
  /** How close the camera sits: 1 at its usual place, more closer, less further. */
  zoom: number
}

/**
 * How the scene looks, every control in the panel's look folders. Colours are
 * hex numbers; angles are degrees; distances metres.
 */
export interface Look {
  /** The warm light the holder carries: its reach is where it fades to nothing, its falloff how fast it gets there. */
  lamp: { color: number; intensity: number; reach: number; falloff: number }
  /**
   * The one light from far away: where it sits from the light it follows, in
   * metres, which sets the way it shines; and how soft its shadows' edges are.
   */
  sun: { color: number; intensity: number; x: number; y: number; z: number; shadows: boolean; softness: number }
  /** The cold fill: a colour from above, another from below. */
  fill: { sky: number; ground: number; intensity: number }
  /** The fog round the light, which the sky shares: clear up to `near` metres from the light, solid from `far`. */
  fog: { color: number; near: number; far: number }
  /** The tint over the rat's own colours. */
  rats: { color: number }
}

export interface PanelEvents {
  /** The rats slider was let go. */
  count(): void
  /** A speed slider moved: once a move, never a frame. */
  speeds(): void
  /** The spread slider moved. */
  spread(): void
  /** The strength slider moved, or the light was put out or relit. */
  light(): void
  /** The lamp's shadows toggle flipped. */
  shadows(): void
  /** Any control in a look folder moved. */
  look(): void
}

/** The panel, its rats slider topped at `maxRats`. Space puts the light out and relights it, as its button does. */
export function createPanel(settings: Settings, look: Look, maxRats: number, changed: PanelEvents): void {
  const gui = new GUI({ title: 'Last Light' })
  gui.add(settings, 'rats', 0, maxRats, 1).onFinishChange(changed.count)

  // Each slider keeps the pair in order, so the slowest never outruns the fastest.
  const min = gui.add(settings, 'minSpeed', 0.2, 4, 0.05).name('slowest m/s')
  const max = gui.add(settings, 'maxSpeed', 0.2, 4, 0.05).name('fastest m/s')
  min.onChange(() => {
    if (settings.maxSpeed < settings.minSpeed) max.setValue(settings.minSpeed)
    changed.speeds()
  })
  max.onChange(() => {
    if (settings.minSpeed > settings.maxSpeed) min.setValue(settings.maxSpeed)
    changed.speeds()
  })

  gui.add(settings, 'strength', 0, 1, 0.01).name('light strength').onChange(changed.light)
  gui.add(settings, 'spread', 0, 40, 0.1).name('spread m (past the light)').onChange(changed.spread)
  // Listening, so the wheel and the keys move it too.
  gui.add(settings, 'zoom', ZOOM_MIN, ZOOM_MAX, 0.01).name('camera zoom (wheel, +/-)').decimals(2).listen()
  const actions = { toggleLight }
  const button = gui.add(actions, 'toggleLight')
  addLook(gui, settings, look, changed)

  function label() {
    button.name(settings.on ? 'put the light out (space)' : 'relight (space)')
  }
  function toggleLight() {
    settings.on = !settings.on
    label()
    changed.light()
  }
  label()

  // Captured on the way down: lil-gui stops keys from bubbling out of the panel.
  addEventListener(
    'keydown',
    (event) => {
      if (event.code !== 'Space' || event.repeat) return
      // Whatever in the panel was last clicked keeps the focus, and would answer
      // the space too: the shadows toggle would flip, or the button click twice.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      event.preventDefault()
      toggleLight()
    },
    { capture: true },
  )
}

/** The look folders, closed to start so the swarm's controls stay in view. */
function addLook(gui: GUI, settings: Settings, look: Look, changed: PanelEvents): void {
  const lamp = gui.addFolder('lamp').close()
  lamp.addColor(look.lamp, 'color')
  lamp.add(look.lamp, 'intensity', 0, 150, 1)
  lamp.add(look.lamp, 'reach', 0, 30, 0.1).name('reach m (0 = endless)')
  lamp.add(look.lamp, 'falloff', 0, 3, 0.05).name('falloff (fade/sharp)')
  lamp.add(settings, 'shadows').name('shadows').onChange(changed.shadows)

  const sun = gui.addFolder('sun').close()
  sun.addColor(look.sun, 'color')
  sun.add(look.sun, 'intensity', 0, 5, 0.05)
  sun.add(look.sun, 'x', -30, 30, 0.5).name('position x m')
  sun.add(look.sun, 'y', 1, 40, 0.5).name('position y m')
  sun.add(look.sun, 'z', -30, 30, 0.5).name('position z m')
  sun.add(look.sun, 'shadows')
  sun.add(look.sun, 'softness', 0, 8, 0.1).name('shadow softness')

  const fill = gui.addFolder('fill').close()
  fill.addColor(look.fill, 'sky')
  fill.addColor(look.fill, 'ground')
  fill.add(look.fill, 'intensity', 0, 3, 0.05)

  const fog = gui.addFolder('fog').close()
  fog.addColor(look.fog, 'color')
  fog.add(look.fog, 'near', 0, 30, 0.25).name('clear to m')
  fog.add(look.fog, 'far', 1, 60, 0.25).name('solid from m')

  const rats = gui.addFolder('rats').close()
  rats.addColor(look.rats, 'color').name('tint')

  for (const folder of [lamp, sun, fill, fog, rats]) folder.onChange(changed.look)
}

/** What one frame measured, for the readouts. */
export interface FrameSample {
  drawn: number
  count: number
  steeringMs: number
  frameMs: number
}

/** How often the readouts change, in seconds: each shows the mean of the frames since. */
const READOUT_PERIOD = 0.5

/** The readout line: rats drawn, steering ms, frame ms, frames a second, and the backend drawing them. */
export function createReadouts(backend: string): (sample: FrameSample) => void {
  const line = document.createElement('div')
  line.id = 'readouts'
  document.body.append(line)

  let frames = 0
  let steering = 0
  let frame = 0
  let drawn = 0
  return (sample) => {
    frames++
    steering += sample.steeringMs
    frame += sample.frameMs
    drawn += sample.drawn
    if (frame < READOUT_PERIOD * 1000) return
    line.textContent =
      `${Math.round(drawn / frames)} / ${sample.count} rats drawn · ` +
      `steering ${(steering / frames).toFixed(2)} ms · frame ${(frame / frames).toFixed(2)} ms · ` +
      `${Math.round((frames * 1000) / frame)} fps · ${backend}`
    frames = steering = frame = drawn = 0
  }
}
