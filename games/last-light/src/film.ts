// Filming: the travelling, and under `?film` a small panel for a take. T
// turns the camera a quarter round the light from wherever the mouse left it,
// at that distance and height, easing out of rest and back into it; the
// panel sets how long the quarter takes and which way it goes, plays it, and
// copies where the camera stands from the light, so a take's start can be
// written down exactly and set again. H hides the panel for the recording.
//
// The turn runs on the frame, not the game's time, so a paused scene still
// turns: a take can open on a still that starts to move.
import type { PerspectiveCamera } from 'three/webgpu'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js'

export interface Film {
  /** Play a quarter turn from where the camera is now. Pressed mid-turn, a new quarter starts from there. */
  play(): void
  /** Set the turn's share of this frame, `frame` s since the last, on the controls; call just before they update with the same `frame`. */
  update(frame: number): void
}

/** The turn, rad: a quarter, enough to show the pile has depth and the ring is round, not so much that the scene's back comes round. */
const TURN = Math.PI / 2
/** How the turn's angle runs over its time: slow out of rest, slow into it. */
const smooth = (u: number) => u * u * (3 - 2 * u)

export function createFilm(camera: PerspectiveCamera, controls: OrbitControls, light: { x: number; z: number }, panel: boolean): Film {
  // How long a quarter takes, s: three seconds reads the depth without holding a fifteen-second take; chosen on 2026-10-08.
  const settings = { seconds: 3, clockwise: true }
  /** Where in the turn, s, and how far it has turned, rad; not playing when `at` is past the end. */
  let at = Infinity
  let turned = 0

  function play() {
    at = 0
    turned = 0
  }

  function update(frame: number) {
    const playing = at < settings.seconds && frame > 0
    controls.autoRotate = playing
    if (!playing) return
    at = Math.min(settings.seconds, at + frame)
    const angle = TURN * smooth(at / settings.seconds)
    // The controls turn (2 pi / 60 * speed) * frame on their update: the speed that makes it this frame's share of the turn.
    controls.autoRotateSpeed = ((settings.clockwise ? 1 : -1) * ((angle - turned) / frame) * 60) / (2 * Math.PI)
    turned = angle
  }

  /** Where the camera and its target stand from the light, to the centimetre, one line to paste. */
  function placing(): string {
    const cm = (v: number) => (Math.round(v * 100) / 100).toFixed(2)
    const from = (x: number, y: number, z: number) => `${cm(x - light.x)}, ${cm(y)}, ${cm(z - light.z)}`
    const p = camera.position
    const t = controls.target
    return `camera from light (x, y, z): ${from(p.x, p.y, p.z)}; target from light: ${from(t.x, t.y, t.z)}`
  }

  let gui: GUI | undefined
  if (panel) {
    gui = new GUI({ title: 'Film' })
    gui.add(settings, 'seconds', 0.5, 12, 0.1).name('quarter turn s')
    gui.add(settings, 'clockwise')
    gui.add({ play }, 'play').name('quarter turn (T)')
    const copy = gui.add({ copy: copyPlacing }, 'copy').name('copy camera')
    function copyPlacing() {
      const text = placing()
      // The console has it too, for a page the clipboard is closed to.
      console.log(text)
      navigator.clipboard?.writeText(text).catch(() => {})
      copy.name('copied')
      setTimeout(() => copy.name('copy camera'), 1500)
    }
  }
  let hidden = false

  // Captured on the way down: lil-gui stops keys from bubbling out of the panel.
  addEventListener(
    'keydown',
    (event) => {
      if (event.target instanceof HTMLInputElement || event.repeat) return
      if (event.code === 'KeyT') play()
      else if (event.code === 'KeyH' && gui) {
        hidden = !hidden
        gui.show(!hidden)
      }
    },
    { capture: true },
  )

  return { play, update }
}
