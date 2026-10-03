// The baked file's private agreement between its writer (src/write-vat.ts) and
// its loader (src/load-vat.ts), ADR-0034: the extension's name, the format
// version, the fields the extension carries, how each texture layer is stored
// and rebuilt, and the digest both sides compute over the rest geometry. Its own module so the loader, which pages import,
// shares it with the writer without reaching into the exporter.
import { FloatType, HalfFloatType } from 'three'
import type { BufferAttribute, DataTexture, InterleavedBufferAttribute } from 'three'
import type { VAT, VATClip } from './types.js'
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
 * of, and (#154) stores a vertex-encoded file's position layer transformed
 * for compression, as {@link toFramePlanes} spells it (ADR-0042).
 */
export const BAKED_FILE_VERSION = 3

/**
 * How each layer's texels are stored, spelled once for both sides: the glTF
 * component type the writer writes them as, the bytes a texel takes, which the
 * loader reads back, what the writer stores in place of the texture's own
 * array, and the builder the bake made that layer's texture with, which the
 * loader hands the stored bytes to, undone. Only the position layer is stored
 * other than as it is (ADR-0042): a frame's delta is mostly its last frame's,
 * and neither the normal layer's octahedral bytes nor the rig's floats gain.
 */
export const BAKED_LAYER_FORMATS = {
  /** The position layer: four half-floats a texel, stored as {@link toFramePlanes}' bytes. */
  RGBA16F: {
    componentType: 5121,
    bytesPerTexel: 8,
    store: (texels: Uint16Array, frames: number): Uint8Array => toFramePlanes(texels, frames),
    build: (stored: ArrayBuffer, width: number, height: number, frames: number): DataTexture =>
      makeVATTexture(fromFramePlanes(new Uint8Array(stored), frames), width, height, HalfFloatType),
  },
  /** The normal layer: an octahedral pair of unsigned bytes a texel. */
  RG8: {
    componentType: 5121,
    bytesPerTexel: 2,
    store: (texels: Uint8Array): Uint8Array => texels,
    build: (stored: ArrayBuffer, width: number, height: number): DataTexture =>
      makeVATNormalTexture(new Uint8Array(stored), width, height),
  },
  /** The rig texture: four floats a texel, two texels a slot. */
  RGBA32F: {
    componentType: 5126,
    bytesPerTexel: 16,
    store: (texels: Float32Array): Float32Array => texels,
    build: (stored: ArrayBuffer, width: number, height: number): DataTexture =>
      makeVATTexture(new Float32Array(stored), width, height, FloatType),
  },
} as const

/**
 * The position layer as a baked file stores it (ADR-0042): the same bytes,
 * reordered and differenced so a general-purpose compressor finds what the
 * texels share. Each half-float's bits become the uint16 difference from the
 * same vertex's previous frame, wrapping, with frame 0 kept as it is; they are
 * laid out vertex-major, every frame of a texel together; and split into four
 * channel planes, each split into its low bytes, then its high bytes. A
 * vertex barely moves from one frame to the next, so the differences are
 * small, and their high bytes almost all zero or all ones.
 *
 * `frames` is the layer's frame count, its texels `frames` runs of a frame's
 * stride each (src/vat-texture.ts), the padding at a spanned frame's end
 * among them.
 */
function toFramePlanes(texels: Uint16Array, frames: number): Uint8Array {
  const stride = texels.length / frames / 4
  const planes = new Uint8Array(texels.length * 2)
  const plane = stride * frames
  for (let c = 0; c < 4; c++) {
    const low = 2 * c * plane
    const high = low + plane
    for (let s = 0; s < stride; s++) {
      let previous = 0
      for (let f = 0; f < frames; f++) {
        const bits = texels[(f * stride + s) * 4 + c]!
        const delta = (bits - previous) & 0xffff
        previous = bits
        const at = s * frames + f
        planes[low + at] = delta & 0xff
        planes[high + at] = delta >>> 8
      }
    }
  }
  return planes
}

/** {@link toFramePlanes} undone: the position layer's texels, as the bake wrote them. */
function fromFramePlanes(planes: Uint8Array, frames: number): Uint16Array {
  const texels = new Uint16Array(planes.length / 2)
  const stride = texels.length / frames / 4
  const plane = stride * frames
  for (let c = 0; c < 4; c++) {
    const low = 2 * c * plane
    const high = low + plane
    for (let s = 0; s < stride; s++) {
      let bits = 0
      for (let f = 0; f < frames; f++) {
        const at = s * frames + f
        bits = (bits + (planes[low + at]! | (planes[high + at]! << 8))) & 0xffff
        texels[(f * stride + s) * 4 + c] = bits
      }
    }
  }
  return texels
}

export type BakedLayerFormat = keyof typeof BAKED_LAYER_FORMATS

/**
 * Every texture layer a VAT holds, by the name the file keys it under, with
 * the format the file stores it in: the one table the writer stores by and
 * the CLI's report reads.
 */
export function layersOf(vat: VAT): { name: 'position' | 'normal' | 'rig'; texture: DataTexture; format: BakedLayerFormat }[] {
  if (vat.encoding === 'rig') return [{ name: 'rig', texture: vat.rigTexture, format: 'RGBA32F' }]
  const position = { name: 'position', texture: vat.positionTexture, format: 'RGBA16F' } as const
  return vat.normalTexture ? [position, { name: 'normal', texture: vat.normalTexture, format: 'RG8' }] : [position]
}

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
