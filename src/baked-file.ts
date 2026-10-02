// The baked file's private agreement between its writer (src/write-vat.ts) and
// its loader (src/load-vat.ts), ADR-0034: the extension's name, the format
// version, the fields the extension carries, how each texture layer is stored
// and rebuilt, and the digest both sides compute over the rest geometry. Its own module so the loader, which pages import,
// shares it with the writer without reaching into the exporter.
import { FloatType, HalfFloatType } from 'three'
import type { BufferAttribute, DataTexture, InterleavedBufferAttribute } from 'three'
import type { VATClip } from './types.js'
import { makeVATNormalTexture, makeVATTexture } from './vat-texture.js'

/** The glTF extension a baked file declares in `extensionsUsed`, and never in `extensionsRequired`. */
export const BAKED_FILE_EXTENSION = 'THREEVAT_vat'

/**
 * The format's own version, not the package's. `loadVAT` reads this one and
 * refuses every other. A release that changes what a layer's array holds, or
 * what a field below means, bumps it; readers for older versions are
 * deliberately not written (ADR-0034).
 *
 * Version 2 (#128) put the hierarchy row under a rig texture's bands
 * (ADR-0039): a version 1 rig file has none, and a crossfade would read its
 * last frame for one.
 *
 * Version 3 (#152) carries the frame bounds, which a version 2 file has none
 * of.
 */
export const BAKED_FILE_VERSION = 3

/**
 * How each layer's texels are stored, spelled once for both sides: the glTF
 * component type the writer writes them as, the bytes a texel takes, which the
 * loader reads back, and the builder the bake made that layer's texture with,
 * which the loader hands them to.
 */
export const BAKED_LAYER_FORMATS = {
  /** The position layer: four half-floats a texel, written as the unsigned shorts that hold their bits. */
  RGBA16F: {
    componentType: 5123,
    bytesPerTexel: 8,
    build: (texels: ArrayBuffer, width: number, height: number): DataTexture =>
      makeVATTexture(new Uint16Array(texels), width, height, HalfFloatType),
  },
  /** The normal layer: an octahedral pair of unsigned bytes a texel. */
  RG8: {
    componentType: 5121,
    bytesPerTexel: 2,
    build: (texels: ArrayBuffer, width: number, height: number): DataTexture =>
      makeVATNormalTexture(new Uint8Array(texels), width, height),
  },
  /** The rig texture: four floats a texel, two texels a slot. */
  RGBA32F: {
    componentType: 5126,
    bytesPerTexel: 16,
    build: (texels: ArrayBuffer, width: number, height: number): DataTexture =>
      makeVATTexture(new Float32Array(texels), width, height, FloatType),
  },
} as const

export type BakedLayerFormat = keyof typeof BAKED_LAYER_FORMATS

/** One texture layer: a buffer view of its own in the file's binary chunk, and its shape. */
export interface BakedLayer {
  bufferView: number
  width: number
  height: number
  format: BakedLayerFormat
}

/**
 * What the extension carries: everything a VAT holds besides the geometry and
 * materials the glTF itself describes, so `loadVAT` builds the VAT without
 * re-deriving anything. The fields every encoding shares, then its own.
 */
interface BakedFileCommon {
  version: number
  /** The glTF mesh holding the merged geometry, one primitive per group. */
  mesh: number
  /** The merged geometry's groups, in primitive order. */
  groups: { start: number; count: number; materialIndex: number }[]
  vertexCount: number
  totalFrames: number
  clips: VATClip[]
  bounds: { min: number[]; max: number[] }
  /**
   * The buffer view holding `vat.frameBounds`: six floats a frame, written as
   * the floats they are, so they come back bit for bit.
   */
  frameBounds: number
  /** {@link positionDigest} of the rest `position` attribute, as written. */
  digest: string
}

/** A vertex-encoded file's own fields. */
export interface BakedDeltaExtension extends BakedFileCommon {
  encoding: 'delta'
  fallback: string | null
  rowsPerFrame: number
  layers: { position: BakedLayer; normal?: BakedLayer }
}

/**
 * A rig-encoded file's own fields. Its geometry keeps `skinIndex` and
 * `skinWeight` as `JOINTS_0` and `WEIGHTS_0`, under a skin that is only the
 * preview's (ADR-0034): the loader reads the slots from here, never from it.
 */
export interface BakedRigExtension extends BakedFileCommon {
  encoding: 'rig'
  slotCount: number
  layers: { rig: BakedLayer }
}

export type BakedFileExtension = BakedDeltaExtension | BakedRigExtension

/**
 * A digest of a rest `position` attribute: FNV-1a over its values as float32
 * bytes, in vertex order. Not a defence against anyone, only a check that the
 * vertices a file's texels are addressed by are still the ones it holds — an
 * optimizer that reorders, welds or simplifies them changes it (ADR-0034).
 */
export function positionDigest(position: BufferAttribute | InterleavedBufferAttribute): string {
  const values = new Float32Array(position.count * position.itemSize)
  for (let v = 0; v < position.count; v++) {
    for (let c = 0; c < position.itemSize; c++) values[v * position.itemSize + c] = position.getComponent(v, c)
  }
  const bytes = new Uint8Array(values.buffer)
  let hash = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i]!, 0x01000193)
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`
}
