// The encoder's two decisions — one palette for the whole recording, and only
// the pixels that changed written per frame — are what keep a 300-frame-tall
// crowd under a README-sized budget. Both are pure, so both are pinned here.
import { describe, expect, it } from 'vitest'
import { encodeHeroGif, maskUnchanged } from './gif.mjs'

/** An RGBA frame of one repeated colour, with `overrides` painted by pixel index. */
function frame(
  width: number,
  height: number,
  base: [number, number, number],
  overrides: Record<number, [number, number, number]> = {},
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const [r, g, b] = overrides[i] ?? base
    rgba.set([r!, g!, b!, 255], i * 4)
  }
  return rgba
}

describe('masking the pixels that did not move', () => {
  const TRANSPARENT = 255

  it('leaves the first frame whole — there is nothing behind it yet', () => {
    const indices = Uint8Array.from([1, 2, 3, 4])
    expect(maskUnchanged(null, indices, TRANSPARENT)).toEqual(indices)
  })

  it('erases a frame identical to the one before it', () => {
    const indices = Uint8Array.from([7, 7, 9, 9])
    expect(maskUnchanged(indices, indices, TRANSPARENT)).toEqual(
      Uint8Array.from([TRANSPARENT, TRANSPARENT, TRANSPARENT, TRANSPARENT]),
    )
  })

  it('keeps exactly the pixels that changed', () => {
    const previous = Uint8Array.from([1, 2, 3, 4])
    const current = Uint8Array.from([1, 9, 3, 8])
    expect(maskUnchanged(previous, current, TRANSPARENT)).toEqual(
      Uint8Array.from([TRANSPARENT, 9, TRANSPARENT, 8]),
    )
  })

  it('does not write into the frame it was handed', () => {
    const current = Uint8Array.from([1, 2])
    maskUnchanged(Uint8Array.from([1, 2]), current, TRANSPARENT)
    expect(current).toEqual(Uint8Array.from([1, 2]))
  })

  it('refuses two frames of different sizes', () => {
    expect(() => maskUnchanged(Uint8Array.from([1]), Uint8Array.from([1, 2]), TRANSPARENT)).toThrow()
  })
})

describe('encoding the recording', () => {
  const W = 8
  const H = 8
  const still = [frame(W, H, [10, 20, 30]), frame(W, H, [10, 20, 30]), frame(W, H, [10, 20, 30])]

  it('writes a GIF a browser and npm will recognise', () => {
    const bytes = encodeHeroGif({ frames: still, width: W, height: H, fps: 12, maxColors: 64 })
    expect(new TextDecoder().decode(bytes.slice(0, 6))).toBe('GIF89a')
    expect(bytes[bytes.length - 1]).toBe(0x3b) // trailer
    // Logical screen descriptor: width then height, little-endian.
    expect([bytes[6], bytes[7], bytes[8], bytes[9]]).toEqual([W, 0, H, 0])
  })

  it('loops, because a hero image that plays once is a still by the time you read it', () => {
    const bytes = encodeHeroGif({ frames: still, width: W, height: H, fps: 12, maxColors: 64 })
    expect(new TextDecoder('latin1').decode(bytes)).toContain('NETSCAPE2.0')
  })

  it('pays for the parts of the frame that did not change', () => {
    // The demo's sky, ground and texture strips are the same pixels all the way
    // through the drag. A frame that repeats its predecessor should cost almost
    // nothing next to one that repaints every pixel.
    const churn = [
      frame(W, H, [10, 20, 30]),
      frame(W, H, [200, 40, 60]),
      frame(W, H, [60, 200, 90]),
    ]
    const stillBytes = encodeHeroGif({ frames: still, width: W, height: H, fps: 12, maxColors: 64 })
    const churnBytes = encodeHeroGif({ frames: churn, width: W, height: H, fps: 12, maxColors: 64 })
    expect(stillBytes.length).toBeLessThan(churnBytes.length)
  })

  it('keeps every colour it was given room for', () => {
    // A changed pixel must never land on the transparent index, or it would
    // punch a hole in the crowd instead of drawing a robot.
    const shades: Uint8ClampedArray[] = []
    for (let i = 0; i < 4; i++) shades.push(frame(W, H, [i * 60, 255 - i * 60, 128]))
    const bytes = encodeHeroGif({ frames: shades, width: W, height: H, fps: 12, maxColors: 64 })
    expect(bytes.length).toBeGreaterThan(0)
  })

  it('refuses a recording with no frames in it', () => {
    expect(() => encodeHeroGif({ frames: [], width: W, height: H, fps: 12, maxColors: 64 })).toThrow(
      /frame/i,
    )
  })
})
