// Core surface: the renderer-agnostic baker, plus the deprecated offline format
// (removed in 1.0 — see ADR-0010).
// Decode adapters live in the `three-vat/webgl` and `three-vat/tsl` subpaths so
// a WebGL-only consumer never pulls in the node-material system.

export { bakeVAT, makeVATTexture, MAX_TEXTURE_SIZE } from './bake.js'
export type { BakeOptions } from './bake.js'

/** @deprecated Removed in 1.0 — see ADR-0010. Bake at runtime instead. */
export { serializeVAT, loadVAT } from './offline.js'
export type { SerializedVAT, SerializeOptions, VATManifest, VATPrecision } from './offline.js'

export type { BakedVAT, VAT, VATClip } from './types.js'
