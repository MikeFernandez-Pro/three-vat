# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-09-17

The 1.0 release: **three library surfaces that all work** — the core baker
(`three-vat`), the WebGL/GLSL decode (`three-vat/webgl`) and the WebGPU/TSL
decode (`three-vat/tsl`) — with documentation that is true on both renderers.
The fourth surface, the offline format, is removed. What changed since `0.3.0`
is below; the two breaking entries are the type collapse and that removal.

**Deferred, and named so 1.0 is not read as promising them:** animation
crossfade (an instance cuts between clips, it does not blend), LOD, the
`npx vat-bake` CLI and any file format for it to write, a React/drei hook or
component, and a `bakeVATInWorker` helper — 1.0 ships the Web Worker recipe in
the README instead. The reasoning for each is in
[README § What 1.0 does not do](./README.md#what-10-does-not-do).

### Added

- **`pnpm parity` — the cross-path pixel-diff release gate.** One bake, rendered through the GLSL decode on `WebGLRenderer` and the TSL decode on `WebGPURenderer` at the same camera, lights and animation time, compared pixel by pixel in a real browser on a real GPU. Everything else in this suite verifies structure — attributes present, node graph builds, materials counted, bundles isolated — and none of it can catch a decode subtly wrong on one path only, which is exactly the risk of shipping two of them ([ADR-0004](./docs/adr/0004-ship-both-glsl-and-tsl-decode-paths.md)). It stays out of pull-request CI on purpose: headless WebGPU is not a dependable target and a flaky gate gets disabled, so it is a required manual step before publishing instead ([docs/releasing.md](./docs/releasing.md)). Every run proves its own tolerance still has teeth by deliberately slipping each path one baked frame and requiring the gate to fail on it, and it separates "the backends shade differently" from "the decodes disagree" by first comparing a rest-pose frame with no VAT in it. The half that decides pass or fail is pure and runs in CI with the rest of the examples suite — which is what lets a gate CI cannot run still be trusted when a human runs it.
- **The demos are live**, at [mikefernandez-pro.github.io/three-vat](https://mikefernandez-pro.github.io/three-vat/) — a WebGL crowd and a WebGPU one, deployed from `main` on every push, and linked above the fold in the README. For a library whose pitch is "one draw call, thousands of characters", a running crowd is worth more than any paragraph. The WebGPU page is also the first real consumer of `createVATMesh` on the TSL path: hold it next to the WebGL page and the VAT section reads the same on both, with nothing shared forcing the resemblance ([ADR-0011](./docs/adr/0011-one-example-per-renderer-duplicated-on-purpose.md)). It asks the browser for a WebGPU adapter before loading anything else and points at the WebGL demo when there is none — `WebGPURenderer` falls back to a WebGL backend on its own, which would have drawn the WebGPU demo through GLSL and said nothing.
- **`createVATMesh(vat, instances)` on the WebGL path.** One call returns a renderable `InstancedMesh` plus the clock that drives it — the baked geometry cloned, the instance-playback attributes written, one patched material per material group, and both shadow-pass materials attached (`customDepthMaterial` for directional and spot lights, `customDistanceMaterial` for point lights) — replacing the block of geometry cloning, attribute wiring, per-material patching and depth-material attachment every user copied out of the README. The shadow materials are the step that wiring by hand most often drops, and the symptom — a crowd whose body animates while its shadow stays in the bind pose — reads as a bug in the bake rather than in the wiring. Instance matrices and `castShadow`/`receiveShadow` stay the caller's, because they are scene decisions. The primitives it composes (`addVATInstanceAttributes`, `patchVATMaterial`, `createVATDepthMaterial`, `createVATUniforms`) are all still exported and unchanged, for rendering onto something other than a plain `InstancedMesh`. The returned `VATCrowd` type lives in core, so the TSL path can return the same one.
- **`createVATMesh` on the TSL path too, with the same signature and the same return.** `three-vat/tsl` exports the call `three-vat/webgl` does, so moving a crowd between `WebGLRenderer` and `WebGPURenderer` is one import line and no other edit — the point at which decode-path parity is something a user can feel rather than something this file claims. The asymmetry is absorbed rather than passed on: the TSL path attaches no depth material, because `positionNode` already feeds the depth pass, and nobody has to know which renderer needs which. Materials are cloned from the bake and carry the whole decode as `positionNode` — the normal with it — so a glTF's own `MeshStandardMaterial` keeps its maps and settings — three converts it to its node twin at build time and takes the nodes with it. Structural parity is now a test (`src/decode-paths.test.ts`): both paths write the same instance attributes from the same array, cull against the same bounds, and hand back a clock driven the same way. Pixel parity is the manual release gate, `pnpm parity`, which ships in this release too (above). The same file pins ADR-0005's bundle isolation by parsing each entry point's import graph — `three-vat/webgl` and `three-vat` reach nothing but `three`, and the walker is itself tested against every import shape that reaches a bundle, the side-effect `import 'three/webgpu'` included.
- **`addVATInstanceAttributes` is exported from `three-vat`.** Instance playback — the per-instance `{ clip, timeOffset, speed }` triple — is one contract owned by the core entry point, instead of a WebGL-only concept the TSL path cannot see. Moving it is what makes the two decode paths able to render the same crowd; the TSL decode reads it too, as of the entry below ([ADR-0009](./docs/adr/0009-both-decode-paths-read-one-instance-playback-contract.md)). The attribute names and layout are documented on the function as the shared contract. Nothing renderer-specific moved with it: the core entry point still imports only `three`, so a WebGL-only consumer's bundle is unchanged.
- **The TSL decode reads instance playback.** `vatNodes(vat, { geometry })` reads the per-instance clip, phase and rate from the same contract attributes the GLSL decode reads, so a single TSL-rendered crowd mixes clips, phases and playback rates — previously a WebGL-only capability the README had to send mixed-clip users away for ([ADR-0009](./docs/adr/0009-both-decode-paths-read-one-instance-playback-contract.md)). Omit `geometry` and the previous behaviour is unchanged: every instance plays `clipIndex`, desynced by a phase hashed from `instanceIndex`. A geometry carrying only part of the contract now throws instead of rendering a crowd frozen in frame 0.
- **The TSL path has automated tests.** Structural node-graph tests run in CI with no GPU: the graph builds, it carries the expected uniform, attribute and texture nodes, it falls back to the hashed desync only when it should, and an out-of-range `clipIndex` throws. These catch a `three` release renaming a TSL primitive, which until now would have shipped silently broken.

### Changed

- **BREAKING against `0.3.0` — `BakedVAT` and `VAT` are one type, `VAT`.** The split existed only so `loadVAT` could return a VAT without geometry; with the loader gone, every VAT carries the `geometry` and `materials` it is indexed by. `bakeVAT` returns the same object it did — this renames a type, it does not change a shape, so `import type { BakedVAT }` becomes `import type { VAT }` and nothing else moves. ADR-0007's four library surfaces are now three: core baker, WebGL decode, TSL decode.

### Deprecated

- **`addInstancedVATAttributes` from `three-vat/webgl`**, along with the `VATInstance` type exported there. Both are re-exported under their old names and are removed in the next minor version — import `addVATInstanceAttributes` and `VATInstance` from `three-vat` instead.

### Removed

- **BREAKING against `0.3.0` — the offline format is gone.** `serializeVAT`, `loadVAT`, `SerializedVAT`, `SerializeOptions`, `VATManifest` and `VATPrecision` are removed from the public API, along with `src/offline.ts` and its tests ([ADR-0010](./docs/adr/0010-drop-the-offline-format-runtime-bake-is-the-library.md)). They were deprecated one release, never worked for a merged bake, and could not be made to without shipping the geometry too: since `0.3.0` a bake merges the whole subtree and the textures are indexed by *that* vertex ordering, so a file holding texels and a manifest can only be rendered by reloading the source glTF and re-running the merge — the work the file existed to save. Cutting it leaves one way to produce a VAT, and one versioned representation of one to maintain. What it bought — bake time at load — is answered by documentation instead: the baker is pure CPU and touches no renderer, so it runs in a Web Worker with the texel buffers transferred back, and the README now carries that recipe plus the measured bake costs (rows, fps and skinned-vs-rigid) to budget against. `bakeVATInWorker` stays deferred; demand should decide it.

### Fixed

- **The TSL decode added its displacement in the wrong space, and its normals in the wrong stage.** A WebGPU crowd had heads, arms and other parts drifting and stretching independently on every instance, while the same VAT rendered correctly through GLSL. Two causes, both about *where* a correct node is evaluated rather than which node it is. First: three applies the instance matrix to `positionLocal` **before** it reads a material's `positionNode` — `NodeMaterial.setupPosition` runs morph, skinning, displacement, batching and `instancedMesh()` and only then assigns from `positionNode`, and `Instance.js` does `positionLocal.assign( instanceMatrix.mul( positionLocal ).xyz )`. So `positionLocal.add( delta )` added a delta baked in the geometry's own space to a position already rotated, scaled and moved into the instance's, and the displacement was never rotated or scaled with the instance it belonged to. The GLSL path is correct because `begin_vertex` adds the delta and `project_vertex` applies `instanceMatrix` afterwards. Second: `normalNode` is built in the **fragment** stage (three reaches it from `normalView` through `builder.context.setupNormal()`) and is expected in **view** space, so a per-vertex object-space VAT normal handed over there skipped both the instance matrix and the normal matrix — and took `vertexIndex` into the fragment stage with it, where `IndexNode` does not return the vertex index at all but turns itself into a varying, so every fragment read a linearly *interpolated* index addressing neither of the vertices it lay between. The decode is now one vertex-stage function that displaces from `positionGeometry`, writes the normal to `normalLocal`, and hands both back to three's own `instancedMesh()` — which is exactly what the GLSL path relies on when it writes `transformed` and `objectNormal` and lets three transform and interpolate them. **`vatNodes` no longer returns a `normalNode`**, because a VAT normal cannot be one; it takes an `instancedMesh` option instead, which `createVATMesh` passes for you. Found by the new cross-path pixel-diff gate — the only check in this repository that could have found it, since every node involved was correct and only its stage and space were wrong.

- **The baker morphs normals.** `bakeVAT` read `morphAttributes.position` and nothing else, so a mesh whose *normals* morph baked the rest normal — correctly carried through the skin and part matrices, and then stored as gospel. three does not ignore them (`morphnormal_vertex` accumulates weighted normal targets under `USE_MORPHNORMALS`), so the same asset lit one way as a `SkinnedMesh` and another as a VAT — a library that ships a whole second texture for lighting filling part of it with the wrong vectors ([ADR-0002](./docs/adr/0002-runtime-texture-encoding.md)). Normal targets now accumulate exactly as position targets do, in both `morphTargetsRelative` modes, before the skin matrix and the part matrix are applied. A mesh with morph positions but no morph normals bakes byte-for-byte as it did; anything with normal targets re-lights, which is why this lands before `1.0` rather than after it.

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

[1.0.0]: https://github.com/MikeFernandez-Pro/three-vat/releases/tag/v1.0.0
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
