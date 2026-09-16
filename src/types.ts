import type { Box3, BufferGeometry, DataTexture, Material } from 'three'

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

/**
 * What {@link bakeVAT} returns: a VAT plus the geometry it was baked against.
 *
 * The merged vertex ordering is the baker's own invention and the textures are
 * indexed by it (`x = gl_VertexID`), so the caller can no longer bring its own
 * geometry — it must render the one baked here. `materials` is ordered to match
 * `geometry.groups[].materialIndex`, giving one draw call per material.
 *
 * `loadVAT` returns a plain {@link VAT} without these, which is precisely why the
 * offline format is deprecated and removed in 1.0 (ADR-0010): a serialized VAT
 * cannot be rendered without re-running the merge that produced its ordering.
 */
export interface BakedVAT extends VAT {
  /** Merged, root-space rest-pose geometry. Its `position` is the delta reference. */
  geometry: BufferGeometry
  /** Source materials, indexed by `geometry.groups[].materialIndex`. */
  materials: Material[]
}
