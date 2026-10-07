// A brush's strokes as a height field, for the shell's painted normals: short
// soft strokes laid mostly one way over a mid grey, drawn into a canvas that
// wraps, so it tiles over a body. Bump-mapped, each stroke tilts the normal a
// little, and the toon steps' edges wobble as if painted by hand. Redrawn at
// another stroke size on the same seed, so the strokes grow where they are.
import { CanvasTexture, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping } from 'three/webgpu'

/** Texels a side. */
const SIZE = 512
/**
 * How far past its edges the canvas is padded with its own tiling before the
 * blur, texels: well past the blur's reach, so the blur reads the stroke that
 * continues over the edge, not the empty outside, and the texture still tiles.
 */
const PAD = 8
/** Strokes laid. */
const STROKES = 900
/** How far a stroke may turn from the brush's direction, radians either way. */
const SPREAD = 0.6

/** mulberry32, seeded: the same strokes every run. */
function random(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A strokes texture and its brush: `draw` lays the strokes again at `size` times their usual length and width. */
export interface Strokes {
  readonly texture: CanvasTexture
  draw(size: number): void
}

/** The strokes, as a texture that repeats: height in any channel, 0.5 the flat canvas. Drawn at size 1. */
export function createStrokes(): Strokes {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIZE
  const context = canvas.getContext('2d')!
  // The strokes, drawn sharp and blurred once from here: a canvas filter is
  // applied per draw, and 8,100 blurred strokes a redraw was enough to hang
  // the GPU process in Chrome (its watchdog then kills it, and the renderer
  // loses its device). One blur over the finished strokes costs one pass.
  const padded = document.createElement('canvas')
  padded.width = padded.height = SIZE + 2 * PAD
  const paddedContext = padded.getContext('2d')!
  const texture = new CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.colorSpace = NoColorSpace
  texture.minFilter = LinearMipmapLinearFilter
  texture.anisotropy = 4
  const draw = (size: number) => {
    context.filter = 'none'
    context.fillStyle = '#808080'
    context.fillRect(0, 0, SIZE, SIZE)
    context.lineCap = 'round'
    // The same seed every draw: a stroke keeps its place and its way as it grows.
    const next = random(11)
    // Drawn nine times, a tile's offset each way, so a stroke over an edge continues on the other side.
    const offsets = [-SIZE, 0, SIZE]
    for (let i = 0; i < STROKES; i++) {
      const x = next() * SIZE
      const y = next() * SIZE
      const angle = (next() - 0.5) * 2 * SPREAD
      const length = SIZE * (0.05 + next() * 0.12) * size
      const dx = (Math.cos(angle) * length) / 2
      const dy = (Math.sin(angle) * length) / 2
      const tone = Math.round(128 + (next() - 0.5) * 110)
      context.strokeStyle = `rgba(${tone}, ${tone}, ${tone}, ${(0.35 + next() * 0.35).toFixed(2)})`
      context.lineWidth = SIZE * (0.006 + next() * 0.018) * size
      for (const ox of offsets) {
        for (const oy of offsets) {
          context.beginPath()
          context.moveTo(x + ox - dx, y + oy - dy)
          context.lineTo(x + ox + dx, y + oy + dy)
          context.stroke()
        }
      }
    }
    // A soft edge, so the tilt comes and goes rather than steps: one blur over
    // the lot, read from the canvas tiled round itself so the edges wrap.
    paddedContext.filter = 'none'
    for (const ox of offsets) for (const oy of offsets) paddedContext.drawImage(canvas, PAD + ox, PAD + oy)
    context.filter = 'blur(1px)'
    context.drawImage(padded, -PAD, -PAD)
    context.filter = 'none'
    texture.needsUpdate = true
  }
  draw(1)
  return { texture, draw }
}
