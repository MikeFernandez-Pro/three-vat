import { Box3, DataUtils, FloatType, HalfFloatType, Vector3 } from 'three'
import { makeVATTexture } from './bake.js'
import type { VAT, VATClip } from './types.js'

export type VATPrecision = 'float16' | 'float32'

/**
 * The versioned descriptor of an offline-baked VAT. The manifest *is* the
 * format — bump `version` on any breaking layout change.
 */
export interface VATManifest {
  version: 1
  vertexCount: number
  totalFrames: number
  encoding: 'delta'
  precision: VATPrecision
  clips: VATClip[]
  bounds: {
    min: [number, number, number]
    max: [number, number, number]
  }
}

/** A serialized VAT: manifest plus the two raw texel buffers. */
export interface SerializedVAT {
  manifest: VATManifest
  /** Interleaved RGBA position deltas, `float16` or `float32` per `manifest.precision`. */
  position: ArrayBuffer
  /** Interleaved RGBA absolute normals, same precision. */
  normal: ArrayBuffer
}

export interface SerializeOptions {
  /** On-disk texel precision. Default `'float16'` (half the bytes, uploads directly). */
  precision?: VATPrecision
}

/**
 * Serialize a baked VAT to raw texel buffers + a versioned manifest. This is
 * the on-disk format; the runtime object is always reconstructed with
 * {@link loadVAT}.
 */
/** @deprecated Removed in 1.0 — see ADR-0010. Bake at runtime instead. */
export function serializeVAT(vat: VAT, { precision = 'float16' }: SerializeOptions = {}): SerializedVAT {
  const pos = vat.positionTexture.image.data as Float32Array
  const nrm = vat.normalTexture.image.data as Float32Array

  const manifest: VATManifest = {
    version: 1,
    vertexCount: vat.vertexCount,
    totalFrames: vat.totalFrames,
    encoding: vat.encoding,
    precision,
    clips: vat.clips,
    bounds: {
      min: [vat.bounds.min.x, vat.bounds.min.y, vat.bounds.min.z],
      max: [vat.bounds.max.x, vat.bounds.max.y, vat.bounds.max.z],
    },
  }

  return { manifest, position: encode(pos, precision), normal: encode(nrm, precision) }
}

function encode(src: Float32Array, precision: VATPrecision): ArrayBuffer {
  if (precision === 'float32') {
    // Copy into a standalone buffer — src may be a view into a larger buffer.
    return src.slice().buffer as ArrayBuffer
  }
  const half = new Uint16Array(src.length)
  for (let i = 0; i < src.length; i++) half[i] = DataUtils.toHalfFloat(src[i]!)
  return half.buffer
}

/**
 * Reconstruct a runtime VAT from serialized buffers. `float16` uploads as
 * `HalfFloatType`; `float32` as `FloatType`. The result is interchangeable with
 * a {@link bakeVAT} result.
 */
/** @deprecated Removed in 1.0 — see ADR-0010. Bake at runtime instead. */
export function loadVAT(serialized: SerializedVAT): VAT {
  const { manifest, position, normal } = serialized
  const { vertexCount, totalFrames, precision } = manifest

  const type = precision === 'float32' ? FloatType : HalfFloatType
  const posData = precision === 'float32' ? new Float32Array(position) : new Uint16Array(position)
  const nrmData = precision === 'float32' ? new Float32Array(normal) : new Uint16Array(normal)

  const bounds = new Box3(
    new Vector3().fromArray(manifest.bounds.min),
    new Vector3().fromArray(manifest.bounds.max),
  )

  return {
    positionTexture: makeVATTexture(posData, vertexCount, totalFrames, type),
    normalTexture: makeVATTexture(nrmData, vertexCount, totalFrames, type),
    clips: manifest.clips,
    bounds,
    vertexCount,
    totalFrames,
    encoding: manifest.encoding,
  }
}
