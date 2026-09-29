// The renderer seam (ADR-0038). Everything the game draws with that differs
// between the two renderers comes through here: the renderer, the materials,
// the particles and the post pass. One module per renderer implements it —
// GLSL on WebGLRenderer in `seams/webgl.ts`, TSL on WebGPURenderer in
// `seams/webgpu.ts` — and one is loaded at start. Nothing outside those two
// modules imports either renderer.
import type { Camera, Color, Material, Object3D, Scene, Texture } from 'three'
import type { RendererKind } from './renderer-choice'

/** The snowfall: one flake per entry, drawn as screen-facing discs that fall and loop. */
export interface SnowSpec {
  /** Flake starting positions, xyz. */
  positions: Float32Array
  /** Per flake: its size factor and fall speed factor. */
  scales: Float32Array
  /** Per flake: its phase in the sideways swirl. */
  movements: Float32Array
  size: number
  speed: number
  color: Color
  /** View depths over which a flake fades in: invisible at `fadeNear`, whole by `fadeFar`. */
  fadeNear: number
  fadeFar: number
}

export interface Snow {
  readonly object: Object3D
  /** Seconds on the snow's own clock. */
  update(time: number): void
}

/** One snowball impact: a handful of discs flung out from a point, falling and shrinking. */
export interface BurstSpec {
  /** Where each disc ends up, relative to the burst's centre, xyz. */
  positions: Float32Array
  /** Per disc: its size factor. */
  scales: Float32Array
  size: number
  /** Top and bottom of each disc. */
  colors: [Color, Color]
}

export interface Burst {
  readonly object: Object3D
  /** How far the burst has gone, 0 (a point) to 1 (spent). */
  setProgress(progress: number): void
  /**
   * Upload its spec's arrays again, rewritten in place. A burst is reused
   * rather than rebuilt: on TSL a new material is a new node build, and a
   * snowball bursts two or three times a second.
   */
  refresh(): void
  dispose(): void
}

export interface RendererSeam {
  readonly kind: RendererKind
  /** Which backend actually runs: `WebGPU`, `WebGL 2` (WebGPURenderer's fallback) or `WebGL`. */
  readonly backend: string
  readonly canvas: HTMLCanvasElement

  /** The game's toon look: a gradient atlas as the map and a stepped ramp as the gradient map. */
  toonMaterial(map: Texture, gradientMap: Texture): Material
  /** The camp's snow floor: toon-lit, coloured by two samples of a voronoi texture. */
  floorMaterial(noise: Texture): Material
  snow(spec: SnowSpec): Snow
  burst(spec: BurstSpec): Burst

  /** Call `frame` once per display frame, or stop with null. */
  setAnimationLoop(frame: (() => void) | null): void
  /** Draw `scene` through the post pass: the vignette, then tone mapping and output. */
  render(): void
  setSize(width: number, height: number, pixelRatio: number): void
}

export interface SeamOptions {
  canvas: HTMLCanvasElement
  scene: Scene
  camera: Camera
  width: number
  height: number
  pixelRatio: number
}

/** The seam for `kind`, its renderer initialised. Only the chosen module is ever downloaded. */
export async function createSeam(kind: RendererKind, options: SeamOptions): Promise<RendererSeam> {
  const module = kind === 'webgl' ? await import('./seams/webgl') : await import('./seams/webgpu')
  return module.createSeam(options)
}

/** The original's scene-wide look, the same on both sides of the seam. */
export const LOOK = {
  clearColor: '#cbe1f7',
  vignette: { radius: 0.46, softness: 1, darkness: 1, color: '#5ebaf8' },
  floor: { color1: '#d0f1ff', color2: '#88b0d2', scale: 4 },
} as const
