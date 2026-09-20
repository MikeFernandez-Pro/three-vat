// Core surface: the renderer-agnostic baker and the instance-playback contract.
// A VAT is produced exactly one way — bake it at runtime from a loaded glTF
// (ADR-0010). Decode adapters live in the `three-vat/webgl` and `three-vat/tsl`
// subpaths so a WebGL-only consumer never pulls in the node-material system.

export { bakeVAT, makeVATTexture, MAX_TEXTURE_SIZE } from './bake.js'
export type { BakeOptions } from './bake.js'

// The instance-playback contract both decode paths read (ADR-0009).
export { addVATInstanceAttributes } from './instance-playback.js'
export type { VATInstance } from './instance-playback.js'

// The playback policy an instance's pack carries. Written into every instance
// today and read by no decode path yet — they are exported here so the bake
// side can name them while the decode side grows into them.
export { EndMode, LoopMode } from './instance-playback.js'

// `VATCrowd` — what `createVATMesh` returns — is core rather than renderer-local
// so both decode paths return the one type (ADR-0009's reasoning, applied to
// the render surface).
export type { VAT, VATClip, VATClock, VATCrowd } from './types.js'
