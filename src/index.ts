// Core surface: the renderer-agnostic baker and the instance-playback contract.
// A VAT is produced exactly one way — bake it at runtime from a loaded glTF
// (ADR-0010). Decode adapters live in the `three-vat/webgl` and `three-vat/tsl`
// subpaths so a WebGL-only consumer never pulls in the node-material system.

export { bakeVAT, makeVATTexture, MAX_TEXTURE_SIZE } from './bake.js'
// `BakeInput` because `bakeVAT` takes a clip *or* a configured `AnimationAction`
// — the action being how per-clip playback defaults are declared once, at the
// bake, rather than repeated at every instance.
export type { BakeInput, BakeOptions } from './bake.js'

// The instance-playback contract both decode paths read (ADR-0009).
export { addVATInstanceAttributes } from './instance-playback.js'
export type { VATInstance } from './instance-playback.js'

// The playback policy an instance's pack carries, and the one definition of
// what that policy means: `resolveVATFrame` is what each decode path
// transcribes, and the only form of the arithmetic CI can evaluate without a
// GPU. It is public because a caller scheduling what happens after a one-shot
// has to ask the shader's own question.
export { EndMode, INFINITE_REPETITIONS, LoopMode, resolveVATFrame } from './instance-playback.js'
export type { VATFrame } from './instance-playback.js'

// `VATCrowd` — what `createVATMesh` returns — is core rather than renderer-local
// so both decode paths return the one type (ADR-0009's reasoning, applied to
// the render surface).
export type { VAT, VATClip, VATClipDefaults, VATClock, VATCrowd } from './types.js'
