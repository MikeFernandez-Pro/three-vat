import { float, hash, instanceIndex, int, ivec2, mix, positionLocal, textureLoad, uniform, vertexIndex } from 'three/tsl'
import type { DataTexture } from 'three'
import type { Node } from 'three/webgpu'
import type { VAT } from './types.js'

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
/** A fluent TSL vec3 node. */
type Vec3Node = Node<'vec3'>

export interface VATNodeOptions {
  /**
   * Elapsed-time uniform node (seconds). Create once with `uniform(0)` and set
   * `.value` per frame. Defaults to a fresh `uniform(0)` you can read back.
   */
  time?: FloatNode
  /** Which clip to play (index into `vat.clips`). Default `0`. */
  clipIndex?: number
  /**
   * Max random per-instance time offset in seconds, hashed from `instanceIndex`.
   * `0` (default) plays every instance in lockstep.
   */
  desync?: number
}

/** Position/normal nodes to assign onto a `MeshStandardNodeMaterial` (or similar). */
export interface VATNodes {
  positionNode: Vec3Node
  normalNode: Vec3Node
  /** The time uniform in use — set `.value` each frame. */
  time: FloatNode
}

/**
 * Build TSL decode nodes for a baked VAT, for the WebGPU/TSL renderer path.
 * Per-instance desync comes from `hash(instanceIndex)` — no instanced
 * attributes needed. Shadows work automatically because `positionNode` also
 * feeds the depth pass.
 *
 * v1 limitation: a single clip per material (all instances share `clipIndex`,
 * only their phase is desynced). Per-instance clip variety is future work; use
 * the `three-vat/webgl` path for mixed-clip crowds today.
 *
 * NOTE: the TSL path is verified visually/manually in v1 (no automated GPU test).
 */
export function vatNodes(vat: VAT, options: VATNodeOptions = {}): VATNodes {
  const { time = uniform(0), clipIndex = 0, desync = 0 } = options
  const clip = vat.clips[clipIndex]
  if (!clip) {
    throw new Error(`three-vat: clipIndex ${clipIndex} out of range (${vat.clips.length} clips)`)
  }

  const frames = float(clip.frames)
  const startFrame = int(clip.startFrame)
  const duration = float(clip.frames / clip.fps)
  const offset = hash(instanceIndex).mul(desync)
  const vertexRow = int(vertexIndex)

  const sample = (tex: DataTexture) => {
    const t = time.add(offset).div(duration).fract().mul(frames)
    const f0 = int(t)
    const f1 = int(f0.add(1).toFloat().mod(frames))
    const s0 = textureLoad(tex, ivec2(vertexRow, f0.add(startFrame))).xyz
    const s1 = textureLoad(tex, ivec2(vertexRow, f1.add(startFrame))).xyz
    return mix(s0, s1, t.fract())
  }

  return {
    positionNode: positionLocal.add(sample(vat.positionTexture)),
    normalNode: sample(vat.normalTexture).normalize(),
    time,
  }
}
