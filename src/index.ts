// Core surface: the renderer-agnostic baker and the instance-playback contract.
// A VAT is produced exactly one way — bake it at runtime from a loaded glTF
// (ADR-0010). Decode adapters live in the `three-vat/webgl` and `three-vat/tsl`
// subpaths so a WebGL-only consumer never pulls in the node-material system.

export { bakeVAT } from './bake.js'
export { makeVATTexture, MAX_TEXTURE_SIZE } from './vat-texture.js'
// `BakeInput` because `bakeVAT` takes a clip *or* a configured `AnimationAction`
// — the action being how per-clip playback defaults are declared once, at the
// bake, rather than repeated at every instance.
export type { BakeInput, BakeOptions } from './bake.js'

// The instance-playback contract both decode paths read (ADR-0009): written for
// the whole crowd at creation into the playback texture that carries it
// (ADR-0016), and one instance at a time after that.
export { createVATPlaybackTexture, setVATInstance } from './instance-playback.js'
// `VATPlaybackTextureOptions` carries the capacity: rows reserved for a crowd
// that spawns and dies, rather than a census of the one you have now
// (ADR-0022).
// `VATPlaybackState` is one clip playing — what an instance is, and what its
// `from` carries while it crossfades out of one (ADR-0025).
export type {
  VATInstance,
  VATPlaybackState,
  VATPlaybackTexture,
  VATPlaybackTextureOptions,
} from './instance-playback.js'

// Scheduling what happens next: `endsAt` is the moment a finite animation
// finishes, which is all chaining one clip to another needs — one CPU write, at
// a time known when the first was written, and never a per-frame poll.
export { endsAt } from './instance-playback.js'

// The playback policy an instance's pack carries, and the one definition of
// what that policy means: `resolveVATFrame` is what each decode path
// transcribes, and the only form of the arithmetic CI can evaluate without a
// GPU. It is public because a caller scheduling what happens after a one-shot
// has to ask the shader's own question.
export { EndMode, INFINITE_REPETITIONS, LoopMode, resolveVATFrame } from './instance-playback.js'
// `VATOutgoingFrame` is a frame with a weight: the band an instance is
// crossfading out of, resolved through the same function at the same moment.
export type { VATFrame, VATOutgoingFrame } from './instance-playback.js'

// `VATCrowd` — what `createVATMesh` returns — is core rather than renderer-local
// so both decode paths return the one type (ADR-0009's reasoning, applied to
// the render surface).
export type { DeltaVAT, RigVAT, VAT, VATBase, VATClip, VATClipDefaults, VATClock, VATCrowd } from './types.js'

// The **carrier**: the mesh a crowd rides. `createVATMesh` builds an
// `InstancedMesh` on either path; a `BatchedMesh` is reached through the
// primitives and buys per-instance frustum culling and depth sorting from
// three.js itself (ADR-0016). Core, like `VATCrowd`, because both decode paths
// classify a carrier by the same rule and refuse the same batches.
export type { VATCarrier } from './carrier.js'
