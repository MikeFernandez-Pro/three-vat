// The recording, turned into the one image format npm will animate.
//
// GIF rather than a video because half this library's audience meets it on the
// npm page, which strips `<video>` and plays nothing. That choice sets the whole
// problem: 256 colours, no interframe prediction, and a README budget. Two
// decisions buy it back, and both are here rather than in the driver because
// both are pure and neither wants a browser to be tested.
//
// **One palette for the whole recording.** Quantized across every frame at once,
// so the sky does not shift hue halfway through the drag — and so a pixel that
// did not move indexes identically in consecutive frames, which is what makes
// the second decision possible at all.
//
// **Only the pixels that moved are written.** Everything else is the transparent
// index over an undisposed previous frame. In this recording that is most of the
// image: the sky, the ground, the HUD's static lines and both texture strips are
// the same pixels from the first frame to the last. The crowd and the cursors
// are what changes, and they are what the GIF pays for.
// gifenc predates the `exports` field, so the two runtimes that read this file
// resolve it differently: vite follows `module` to an ESM build with named
// exports, node follows `main` to a CommonJS build whose whole surface arrives
// as `default`. A namespace import covers both — and the test is for a *named*
// export rather than for `default`, because gifenc has a default too and it is
// a function, not the module.
import * as gifenc from 'gifenc'

const { GIFEncoder, applyPalette, quantize } =
  'quantize' in gifenc ? gifenc : /** @type {any} */ (gifenc).default

/**
 * What the hero image may weigh.
 *
 * A README hero is loaded before the reader has decided to care, on the npm page
 * and on a phone, and it is the first thing there — so it is the one asset that
 * cannot be allowed to cost a second of blank screen.
 *
 * Set near what the capture actually weighs rather than at the largest tolerable
 * image: a ceiling with room for the file to triple under it is a ceiling that
 * cannot report the regression it exists to catch. Raise it deliberately, and
 * only alongside a decision to spend the bytes.
 */
export const HERO_BUDGET_BYTES = 1_500_000

/**
 * Blank out every pixel this frame shares with the one before it.
 *
 * @param {Uint8Array | null} previous Indices of the frame behind this one, or
 *   null for the first frame, which has nothing behind it and is written whole.
 * @param {Uint8Array} current Indices of this frame.
 * @param {number} transparentIndex A palette slot no real pixel can occupy.
 * @returns {Uint8Array} A fresh array; `current` is left alone.
 */
export function maskUnchanged(previous, current, transparentIndex) {
  if (!previous) return Uint8Array.from(current)
  if (previous.length !== current.length) {
    throw new Error(
      `frames differ in size: ${previous.length} indices behind ${current.length}`,
    )
  }
  const masked = Uint8Array.from(current)
  for (let i = 0; i < masked.length; i++) {
    if (previous[i] === current[i]) masked[i] = transparentIndex
  }
  return masked
}

/**
 * @typedef {object} EncodeOptions
 * @property {ArrayLike<number>[]} frames RGBA pixels per frame, in order.
 * @property {number} width
 * @property {number} height
 * @property {number} fps    Playback rate of the finished GIF.
 * @property {number} maxColors Size of the colour table, transparent slot included.
 */

/**
 * Encode the captured frames as one looping GIF.
 *
 * @param {EncodeOptions} options
 * @returns {Uint8Array}
 */
export function encodeHeroGif({ frames, width, height, fps, maxColors }) {
  if (frames.length === 0) throw new Error('nothing to encode: the recording has no frames')

  // Quantized over the whole recording at once. The top slot is held back for
  // transparency, so `applyPalette` can never place a real pixel there and a
  // moving robot can never punch a hole in the frame behind it.
  const everything = concatRGBA(frames)
  const palette = quantize(everything, maxColors - 1)
  const transparentIndex = palette.length
  const table = [...palette, [0, 0, 0]]

  const gif = GIFEncoder()
  /** @type {Uint8Array | null} */
  let previous = null
  for (const frame of frames) {
    const indices = applyPalette(asBytes(frame), palette)
    const first = previous === null
    gif.writeFrame(maskUnchanged(previous, indices, transparentIndex), width, height, {
      palette: first ? table : undefined,
      delay: 1000 / fps,
      transparent: !first,
      transparentIndex,
      // "Do not dispose": leave the frame on screen, which is what the pixels
      // masked out of the next frame are asking to see.
      dispose: 1,
    })
    previous = indices
  }
  gif.finish()
  return gif.bytesView()
}

/** One RGBA buffer holding every frame, for the palette to be drawn from. */
function concatRGBA(/** @type {ArrayLike<number>[]} */ frames) {
  const all = new Uint8Array(frames.reduce((n, frame) => n + frame.length, 0))
  let at = 0
  for (const frame of frames) {
    all.set(asBytes(frame), at)
    at += frame.length
  }
  return all
}

/**
 * gifenc reads RGBA through a `Uint32Array` over the whole buffer, so a frame is
 * handed on as-is only when it *is* the whole buffer — a clamped array or a view
 * into a larger one is copied rather than reinterpreted. At a megabyte a frame
 * this is the difference between borrowing the recording and duplicating it.
 */
function asBytes(/** @type {any} */ frame) {
  const whole =
    ArrayBuffer.isView(frame) && frame.byteOffset === 0 && frame.byteLength === frame.buffer.byteLength
  return whole ? new Uint8Array(frame.buffer) : Uint8Array.from(frame)
}
