// The comparator at the heart of the release gate (#14). Everything else in the
// gate needs a GPU; this does not, so the one piece that decides pass or fail is
// pinned here and runs in CI with the rest of the suite.
//
// The two properties that matter are opposites, and a tolerance that gets either
// one wrong makes the whole gate worthless:
//
//   * a backend difference — a hair of shading, a rounding edge — must pass;
//   * a decode divergence — vertices in the wrong place — must fail.
import { describe, expect, it } from 'vitest'
import { diffFrames, flipRows, isBlank, PARITY_TOLERANCE, withinTolerance } from './compare.js'

const SIZE = { width: 16, height: 16 }
const PIXELS = SIZE.width * SIZE.height

/** A frame painted by `paint(x, y)` → `[r, g, b]`. Alpha is always opaque. */
function frame(paint: (x: number, y: number) => [number, number, number]): Uint8Array {
  const data = new Uint8Array(PIXELS * 4)
  for (let y = 0; y < SIZE.height; y++) {
    for (let x = 0; x < SIZE.width; x++) {
      const i = (y * SIZE.width + x) * 4
      const [r, g, b] = paint(x, y)
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
  return data
}

/** A recognisable scene: a bright 10x10 square on a dark ground, in the top-left. */
const scene = () => frame((x, y) => (x < 10 && y < 10 ? [200, 180, 160] : [20, 24, 30]))

/** The same square, moved `dx` to the right — a decode divergence, in miniature. */
const moved = (dx: number) => frame((x, y) => (x >= dx && x < 10 + dx && y < 10 ? [200, 180, 160] : [20, 24, 30]))

describe('diffFrames', () => {
  it('reports nothing for identical frames', () => {
    const diff = diffFrames(scene(), scene(), SIZE)

    expect(diff).toMatchObject({ pixels: PIXELS, drawn: 100, differing: 0, maxChannelDelta: 0, meanChannelDelta: 0 })
    expect(withinTolerance(diff)).toBe(true)
  })

  it('passes a whole-frame shading difference smaller than the channel tolerance', () => {
    // What two backends genuinely do to each other: every pixel a shade off.
    const shifted = diffFrames(
      scene(),
      frame((x, y) => (x < 10 && y < 10 ? [203, 183, 163] : [23, 27, 33])),
      SIZE,
    )

    expect(shifted.maxChannelDelta).toBe(3)
    expect(shifted.differing).toBe(0)
    expect(withinTolerance(shifted)).toBe(true)
  })

  it('fails when enough pixels move, however small the move', () => {
    // A decode divergence is not subtle *everywhere*, but it can be subtle
    // everywhere it is not — what gives it away is the count of pixels that
    // went well past the shading tolerance.
    const diff = diffFrames(scene(), moved(1), SIZE)

    expect(diff.differing).toBeGreaterThan(diff.drawn * PARITY_TOLERANCE.differingFraction)
    expect(withinTolerance(diff)).toBe(false)
  })

  it('tolerates a stray edge pixel, so rasterisation at a silhouette is not a failure', () => {
    // One pixel of the square's 100 is 1% — inside the 2% budget.
    const edge = diffFrames(
      scene(),
      frame((x, y) => (x === 9 && y === 9 ? [20, 24, 30] : x < 10 && y < 10 ? [200, 180, 160] : [20, 24, 30])),
      SIZE,
    )

    expect(edge.differing).toBe(1)
    expect(withinTolerance(edge)).toBe(true)
  })

  it('budgets against what is drawn, not against the canvas', () => {
    // A small crowd in a big frame, diverging across a fifth of itself. Three
    // pixels of 256 is 1.2% of the canvas — inside a canvas-relative budget,
    // which is what makes a canvas-relative budget worthless: it loosens itself
    // every time the camera pulls back.
    const small = frame((x, y) => (x < 4 && y < 4 ? [200, 180, 160] : [20, 24, 30]))
    const diverged = frame((x, y) => (y === 0 && x > 0 && x < 4 ? [20, 24, 30] : x < 4 && y < 4 ? [200, 180, 160] : [20, 24, 30]))

    const diff = diffFrames(small, diverged, SIZE)

    expect(diff.drawn).toBe(16)
    expect(diff.differing).toBe(3)
    expect(diff.differing).toBeLessThan(diff.pixels * PARITY_TOLERANCE.differingFraction)
    expect(withinTolerance(diff)).toBe(false)
  })

  it('counts a pixel once, however many of its channels moved', () => {
    const diff = diffFrames(
      scene(),
      frame((x, y) => (x === 0 && y === 0 ? [0, 0, 0] : x < 10 && y < 10 ? [200, 180, 160] : [20, 24, 30])),
      SIZE,
    )

    expect(diff.differing).toBe(1)
    expect(diff.maxChannelDelta).toBe(200)
  })

  it('ignores alpha, which the two backends write into a render target differently', () => {
    const opaque = scene()
    const transparent = scene()
    for (let i = 3; i < transparent.length; i += 4) transparent[i] = 0

    expect(withinTolerance(diffFrames(opaque, transparent, SIZE))).toBe(true)
  })

  it('refuses frames of different lengths rather than comparing part of one', () => {
    expect(() => diffFrames(scene(), new Uint8Array(4), SIZE)).toThrow(/size/i)
  })
})

describe('flipRows', () => {
  it('turns a bottom-up readback into a top-down one', () => {
    const topLeftBright = scene()
    const bottomLeftBright = frame((x, y) => (x < 10 && y >= SIZE.height - 10 ? [200, 180, 160] : [20, 24, 30]))

    expect(flipRows(topLeftBright, SIZE)).toEqual(bottomLeftBright)
  })

  it('is its own inverse', () => {
    expect(flipRows(flipRows(scene(), SIZE), SIZE)).toEqual(scene())
  })
})

describe('isBlank', () => {
  // Guards the guard: two empty frames match perfectly, so a harness that drew
  // nothing on either path would otherwise report the cleanest pass of its life.
  it('spots a frame with nothing drawn in it', () => {
    expect(isBlank(frame(() => [20, 24, 30]))).toBe(true)
  })

  it('accepts a frame with something in it', () => {
    expect(isBlank(scene())).toBe(false)
  })

  it('is not fooled by a single stray bright pixel', () => {
    const speck = frame((x, y) => (x === 0 && y === 0 ? [255, 255, 255] : [20, 24, 30]))

    expect(isBlank(speck)).toBe(true)
  })

  it('counts the crowd, not the canvas, when deciding a frame has something in it', () => {
    // 100 of 256 pixels — a frame with a crowd in it, at any framing.
    expect(isBlank(scene())).toBe(false)
  })
})
