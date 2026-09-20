import type { Box3, BufferGeometry, DataTexture, InstancedMesh, Material } from 'three'
import type { EndMode, LoopMode } from './instance-playback.js'

/**
 * The playback policy a clip carries for every instance that plays it —
 * declared once, at the bake, instead of repeated at every instance. Hand
 * `bakeVAT` a configured `AnimationAction` rather than a bare `AnimationClip`
 * and these come from it; hand it a clip and they are the library defaults
 * (repeat, forever, speed 1, clamping when finished).
 *
 * Defaults, never decisions: an instance overrides any of them, field by field
 * ({@link VATInstance}). Nothing in the texels changes between "once" and
 * "forever" — a bake produces poses, and this is the policy those poses are
 * played under.
 */
export interface VATClipDefaults {
  /** How the clip repeats, from the action's `loop`. */
  loopMode: LoopMode
  /**
   * How many times it plays, from the action's `repetitions` — `Infinity`
   * converted to `INFINITE_REPETITIONS`, because a `Float32Array` cannot carry
   * the former.
   */
  repetitions: number
  /**
   * What it does once finished, from the action's `clampWhenFinished` — and the
   * one field where a bare clip and an action part company.
   *
   * A bare `AnimationClip` says nothing, and a crowd's answer to nothing is
   * {@link EndMode.Clamp}: three defaults `clampWhenFinished` to `false`, but a
   * corpse standing back up is the worse default to ship (see {@link EndMode}).
   * An action *has* said something, so it is read literally — configure one,
   * leave `clampWhenFinished` alone, and a clip that does not loop rewinds to
   * its first frame rather than holding its last (ADR-0017).
   */
  endMode: EndMode
  /** Playback rate, from the action's `timeScale`. */
  speed: number
}

/**
 * One baked animation range within a VAT's stacked frame rows, and the playback
 * defaults every instance of it inherits.
 */
export interface VATClip extends VATClipDefaults {
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
 * A baked Vertex Animation Texture: the position `DataTexture` (and the normal
 * one, unless the bake was told to skip it), the geometry they are indexed by,
 * and the clip table and bounds needed to decode and render them. Produced
 * exactly one way — {@link bakeVAT}, at runtime, from a loaded glTF (ADR-0010).
 *
 * The merged vertex ordering is the baker's own invention and the textures are
 * indexed by it (`x = gl_VertexID`), so the caller cannot bring its own
 * geometry — it must render the one baked here. `materials` is ordered to match
 * `geometry.groups[].materialIndex`, giving one draw call per material.
 *
 * The typed array behind either texture's `image.data` is the bake's choice,
 * not part of this contract: `Float32Array` today, and a narrower encoding may
 * change it in a minor release. Move the buffer, hand it to {@link makeVATTexture};
 * do not read numbers out of it.
 */
export interface VAT {
  /** RGBA float texture of per-vertex position deltas (`x = vertex`, `y = frame`). */
  positionTexture: DataTexture
  /**
   * RGBA float texture of per-vertex absolute normals (`x = vertex`, `y = frame`),
   * or `null` when the bake was told to skip it (`bakeNormals: false`) — halving
   * the VAT for a crowd that never reads a normal. Neither decode path samples
   * it when it is absent; a smooth-shaded lit material paired with such a VAT is
   * refused rather than lit by its rest pose.
   */
  normalTexture: DataTexture | null
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
