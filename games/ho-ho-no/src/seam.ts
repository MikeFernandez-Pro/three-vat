// The renderer seam (ADR-0038). Everything the game draws with that is the
// renderer's comes through here: the renderer, the materials, the particles,
// the post pass, and the decode path the crowds are drawn by. `seams/webgpu.ts`
// implements it in TSL on WebGPURenderer, loaded at start; nothing outside it
// imports the renderer.
import type { Camera, Color, InstancedMesh, Material, Object3D, Scene, Texture } from 'three'
import type { VAT, VATClock, VATCrowd, VATInstance, VATPlaybackTexture } from 'three-vat'
import type { Inspector } from 'three/examples/jsm/inspector/Inspector.js'

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

/**
 * One burst of discs flung out from a point, drifting up or down and shrinking
 * away: a snowball's impact, or a gift's.
 */
export interface BurstSpec {
  /** Each disc's direction out of the burst's centre, xyz. */
  positions: Float32Array
  /** Per disc: its size factor. */
  scales: Float32Array
  /** Per disc: its colour, rgb. */
  tints: Float32Array
  size: number
  /** How far out each disc ends up, as a multiple of its direction. */
  spread: number
  /** How far the discs drift by the end, in units up; negative is down. */
  rise: number
}

export interface Burst {
  readonly object: Object3D
  /** How far the burst has gone, 0 (a point) to 1 (spent). */
  setProgress(progress: number): void
  /**
   * Upload its spec's arrays again, rewritten in place. A burst is reused
   * rather than rebuilt: a new material is a new node build, and a snowball
   * bursts two or three times a second.
   */
  refresh(): void
}

/** The toon look's two textures: the colour atlas as the map, the five-tone ramp as the gradient map. */
export interface Toon {
  map: Texture
  gradientMap: Texture
}

export interface RendererSeam {
  /** three's inspector on the renderer, with the look's own groups in it, when the page is opened on `#debug`. */
  readonly inspector: Inspector | null
  /** Which backend actually runs: `WebGPU`, or `WebGL 2` (WebGPURenderer's fallback). */
  readonly backend: 'WebGPU' | 'WebGL 2'

  /** The game's toon look: a gradient atlas as the map and a stepped ramp as the gradient map. */
  toonMaterial(toon: Toon): Material
  /** The camp's snow floor: toon-lit, coloured by two samples of a voronoi texture. */
  floorMaterial(noise: Texture): Material

  /** The clock every crowd's playback is read against, in seconds: the simulation's. */
  readonly vatTime: VATClock
  /** The GPU's largest texture, which a playback texture's rows count against. */
  readonly maxTextureSize: number
  /**
   * Draw `mesh` — an `InstancedMesh` of `vat`'s geometry, its rows handed out
   * as instances come and go — in the toon look, each instance posed by its
   * row of `playback`, its shadow too.
   */
  dressHorde(mesh: InstancedMesh, vat: VAT, playback: VATPlaybackTexture, toon: Toon): void
  /** A crowd of `vat` on the library's `createVATMesh`, one instance per entry, in the toon look. */
  vatCrowd(vat: VAT, instances: VATInstance[], toon: Toon): VATCrowd
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
  /** VSM's blurred shadows, or PCF's cheaper ones. */
  softShadows: boolean
  /** Attach three's inspector, and put the look's uniforms in its parameters. */
  debug: boolean
}

/** The seam, its renderer initialised. Loaded apart from the entry, so the download and the assets overlap. */
export async function createSeam(options: SeamOptions): Promise<RendererSeam> {
  return (await import('./seams/webgpu')).createSeam(options)
}
