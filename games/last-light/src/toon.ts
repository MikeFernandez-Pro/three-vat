// Toon shading's gradient: a lit surface takes the light in hard steps, three
// or five, read from a gradient of fifteen texels, so three steps of five or
// five of three fill it evenly. Each shell material (shell.ts) has a gradient
// of its own and rewrites it when its steps move, never recompiling.
import { DataTexture, NearestFilter, RedFormat } from 'three/webgpu'

/** Texels in a gradient: both step counts divide it. */
const TEXELS = 15

/** What a toon folder edits: how many steps, and each step's brightness, darkest first, 0 to 1, for both counts. */
export interface ToonLook {
  steps: 3 | 5
  three: number[]
  five: number[]
}

/** Three steps to start: shade, half-light, full light. Five, evenly up from a deeper shade. */
export const defaultToon = (): ToonLook => ({ steps: 3, three: [0.35, 0.65, 1], five: [0.2, 0.4, 0.6, 0.8, 1] })

/** A gradient a material reads by how squarely the light falls on it, at the default steps. */
export function createToonGradient(): DataTexture {
  const gradient = new DataTexture(new Uint8Array(TEXELS), TEXELS, 1, RedFormat)
  gradient.minFilter = gradient.magFilter = NearestFilter
  gradient.generateMipmaps = false
  writeToon(gradient, defaultToon())
  return gradient
}

/** Write a toon folder's steps into `gradient`. */
export function writeToon(gradient: DataTexture, look: ToonLook): void {
  const steps = look.steps === 5 ? look.five : look.three
  const data = gradient.image.data as Uint8Array
  for (let t = 0; t < TEXELS; t++) {
    const step = steps[Math.floor((t * steps.length) / TEXELS)]
    data[t] = Math.round(Math.min(1, Math.max(0, step)) * 255)
  }
  gradient.needsUpdate = true
}
