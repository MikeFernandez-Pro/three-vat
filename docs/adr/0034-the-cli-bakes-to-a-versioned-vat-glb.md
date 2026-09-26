# The CLI bakes to a versioned `.vat.glb`, and a baked file loads only in its own format version

`npx three-vat bake` bakes an asset in Node. By default it **reports** what the bake chose, and with `--out` it also **writes** a **baked file**. That is one `.vat.glb` holding the merged geometry, its materials and the VAT's texels, and `loadVAT` turns it back into the VAT `bakeVAT` would have returned. This brings back the offline format [ADR-0010](./0010-drop-the-offline-format-runtime-bake-is-the-library.md) removed, in the shape that ADR named as the right one if the format ever returned. It closes the CLI [ADR-0007](./0007-v1-scope-library-only.md) deferred and answers the output question [ADR-0032](./0032-the-drop-tool-evaluates-and-hands-back-code-not-a-file.md) left to [#94](https://github.com/MikeFernandez-Pro/three-vat/issues/94). Decided on 2026-09-26.

## Why a file, when the bake is cheap

ADR-0010 cut the format because it bought only bake time at load, and the measurements made that a narrow problem. Since the rig encoding became the default ([ADR-0027](./0027-the-default-encoding-is-the-rig-where-the-asset-allows-it.md)), the problem is narrower still. Soldier's four clips bake in 60 ms in Chrome, and 16 000-vertex Michelle in 0.4 s. What remains is the **fallback**: an asset whose clips animate morphs bakes under the vertex encoding, at several seconds on a phone for a large character. A worker moves that cost off the main thread but does not remove it. A file removes it. The CLI's report mode is the other half. It answers the question an asset pipeline asks, "will this bake, and how?", and it needs no format at all.

## The file

- **One `.glb`.** The merged geometry is a glTF mesh, the texels sit in buffer views of their own in the same binary chunk, and a `THREEVAT_vat` extension carries the clip table, encoding, `fallback`, bounds, `rowsPerFrame` and the **format version**. ADR-0003's texel `.bin` plus manifest is not revived, because without the geometry it cannot be rendered, which is the finding ADR-0010 rests on.
- **Materials travel in it.** A glTF source's image bytes are copied through as they are. Node has no canvas, and three's exporter cannot re-encode an image without one, so there is nothing to re-encode, and nothing is lost. An FBX source's Phong and Lambert materials go through three's own conversion to PBR, and the report names what was dropped. `loadVAT(url, { materials })` still takes the caller's own materials, in `materialIndex` order. A file without materials would leave the caller loading the source anyway for them, which defeats the file.
- **Viewers open it.** The extension is in `extensionsUsed`, not `extensionsRequired`, so Blender or the Khronos viewer shows the geometry and materials of what the CLI wrote. A rig-encoded file also carries a glTF skin, with slots as joints, a slot's rest matrix as its joint's transform, and `skinIndex` and `skinWeight` as `JOINTS_0` and `WEIGHTS_0`. That skin is so a viewer shows the rest pose instead of every part stacked at its own origin. `loadVAT` ignores the skin. If it ever disagreed with the slots, only a preview would be wrong, never a crowd.
- **The loader checks the geometry.** The texels are addressed by the merged vertex order, so a tool that reorders, welds or simplifies vertices breaks a baked file without breaking the glTF. `extensionsRequired` would not stop it, since a tool may ignore the requirement. The extension therefore records the vertex count and a digest of the rest `position` attribute, and `loadVAT` refuses a file whose geometry no longer matches, naming an optimizer pass as the likely cause.

## One format version, read only by its own loader

The file states a format version of its own, not the package's. `loadVAT` reads its current version and refuses any other by name, asking for a re-bake. A release that leaves the encodings alone leaves every baked file valid. A release that narrows one bumps the version, and a build step re-bakes, which it does anyway.

This is the cost ADR-0010 refused to pay, "a second versioned representation of a VAT to maintain forever", and this rule is what makes it bounded. There are no readers for old versions, so nothing is maintained forever. The price is that a baked file checked into a repository has to be re-baked when its version moves. Readers for older versions can be added later without breaking anything.

## Considered and rejected

- **Report only, no file.** It fits the library as it stands, and it was the recommendation going in. It was rejected because skipping the bake at load is worth having wherever it is possible, and report mode alone never skips it.
- **A file that loads in every later version.** That means a reader for every old version, kept forever, and it costs the freedom the `VAT` type reserves to narrow a texel array in a minor release.
- **A file that loads only in the package version that wrote it.** Cheaper again, but every patch release would invalidate every file.
- **A separate `vat-bake` package.** The name reads better, but a writer and a reader could come from different releases. As a `bin` inside `three-vat`, they cannot ([ADR-0005](./0005-single-package-isolated-subpath-exports.md)).
- **Rest-pose nodes instead of a skin.** One mesh is merged, so separate nodes could not place its parts. A skin is the glTF shape that already describes what a rig-encoded VAT is.

## Consequences

- **`loadVAT` returns to core**, beside `bakeVAT`. It is built on a `GLTFLoader` plugin, which is the whole of the mechanism, so a caller keeps their own configured loader (Draco, meshopt, KTX2), as [ADR-0026](./0026-a-worker-bake-copies-the-subtree-and-calls-bakevat.md) insisted for the worker. A loaded VAT is held texel for texel to a fresh bake, as `worker.test.ts` holds a worker bake.
- **The texel arrays become a format.** The `VAT` type's promise that they "may change in a minor release" still holds for the runtime object. For a baked file, that change is a format bump.
- **Options come as flags and an optional `vat.config.json`.** The config holds per-clip settings, meaning the **clip defaults** a page reads from a configured `AnimationAction`. The CLI evaluates no user code. A procedural subtree is baked from the caller's own script.
- **Report mode fails CI on a refusal only**, on a fallback under `--encoding rig`, and on a byte budget (`--max-bytes`). Bake time is never a budget, because it measures the machine.
- **Input is glTF, including meshopt, with KTX2 images copied through undecoded, and FBX.** Draco is refused by name, with the `gltf-transform` command that decodes it first. Its decoder needs `fetch` and a Worker, and Node has neither to give it.
- **Writing in Node needs a `FileReader` shim** for three's exporter. The texel buffer views are written by an exporter plugin, and read back by the loader plugin through `parser.getDependency('bufferView', i)`.
- **A download in the drop tool** is its own ticket, blocked by the writer. A browser bake has decoded images where a Node bake has bytes, so it has a materials question of its own.
