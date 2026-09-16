# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **`createVATMesh(vat, instances)` on the WebGL path.** One call returns a renderable `InstancedMesh` plus the clock that drives it — the baked geometry cloned, the instance-playback attributes written, one patched material per material group, and both shadow-pass materials attached (`customDepthMaterial` for directional and spot lights, `customDistanceMaterial` for point lights) — replacing the block of geometry cloning, attribute wiring, per-material patching and depth-material attachment every user copied out of the README. The shadow materials are the step that wiring by hand most often drops, and the symptom — a crowd whose body animates while its shadow stays in the bind pose — reads as a bug in the bake rather than in the wiring. Instance matrices and `castShadow`/`receiveShadow` stay the caller's, because they are scene decisions. The primitives it composes (`addVATInstanceAttributes`, `patchVATMaterial`, `createVATDepthMaterial`, `createVATUniforms`) are all still exported and unchanged, for rendering onto something other than a plain `InstancedMesh`. The returned `VATCrowd` type lives in core, so the TSL path can return the same one.
- **`addVATInstanceAttributes` is exported from `three-vat`.** Instance playback — the per-instance `{ clip, timeOffset, speed }` triple — is one contract owned by the core entry point, instead of a WebGL-only concept the TSL path cannot see. Moving it is what makes the two decode paths able to render the same crowd; the TSL decode reads it too, as of the entry below ([ADR-0009](./docs/adr/0009-both-decode-paths-read-one-instance-playback-contract.md)). The attribute names and layout are documented on the function as the shared contract. Nothing renderer-specific moved with it: the core entry point still imports only `three`, so a WebGL-only consumer's bundle is unchanged.
- **The TSL decode reads instance playback.** `vatNodes(vat, { geometry })` reads the per-instance clip, phase and rate from the same contract attributes the GLSL decode reads, so a single TSL-rendered crowd mixes clips, phases and playback rates — previously a WebGL-only capability the README had to send mixed-clip users away for ([ADR-0009](./docs/adr/0009-both-decode-paths-read-one-instance-playback-contract.md)). Omit `geometry` and the previous behaviour is unchanged: every instance plays `clipIndex`, desynced by a phase hashed from `instanceIndex`. A geometry carrying only part of the contract now throws instead of rendering a crowd frozen in frame 0.
- **The TSL path has automated tests.** Structural node-graph tests run in CI with no GPU: the graph builds, it carries the expected uniform, attribute and texture nodes, it falls back to the hashed desync only when it should, and an out-of-range `clipIndex` throws. These catch a `three` release renaming a TSL primitive, which until now would have shipped silently broken.

### Deprecated

- **`addInstancedVATAttributes` from `three-vat/webgl`**, along with the `VATInstance` type exported there. Both are re-exported under their old names and are removed in the next minor version — import `addVATInstanceAttributes` and `VATInstance` from `three-vat` instead.

## [0.3.0] - 2026-09-16

### Changed

- **BREAKING — the unit of a bake is a posed subtree, not a mesh.** `bakeVAT(root, mesh, clips, options)` is now `bakeVAT(root, clips, options)`: the baker walks every `Mesh` under `root`, merges them into one vertex set and records where each vertex ended up in root space ([ADR-0008](./docs/adr/0008-a-vat-bakes-a-posed-subtree-not-a-skinnedmesh.md)). One call now handles a single `SkinnedMesh`, a morph-target mesh, a hierarchy of rigid node-animated parts (three.js `RobotExpressive`), or any mix — with no classification by the caller. Previously a rigid node-animated character baked to all-zero deltas and tripped the library's own "frozen pose" diagnostic.
- **BREAKING — `bakeVAT` returns `BakedVAT`**, a `VAT` plus the merged `geometry` and the ordered `materials`. The merged vertex ordering is the baker's own and the textures are indexed by it, so callers must render `vat.geometry` rather than cloning their source mesh. `materials` lines up with `geometry.groups[].materialIndex`, giving one draw call per material — VAT collapses instance count, not material count.
- `vat.geometry` carries the union-of-all-frames bounding box and sphere, so instances no longer cull mid-animation.
- Example replaced: a `RobotExpressive` crowd, the asset that motivated the posed-subtree bake.

### Added

- **Morph-target baking is applied per part**, alongside skinning, so a subtree mixing skinned, morphed and rigid meshes bakes correctly in one pass.
- `maxTextureSize` bake option, plus `getMaxTextureSize(renderer)` exported from both `three-vat/webgl` and `three-vat/tsl`. Both VAT axes — `vertexCount` (width) and `totalFrames` (height) — are now checked against it. The baker is renderer-agnostic and cannot query the GPU itself, and its conservative `16384` default is a desktop figure: mobile GPUs commonly report 4096 or 8192, so a bake that allocates on desktop could fail on a phone.
- Meshes with interleaved attributes, or with a material array, are now rejected with a named error rather than baking silently wrong data.

### Fixed

- Absolute morph targets (`morphTargetsRelative === false`) measured each target against the partially-morphed vertex instead of the base vertex, skewing the result whenever more than one target was active. glTF targets are always relative, so this never affected a glTF asset.

### Deprecated

- **The offline format.** `serializeVAT`, `loadVAT` and their types still ship but are removed in 1.0 ([ADR-0010](./docs/adr/0010-drop-the-offline-format-runtime-bake-is-the-library.md)). The format stores texels and a manifest but not the geometry, and since this release the textures are indexed by the merged ordering — so a loaded VAT cannot be rendered without re-running the merge, which is the work the file existed to save. The README's claim that a loaded VAT was "interchangeable with a freshly-baked one" is corrected. Bake at runtime; run `bakeVAT` in a Web Worker if load-time bake cost hurts.

[0.3.0]: https://github.com/MikeFernandez-Pro/three-vat/releases/tag/v0.3.0

## [0.2.0] - 2026-09-14 — never published

> This version was tagged in the changelog and in `package.json` but **never
> reached npm**; the registry went straight from `0.1.0` to `0.3.0`. Everything
> below shipped in `0.3.0`. Recorded rather than deleted so the version history
> stays honest.

### Added

- **Morph-target baking** — `bakeVAT` now bakes morph-target meshes as well as skinned ones, applying morph then skinning per vertex to match three's own pipeline. This makes the "morph/non-skeletal deformation for free" promise real and unlocks assets like the three.js Flamingo/Parrot/Stork. The `mesh` parameter widened from `SkinnedMesh` to `Mesh` (non-breaking — a `SkinnedMesh` is a `Mesh`).
- `bakeVAT` derives vertex normals from the base geometry when the source ships without a `normal` attribute (some morph assets are position + color only).

### Changed

- `addInstancedVATAttributes` strips the geometry's morph targets, which the VAT supersedes. Besides dropping now-dead buffers, this avoids a crash in three's morph path when the geometry is drawn as an `InstancedMesh` (which has no `morphTargetInfluences`).
- Example replaced: a flat toon-shaded, three-species **bird tornado** with live GUI controls (funnel shape/speed, per-species scale/count, motion toggles) and a CPU/GPU/draw-call perf panel, superseding the soldier crowd-vs-benchmark demo.


## [0.1.0] - 2026-09-14

Initial release.

### Added

- **`bakeVAT`** — renderer-agnostic CPU baker: a glTF's `AnimationClip`s → position/normal VAT textures (delta positions, absolute normals, stacked clip table, union-of-frames bounds).
- **`three-vat/webgl`** — `patchVATMaterial`, `addInstancedVATAttributes`, `createVATUniforms`, `createVATDepthMaterial` for the `onBeforeCompile` GLSL decode, including correct instanced shadows via a patched depth material.
- **`three-vat/tsl`** — `vatNodes` for the WebGPU/TSL decode path (single clip + per-instance desync in v1).
- **Offline format** — `serializeVAT` / `loadVAT` with a versioned JSON manifest; `float16` (default) and `float32` precision.
- Example crowd demo comparing a VAT crowd against a cloned-`SkinnedMesh` baseline.

### Known limitations

- The TSL path is verified visually, not by automated tests.
- No clip crossfade; the TSL path plays a single clip per material.

[0.1.0]: https://github.com/MikeFernandez-Pro/three-vat/releases/tag/v0.1.0
