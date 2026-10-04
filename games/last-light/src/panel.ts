// The settings panel and the readouts: what makes the swarm tunable and
// measurable. The panel is three's own copy of lil-gui, so the game installs
// nothing for it; the readouts are one line of text, top-left.
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js'

/** What the panel edits. The page reads it, and is told when a group of it changes. */
export interface Settings {
  rats: number
  minSpeed: number
  maxSpeed: number
  strength: number
  on: boolean
  shadows: boolean
}

export interface PanelEvents {
  /** The rats slider was let go. */
  count(): void
  /** A speed slider moved: once a move, never a frame. */
  speeds(): void
  /** The strength slider moved, or the light was put out or relit. */
  light(): void
  /** The shadows toggle flipped. */
  shadows(): void
}

/** The panel, its rats slider topped at `maxRats`. Space puts the light out and relights it, as its button does. */
export function createPanel(settings: Settings, maxRats: number, changed: PanelEvents): void {
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
  const actions = { toggleLight }
  const button = gui.add(actions, 'toggleLight')
  gui.add(settings, 'shadows').onChange(changed.shadows)

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

/** What one frame measured, for the readouts. */
export interface FrameSample {
  drawn: number
  count: number
  steeringMs: number
  frameMs: number
}

/** How often the readouts change, in seconds: each shows the mean of the frames since. */
const READOUT_PERIOD = 0.5

/** The readout line: rats drawn, steering ms, frame ms, and the backend drawing them. */
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
      `steering ${(steering / frames).toFixed(2)} ms · frame ${(frame / frames).toFixed(2)} ms · ${backend}`
    frames = steering = frame = drawn = 0
  }
}
