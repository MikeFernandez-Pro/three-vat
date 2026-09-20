import { InstancedMesh } from 'three'
import { Fn, attribute, bool, float, hash, instanceIndex, instancedMesh, int, ivec2, mix, normalLocal, positionGeometry, positionLocal, textureLoad, uniform, vertexIndex } from 'three/tsl'
import type { BufferGeometry, DataTexture, Material } from 'three'
import type { Node } from 'three/webgpu'
import { assertBakedNormal } from './baked-normals.js'
import {
  createCrowdGeometry,
  EndMode,
  INFINITE_REPETITIONS,
  LoopMode,
  PLAYBACK_ATTRIBUTES,
} from './instance-playback.js'
import type { VATInstance } from './instance-playback.js'
import type { VAT, VATClip, VATClock, VATCrowd } from './types.js'

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
   * The geometry these nodes will render. When it carries the instance-playback
   * attributes — write them with `addVATInstanceAttributes` from `three-vat`
   * *before* calling this — each instance plays its own clip, at its own phase
   * and rate. Without them, every instance plays `clipIndex`, phase-desynced by
   * `desync`.
   *
   * Which decode the graph compiles is decided here, at build time: a TSL
   * attribute that is missing from the geometry reads as a constant, so the
   * fallback cannot be a shader-side branch.
   */
  geometry?: BufferGeometry
  /**
   * The `InstancedMesh` these nodes will render, when there is one.
   *
   * Required for a crowd, and for one reason: three applies the instance matrix
   * to `positionLocal` *before* it reads `positionNode`, so the decode has to
   * displace in the geometry's own space and then re-apply the instancing
   * itself. Without this the delta is added in instance space — unrotated and
   * unscaled — and every instance deforms according to its own matrix.
   *
   * Omit it for a single, non-instanced mesh, where `positionLocal` is the
   * geometry position and there is nothing to re-apply.
   */
  instancedMesh?: InstancedMesh
  /**
   * Which clip to play (index into `vat.clips`). Ignored — along with
   * `desync` — when `geometry` carries instance playback, which says all of this
   * per instance. Default `0`.
   */
  clipIndex?: number
  /**
   * Max random per-instance time offset in seconds, hashed from `instanceIndex`.
   * `0` (default) plays every instance in lockstep. Ignored when `geometry`
   * carries instance playback.
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
}

/** A packed instanced attribute, as a fluent vec4 node. */
const vec4Attribute = (name: string) => attribute(name, 'vec4') as Vec4Node

/**
 * Per-instance playback, unpacked from the contract attributes.
 *
 * Component for component with the table on `addVATInstanceAttributes` and with
 * `DECODE_PRELUDE` in src/webgl.ts — the swizzles here are the whole of what the
 * two paths have to agree on, and a wrong one is silent. `aVatFade` is written
 * by the contract but read by nothing until crossfade lands, so it is not
 * unpacked.
 */
function attributePlayback(): Playback {
  const clip = vec4Attribute(PLAYBACK_ATTRIBUTES.clip)
  const playback = vec4Attribute(PLAYBACK_ATTRIBUTES.playback)
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
  }
}

/** The clip the fallback plays, named in the error when it does not exist. */
function clipAt(vat: VAT, clipIndex: number): VATClip {
  const clip = vat.clips[clipIndex]
  if (!clip) {
    throw new Error(`three-vat: clipIndex ${clipIndex} out of range (${vat.clips.length} clips)`)
  }
  return clip
}

/** The zero-config default: one clip, phase-desynced from `instanceIndex`. */
function hashedPlayback(clip: VATClip, desync: number): Playback {
  return {
    startFrame: int(clip.startFrame),
    frames: float(clip.frames),
    duration: float(clip.frames / clip.fps),
    // Negated, because desync is now a start time in the *past*: an instance
    // that began `desync` seconds ago is that far into its clip already.
    startTime: hash(instanceIndex).mul(-desync),
    // Everything but the phase comes from the clip's own baked defaults, so a
    // clip baked "once, clamped, at 2x" plays that way here too. A second set
    // of defaults living in this path would be a crowd that animates
    // differently depending on whether anyone wrote the attributes.
    speed: float(clip.speed),
    loopMode: float(clip.loopMode),
    repetitions: float(clip.repetitions),
    endMode: float(clip.endMode),
  }
}

/**
 * Whether this geometry carries the instance-playback contract — all three
 * attributes or none. A geometry with some of them is a wiring mistake, and is
 * refused here rather than decoded: TSL reads a missing attribute as a
 * constant, so the crowd would render frozen in frame 0 with nothing to explain
 * it.
 */
function checkPlaybackAttributes(geometry: BufferGeometry): boolean {
  const names = Object.values(PLAYBACK_ATTRIBUTES)
  const missing = names.filter((name) => geometry.getAttribute(name) === undefined)
  if (missing.length === 0) return true
  if (missing.length === names.length) return false
  throw new Error(
    `three-vat: geometry carries only part of the instance-playback contract (missing ${missing.join(', ')}) — ` +
      'write all of it with `addVATInstanceAttributes` from `three-vat`, or pass no geometry for the hashed default',
  )
}

/**
 * Build TSL decode nodes for a baked VAT, for the WebGPU/TSL renderer path.
 * Shadows work automatically because `positionNode` also feeds the depth pass.
 *
 * Pass the `geometry` you are about to render and each instance plays the clip,
 * phase and rate written into it by `addVATInstanceAttributes` — the same
 * instance-playback contract the WebGL path reads (ADR-0009), so a mixed-clip
 * crowd renders identically on either renderer. Without those attributes every
 * instance plays `clipIndex`, desynced by a phase hashed from `instanceIndex`.
 *
 * Coverage note: the node graph is tested structurally in CI (no GPU); that the
 * two paths decode *identically* is a pixel-diff release gate.
 */
export function vatNodes(vat: VAT, options: VATNodeOptions = {}): VATNodes {
  const { time = uniform(0), instancedMesh: instanced } = options
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
    positionLocal.assign((instanced ? positionGeometry : positionLocal).add(position))
    // Absent for a VAT baked with `bakeNormals: false`: nothing to sample, and
    // nothing to write — `normalLocal` keeps the rest normal three put there,
    // which an unlit material ignores and a flat-shaded one overrides with the
    // deformed position's derivatives.
    if (normal) normalLocal.assign(normal)
    if (instanced) instancedMesh(instanced)
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
  const { time = uniform(0), geometry, clipIndex = 0, desync = 0 } = options

  const playback =
    geometry && checkPlaybackAttributes(geometry)
      ? attributePlayback()
      : hashedPlayback(clipAt(vat, clipIndex), desync)
  const vertexRow = int(vertexIndex)

  // `resolveVATFrame` (src/instance-playback.ts) as a node graph, branch for
  // branch with the GLSL decode's `vatSample`. The semantics live there; this
  // transcribes them, and the mode constants come from that module rather than
  // being retyped as literals. Built once, outside `sample`, because both
  // textures are read at the same frame pair — the graph is a DAG, so the
  // arithmetic below is shared rather than duplicated per texture.
  const frames = playback.frames
  const last = frames.sub(1) as FloatNode
  const local = time.sub(playback.startTime).mul(playback.speed) as FloatNode
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

  /** A frame offset within the clip's band, as an absolute texture row. */
  const bandRow = (offset: FloatNode) => int(offset).add(playback.startFrame)

  const sample = (tex: DataTexture) => {
    const s0 = textureLoad(tex, ivec2(vertexRow, bandRow(f0))).xyz
    const s1 = textureLoad(tex, ivec2(vertexRow, bandRow(f1))).xyz
    return mix(s0, s1, frameMix)
  }

  const normalTexture = vat.normalTexture
  return {
    position: sample(vat.positionTexture) as Vec3Node,
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
 * `InstancedMesh` whose geometry carries the instance-playback contract and
 * whose materials decode the VAT on the vertex stage.
 *
 * ```ts
 * const { mesh, time } = createVATMesh(vat, instances)
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

  const geometry = createCrowdGeometry(vat, instances)

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
  const mesh = new InstancedMesh(geometry, materials, instances.length)

  // Built after the mesh, and from it: the decode has to re-apply this mesh's
  // own instancing, because three applies the instance matrix before it reads
  // `positionNode` (see `VATNodeOptions.instancedMesh`). Built once and shared
  // by every material — the graph is a DAG, so one decode read by three
  // materials is one decode, not three.
  const { positionNode } = vatNodes(vat, { time, geometry, instancedMesh: mesh })
  for (const material of materials) material.positionNode = positionNode

  return { mesh, time }
}
