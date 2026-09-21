import { InstancedMesh } from 'three'
import { Fn, batch, batchIndirectIndex, bool, float, hash, instanceIndex, instancedMesh, int, ivec2, mix, normalLocal, positionGeometry, positionLocal, textureLoad, uniform, vertexIndex } from 'three/tsl'
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
import type { VAT, VATClip, VATClock, VATCrowd } from './types.js'
import { vertexEncoded } from './encoding.js'

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
/** A fluent TSL vec3 node. */
type Vec3Node = Node<'vec3'>
/** A fluent TSL vec4 node — how the instance-playback pack arrives. */
type Vec4Node = Node<'vec4'>
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
   * the decode has to displace in the geometry's own space and then re-apply
   * that transform itself. Without this the delta is added in instance space —
   * unrotated and unscaled — and every instance deforms according to its own
   * matrix. Second: the carrier decides how this instance's *logical* index is
   * spelled, which is the row of the playback texture the pack is read from —
   * `instanceIndex` on an `InstancedMesh`, `batchIndirectIndex` on a
   * `BatchedMesh`, whose drawn slot is a permutation that changes every frame
   * (ADR-0016).
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
   * with it.
   *
   * There is deliberately no `normalNode`. A material's `normalNode` is built in
   * the *fragment* stage (three reaches it from `normalView` through
   * `builder.context.setupNormal()`) and is expected in **view** space, whereas a
   * VAT's baked normals are per-vertex and in the geometry's own space. Handing
   * an object-space normal to a fragment-stage node skipped both the instance
   * matrix and the normal matrix, and took `vertexIndex` into the fragment stage
   * with it — where `IndexNode` does not give you the vertex index at all, but
   * quietly turns itself into a varying, so every fragment read a linearly
   * *interpolated* index that addresses neither of the vertices it lies between.
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

/** Everything the decode needs to locate an instance in the frame bands. */
interface Playback {
  /** First texture row of the clip's band. */
  startFrame: IntNode
  /** Rows in the band. */
  frames: FloatNode
  /** Seconds the band spans. */
  duration: FloatNode
  /** Absolute clock time this animation began. In the past, for a desynced crowd. */
  startTime: FloatNode
  /** Rate multiplier. */
  speed: FloatNode
  /** {@link LoopMode}, as the number the pack carries. */
  loopMode: FloatNode
  /** Repeat count, or {@link INFINITE_REPETITIONS}. */
  repetitions: FloatNode
  /** {@link EndMode}, as the number the pack carries. */
  endMode: FloatNode
  /** The frozen outgoing pose of a pose-freeze fade, and how long it lasts. */
  fade: {
    /** First texture row of the outgoing clip's band. */
    startFrame: FloatNode
    /** Rows in that band. */
    frames: FloatNode
    /** The phase of it that was frozen, in `[0, 1]`. */
    phase: FloatNode
    /** Seconds to blend it away over. Zero is not fading. */
    duration: FloatNode
  }
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
 * `DECODE_PRELUDE` in src/webgl.ts — the swizzles here are the whole of what the
 * two paths have to agree on, and a wrong one is silent.
 */
function texturePlayback(texture: DataTexture, instance: IntNode): Playback {
  const clip = packTexel(texture, PACK_TEXELS.clip, instance)
  const playback = packTexel(texture, PACK_TEXELS.playback, instance)
  const fade = packTexel(texture, PACK_TEXELS.fade, instance)
  const frames = clip.y as FloatNode
  return {
    startFrame: int(clip.x as FloatNode),
    frames,
    duration: frames.div(clip.z as FloatNode),
    startTime: playback.x as FloatNode,
    speed: clip.w as FloatNode,
    loopMode: playback.y as FloatNode,
    repetitions: playback.z as FloatNode,
    endMode: playback.w as FloatNode,
    fade: {
      startFrame: fade.x as FloatNode,
      frames: fade.y as FloatNode,
      phase: fade.z as FloatNode,
      duration: fade.w as FloatNode,
    },
  }
}

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
  return {
    startFrame: int(clip.startFrame),
    frames: float(clip.frames),
    duration: float(clip.frames / clip.fps),
    // Negated, because desync is now a start time in the *past*: an instance
    // that began `desync` seconds ago is that far into its clip already.
    startTime: hash(instance).mul(-desync),
    // Everything but the phase comes from the clip's own baked defaults, so a
    // clip baked "once, clamped, at 2x" plays that way here too. A second set
    // of defaults living in this path would be a crowd that animates
    // differently depending on whether anyone wrote the attributes.
    speed: float(clip.speed),
    loopMode: float(clip.loopMode),
    repetitions: float(clip.repetitions),
    endMode: float(clip.endMode),
    // Nothing to fade out of: this path is the zero-config default, where an
    // instance has never been written and so has no animation it left behind.
    fade: { startFrame: float(0), frames: float(0), phase: float(0), duration: float(0) },
  }
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
  const { position, normal } = vatDecode(vat, options)

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
    positionLocal.assign((carrier ? positionGeometry : positionLocal).add(position))
    // Absent for a VAT baked with `bakeNormals: false`: nothing to sample, and
    // nothing to write — `normalLocal` keeps the rest normal three put there,
    // which an unlit material ignores and a flat-shaded one overrides with the
    // deformed position's derivatives.
    if (normal) normalLocal.assign(normal)
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
 * The decode's arithmetic: the position delta and the normal this instance reads
 * at this moment, as nodes — before the vertex-stage writes that place them.
 * `normal` is `null` when the VAT was baked without a normal texture.
 *
 * @internal Split out and exported for the structural tests. A `Fn` body is
 * opaque to graph traversal (its statements are not built until the shader is),
 * and structural assertions are the only TSL coverage CI can run without a GPU —
 * so the arithmetic that matters stays reachable as a graph. Not re-exported
 * from `three-vat`; nothing outside this package should build against it.
 */
export function vatDecode(
  vat: VAT,
  options: VATNodeOptions = {},
): { position: Vec3Node; normal: Vec3Node | null } {
  const { time = uniform(0), playback: playbackTexture, carrier, clipIndex = 0, desync = 0 } = options

  // A batch a VAT cannot be decoded on is refused here, where the WebGL path
  // refuses it in `patchVATMaterial` — one rule, read by both (src/carrier.ts).
  if (carrier) assertVATCarrier(carrier, vat)

  const instance = instanceIdOf(carrier)
  const playback = playbackTexture
    ? texturePlayback(playbackTexture.texture, instance)
    : hashedPlayback(clipAt(vat, clipIndex), desync, instance)
  // The VAT's x axis, on either carrier. A `BatchedMesh` holding one geometry
  // added first puts that geometry at vertex 0 of the batch, so the batch's
  // vertex index and the VAT's are the same number — which is what
  // `assertVATCarrier` above is there to keep true.
  const vertexRow = int(vertexIndex)

  // `resolveVATFrame` (src/instance-playback.ts) as a node graph, branch for
  // branch with the GLSL decode's `vatSample`. The semantics live there; this
  // transcribes them, and the mode constants come from that module rather than
  // being retyped as literals. Built once, outside `sample`, because both
  // textures are read at the same frame pair — the graph is a DAG, so the
  // arithmetic below is shared rather than duplicated per texture.
  const frames = playback.frames
  const last = frames.sub(1) as FloatNode
  // Seconds of clock since this animation began, shared by the two things that
  // measure from it: playback, which scales it by the clip's speed, and the
  // fade, which does not.
  const elapsed = time.sub(playback.startTime) as FloatNode
  const local = elapsed.mul(playback.speed) as FloatNode
  const loops = local.div(playback.duration) as FloatNode

  const started = local.greaterThanEqual(0) as BoolNode
  const finished = started
    .and(playback.repetitions.notEqual(INFINITE_REPETITIONS))
    .and(loops.greaterThanEqual(playback.repetitions)) as BoolNode
  const isPingPong = playback.loopMode.equal(LoopMode.PingPong) as BoolNode

  // A ping-pong's triangle wave: forward across the first unit, back across the
  // second.
  const bounce = loops.mod(2) as FloatNode
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
  const f1 = wraps.select(f0.add(1).mod(frames), f0.add(1).min(last)) as FloatNode
  // `VATFrame.mix`, under another name: `mix` here is TSL's own function.
  const frameMix = f.sub(f0) as FloatNode

  /**
   * The two rows both textures read, as absolute texture rows — built once
   * here, and never inside `sample`.
   *
   * Not only for economy. `f1` is a `select`, which TSL hoists into a variable
   * assigned in an if/else, and a *second* `int()` built over that same
   * variable comes out of the WGSL builder without its cast (three r185): the
   * position texture's fetch read `i32( nodeVar )`, the normal texture's read
   * the bare `f32`, and the vertex shader failed to compile — which on WebGPU
   * is a crowd that silently draws nothing. One conversion node per row, shared
   * by every fetch, is the shape the builder handles.
   */
  const bandRow = (offset: FloatNode) => int(offset).add(playback.startFrame) as IntNode
  const row0 = bandRow(f0)
  const row1 = bandRow(f1)

  // The pose-freeze fade, branch for branch with the GLSL decode's. Wall clock
  // rather than clip time — the incoming clip's speed does not stretch a fade —
  // and guarded on the duration, because a graph divides whether or not the
  // result is used and 0/0 is a NaN that `clamp` does not rescue.
  const fade = playback.fade
  const fadeWeight = fade.duration.greaterThan(0).select(
    float(1).sub(elapsed.div(fade.duration).clamp(0, 1)),
    float(0),
  ) as FloatNode
  // `fadeRowOf` in src/instance-playback.ts, transcribed — clamp and all.
  const frozenRow = int(fade.phase.mul(fade.frames).floor().min(fade.frames.sub(1)).max(0)).add(
    int(fade.startFrame),
  ) as IntNode

  const sample = (tex: DataTexture) => {
    const s0 = textureLoad(tex, ivec2(vertexRow, row0)).xyz
    const s1 = textureLoad(tex, ivec2(vertexRow, row1)).xyz
    // The third fetch every crowd pays for, fading or not: a node graph has no
    // branch to skip it behind, and `fadeWeight` is zero whenever it is not
    // wanted. It is also why this fade is provisional — a real crossfade (#30)
    // is a second live playback and four fetches, which is the cost ADR-0007
    // deferred.
    const frozen = textureLoad(tex, ivec2(vertexRow, frozenRow)).xyz
    return mix(mix(s0, s1, frameMix), frozen, fadeWeight)
  }

  // Narrowed on the encoding before a texture is read (ADR-0018): this is the
  // vertex decode, and it reads the vertex encoding's two layers.
  const { positionTexture, normalTexture } = vertexEncoded(vat, 'vatDecode')
  return {
    position: sample(positionTexture) as Vec3Node,
    normal: normalTexture ? (sample(normalTexture).normalize() as Vec3Node) : null,
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
  const playback = createVATPlaybackTexture(instances)

  // One material per source material, never merged (ADR-0008): a three-material
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
