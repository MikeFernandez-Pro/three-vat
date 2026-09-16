// Core surface: the renderer-agnostic baker and the instance-playback contract,
// plus the deprecated offline format (removed in 1.0 — see ADR-0010).
// Decode adapters live in the `three-vat/webgl` and `three-vat/tsl` subpaths so
// a WebGL-only consumer never pulls in the node-material system.

export { bakeVAT, makeVATTexture, MAX_TEXTURE_SIZE } from './bake.js'
export type { BakeOptions } from './bake.js'

// The instance-playback contract both decode paths read (ADR-0009).
export { addVATInstanceAttributes } from './instance-playback.js'
export type { VATInstance } from './instance-playback.js'

/** @deprecated Removed in 1.0 — see ADR-0010. Bake at runtime instead. */
export { serializeVAT, loadVAT } from './offline.js'
export type { SerializedVAT, SerializeOptions, VATManifest, VATPrecision } from './offline.js'

// `VATCrowd` — what `createVATMesh` returns — is core rather than renderer-local
// so both decode paths return the one type (ADR-0009's reasoning, applied to
// the render surface).
export type { BakedVAT, VAT, VATClip, VATClock, VATCrowd } from './types.js'
