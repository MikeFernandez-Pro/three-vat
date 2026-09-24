import { InstancedMesh } from 'three'
import {
  Fn,
  attribute,
  batch,
  batchIndirectIndex,
  bool,
  dot,
  float,
  hash,
  instanceIndex,
  instancedMesh,
  int,
  ivec2,
  mat3,
  mat4,
  mix,
  normalGeometry,
  normalLocal,
  positionGeometry,
  positionLocal,
  tangentGeometry,
  tangentLocal,
  textureLoad,
  uniform,
  vec3,
  vec4,
  vertexIndex,
} from 'three/tsl'
import type { DataTexture, Material } from 'three'
import type { Node } from 'three/webgpu'
import { assertBakedNormal } from './baked-normals.js'
import { assertVATCarrier, isBatchedCarrier } from './carrier.js'
import type { VATCarrier } from './carrier.js'
import {
  createVATPlaybackTexture,
  EndMode,
  INFINITE_REPETITIONS,
  LoopMode,
  PACK_TEXELS,
} from './instance-playback.js'
import type { VATInstance, VATPlaybackTexture } from './instance-playback.js'
import { RIG_TEXELS, RIG_TEXELS_PER_SLOT } from './rig-texture.js'
import type { DeltaVAT, RigVAT, VAT, VATClip, VATClock, VATCrowd } from './types.js'

/**
 * The real maximum texture dimension this renderer accepts, for
 * `bakeVAT(..., { maxTextureSize })`. The baker is renderer-agnostic (it runs
 * in Node, and in a Web Worker) so it cannot query this itself.
 *
 * Call this *after* `await renderer.init()` — the backend has no device before
 * that. Handles both a WebGPU backend and the WebGL fallback backend a
 * `WebGPURenderer` may silently switch to when WebGPU is unavailable.
 */
export function getMaxTextureSize(renderer: object): number {
  const backend = (renderer as { backend?: Record<string, unknown> }).backend
  const device = backend?.['device'] as { limits?: { maxTextureDimension2D?: number } } | null | undefined
  if (device?.limits?.maxTextureDimension2D) return device.limits.maxTextureDimension2D

  // WebGPURenderer falls back to a WebGL backend when WebGPU is unavailable.
  const gl = backend?.['gl'] as WebGL2RenderingContext | null | undefined
  if (gl) return gl.getParameter(gl.MAX_TEXTURE_SIZE) as number

  throw new Error('three-vat: renderer has no initialized backend — call `await renderer.init()` first')
}

/** A fluent TSL float node (has `.add`, `.mul`, … via NodeExtensions). */
type FloatNode = Node<'float'>
/** A fluent TSL int node. */
type IntNode = Node<'int'>
/** A fluent TSL vec2 node — how an octahedral normal texel arrives. */
type Vec2Node = Node<'vec2'>
/** A fluent TSL vec3 node. */
type Vec3Node = Node<'vec3'>
/** A fluent TSL vec4 node — how the instance-playback pack arrives, and how a rig texel does. */
type Vec4Node = Node<'vec4'>
/** A fluent TSL mat4 node — one slot of the posed rig, composed, and the skin matrix summed from them. */
type Mat4Node = Node<'mat4'>
/** A fluent TSL bool node — a branch condition, and what `.select()` reads. */
type BoolNode = Node<'bool'>

/**
 * A TSL float uniform: a node the graph reads, and a `{ value }` clock the
 * caller sets per frame. Both halves matter — the node is what the decode
 * samples against, the clock is what the render loop writes — which is why
 * `createVATMesh` can hand the same object back as a {@link VATClock} and have
 * it mean the same thing as the WebGL path's uniform.
 */
export type VATTimeUniform = FloatNode & VATClock

export interface VATNodeOptions {
  /**
   * Elapsed-time uniform (seconds). Create once with `uniform(0)` and set
   * `.value` per frame. Defaults to a fresh `uniform(0)` you can read back.
   */
  time?: VATTimeUniform
  /**
   * The crowd's playback texture — build it with `createVATPlaybackTexture`
   * from `three-vat` *before* calling this, or let `createVATMesh` do it — and
   * each instance plays its own clip, at its own phase and rate, read from its
   * own row — which row that is, is the carrier's answer (see `carrier`). Without
   * it, every instance plays `clipIndex`, phase-desynced by `desync`.
   *
   * Which decode the graph compiles is decided here, at build time: the
   * fallback is a different graph, not a shader-side branch.
   */
  playback?: VATPlaybackTexture
  /**
   * The crowd's **carrier** — the mesh these nodes will render on, an
   * `InstancedMesh` or a `BatchedMesh`. Named as the WebGL path's
   * `patchVATMaterial` names it, because it is the one concept (CONTEXT.md).
   *
   * Required for a crowd, and for two reasons. First: three applies the
   * carrier's transform to `positionLocal` *before* it reads `positionNode`, so
   * the decode has to pose in the geometry's own space and then re-apply that
   * transform itself. Without this the vertex encoding adds its delta in
   * instance space — unrotated and unscaled — and every instance deforms
   * according to its own matrix; the rig encoding, which skins the rest pose
   * outright, never applies the instance matrix at all and draws the whole
   * crowd at the origin. Second: the carrier decides how this instance's
   * *logical* index is spelled, which is the row of the playback texture the
   * pack is read from — `instanceIndex` on an `InstancedMesh`,
   * `batchIndirectIndex` on a `BatchedMesh`, whose drawn slot is a permutation
   * that changes every frame (ADR-0016).
   *
   * One option rather than one per carrier, because those two answers have to
   * come from the same object: a decode that re-applied one mesh's transform
   * while reading another's index would render a crowd nothing could explain.
   *
   * Omit it for a single, non-instanced mesh, where `positionLocal` is the
   * geometry position and there is nothing to re-apply.
   */
  carrier?: VATCarrier
  /**
   * Which clip to play (index into `vat.clips`). Ignored — along with
   * `desync` — when a `playback` texture is given, which says all of this per
   * instance. Default `0`.
   */
  clipIndex?: number
  /**
   * Max random per-instance time offset in seconds, hashed from the instance's
   * logical index. `0` (default) plays every instance in lockstep. Ignored when
   * a `playback` texture is given.
   */
  desync?: number
}

/** Position/normal nodes to assign onto a `MeshStandardNodeMaterial` (or similar). */
export interface VATNodes {
  /**
   * Assign to `material.positionNode`. It carries the whole decode — the normal
   * with it, and the tangent under the rig encoding.
   *
   * There is deliberately no `normalNode`, under either encoding. A material's
   * `normalNode` is built in the *fragment* stage (three reaches it from
   * `normalView` through `builder.context.setupNormal()`) and is expected in
   * **view** space, whereas a VAT's normals are per-vertex and in the geometry's
   * own space — read from the normal texture, or skinned from the rig one.
   * Handing an object-space normal to a fragment-stage node skipped both the
   * instance matrix and the normal matrix, and took `vertexIndex` into the
   * fragment stage with it — where `IndexNode` does not give you the vertex
   * index at all, but quietly turns itself into a varying, so every fragment
   * read a linearly *interpolated* index that addresses neither of the vertices
   * it lies between.
   *
   * Writing `normalLocal` inside the vertex-stage decode instead is what the
   * GLSL path does when it sets `objectNormal` in `beginnormal_vertex`: three
   * then transforms it by the instance and normal matrices and interpolates the
   * result, on both paths, for free.
   */
  positionNode: Vec3Node
  /** The time uniform in use — set `.value` each frame. */
  time: VATTimeUniform
}

/** The clip texel: which band an instance plays, how long it is, and how fast. */
interface ClipTexel {
  /** First texture row of the clip's band. */
  startFrame: IntNode
  /** Rows in the band. */
  frames: FloatNode
  /** Seconds the band spans. */
  duration: FloatNode
  /** Rate multiplier. */
  speed: FloatNode
}

/** The playback texel: when this animation began, and how it repeats. */
interface PlaybackTexel {
  /** Absolute clock time this animation began. In the past, for a desynced crowd. */
  startTime: FloatNode
  /** {@link LoopMode}, as the number the pack carries. */
  loopMode: FloatNode
  /** Repeat count, or {@link INFINITE_REPETITIONS}. */
  repetitions: FloatNode
  /** {@link EndMode}, as the number the pack carries. */
  endMode: FloatNode
}

/**
 * The unit {@link resolveBand} resolves a band from, and the unit the pack
 * carries twice: the clip texel and the playback texel beside it.
 */
interface BandTexels {
  clip: ClipTexel
  playback: PlaybackTexel
}

/**
 * Everything the decode needs to locate an instance in the frame bands — the
 * values, grouped texel for texel with the layout {@link PACK_TEXELS} names,
 * because a crossfade is two pairs and one duration between them.
 */
interface Playback {
  live: BandTexels
  /** Seconds to blend {@link outgoing} away over. Zero is a cut — not transitioning. */
  crossfadeDuration: FloatNode
  outgoing: BandTexels
}

/**
 * One texel of this instance's row of the playback texture, as a fluent vec4
 * node. `y` is the instance's *logical* index — not the drawn slot an instanced
 * attribute would have been indexed by (ADR-0016), and on a `BatchedMesh` not
 * the drawn slot at all (see {@link instanceIdOf}) — and `x` names the field,
 * from the one definition of the layout.
 */
const packTexel = (texture: DataTexture, field: number, instance: IntNode) =>
  textureLoad(texture, ivec2(int(field), instance)) as Vec4Node

/**
 * Per-instance playback, unpacked from the playback texture.
 *
 * Component for component with the table on `createVATPlaybackTexture` and with
 * `ROW_PRELUDE` in src/webgl.ts — the swizzles here are the whole of what the
 * two paths have to agree on, and a wrong one is silent.
 */
function texturePlayback(texture: DataTexture, instance: IntNode): Playback {
  const crossfade = packTexel(texture, PACK_TEXELS.crossfade, instance)
  return {
    live: liveBand(
      packTexel(texture, PACK_TEXELS.clip, instance),
      packTexel(texture, PACK_TEXELS.playback, instance),
    ),
    crossfadeDuration: crossfade.x as FloatNode,
    outgoing: outgoingBand(
      packTexel(texture, PACK_TEXELS.outgoingClip, instance),
      packTexel(texture, PACK_TEXELS.outgoingPlayback, instance),
    ),
  }
}

/**
 * One (clip texel, playback texel) pair, unpacked — component for component
 * with the table on `createVATPlaybackTexture`. `frames` and `fps` are passed
 * rather than read here, because the outgoing pair needs them guarded and the
 * live pair must stay an exact transcription of the resolver.
 */
function bandTexels(clip: Vec4Node, playback: Vec4Node, frames: FloatNode, fps: FloatNode): BandTexels {
  return {
    clip: {
      startFrame: int(clip.x as FloatNode),
      frames,
      duration: frames.div(fps),
      speed: clip.w as FloatNode,
    },
    playback: {
      startTime: playback.x as FloatNode,
      loopMode: playback.y as FloatNode,
      repetitions: playback.z as FloatNode,
      endMode: playback.w as FloatNode,
    },
  }
}

/** The band an instance is playing, exactly as the pack spells it. */
const liveBand = (clip: Vec4Node, playback: Vec4Node) =>
  bandTexels(clip, playback, clip.y as FloatNode, clip.z as FloatNode)

/**
 * The band it is crossfading out of, with a band nothing can divide by zero.
 *
 * This path has no branch to resolve the outgoing band behind (see
 * {@link vatDecode}), so it resolves one for every instance — including the
 * overwhelming majority whose outgoing pair is the zeroes "not transitioning" is
 * written as. A band of no frames at no fps is a 0/0 duration, and a NaN row is
 * not rescued by a weight-zero mix: NaN times zero is NaN. One row at one fps
 * costs nothing and is finite, which is the reserved row's reasoning applied to
 * a texel pair.
 */
const outgoingBand = (clip: Vec4Node, playback: Vec4Node) =>
  bandTexels(clip, playback, (clip.y as FloatNode).max(1), (clip.z as FloatNode).max(1))

/**
 * This vertex's *logical* instance index, as the carrier spells it — the row of
 * the playback texture its pack sits in, and the whole of what the second
 * carrier changes on this path.
 *
 * `batchIndirectIndex` is three's own public accessor (`three/tsl`, r186 and
 * up): a `uint` varying that `batch()` assigns with the logical index, and
 * `NodeMaterial.setupPosition` runs `batch( object )` before it reads
 * `positionNode`, so the value is already in scope where this decode runs.
 * Reading it is what keeps this path off `_indirectTexture` — the private field
 * ADR-0016's stop condition forbids, and the reason this carrier waited for an
 * upstream release rather than shipping on WebGL alone.
 */
const instanceIdOf = (carrier: VATCarrier | undefined): IntNode =>
  isBatchedCarrier(carrier) ? (int(batchIndirectIndex) as IntNode) : (int(instanceIndex) as IntNode)

/** The clip the fallback plays, named in the error when it does not exist. */
function clipAt(vat: VAT, clipIndex: number): VATClip {
  const clip = vat.clips[clipIndex]
  if (!clip) {
    throw new Error(`three-vat: clipIndex ${clipIndex} out of range (${vat.clips.length} clips)`)
  }
  return clip
}

/** The zero-config default: one clip, phase-desynced from the instance index. */
function hashedPlayback(clip: VATClip, desync: number, instance: IntNode): Playback {
  const live: BandTexels = {
    clip: {
      startFrame: int(clip.startFrame),
      frames: float(clip.frames),
      duration: float(clip.frames / clip.fps),
      // Everything but the phase comes from the clip's own baked defaults, so a
      // clip baked "once, clamped, at 2x" plays that way here too. A second set
      // of defaults living in this path would be a crowd that animates
      // differently depending on whether anyone wrote the attributes.
      speed: float(clip.speed),
    },
    playback: {
      // Negated, because desync is now a start time in the *past*: an instance
      // that began `desync` seconds ago is that far into its clip already.
      startTime: hash(instance).mul(-desync),
      loopMode: float(clip.loopMode),
      repetitions: float(clip.repetitions),
      endMode: float(clip.endMode),
    },
  }
  // Nothing to blend out of: this path is the zero-config default, where an
  // instance has never been written and so has no animation it left behind. The
  // outgoing pair is the live one, at a weight of zero — the one shape that
  // resolves to a real row without a band to resolve.
  return { live, crossfadeDuration: float(0), outgoing: live }
}

/**
 * Build TSL decode nodes for a baked VAT, for the WebGPU/TSL renderer path.
 * Shadows work automatically because `positionNode` also feeds the depth pass.
 *
 * Pass the crowd's `playback` texture and each instance plays the clip, phase
 * and rate written into its row by `createVATPlaybackTexture` — the same
 * instance-playback contract the WebGL path reads (ADR-0009), so a mixed-clip
 * crowd renders identically on either renderer. Without it every instance plays
 * `clipIndex`, desynced by a phase hashed from the instance index.
 *
 * Coverage note: the node graph is tested structurally in CI (no GPU); that the
 * two paths decode *identically* is a pixel-diff release gate.
 */
export function vatNodes(vat: VAT, options: VATNodeOptions = {}): VATNodes {
  const { time = uniform(0), carrier } = options
  const decoded = vatDecode(vat, options)

  // One vertex-stage function, not two nodes, and that is the whole fix.
  //
  // three applies the instance matrix to `positionLocal` *before* it reads a
  // material's `positionNode` — NodeMaterial.setupPosition runs morph, skinning,
  // displacement, batching and `instancedMesh()` and only then assigns from
  // `positionNode` (Instance.js: `positionLocal.assign( instanceMatrix.mul(
  // positionLocal ).xyz )`). So `positionLocal.add( delta )` adds a delta baked
  // in the geometry's own space to a position already rotated, scaled and moved
  // into the instance's: the displacement is never rotated or scaled with the
  // robot it belongs to, and every instance deforms differently according to its
  // own matrix. That is a crowd whose heads and arms drift and stretch on their
  // own while the same VAT renders correctly through GLSL, where `begin_vertex`
  // adds the delta and `project_vertex` applies `instanceMatrix` afterwards.
  //
  // So: displace in the space the bake is in, then hand the result back to
  // three's own instancing, which transforms `positionLocal` and `normalLocal`
  // together — which is also why the normal is written here rather than returned
  // as a `normalNode` (see {@link VATNodes}).
  const decode = Fn(() => {
    if (decoded.encoding === 'rig') {
      // The rig decode skins the rest pose outright rather than displacing it,
      // so the posed position replaces `positionLocal` — and the normal and
      // tangent come out of the same skin matrix, as in three's own skinning
      // (ADR-0018). The tangent is absent when the geometry has none; see
      // `rigDecode` for why it is gated there rather than read and ignored.
      positionLocal.assign(decoded.position)
      normalLocal.assign(decoded.normal)
      if (decoded.tangent) tangentLocal.assign(decoded.tangent)
    } else {
      positionLocal.assign((carrier ? positionGeometry : positionLocal).add(decoded.position))
      // Absent for a VAT baked with `bakeNormals: false`: nothing to sample, and
      // nothing to write — `normalLocal` keeps the rest normal three put there,
      // which an unlit material ignores and a flat-shaded one overrides with the
      // deformed position's derivatives.
      if (decoded.normal) normalLocal.assign(decoded.normal)
    }
    // …and hand both back to whichever carrier three would have applied. One
    // line per carrier, which is what ADR-0016 said a second carrier would
    // cost: `batch()` multiplies by the instance's batching matrix exactly as
    // `instancedMesh()` multiplies by its instance matrix, and it re-assigns
    // `batchIndirectIndex` on the way — the accessor the pack row was read at,
    // already in scope because three ran `batch( object )` before it read this
    // `positionNode` at all.
    if (carrier) {
      if (isBatchedCarrier(carrier)) batch(carrier)
      else instancedMesh(carrier)
    }
    return positionLocal
  }, 'vec3')

  return { positionNode: decode() as Vec3Node, time }
}

/**
 * What a decode hands the vertex stage, discriminated on the encoding it read
 * (ADR-0018) — because the two encodings answer a different question. The
 * vertex encoding reads where this vertex *moved to*: `position` is the delta
 * to add to the rest position, `normal` the baked normal or `null` when the
 * bake skipped it. The rig encoding *skins* the rest pose: `position` is the
 * posed position itself, `normal` always exists because it comes out of the
 * skin matrix, and so does `tangent` when the geometry carries one.
 *
 * @internal The return type of {@link vatDecode}, exported for the same
 * structural tests and for nothing else.
 */
export type VATDecoded =
  | { encoding: 'delta'; position: Vec3Node; normal: Vec3Node | null }
  | { encoding: 'rig'; position: Vec3Node; normal: Vec3Node; tangent: Vec3Node | null }

/**
 * Where an instance is reading, resolved once for every fetch that follows — the
 * TSL spelling of the GLSL decode's `VatRows` struct, and the half of the
 * decode both encodings share (ADR-0018).
 */
interface Rows {
  /** The band this instance is playing: two rows and the blend between them. */
  live: Band
  /**
   * The band it is crossfading out of — the live band itself when it is not
   * transitioning, so no fetch ever addresses a row this instance is not
   * already sampling.
   */
  outgoing: Band
  /** How much of {@link outgoing} still shows — zero being "not transitioning". */
  weight: FloatNode
}

/**
 * One band resolved — the TSL spelling of the GLSL decode's `VatBand` struct:
 * the two rows and the blend between them, plus the two facts those rows cannot
 * be read back out of.
 *
 * @internal The return type of {@link resolveBand}, exported for the structural
 * tests and for nothing else.
 */
export interface Band {
  row0: IntNode
  row1: IntNode
  blend: FloatNode
  /** Whether the sampling crossed the band's last row back into its first. */
  wraps: BoolNode
  /** Whether the repetitions have run out and the instance is holding an end pose. */
  finished: BoolNode
}

/**
 * `resolveVATFrame` (src/instance-playback.ts) as a node graph, for one (clip
 * texel, playback texel) pair — branch for branch with the GLSL decode's
 * `vatBand`. The semantics live there; this transcribes them, and the mode
 * constants come from that module rather than being retyped as literals.
 *
 * A function of the pair rather than of the instance, because the pair is what
 * there are two of: a crossfading instance resolves its outgoing band by
 * calling this a second time, not by transcribing it a second time.
 *
 * @internal Exported for the structural tests, and for nothing else. Not
 * re-exported from `three-vat`.
 */
export function resolveBand(clip: ClipTexel, playback: PlaybackTexel, time: FloatNode): Band {
  const frames = clip.frames
  const last = frames.sub(1) as FloatNode
  // Local time: how far into its own animation this instance is. A start time
  // in the past is what desyncs a crowd; a start time in the future has not
  // begun, which is not the same thing as having finished.
  const local = time.sub(playback.startTime).mul(clip.speed) as FloatNode
  const loops = local.div(clip.duration) as FloatNode

  const started = local.greaterThanEqual(0) as BoolNode
  const finished = started
    .and(playback.repetitions.notEqual(INFINITE_REPETITIONS))
    .and(loops.greaterThanEqual(playback.repetitions)) as BoolNode
  const isPingPong = playback.loopMode.equal(LoopMode.PingPong) as BoolNode

  // A ping-pong's triangle wave: forward across the first unit, back across the
  // second. Halved rather than divided, so the remainder cannot land below zero.
  const bounce = loops.sub(loops.mul(0.5).floor().mul(2)) as FloatNode
  const pingPongPhase = bounce.lessThan(1).select(bounce, float(2).sub(bounce)) as FloatNode
  // Held at an end pose, and in neither case sampling past it.
  const endPhase = playback.endMode.equal(EndMode.Clamp).select(float(1), float(0)) as FloatNode

  const phase = started.select(
    finished.select(endPhase, isPingPong.select(pingPongPhase, loops.fract())),
    float(0),
  ) as FloatNode
  // Written as the same nested branch rather than as `!finished && !pingPong`,
  // so the one place a reader compares the two paths line by line stays a
  // comparison of the same shape.
  const wraps = started.select(
    finished.select(bool(false), isPingPong.select(bool(false), bool(true))),
    bool(false),
  ) as BoolNode

  // Phase to frame row: a wrapping clip spreads its phase over `frames`,
  // because its last row owns the interval that crosses back into the first; a
  // clip that does not wrap spreads it over `frames - 1`, so phase 1 lands on
  // the last row rather than one past it.
  const f = phase.mul(wraps.select(frames, last)) as FloatNode
  const f0 = f.floor().min(last) as FloatNode
  // A compare, not a mod: `mod( frames, frames )` divides, and can leave `f1`
  // one row past the band (#79).
  const next = f0.add(1) as FloatNode
  const f1 = wraps.select(next.greaterThanEqual(frames).select(float(0), next), next.min(last)) as FloatNode

  /**
   * The two rows every texture reads, as absolute texture rows — built once
   * here, and never inside a sampler.
   *
   * Not only for economy. `f1` is a `select`, which TSL hoists into a variable
   * assigned in an if/else, and a *second* `int()` built over that same
   * variable comes out of the WGSL builder without its cast (three r185): the
   * position texture's fetch read `i32( nodeVar )`, the normal texture's read
   * the bare `f32`, and the vertex shader failed to compile — which on WebGPU
   * is a crowd that silently draws nothing. One conversion node per row, shared
   * by every fetch, is the shape the builder handles — and the rig decode makes
   * twenty-four fetches of it.
   */
  const bandRow = (offset: FloatNode) => int(offset).add(clip.startFrame) as IntNode

  return {
    row0: bandRow(f0),
    row1: bandRow(f1),
    blend: f.sub(f0) as FloatNode,
    wraps,
    finished,
  }
}

/**
 * The decode's arithmetic: what this instance reads at this moment, as nodes —
 * before the vertex-stage writes that place it. See {@link VATDecoded} for what
 * `position` means under each encoding.
 *
 * @internal Split out and exported for the structural tests. A `Fn` body is
 * opaque to graph traversal (its statements are not built until the shader is),
 * and structural assertions are the only TSL coverage CI can run without a GPU —
 * so the arithmetic that matters stays reachable as a graph. Not re-exported
 * from `three-vat`; nothing outside this package should build against it.
 */
export function vatDecode(vat: VAT, options: VATNodeOptions = {}): VATDecoded {
  const { time = uniform(0), playback: playbackTexture, carrier, clipIndex = 0, desync = 0 } = options

  // A batch a VAT cannot be decoded on is refused here, where the WebGL path
  // refuses it in `patchVATMaterial` — one rule, read by both (src/carrier.ts).
  if (carrier) assertVATCarrier(carrier, vat)

  const instance = instanceIdOf(carrier)
  const playback = playbackTexture
    ? texturePlayback(playbackTexture.texture, instance)
    : hashedPlayback(clipAt(vat, clipIndex), desync, instance)

  // The live band: the one clip this instance is playing, resolved from its own
  // pair of texels. Built once, ahead of either encoding's sampling, because
  // every texture is read at the same frame pair — the graph is a DAG, so the
  // arithmetic is shared rather than duplicated per fetch.
  const live = resolveBand(playback.live.clip, playback.live.playback, time)

  // The crossfade's weight, branch for branch with the GLSL decode's. Wall clock
  // rather than clip time — the incoming clip's speed does not stretch a
  // transition, which is why this elapsed is the band resolver's own `local`
  // with no speed on it, spelled again here exactly as the GLSL decode spells it
  // a second time in `vatRows` — and guarded on the duration, because a graph
  // divides whether or not the result is used and 0/0 is a NaN that `clamp` does
  // not rescue.
  const elapsed = time.sub(playback.live.playback.startTime) as FloatNode
  const duration = playback.crossfadeDuration
  const weight = duration.greaterThan(0).select(
    float(1).sub(elapsed.div(duration).clamp(0, 1)),
    float(0),
  ) as FloatNode

  // And the outgoing band: the very same resolver, called a second time on the
  // outgoing pair, so the clip this instance is leaving keeps playing at its own
  // speed under its own end policy (ADR-0025).
  //
  // Not behind a branch. A real `If` has to be built inside a `Fn` body, and a
  // `Fn` body does not traverse — burying the decode in one would erase every
  // structural assertion CI can make about this path without a GPU, which is
  // the only coverage it has. What is done instead: while the weight is zero
  // the outgoing rows *are* the live rows, so an idle crowd's extra fetches
  // land on texels it has already read rather than on a second band.
  //
  // This was written as the compromise, against a GLSL decode that branched.
  // #72 measured both and the GLSL vertex decode now does the same thing, for
  // the same reason spelled the other way round: guarding two fetches cost an
  // idle crowd 10% there, because a branch holds registers for the side it
  // skips (ADR-0025).
  const resolved = resolveBand(playback.outgoing.clip, playback.outgoing.playback, time)
  const blending = weight.greaterThan(0) as BoolNode
  const outgoing: Band = {
    row0: blending.select(resolved.row0, live.row0) as IntNode,
    row1: blending.select(resolved.row1, live.row1) as IntNode,
    blend: blending.select(resolved.blend, live.blend) as FloatNode,
    // Not selected, and deliberately: a sampler reads a band's rows and its
    // blend and nothing else, so these two are carried because the band
    // resolver answers them and not because anything downstream asks.
    wraps: resolved.wraps,
    finished: resolved.finished,
  }

  const rows: Rows = { live, outgoing, weight }

  // Where the rows are is settled above; what a row *holds* is each encoding's
  // own, narrowed on the encoding before a texture is read (ADR-0018). A third
  // encoding is a compile error at the `never` below, never a silent sample of
  // a texture the VAT does not have.
  switch (vat.encoding) {
    case 'delta':
      return vertexDecode(vat, rows)
    case 'rig':
      return rigDecode(vat, rows)
    default: {
      const unhandled: never = vat
      throw new Error(
        `three-vat: vatDecode has no decode for encoding "${String((unhandled as VAT).encoding)}"`,
      )
    }
  }
}

/**
 * A normal texel unpacked: two unsigned bytes, octahedral, back to a unit
 * vector — `decodeOctahedral` in src/octahedral.ts, term for term, and the
 * GLSL decode's `vatOctDecode` (#29). That module is the definition and this
 * is a transcription of it; the sampler hands the two bytes over already
 * divided by 255, which is the whole of the difference.
 *
 * The fold is undone without a branch, by the identity that a negative z is
 * exactly the overshoot to take back off both components, each toward its own
 * zero — `select` rather than `If`, as everything on this path is.
 */
function octDecode(stored: Vec2Node): Vec3Node {
  const e = stored.mul(2).sub(1) as Vec2Node
  const ex = e.x as FloatNode
  const ey = e.y as FloatNode
  const z = float(1).sub(ex.abs()).sub(ey.abs()) as FloatNode
  const overshoot = z.negate().max(0) as FloatNode
  const back = (component: FloatNode) =>
    component.sub((component.greaterThanEqual(0) as BoolNode).select(overshoot, overshoot.negate()))

  return vec3(back(ex), back(ey), z).normalize() as Vec3Node
}

/**
 * The vertex encoding's sampler: a row holds where this vertex ended up, so the
 * decode is two fetches at `x = vertexIndex` and a mix — the same shape for the
 * position layer and the normal layer, over texels that no longer hold the same
 * thing.
 */
function vertexDecode({ positionTexture, normalTexture }: DeltaVAT, rows: Rows): VATDecoded {
  // The VAT's x axis, on either carrier. A `BatchedMesh` holding one geometry
  // added first puts that geometry at vertex 0 of the batch, so the batch's
  // vertex index and the VAT's are the same number — which is what
  // `assertVATCarrier` in `vatDecode` is there to keep true.
  const vertexRow = int(vertexIndex)

  // One band of one layer: the two rows that band sits between, mixed — the
  // GLSL decode's `vatBandSample`, and the same function for both bands.
  const band = (tex: DataTexture, of: Band) => {
    const s0 = textureLoad(tex, ivec2(vertexRow, of.row0)).xyz
    const s1 = textureLoad(tex, ivec2(vertexRow, of.row1)).xyz
    return mix(s0, s1, of.blend)
  }

  // The two lerps, mixed by the weight. The second pair is fetched whether or
  // not this instance is transitioning — a node graph has no branch to skip it
  // behind (see `vatDecode`), and on this encoding the GLSL decode does not
  // skip it either, because #72 measured the skip costing more than the fetches
  // — but while the weight is zero those rows are the live ones, so the fetches
  // land on texels already read. The caller renormalises the normal layer after
  // the mix, as it does for one band.
  const sample = (tex: DataTexture) => mix(band(tex, rows.live), band(tex, rows.outgoing), rows.weight)

  // The normal layer's own pair, because its texel is not what it decodes to
  // (#29): each fetch is unpacked *before* the lerp, never after. Two
  // octahedral pairs either side of the fold interpolate through the wrong
  // half of the sphere, so the mix stays a mix of vectors — the one the float
  // layer did — and the result is renormalised below as it always was.
  const bandNormal = (tex: DataTexture, of: Band) => {
    const s0 = octDecode(textureLoad(tex, ivec2(vertexRow, of.row0)).xy as Vec2Node)
    const s1 = octDecode(textureLoad(tex, ivec2(vertexRow, of.row1)).xy as Vec2Node)
    return mix(s0, s1, of.blend)
  }
  const sampleNormal = (tex: DataTexture) =>
    mix(bandNormal(tex, rows.live), bandNormal(tex, rows.outgoing), rows.weight)

  return {
    encoding: 'delta',
    position: sample(positionTexture) as Vec3Node,
    normal: normalTexture ? (sampleNormal(normalTexture).normalize() as Vec3Node) : null,
  }
}

/**
 * `Matrix4.compose`, component for component: a rotation, a translation and one
 * scale back to the matrix the skinning wants — the GLSL decode's `vatCompose`,
 * as nodes, so a rig crowd deforms on this path as it does on the other.
 */
function compose(q: Vec4Node, ts: Vec4Node): Mat4Node {
  const x = q.x as FloatNode
  const y = q.y as FloatNode
  const z = q.z as FloatNode
  const w = q.w as FloatNode
  const x2 = x.add(x) as FloatNode
  const y2 = y.add(y) as FloatNode
  const z2 = z.add(z) as FloatNode
  const xx = x.mul(x2) as FloatNode
  const xy = x.mul(y2) as FloatNode
  const xz = x.mul(z2) as FloatNode
  const yy = y.mul(y2) as FloatNode
  const yz = y.mul(z2) as FloatNode
  const zz = z.mul(z2) as FloatNode
  const wx = w.mul(x2) as FloatNode
  const wy = w.mul(y2) as FloatNode
  const wz = w.mul(z2) as FloatNode
  const s = ts.w as FloatNode
  const one = float(1)
  return mat4(
    vec4(one.sub(yy.add(zz)).mul(s), xy.add(wz).mul(s), xz.sub(wy).mul(s), 0),
    vec4(xy.sub(wz).mul(s), one.sub(xx.add(zz)).mul(s), yz.add(wx).mul(s), 0),
    vec4(xz.add(wy).mul(s), yz.sub(wx).mul(s), one.sub(xx.add(yy)).mul(s), 0),
    vec4(ts.xyz, 1),
  ) as Mat4Node
}

/**
 * `q`, on the same hemisphere as `reference`: `dot( reference, q ) < 0.0 ? -q : q`.
 * The bake keeps consecutive rows on one hemisphere, but a looping clip blends
 * its band's last row into its first, and a crossfade's outgoing band is any row
 * of the bake — neither is this row's neighbour, so both are checked, or the
 * blend passes through zero and a limb collapses for a frame.
 */
const hemisphereOf = (reference: Vec4Node, q: Vec4Node): Vec4Node =>
  (dot(reference, q) as FloatNode).lessThan(0).select(q.negate(), q) as Vec4Node

/**
 * The rig encoding's sampler (ADR-0018): a row holds the posed rig, one slot per
 * bone as a rotation, a translation and a uniform scale, and the vertex skins
 * itself from the four slots its `skinIndex` names — three's own `skinning`
 * node with a frame axis, built from the same primitives it uses (`mat4` from
 * four columns, `uvec4` for the indices, the weighted sum, `mat3` for the
 * normal). Twenty-four fetches per vertex, dependent on an attribute, against
 * the vertex decode's six; measured on the prototype (#47), where the fetch
 * count turned out not to be the cost, the dependent read was.
 *
 * Every fetch is paid whether or not its slot has weight and whether or not
 * the instance is fading: a node graph has no branch to skip a fetch behind,
 * which is the trade the vertex decode already makes. The GLSL decode does skip
 * them on *this* encoding — sixteen dependent fetches per vertex is well over
 * what a branch costs to hold, which is the one place #72 found the guard worth
 * keeping — and the parity gate is what says the two still land on the same
 * pixels.
 */
function rigDecode({ rigTexture, geometry }: RigVAT, rows: Rows): VATDecoded {
  // Declared as three's skinning declares them: `uvec4` for the indices, because
  // a WebGPU vertex format of unsigned integers must be read as one, and the
  // bake writes `skinIndex` as three itself does. Bound by name off the
  // geometry, remapped to slots by the bake.
  const skinIndex = attribute('skinIndex', 'uvec4')
  const skinWeight = attribute('skinWeight', 'vec4')

  const fetch = (column: IntNode, row: IntNode) => textureLoad(rigTexture, ivec2(column, row)) as Vec4Node

  // One slot of the posed rig at one band — the GLSL decode's `vatSlotPose`,
  // and the same function for both bands.
  const pose = (rotation: IntNode, placement: IntNode, of: Band) => {
    const q0 = fetch(rotation, of.row0)
    const ts0 = fetch(placement, of.row0)
    const q1 = hemisphereOf(q0, fetch(rotation, of.row1))
    const ts1 = fetch(placement, of.row1)
    return {
      // A normalised lerp, not a slerp: at a bake's frame step the angular error
      // against a true slerp is far below anything visible. It is still a
      // *rotation* at every blend, which is what a componentwise matrix lerp is
      // not — that one shortens a limb as it turns (ADR-0018).
      q: mix(q0, q1, of.blend).normalize() as Vec4Node,
      ts: mix(ts0, ts1, of.blend) as Vec4Node,
    }
  }

  // One slot's matrix: its pose in the band the instance is playing, blended
  // with its pose in the band it is leaving *before* the matrix is composed, so
  // the crowd skins from one rig rather than from the average of two matrices.
  // Weighted for the sum.
  const slot = (index: Node<'uint'>, weight: FloatNode): Mat4Node => {
    // Two texels per slot, addressed as the baker laid them out — from the one
    // layout module, so a repack there cannot leave this decode on the old one.
    const column = (texel: number) => int(index).mul(RIG_TEXELS_PER_SLOT).add(texel) as IntNode
    const rotation = column(RIG_TEXELS.rotation)
    const placement = column(RIG_TEXELS.placement)

    const live = pose(rotation, placement, rows.live)
    const outgoing = pose(rotation, placement, rows.outgoing)
    // The outgoing band is any row of the bake, not this row's neighbour, so
    // the same hemisphere check the wrap needs.
    const q = mix(live.q, hemisphereOf(live.q, outgoing.q), rows.weight).normalize() as Vec4Node
    const ts = mix(live.ts, outgoing.ts, rows.weight) as Vec4Node

    return compose(q, ts).mul(weight) as Mat4Node
  }

  // Linear blend skinning: the weighted sum of slot matrices, which is the
  // blend the bake did on the CPU for the bounds and three's own skinning does
  // on the GPU.
  const skin = slot(skinIndex.x as Node<'uint'>, skinWeight.x as FloatNode)
    .add(slot(skinIndex.y as Node<'uint'>, skinWeight.y as FloatNode))
    .add(slot(skinIndex.z as Node<'uint'>, skinWeight.z as FloatNode))
    .add(slot(skinIndex.w as Node<'uint'>, skinWeight.w as FloatNode)) as Mat4Node

  // Normal and tangent through the matrix itself rather than its
  // inverse-transpose, as three's skinning takes them: exact for the rigid and
  // uniformly scaled slots this encoding stores. Off the rest-pose attributes,
  // which under this encoding are in each part's own local space — the slot
  // carries the placement (ADR-0018).
  const skin3 = mat3(skin)
  return {
    encoding: 'rig',
    position: skin.mul(vec4(positionGeometry, 1)).xyz as Vec3Node,
    normal: skin3.mul(normalGeometry).normalize() as Vec3Node,
    // Gated on the geometry rather than read and ignored: `tangentGeometry`
    // is an attribute read, and three computes tangents onto a geometry that
    // has none the moment a graph asks for them.
    tangent: geometry.hasAttribute('tangent')
      ? (skin3.mul(tangentGeometry.xyz).normalize() as Vec3Node)
      : null,
  }
}

/**
 * A material carrying the decode. Written as an intersection rather than a
 * `MeshStandardNodeMaterial` so the baked material's own class survives: three
 * converts a classic material to its node twin at build time and copies these
 * across, so a glTF's `MeshStandardMaterial` needs no rebuilding here, and a
 * source that is already a node material is left alone. The shadow pass reads
 * `positionNode` off the source material too, which is what makes the missing
 * depth material correct rather than forgotten.
 *
 * The conversion covers the material classes three itself maps — every one a
 * `GLTFLoader` produces. A custom `Material` subclass with no node twin is
 * refused by the renderer, and must be authored as a node material instead.
 */
type VATNodeMaterial = Material & { positionNode: Vec3Node }

/** Options for {@link createVATMesh}. */
export interface CreateVATMeshOptions {
  /**
   * The playback clock to drive this crowd from, in seconds. Pass one — from
   * `uniform(0)` — to run several VAT meshes off a single time value, or to
   * keep the node for wiring elsewhere in a graph, which the returned `time`
   * gives back as a plain clock. Defaults to a fresh `uniform(0)`.
   *
   * The one place the two paths' signatures differ: `three-vat/webgl` takes a
   * `THREE.IUniform` here. Both are `{ value }` clocks, and code that lets the
   * call make its own is identical on either path.
   */
  time?: VATTimeUniform
  /**
   * The GPU's real texture ceiling — {@link getMaxTextureSize} — which the
   * playback texture checks the crowd against, one row per instance. Defaults
   * to `MAX_TEXTURE_SIZE`, a desktop figure (`VATPlaybackTextureOptions`).
   */
  maxTextureSize?: number
}

/**
 * Turn a baked VAT and a list of instances into a crowd ready to render: an
 * `InstancedMesh` rendering the bake's geometry, a playback texture carrying
 * the instance-playback contract, and materials that decode the VAT on the
 * vertex stage.
 *
 * ```ts
 * const { mesh, time, playback } = createVATMesh(vat, instances)
 * mesh.castShadow = mesh.receiveShadow = true
 * scene.add(mesh)
 * // per frame:
 * time.value = clock.elapsedTime
 * ```
 *
 * The same call, the same signature and the same return as `three-vat/webgl`:
 * a crowd moves between `WebGLRenderer` and `WebGPURenderer` by changing the
 * import line and nothing else. The one asymmetry is absorbed here rather than
 * passed on — this path attaches **no depth material**, because `positionNode`
 * already feeds the depth pass, whereas the WebGL path must patch one by hand
 * or cast bind-pose shadows.
 *
 * Instance matrices and `castShadow`/`receiveShadow` stay yours, as on the
 * WebGL path: `mesh.setMatrixAt` then `mesh.computeBoundingSphere()`, or
 * `frustumCulled = false` when the matrices change every frame.
 */
export function createVATMesh(
  vat: VAT,
  instances: VATInstance[],
  options: CreateVATMeshOptions = {},
): VATCrowd {
  // Created here rather than left to `vatNodes`' own default, because this
  // function has to hand the clock back as something the caller can set.
  const time: VATTimeUniform = options.time ?? uniform(0)

  // The crowd's playback, in the texture that carries it.
  const playback = createVATPlaybackTexture(instances, { maxTextureSize: options.maxTextureSize })

  // One material per VAT material, never merged here (ADR-0008, ADR-0028): a three-material
  // crowd is three draw calls, not three per instance.
  // A normal-less VAT under a material that shades from a normal is refused
  // here, as the WebGL path refuses it in `patchVATMaterial` — the source
  // material is checked, so the error names what the caller baked, not a clone.
  for (const source of vat.materials) assertBakedNormal(vat, source)

  const materials = vat.materials.map((source) => source.clone() as VATNodeMaterial)

  // No `customDepthMaterial`, and none is missing: `positionNode` is read by
  // the depth pass too, so the crowd's shadows deform for free (contrast
  // `three-vat/webgl`, where that is the step most easily dropped).
  // The bake's own geometry, not a clone of it: the clone existed for the
  // instance-playback attributes and for nothing else, so with the pack in a
  // texture two crowds over one bake share the geometry and its all-frames
  // bounds, and its disposal follows the bake's (ADR-0016).
  const mesh = new InstancedMesh(vat.geometry, materials, instances.length)

  // Built after the mesh, and from it: the decode has to re-apply this mesh's
  // own instancing, because three applies the instance matrix before it reads
  // `positionNode` (see `VATNodeOptions.carrier`). Built once and shared
  // by every material — the graph is a DAG, so one decode read by three
  // materials is one decode, not three.
  const { positionNode } = vatNodes(vat, { time, playback, carrier: mesh })
  for (const material of materials) material.positionNode = positionNode

  return { mesh, time, playback }
}
