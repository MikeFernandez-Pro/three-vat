// Core surface: the renderer-agnostic baker + the offline format.
// Decode adapters live in the `three-vat/webgl` and `three-vat/tsl` subpaths so
// a WebGL-only consumer never pulls in the node-material system.

export { bakeVAT, makeVATTexture, MAX_TEXTURE_SIZE } from './bake.js'
export type { BakeOptions } from './bake.js'

export { serializeVAT, loadVAT } from './offline.js'
export type { SerializedVAT, SerializeOptions, VATManifest, VATPrecision } from './offline.js'

export type { VAT, VATClip } from './types.js'
