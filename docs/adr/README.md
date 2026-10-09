# Architecture decision records

What each decision was, so you can find the one you are looking for; the
[docs front door](../README.md) says what this folder is and which record to
read first. A decision later overturned stays in the list, because the reasoning
that turned out wrong is the part a reader needs — it carries an amendment note
on top rather than a deletion.

| # | Decision |
| --- | --- |
| [0001](./0001-bake-vat-at-runtime-from-gltf.md) | Bake VAT at runtime from the glTF |
| [0002](./0002-runtime-texture-encoding.md) | Runtime texture encoding: deltas, float, and manual in-shader interpolation |
| [0003](./0003-offline-format-float16-bin-plus-manifest.md) | *(superseded by 0010)* Offline format: raw Float16 binary + versioned JSON manifest |
| [0004](./0004-ship-both-glsl-and-tsl-decode-paths.md) | Ship both GLSL (WebGL) and TSL decode paths |
| [0005](./0005-single-package-isolated-subpath-exports.md) | Single package with isolated subpath exports |
| [0006](./0006-shader-injection-must-be-self-contained.md) | Shader-chunk injection must be self-contained, with a custom program cache key |
| [0007](./0007-v1-scope-library-only.md) | v1 scope: library-only; CLI, drei hook, and crossfade deferred |
| [0008](./0008-a-vat-bakes-a-posed-subtree-not-a-skinnedmesh.md) | A VAT bakes a posed subtree, not a `SkinnedMesh` |
| [0009](./0009-both-decode-paths-read-one-instance-playback-contract.md) | Both decode paths read one instance-playback contract |
| [0010](./0010-drop-the-offline-format-runtime-bake-is-the-library.md) | Drop the offline format: the runtime bake is the library |
| [0011](./0011-one-example-per-renderer-duplicated-on-purpose.md) | One example per renderer, duplicated on purpose |
| [0012](./0012-the-demo-is-an-argument-not-a-showcase.md) | *(superseded by 0020)* The demo is an argument, not a showcase |
| [0013](./0013-the-readme-is-beginner-first-depth-lives-in-docs.md) | The README is beginner-first; depth lives in `docs/` |
| [0014](./0014-changing-an-instance-is-a-function-not-a-mesh-subclass.md) | Changing an instance is a function over a geometry, not an `InstancedMesh` subclass |
| [0015](./0015-the-pose-freeze-fade-is-provisional-and-capped.md) | *(superseded by 0025)* The pose-freeze fade is provisional, and capped rather than trusted |
| [0016](./0016-the-pack-is-a-texture-keyed-by-instance-not-instanced-attributes.md) | *(amended by 0025 and 0051)* The pack is a texture keyed by instance, not instanced attributes |
| [0017](./0017-loop-mode-is-a-playback-policy-not-bake-data.md) | Loop mode is a playback policy, not bake data |
| [0018](./0018-the-rig-encoding-is-a-second-encoding-opt-in-for-now.md) | The rig encoding is a second encoding, opt-in for now |
| [0019](./0019-examples-beside-the-demo.md) | *(superseded by 0020)* Examples beside the demo |
| [0020](./0020-the-gallery-is-the-root.md) | The gallery is the root, and the demo is gone *(its flat list superseded by 0037)* |
| [0021](./0021-the-post-decode-hook-has-two-injection-points.md) | The post-decode hook has two injection points |
| [0022](./0022-capacity-is-fixed-when-the-playback-texture-is-made.md) | Capacity is fixed when the playback texture is made |
| [0023](./0023-a-one-geometry-batch-is-one-draw-on-webgpu-in-the-example-not-the-library.md) | *(amended by 0040)* A one-geometry batch is one draw on WebGPU, in the example and not the library |
| [0024](./0024-the-engineering-overlay-is-threes-own-and-the-pages-wear-threes-theme.md) | *(superseded by 0037)* The frame timings are always on, the Inspector is WebGPU's, and the pages wear three's theme |
| [0025](./0025-the-crossfade-is-a-second-live-band-in-the-pack.md) | *(rig blend amended by 0039)* The crossfade is a second live band in the pack, and the pose freeze is gone |
| [0026](./0026-a-worker-bake-copies-the-subtree-and-calls-bakevat.md) | A worker bake copies the posed subtree, and the worker calls `bakeVAT` |
| [0027](./0027-the-default-encoding-is-the-rig-where-the-asset-allows-it.md) | The default encoding is the rig where the asset allows it |
| [0028](./0028-merging-flat-materials-is-a-bake-option.md) | Merging flat materials is a bake option, off by default |
| [0029](./0029-a-fallen-back-bake-says-why-on-the-vat-not-in-the-console.md) | A fallen-back bake says why on the VAT, not in the console |
| [0030](./0030-a-vertex-encoded-frame-spans-rows-past-the-ceiling.md) | A vertex-encoded frame spans rows past the texture ceiling |
| [0031](./0031-gltf-and-fbx-are-the-supported-formats.md) | glTF and FBX are the supported formats; any subtree is accepted |
| [0032](./0032-the-drop-tool-evaluates-and-hands-back-code-not-a-file.md) | The drop tool evaluates; it hands back code, not a file |
| [0033](./0033-a-negative-speed-plays-the-band-backwards-mirrored.md) | A negative speed plays the band backwards, mirrored |
| [0034](./0034-the-cli-bakes-to-a-versioned-vat-glb.md) | The CLI bakes to a versioned `.vat.glb`, and a baked file loads only in its own format version |
| [0035](./0035-the-writer-is-public-as-three-vat-write.md) | The baked file's writer is public, as `three-vat/write`, and copies the source's image bytes |
| [0036](./0036-a-turn-retraces-and-the-blend-gets-a-start-of-its-own.md) | A turn retraces the path, and the blend gets a start of its own |
| [0037](./0037-an-example-is-a-recipe-in-a-studio-of-its-own.md) | An example is a recipe as well as evidence, in a studio of the library's own |
| [0038](./0038-a-game-lives-beside-the-gallery-as-one-program-on-either-renderer.md) | A game lives beside the gallery, as one program on either renderer |
| [0039](./0039-a-rig-crossfade-blends-each-slot-as-the-mixer-does-about-its-pivot.md) | A rig crossfade blends each slot as three's mixer does, about its pivot |
| [0040](./0040-several-characters-share-a-carrier-through-an-atlas.md) | Several characters share a carrier through an atlas, and the decode does not change |
| [0041](./0041-a-pause-is-a-stopped-clock.md) | A pause is a stopped clock, one value in the pack |
| [0042](./0042-the-position-layer-is-stored-transformed-for-compression.md) | A vertex-encoded file stores its position layer transformed for compression |
| [0043](./0043-a-level-of-detail-repeats-the-vertices-and-the-decode-wraps-the-column.md) | A level of detail repeats the vertices, and the decode wraps the column |
| [0044](./0044-a-second-game-lives-outside-the-workspace.md) | A second game lives outside the workspace |
| [0045](./0045-the-swarm-is-a-flow-field-and-bodies-not-rules.md) | *(superseded by 0046)* The swarm is a flow field and bodies, not rules |
| [0046](./0046-the-swarm-is-one-want-and-nerve-not-a-route-map.md) | The swarm is one want and nerve, not a route map |
| [0047](./0047-the-swarm-steps-in-a-worker-at-a-fixed-rate.md) | *(amended by 0053)* The swarm steps in a worker, at a fixed rate |
| [0048](./0048-the-look-steps-down-where-a-device-cannot-keep-up.md) | The look steps down where a device cannot keep up |
| [0050](./0050-the-scene-is-drawn-once-and-smoothed-by-fxaa.md) | The scene is drawn once, and smoothed by FXAA |
| [0051](./0051-a-caller-may-spell-the-logical-index-on-the-tsl-path.md) | A caller may spell the logical index, on the TSL path |
| [0052](./0052-last-lights-rats-are-culled-on-the-gpu-on-webgpu.md) | Last Light's rats are culled on the GPU, on WebGPU |
| [0053](./0053-last-lights-swarm-steps-on-the-gpu-on-webgpu.md) | Last Light's swarm steps on the GPU, on WebGPU |
