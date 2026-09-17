import type { Box3, BufferGeometry, DataTexture, InstancedMesh, Material } from 'three'

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
 * A baked Vertex Animation Texture: the position/normal `DataTexture`s, the
 * geometry they are indexed by, and the clip table and bounds needed to decode
 * and render them. Produced exactly one way — {@link bakeVAT}, at runtime, from
 * a loaded glTF (ADR-0010).
 *
 * The merged vertex ordering is the baker's own invention and the textures are
 * indexed by it (`x = gl_VertexID`), so the caller cannot bring its own
 * geometry — it must render the one baked here. `materials` is ordered to match
 * `geometry.groups[].materialIndex`, giving one draw call per material.
 */
export interface VAT {
  /** RGBA float texture of per-vertex position deltas (`x = vertex`, `y = frame`). */
  positionTexture: DataTexture
  /** RGBA float texture of per-vertex absolute normals (`x = vertex`, `y = frame`). */
  normalTexture: DataTexture
  /** Merged, root-space rest-pose geometry. Its `position` is the delta reference. */
  geometry: BufferGeometry
  /** Source materials, indexed by `geometry.groups[].materialIndex`. */
  materials: Material[]
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
 * The shared playback clock: one `{ value }` in seconds, read by every material
 * of every VAT mesh driven by it. Set it once per frame. Deliberately the
 * narrowest shape both decode paths satisfy — a WebGL `IUniform<number>` and a
 * TSL uniform node are both one of these — so `createVATMesh` returns the same
 * thing on either renderer.
 */
export interface VATClock {
  value: number
}

/**
 * A **crowd** ready to render: the mesh to add to the scene, and the clock to
 * advance. What `createVATMesh` returns on either decode path, so moving a
 * crowd between renderers is an import change and nothing else. Named for what
 * it is rather than for its `mesh` field — the clock is half of it.
 */
export interface VATCrowd {
  /** Add to the scene. Its instance matrices are yours to write. */
  mesh: InstancedMesh
  /** The shared playback clock — set `.value` once per frame. */
  time: VATClock
}
