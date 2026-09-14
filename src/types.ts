import type { Box3, DataTexture } from 'three'

/** One baked animation range within a VAT's stacked frame rows. */
export interface VATClip {
  /** Clip name, taken from the source `AnimationClip`. */
  name: string
  /** First frame row (y) of this clip in the texture. */
  startFrame: number
  /** Number of frame rows baked for this clip. */
  frames: number
  /** Effective frames-per-second of the bake (`frames / duration`). */
  fps: number
  /** Source clip duration in seconds. */
  duration: number
  /**
   * Largest per-vertex position-delta magnitude (metres) across the clip.
   * Near-zero means the clip baked as a frozen pose — the diagnostic for a
   * mis-targeted or genuinely static clip.
   */
  maxDelta: number
}

/**
 * A baked Vertex Animation Texture: the position/normal `DataTexture`s plus the
 * clip table and bounds needed to decode and render them. Produced by
 * {@link bakeVAT} (runtime) or `loadVAT` (offline); the two paths yield
 * identical objects.
 */
export interface VAT {
  /** RGBA float texture of per-vertex position deltas (`x = vertex`, `y = frame`). */
  positionTexture: DataTexture
  /** RGBA float texture of per-vertex absolute normals (`x = vertex`, `y = frame`). */
  normalTexture: DataTexture
  /** Clip table: name → `{ startFrame, frames, fps, ... }`. */
  clips: VATClip[]
  /** Union of every baked frame's bounds; use as the geometry bounding box. */
  bounds: Box3
  /** Vertex count (texture width). */
  vertexCount: number
  /** Total frame rows across all clips (texture height). */
  totalFrames: number
  /** Position encoding. Only `'delta'` in v1. */
  encoding: 'delta'
}
