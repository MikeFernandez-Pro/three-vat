# A crowd patched by hand draws the crossfade pass on the carrier it names

> **Amends [ADR-0060](./0060-a-rig-crossfade-is-walked-once-an-instance-on-webgl-in-a-pass-of-its-own.md)**, under which only a crowd from `createVATMesh` drew the GLSL path's crossfade pass, and one wired by hand through `patchVATMaterial` walked the chain once a vertex.

A rig-encoded VAT patched with `patchVATMaterial`, or `createVATDepthMaterial`, draws ADR-0060's crossfade pass when the carrier is passed, as the fifth argument or as `carrier` in the options. The first material patched for a carrier, playback and clock makes the pass, and every later material for that carrier, playback and clock reads it. So the render, depth and distance materials of one crowd draw one pass. The carrier's `onBeforeRender` and `onBeforeShadow` draw it. Passing an `InstancedMesh`, which the index spelling never needed, now starts the pass and nothing else. A crowd patched without its carrier walks once a vertex, as before. No call changes meaning, and no crowd draws differently.

## Why

On the GLSL path the pass has to be started from the mesh, before the draws that read it. three's WebGL renderer runs no shader nodes ahead of a draw, and before a shadow draw it calls only the mesh's `onBeforeShadow`, never the material's. `patchVATMaterial` patches a material and knows the mesh only when it is told. The carrier it may be told already names that mesh for a `BatchedMesh`, so a batched crowd gets the pass without a change.

Measured on an RTX 5080, 1600x900, three r187, WebGLRenderer, best GPU frame, medians of three interleaved rounds, in the bench outside the repo. 1,024 Soldiers all mid-fade on an `InstancedMesh` patched by hand took 1.43 ms against 8.90 walked, and on a `BatchedMesh` 1.17 against 7.23. Imp took 1.66 against 11.77 and 1.18 against 8.66. Steady crowds drew level, at 1.41 against 1.41 and 1.16 against 1.19.

## How it runs

- **One pass a carrier, playback and clock,** kept on the carrier. A second playback or clock on the same carrier draws a pass of its own.
- **One wrapper a carrier for all its passes.** A wrapper per pass would leave every pass but the last behind a hook assigned to the carrier later. The carrier's own hooks run first, set before the patch or after, as ADR-0060's do.
- **Started once the carrier has passed its checks,** so a carrier the patch refuses is left as it was.
- **`createVATMesh` adopts its own pass the same way,** so a material patched by hand for its mesh later reads the crowd's pass and does not make a second.

## Consequences

- **A crowd that names its carrier holds two float targets** of two RGBA32F texels a slot of every row, freed with the carrier, as ADR-0060's do.
- **Coverage.** CI reads the GLSL. A crowd patched by hand on a `BatchedMesh` or an `InstancedMesh` draws one pass for its render, depth and distance materials, all of which read it. A `BatchedMesh` reads it at the logical index the pack is read at. A second playback on one carrier draws its own pass, alongside the first. A refused carrier starts none. The bench showed both carriers drawing the pixels of `createVATMesh`'s crowd, with zero pixels differing, on r186 and r187. That held steady, mid-fade, with a moving clock, with shadows (with and without a moving clock), and on the first frame. With the pass not drawn, a fade breaks there.
