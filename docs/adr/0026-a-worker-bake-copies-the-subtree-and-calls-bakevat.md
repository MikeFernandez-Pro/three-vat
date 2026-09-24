# A worker bake copies the posed subtree, and the worker calls `bakeVAT`

`bakeVATInWorker(worker, root, animations, options)` takes what `bakeVAT` takes, plus the worker, and resolves with the VAT `bakeVAT` would have returned: the same texels, the same geometry, and the caller's own materials. The worker module is two lines, `import { serveVATBakes } from 'three-vat'` and `serveVATBakes()`. This closes the helper [ADR-0010](./0010-drop-the-offline-format-runtime-bake-is-the-library.md) deferred to 1.1 "for demand to decide".

## The page sends a copy of the subtree, not a URL

The 1.0 recipe had the worker load the glTF itself from a URL, and that is the shape a helper would most obviously wrap. It was rejected. The page ships a **copy of what the bake reads** instead: every node's transform, every mesh's geometry, skin and morph state, the skeletons, and the clips' tracks. The worker rebuilds that subtree and bakes it.

This is because a URL is a narrower input than the one the library already has:

- **A loader in the worker is a second loader.** A caller configures `GLTFLoader` with Draco, meshopt or KTX2. The worker would need the same configuration, written twice and kept in step. Where the two disagree, the bake and the render read different files.
- **Textures do not decode in a worker everywhere.** `GLTFLoader` falls back to an `<img>` element where `createImageBitmap` is unreliable, and a worker has no `document`. The bake never needed the images in the first place.
- **Materials have to be rebuilt on the page anyway.** The recipe told the reader to load the file a second time on the main thread to get the real materials, in the order the merge recorded them. Holding the order right was the caller's job, and getting it wrong rendered every group past the first with the wrong material.
- **`bakeVAT` takes a posed subtree, not a file** ([ADR-0008](./0008-a-vat-bakes-a-posed-subtree-not-a-skinnedmesh.md)). A URL-shaped helper could not bake a procedurally built hierarchy, a subtree of a larger scene, or a configured `AnimationAction`.

The page usually has the glTF loaded already, because it renders it. The copy costs one pass over the geometry arrays, sliced out of the file's buffer so the images inside it never cross. That cost is small next to the bake, and it is the only work the page does.

## The worker calls `bakeVAT`, and there is no second baker

The worker does not bake its own way. It rebuilds real three.js objects, a `SkinnedMesh`, a `Skeleton`, an `AnimationClip`, and calls the same `bakeVAT` the page would have called. ADR-0008's reason for one entry point holds unchanged: two bakers would disagree about what a frame is, and a caller would have to pick one. What exists is one baker and two places to run it.

The copy is held to that, texel for texel, by `src/worker.test.ts`. It bakes every fixture and both real assets through a real message channel and then on the thread, under both encodings, and requires every field of the two VATs to match.

## Materials travel by number

A material holds textures and GPU state and cannot be cloned across a message. The bake only needs to tell one material from another, to sort parts into groups. So the worker bakes against numbered stand-ins, and the page maps each `vat.materials` entry back to the material it numbered. The VAT that resolves holds the caller's own objects, in `materialIndex` order.

## What cannot be copied is refused before sending

Three things a bake can read have no faithful copy, and each is refused by name before a message is sent:

- **A bone outside the subtree.** Its world matrix comes from ancestors the copy does not carry.
- **A keyframe track with a custom interpolant.** Code does not cross a message. glTF's cubic spline is the exception that matters: `GLTFLoader` implements it outside three, marks it, and the worker carries a transcription of it.
- **An attribute that is neither a `BufferAttribute` nor an interleaved one.** Interleaved attributes are carried as they are, because the bake reads skinning attributes through them (Soldier interleaves its own).

## Consequences

- **The caller's scene is only read.** ~~A bake on the main thread computes normals on a source geometry that has none. A worker bake computes them on its copy.~~ *Amended by [#80](https://github.com/MikeFernandez-Pro/three-vat/issues/80):* neither bake computes them on the caller's geometry. Both derive them for the merged rest geometry, so the two leave the caller's scene in the same state.
- **Core, not a subpath.** Neither half touches a renderer, so both ship from `three-vat` beside `bakeVAT`, and no fifth alias spelling is needed ([ADR-0005](./0005-single-package-isolated-subpath-exports.md)).
- **One worker serves any number of bakes.** Each request carries an id, and each promise waits for its own answer. A worker whose script fails to load rejects every pending bake with a message naming `serveVATBakes`.
- **The wire format is internal.** Both halves ship in one package version, so the message shape can change in any release.
- **The example measures the argument.** `webgl_worker.html` and `webgpu_worker.html` run the same bake in a worker and on the main thread while a crowd walks, and print the longest frame each run left. On the main thread that frame is the whole bake.
