import { InstancedMesh } from 'three'
import { attribute, float, hash, instanceIndex, int, ivec2, mix, positionLocal, textureLoad, uniform, vertexIndex } from 'three/tsl'
import type { BufferGeometry, DataTexture, Material } from 'three'
import type { Node } from 'three/webgpu'
import { createCrowdGeometry, PLAYBACK_ATTRIBUTES } from './instance-playback.js'
import type { VATInstance } from './instance-playback.js'
import type { BakedVAT, VAT, VATClip, VATClock, VATCrowd } from './types.js'

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
  positionNode: Vec3Node
  normalNode: Vec3Node
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
  /** Phase, in seconds. */
  timeOffset: FloatNode
  /** Rate multiplier. */
  speed: FloatNode
}

/** A one-component instanced attribute, as a fluent float node. */
const floatAttribute = (name: string) => attribute(name, 'float') as FloatNode

/** Per-instance playback, read from the contract attributes. */
function attributePlayback(): Playback {
  const frames = floatAttribute(PLAYBACK_ATTRIBUTES.clipFrames)
  return {
    startFrame: int(floatAttribute(PLAYBACK_ATTRIBUTES.clipStart)),
    frames,
    duration: frames.div(floatAttribute(PLAYBACK_ATTRIBUTES.clipFps)),
    timeOffset: floatAttribute(PLAYBACK_ATTRIBUTES.timeOffset),
    speed: floatAttribute(PLAYBACK_ATTRIBUTES.speed),
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
    timeOffset: hash(instanceIndex).mul(desync),
    speed: float(1),
  }
}

/**
 * Whether this geometry carries the instance-playback contract — all five
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
  const { time = uniform(0), geometry, clipIndex = 0, desync = 0 } = options

  const playback =
    geometry && checkPlaybackAttributes(geometry)
      ? attributePlayback()
      : hashedPlayback(clipAt(vat, clipIndex), desync)
  const vertexRow = int(vertexIndex)

  const sample = (tex: DataTexture) => {
    // Phrased exactly as the GLSL decode's `vatSample`, term for term — the two
    // paths must land on the same frame pair for the same instance.
    const t = time.mul(playback.speed).add(playback.timeOffset).div(playback.duration).fract().mul(playback.frames)
    const f0 = int(t)
    const f1 = int(f0.add(1).toFloat().mod(playback.frames))
    const s0 = textureLoad(tex, ivec2(vertexRow, f0.add(playback.startFrame))).xyz
    const s1 = textureLoad(tex, ivec2(vertexRow, f1.add(playback.startFrame))).xyz
    return mix(s0, s1, t.fract())
  }

  return {
    positionNode: positionLocal.add(sample(vat.positionTexture)),
    normalNode: sample(vat.normalTexture).normalize(),
    time,
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
type VATNodeMaterial = Material & { positionNode: Vec3Node; normalNode: Vec3Node }

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
  vat: BakedVAT,
  instances: VATInstance[],
  options: CreateVATMeshOptions = {},
): VATCrowd {
  // Created here rather than left to `vatNodes`' own default, because this
  // function has to hand the clock back as something the caller can set.
  const time: VATTimeUniform = options.time ?? uniform(0)

  const geometry = createCrowdGeometry(vat, instances)

  // Built once and shared by every material: the graph is a DAG, and one
  // decode read by three materials is one decode, not three.
  const { positionNode, normalNode } = vatNodes(vat, { time, geometry })

  // One material per source material, never merged (ADR-0008): a three-material
  // crowd is three draw calls, not three per instance.
  const materials = vat.materials.map((source) => {
    const material = source.clone() as VATNodeMaterial
    material.positionNode = positionNode
    material.normalNode = normalNode
    return material
  })

  // No `customDepthMaterial`, and none is missing: `positionNode` is read by
  // the depth pass too, so the crowd's shadows deform for free (contrast
  // `three-vat/webgl`, where that is the step most easily dropped).
  const mesh = new InstancedMesh(geometry, materials, instances.length)

  return { mesh, time }
}
