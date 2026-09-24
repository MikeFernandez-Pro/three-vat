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
| [0016](./0016-the-pack-is-a-texture-keyed-by-instance-not-instanced-attributes.md) | The pack is a texture keyed by instance, not instanced attributes |
| [0017](./0017-loop-mode-is-a-playback-policy-not-bake-data.md) | Loop mode is a playback policy, not bake data |
| [0018](./0018-the-rig-encoding-is-a-second-encoding-opt-in-for-now.md) | The rig encoding is a second encoding, opt-in for now |
| [0019](./0019-examples-beside-the-demo.md) | *(superseded by 0020)* Examples beside the demo |
| [0020](./0020-the-gallery-is-the-root.md) | The gallery is the root, and the demo is gone |
| [0021](./0021-the-post-decode-hook-has-two-injection-points.md) | The post-decode hook has two injection points |
| [0022](./0022-capacity-is-fixed-when-the-playback-texture-is-made.md) | Capacity is fixed when the playback texture is made |
| [0023](./0023-a-one-geometry-batch-is-one-draw-on-webgpu-in-the-example-not-the-library.md) | A one-geometry batch is one draw on WebGPU, in the example and not the library |
| [0024](./0024-the-engineering-overlay-is-threes-own-and-the-pages-wear-threes-theme.md) | The frame timings are always on, the Inspector is WebGPU's, and the pages wear three's theme |
| [0025](./0025-the-crossfade-is-a-second-live-band-in-the-pack.md) | The crossfade is a second live band in the pack, and the pose freeze is gone |
| [0026](./0026-a-worker-bake-copies-the-subtree-and-calls-bakevat.md) | A worker bake copies the posed subtree, and the worker calls `bakeVAT` |
| [0027](./0027-the-default-encoding-is-the-rig-where-the-asset-allows-it.md) | The default encoding is the rig where the asset allows it |
