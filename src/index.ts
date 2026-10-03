// Core surface: the renderer-agnostic baker and the instance-playback contract.
// A VAT is baked at runtime from a loaded asset (ADR-0010), or loaded from a
// baked file the bake command wrote (ADR-0034). Decode adapters live in the
// `three-vat/webgl` and `three-vat/tsl` subpaths so a WebGL-only consumer never
// pulls in the node-material system.

export { bakeVAT } from './bake.js'
// The baked file, read back as the VAT `bakeVAT` returned (ADR-0034). Beside
// the baker, with no subpath: it reaches three's `GLTFLoader` and nothing else,
// and never the exporter the command writes the file with.
export { loadVAT } from './load-vat.js'
export type { LoadVATOptions } from './load-vat.js'
export { makeVATNormalTexture, makeVATTexture, MAX_TEXTURE_SIZE } from './vat-texture.js'
// What a normal texel means (#29): two unsigned bytes, octahedral. Public
// because anything reading a baked normal back on the CPU — the demo's texture
// panel, the parity gate's normal fault — has to ask rather than re-derive it,
// and the encoder ships beside the decoder because half a codec is not one:
// a caller writing its own normal layer needs the way in, not only the way
// out.
export { decodeOctahedral, encodeOctahedral } from './octahedral.js'
export type { Vec3Out } from './octahedral.js'
// `BakeInput` because `bakeVAT` takes a clip *or* a configured `AnimationAction`
// — the action being how per-clip playback defaults are declared once, at the
// bake, rather than repeated at every instance.
export type { BakeInput, BakeOptions } from './bake.js'
// The same bake in a Web Worker (ADR-0026): the page's half and the worker's
// half, core because neither touches a renderer. One entry point still — the
// worker calls `bakeVAT` on a copy of the subtree, it does not bake its own way.
export { bakeVATInWorker, serveVATBakes } from './worker.js'
export type { VATBakeScope, VATBakeWorker } from './worker.js'

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
// Turning an instance round at the pose it is showing (ADR-0036): one more
// write, read back from the row, returning the instance so `endsAt` can
// schedule what follows the retrace.
export { turnVATInstance } from './instance-playback.js'
// Stopping an instance's own clock and starting it again from exactly there
// (ADR-0041): one value in the pack, read back from the row like the turn.
export { pauseVATInstance, resumeVATInstance } from './instance-playback.js'

// The playback policy an instance's pack carries, and the one definition of
// what that policy means: `resolveVATFrame` is what each decode path
// transcribes, and the only form of the arithmetic CI can evaluate without a
// GPU. It is public because a caller scheduling what happens after a one-shot
// has to ask the shader's own question.
export { EndMode, INFINITE_REPETITIONS, LoopMode, resolveVATFrame } from './instance-playback.js'
// `VATOutgoingFrame` is a frame with a weight: the band an instance is
// crossfading out of, resolved through the same function at the same moment.
export type { VATFrame, VATOutgoingFrame } from './instance-playback.js'
// An instance's box at a moment, from the VAT's frame bounds (#152): the union
// of the frames `resolveVATFrame` says it is showing, for hit tests and game
// logic. The carrier still culls by `vat.bounds`.
export { resolveVATBounds } from './instance-bounds.js'

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
// The **atlas** (ADR-0040): several bakes side by side in one VAT, so one batch
// draws several characters. Core, beside the bake, because it copies texels
// the `VAT` contract keeps opaque; `characters` on the VAT is the record the
// carrier rule reads.
export { composeVATAtlas } from './atlas.js'
export type { ComposeVATAtlasOptions, VATAtlas, VATAtlasCharacter } from './atlas.js'
export type { VATCharacterRange } from './types.js'
// **Levels of detail** (ADR-0043): the VAT at a lower detail from the same
// textures, every vertex kept and fewer drawn, the caller's simplifier making
// the index. Core, beside the atlas, because both decode paths read the
// record it leaves on the VAT, and the carrier rule accepts a batch by it.
export { createVATLODs } from './lod.js'
export type { VATLODLevel, VATLODs } from './lod.js'
