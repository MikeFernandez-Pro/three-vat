// The baked file's private agreement between its writer (src/write-vat.ts) and
// its loader (src/load-vat.ts), ADR-0034: the extension's name, the format
// version, the fields the extension carries, and the digest both sides compute
// over the rest geometry. Its own module so the loader, which pages import,
// shares it with the writer without reaching into the exporter.
import type { BufferAttribute, InterleavedBufferAttribute } from 'three'
import type { VATClip } from './types.js'

/** The glTF extension a baked file declares in `extensionsUsed`, and never in `extensionsRequired`. */
export const BAKED_FILE_EXTENSION = 'THREEVAT_vat'

/**
 * The format's own version, not the package's. `loadVAT` reads this one and
 * refuses every other. A release that changes what a layer's array holds, or
 * what a field below means, bumps it; readers for older versions are
 * deliberately not written (ADR-0034).
 */
export const BAKED_FILE_VERSION = 1

/**
 * How each layer's texels are stored, spelled once for both sides: the glTF
 * component type the writer writes them as, and the bytes a texel takes, which
 * the loader reads back. The builder that rebuilds a layer follows from its
 * format. The vertex encoding's two for now; the rig texture joins with the
 * rig-encoded file (#114).
 */
export const BAKED_LAYER_FORMATS = {
  /** The position layer: four half-floats a texel, written as the unsigned shorts that hold their bits. */
  RGBA16F: { componentType: 5123, bytesPerTexel: 8 },
  /** The normal layer: an octahedral pair of unsigned bytes a texel. */
  RG8: { componentType: 5121, bytesPerTexel: 2 },
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
 * re-deriving anything.
 */
export interface BakedFileExtension {
  version: number
  encoding: 'delta'
  fallback: string | null
  /** The glTF mesh holding the merged geometry, one primitive per group. */
  mesh: number
  /** The merged geometry's groups, in primitive order. */
  groups: { start: number; count: number; materialIndex: number }[]
  vertexCount: number
  totalFrames: number
  rowsPerFrame: number
  clips: VATClip[]
  bounds: { min: number[]; max: number[] }
  /** {@link positionDigest} of the rest `position` attribute, as written. */
  digest: string
  layers: { position: BakedLayer; normal?: BakedLayer }
}

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
