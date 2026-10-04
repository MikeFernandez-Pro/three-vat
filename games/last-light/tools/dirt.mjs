// Paints the ground's dirt: a tileable, hand-painted-looking texture, written to
// public/textures/dirt.png. No dependencies: wrapping noise for the soil, cut
// into a few flat tones, thin cracks, clusters of flat-shaded pebbles lit from
// the upper left, and the PNG encoded by hand over node's zlib.
//
//   node tools/dirt.mjs [size] [seed]
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = Number(process.argv[2] ?? 1024)
const SEED = Number(process.argv[3] ?? 3)
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/textures/dirt.png')

/** mulberry32, as the swarm's. */
function random(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = random(SEED)

/** Value noise on a grid of `cells` that wraps, so the texture tiles. */
function layer(cells) {
  const grid = Float32Array.from({ length: cells * cells }, rand)
  const smooth = (t) => t * t * (3 - 2 * t)
  return (u, v) => {
    const x = u * cells
    const y = v * cells
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = smooth(x - x0)
    const fy = smooth(y - y0)
    const at = (i, j) => grid[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)]
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx
    return a + (b - a) * fy
  }
}
/** Octaves of wrapping noise, from `cells` up, in 0..1. */
function fbm(cells, octaves) {
  const layers = Array.from({ length: octaves }, (_, o) => layer(cells << o))
  return (u, v) => {
    let sum = 0
    let weight = 0
    let w = 1
    for (const l of layers) {
      sum += l(u, v) * w
      weight += w
      w *= 0.5
    }
    return sum / weight
  }
}

// The palette, darkest to lightest: cold, muted grey-brown soil.
const PALETTE = [
  [52, 50, 44],
  [62, 60, 51],
  [72, 69, 58],
  [82, 78, 65],
  [93, 88, 73],
].map((c) => c.map((x) => x / 255))

const soil = fbm(3, 4)
const warpU = fbm(4, 3)
const warpV = fbm(4, 3)
const streaks = fbm(16, 2)
const crackLines = fbm(5, 4)
const crackMask = fbm(3, 2)

const rgb = new Float32Array(SIZE * SIZE * 3)
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const u = x / SIZE
    const v = y / SIZE
    // The soil, its shapes warped so they flow like brushed paint, pushed into
    // a few flat tones with hard edges: a painter's steps, not a photo's
    // gradients.
    const wu = u + (warpU(u, v) - 0.5) * 0.18
    const wv = v + (warpV(u, v) - 0.5) * 0.18
    const t = (soil(wu, wv) - 0.5) * 2.2 + 0.5
    const steps = PALETTE.length - 1
    const s = Math.min(Math.max(t, 0), 0.999) * steps
    const i = Math.floor(s)
    const f = Math.min(Math.max((s - i - 0.45) / 0.1, 0), 1)
    const lo = PALETTE[i]
    const hi = PALETTE[Math.min(i + 1, steps)]
    // Brush streaks inside each tone: noise stretched along one slant, faint.
    const g = 1 + (streaks(u * 0.25 + v * 0.1, v * 2 - u * 0.4) - 0.5) * 0.1
    const k = (y * SIZE + x) * 3
    for (let c = 0; c < 3; c++) rgb[k + c] = (lo[c] + (hi[c] - lo[c]) * f) * g
    // Cracks: thin dark lines along one level of a noise field, broken up by
    // another, wider where the soil is dark.
    const line = Math.abs(crackLines(wu, wv) - 0.5)
    const width = 0.006 + (1 - t) * 0.004
    if (crackMask(u, v) > 0.55 && line < width) {
      const a = 0.55 * (1 - line / width)
      for (let c = 0; c < 3; c++) rgb[k + c] *= 1 - a
    }
  }
}

/**
 * Fills an irregular stone that wraps across the edges: a radius around
 * (cx, cy) that wobbles with the angle, stretched along `angle` by `stretch`.
 */
function blob(cx, cy, r, shape, color, alpha = 1) {
  const r2 = Math.ceil(r * shape.stretch * 1.6 + 1)
  for (let dy = -r2; dy <= r2; dy++) {
    for (let dx = -r2; dx <= r2; dx++) {
      // Into the stone's own frame: unrotated, unstretched.
      const ca = Math.cos(shape.angle)
      const sa = Math.sin(shape.angle)
      const lx = (dx * ca + dy * sa) / shape.stretch
      const ly = -dx * sa + dy * ca
      const theta = Math.atan2(ly, lx)
      let edge = 1
      for (const [a, n, p] of shape.wobble) edge += a * Math.cos(n * theta + p)
      if (Math.hypot(lx, ly) > r * edge) continue
      const x = (((Math.round(cx) + dx) % SIZE) + SIZE) % SIZE
      const y = (((Math.round(cy) + dy) % SIZE) + SIZE) % SIZE
      const k = (y * SIZE + x) * 3
      for (let c = 0; c < 3; c++) rgb[k + c] += (color[c] - rgb[k + c]) * alpha
    }
  }
}

// Pebbles, in loose clusters: a flat shadow down and to the right, the stone in
// one flat tone, and a flat lit facet up and to the left, cut, not blended.
const clusters = 14
for (let n = 0; n < clusters; n++) {
  const ox = rand() * SIZE
  const oy = rand() * SIZE
  const spread = SIZE * (0.03 + rand() * 0.06)
  const count = 4 + Math.floor(rand() * 14)
  for (let m = 0; m < count; m++) {
    const x = ox + (rand() - 0.5) * 2 * spread
    const y = oy + (rand() - 0.5) * 2 * spread
    const r = SIZE * (0.003 + rand() ** 2.5 * 0.012)
    const shape = {
      angle: rand() * Math.PI,
      stretch: 1 + rand() * 0.6,
      wobble: [
        [0.08 + rand() * 0.1, 2, rand() * 6.3],
        [0.05 + rand() * 0.08, 3, rand() * 6.3],
        [0.03, 5, rand() * 6.3],
      ],
    }
    const tone = 0.24 + rand() * 0.12
    const stone = [tone * 0.96, tone * 0.98, tone * 0.9]
    blob(x + r * 0.3, y + r * 0.35, r * 1.05, shape, [0.09, 0.09, 0.08], 0.6)
    blob(x, y, r, shape, stone)
    blob(x - r * 0.22, y - r * 0.25, r * 0.6, shape, stone.map((c) => Math.min(c * 1.2, 1)))
  }
}

// Grit: single specks, dark and pale, scattered evenly.
for (let n = 0; n < (SIZE * SIZE) / 900; n++) {
  const x = Math.floor(rand() * SIZE)
  const y = Math.floor(rand() * SIZE)
  const k = (y * SIZE + x) * 3
  const a = rand() < 0.5 ? 0.6 : 1.35
  for (let c = 0; c < 3; c++) rgb[k + c] *= a
}

// ---------------------------------------------------------------- PNG
const raw = Buffer.alloc((SIZE * 3 + 1) * SIZE)
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 3 + 1)] = 0
  for (let x = 0; x < SIZE * 3; x++) {
    raw[y * (SIZE * 3 + 1) + 1 + x] = Math.round(Math.min(Math.max(rgb[y * SIZE * 3 + x], 0), 1) * 255)
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}
const header = Buffer.alloc(13)
header.writeUInt32BE(SIZE, 0)
header.writeUInt32BE(SIZE, 4)
header[8] = 8 // bit depth
header[9] = 2 // RGB
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(
  OUT,
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]),
)
console.log(`dirt: ${SIZE}px, seed ${SEED} -> ${OUT}`)
