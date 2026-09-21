import type { Box3, BufferGeometry, DataTexture, InstancedMesh, Material } from 'three'
import type { EndMode, LoopMode, VATPlaybackTexture } from './instance-playback.js'

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
   * What it does once finished — {@link EndMode.Clamp} from the bake, whichever
   * of the two inputs it came from.
   *
   * three defaults `clampWhenFinished` to `false`, and a crowd's answer to a
   * one-shot is to hold the last frame: a corpse standing back up is the worse
   * default to ship (see {@link EndMode}). A bare `AnimationClip` says nothing,
   * and an untouched action's `false` is not a statement either — it is what
   * the field already holds — so the bake gives both the same answer rather
   * than punishing the caller who configured an action. `clampWhenFinished =
   * true` agrees with it; three's rewind is asked for per instance, with
   * `endMode: EndMode.Rewind` (ADR-0017).
   */
  endMode: EndMode
  /**
   * Playback rate, from the action's `timeScale`. `>= 0`: a band is sampled
   * forward from its own first row, so a negative rate is refused at the bake
   * rather than held on that row for ever. `0` is a held first row, on purpose.
   */
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
export interface VATBase {
  /**
   * Merged rest-pose geometry, in whichever space the encoding stores it (root
   * space under the vertex encoding, where its `position` is the delta
   * reference). Carries `normal` always, and `uv`, `color` and `tangent`
   * when every source mesh carried them.
   */
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
}

/**
 * A VAT under the **vertex encoding**: a row holds where every vertex ended up,
 * as a position delta and, unless the bake was told to skip it, a normal. The
 * source-agnostic encoding (ADR-0008) and the default; the member every bake
 * produced before there was a second one (ADR-0018).
 */
export interface DeltaVAT extends VATBase {
  /** Which encoding a row holds — the discriminant of {@link VAT}. */
  encoding: 'delta'
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
}

/**
 * A baked VAT, discriminated on `encoding`. One member today; a consumer that
 * reads a texture narrows on `encoding` first, so the second encoding
 * (ADR-0018) arrives as a member and not as an edit to every reader.
 */
export type VAT = DeltaVAT

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
  /**
   * The crowd's **playback texture**: what carries each instance's clip, phase
   * and policy to the shader, and what `setVATInstance` writes one row of
   * (ADR-0016). Exposed rather than hidden behind the mesh because it is the
   * object a caller has to hold to change an instance after the crowd is
   * built — a `BufferGeometry` cannot carry a texture, so there is nowhere
   * else honest to keep it.
   */
  playback: VATPlaybackTexture
}
