// The instance-playback contract: the per-instance `{ clip, timeOffset, speed }`
// triple, written once here for every decode path to read (ADR-0009). It lives
// in core — not in a renderer subpath — because it is the interface between the
// baker and the decoders, and a contract with two definitions drifts the first
// time a field is added. Nothing here is renderer-specific: it is
// `InstancedBufferAttribute` work on a `BufferGeometry`, so ADR-0005's bundle
// isolation is untouched.
import { InstancedBufferAttribute } from 'three'
import type { BufferGeometry } from 'three'
import type { VAT } from './types.js'

/**
 * The attribute names of the contract — the one definition of them. Both decode
 * paths read this: `DECODE_PRELUDE` in `src/webgl.ts` declares them as GLSL
 * attributes, `vatNodes` in `src/tsl.ts` builds TSL attribute nodes from these
 * very strings. Not re-exported from the entry point: it is the contract's
 * spelling, not part of the public API.
 */
export const PLAYBACK_ATTRIBUTES = {
  clipStart: 'aClipStart',
  clipFrames: 'aClipFrames',
  clipFps: 'aClipFps',
  timeOffset: 'aTimeOffset',
  speed: 'aSpeed',
} as const

/** Per-instance playback state consumed by both decode paths. */
export interface VATInstance {
  clip: Pick<VAT['clips'][number], 'startFrame' | 'frames' | 'fps'>
  /** Phase offset in seconds — desyncs the crowd. */
  timeOffset: number
  /** Playback rate multiplier. */
  speed: number
}

/**
 * Attach the instance-playback attributes to an instanced geometry. Call once
 * before rendering, on the geometry you hand to the `InstancedMesh`.
 *
 * The attribute names and layout below are the shared contract, spelled once in
 * {@link PLAYBACK_ATTRIBUTES}. Both decode paths read exactly these five —
 * `DECODE_PRELUDE` in `src/webgl.ts` as GLSL attributes, `vatNodes` in
 * `src/tsl.ts` as TSL attribute nodes, when it is handed this geometry.
 *
 * | Attribute     | Type          | Source                |
 * | ------------- | ------------- | --------------------- |
 * | `aClipStart`  | `float` (x 1) | `instance.clip.startFrame` — first texture row of the clip's frame band |
 * | `aClipFrames` | `float` (x 1) | `instance.clip.frames` — rows in the band |
 * | `aClipFps`    | `float` (x 1) | `instance.clip.fps` — with `frames`, the clip's duration |
 * | `aTimeOffset` | `float` (x 1) | `instance.timeOffset` — phase, in seconds |
 * | `aSpeed`      | `float` (x 1) | `instance.speed` — rate multiplier |
 *
 * Every entry is a one-component `InstancedBufferAttribute` of `Float32Array`,
 * one element per instance, in instance order. Adding a field — crossfade's
 * reserved second clip index being the known case (ADR-0007) — means adding it
 * here, in the table above, and in each decode path's own attribute
 * declarations.
 */
export function addVATInstanceAttributes(geometry: BufferGeometry, instances: VATInstance[]): void {
  // VAT supersedes native deformation. Drop any morph targets baked into the
  // VAT so three's renderer doesn't try to apply them — an InstancedMesh has no
  // morphTargetInfluences, so the morph path would crash — and doesn't upload
  // now-dead target buffers.
  geometry.morphAttributes = {}
  geometry.morphTargetsRelative = false

  const n = instances.length
  const clipStart = new Float32Array(n)
  const clipFrames = new Float32Array(n)
  const clipFps = new Float32Array(n)
  const timeOffset = new Float32Array(n)
  const speed = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const inst = instances[i]!
    clipStart[i] = inst.clip.startFrame
    clipFrames[i] = inst.clip.frames
    clipFps[i] = inst.clip.fps
    timeOffset[i] = inst.timeOffset
    speed[i] = inst.speed
  }
  geometry.setAttribute(PLAYBACK_ATTRIBUTES.clipStart, new InstancedBufferAttribute(clipStart, 1))
  geometry.setAttribute(PLAYBACK_ATTRIBUTES.clipFrames, new InstancedBufferAttribute(clipFrames, 1))
  geometry.setAttribute(PLAYBACK_ATTRIBUTES.clipFps, new InstancedBufferAttribute(clipFps, 1))
  geometry.setAttribute(PLAYBACK_ATTRIBUTES.timeOffset, new InstancedBufferAttribute(timeOffset, 1))
  geometry.setAttribute(PLAYBACK_ATTRIBUTES.speed, new InstancedBufferAttribute(speed, 1))
}

/**
 * The geometry a crowd renders: the bake's own, cloned, carrying this crowd's
 * instance playback.
 *
 * Spelled once for both decode paths, because the reasoning is the same on
 * either renderer. The geometry comes from the VAT because the baker owns the
 * vertex ordering and the textures are indexed by it; it is cloned because the
 * playback attributes are per-crowd and two crowds may share one bake; and the
 * clone carries the all-frames bounding volume with it, which is what stops a
 * deformed crowd culling mid-animation.
 *
 * Like {@link PLAYBACK_ATTRIBUTES}, this is shared internals rather than public
 * API: it is not re-exported from the entry point. A caller assembling a crowd
 * by hand writes these two lines themselves.
 */
export function createCrowdGeometry(vat: VAT, instances: VATInstance[]): BufferGeometry {
  const geometry = vat.geometry.clone()
  addVATInstanceAttributes(geometry, instances)
  return geometry
}
