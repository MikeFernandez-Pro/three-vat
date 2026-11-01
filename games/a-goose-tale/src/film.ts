// Filming: the travelling. T turns the camera a quarter round the light from
// wherever the mouse left it, pulling back as it turns, easing out of rest and
// back into it.
//
// The turn runs on the frame, not the game's time, so a paused scene still
// turns: a take can open on a still that starts to move.
import { type PerspectiveCamera, Vector3 } from 'three/webgpu'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

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
// How long a quarter takes, s: three seconds reads the depth without holding a fifteen-second take; which way it
// turns; and how far the camera ends from the light as a share of where it started, 1 staying put: a third again
// shows the dark field round the ring, which the fog keeps the same size, without the ring going small. Chosen on
// 2026-10-08, from a panel since removed.
const SECONDS = 3
const CLOCKWISE = true
const DEZOOM = 1.3

export function createFilm(camera: PerspectiveCamera, controls: OrbitControls): Film {
  /** Where in the turn, s, and how far it has turned, rad; not playing when `at` is past the end. */
  let at = Infinity
  let turned = 0
  /** How far the camera stood from its target as the last turn began, m: the pull-back goes from there. */
  let began = 0
  const offset = new Vector3()

  function play() {
    at = 0
    turned = 0
    began = camera.position.distanceTo(controls.target)
  }

  function update(frame: number) {
    const playing = at < SECONDS && frame > 0
    controls.autoRotate = playing
    if (!playing) return
    at = Math.min(SECONDS, at + frame)
    const eased = smooth(at / SECONDS)
    const angle = TURN * eased
    // The pull-back, on the same ease: the camera set at the turn's distance from its target, the way it already stands. The
    // controls read where the camera is at each update, so this is all the dolly takes.
    offset.copy(camera.position).sub(controls.target).setLength(began * (1 + (DEZOOM - 1) * eased))
    camera.position.copy(controls.target).add(offset)
    // The controls turn (2 pi / 60 * speed) * frame on their update: the speed that makes it this frame's share of the turn.
    controls.autoRotateSpeed = ((CLOCKWISE ? 1 : -1) * ((angle - turned) / frame) * 60) / (2 * Math.PI)
    turned = angle
  }

  // Captured on the way down: the game's panel (lil-gui) stops keys from bubbling out of it.
  addEventListener(
    'keydown',
    (event) => {
      if (event.target instanceof HTMLInputElement || event.repeat) return
      if (event.code === 'KeyT') play()
    },
    { capture: true },
  )

  return { play, update }
}
