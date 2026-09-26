# The baked file's writer is public, as `three-vat/write`, and copies the source's image bytes

[ADR-0034](./0034-the-cli-bakes-to-a-versioned-vat-glb.md) made the baked file the command's output and kept its writer internal. The drop pages now download what they bake ([#116](https://github.com/MikeFernandez-Pro/three-vat/issues/116)), so a page needs the writer too, and so does a caller baking a procedural subtree that no file ever held. The writer is exported from a **subpath of its own**, `three-vat/write`, and takes the same two things the command gives it: the VAT, and the source's images, read out of the glTF load the VAT was baked from. Decided on 2026-09-27.

## What it takes

```ts
import { readSourceImages, writeBakedFile } from 'three-vat/write'

const vat = bakeVAT(gltf.scene, gltf.animations)
const bytes = await writeBakedFile(vat, { images: await readSourceImages(gltf.parser) })
```

- **`writeBakedFile(vat, { images })`** resolves to the `.glb`'s bytes. It is the command's writer unchanged. A VAT with no textures needs no `images`.
- **`readSourceImages(parser, readFile?)`** reads every texture's image out of the loaded glTF as the file holds it. An image in the binary chunk comes through the loader's own `getDependency('bufferView', i)`, and a `data:` URI is decoded where it stands. An image in a file beside a `.gltf` goes through `readFile`, which may answer asynchronously and which by default fetches the image from where the loader found the `.gltf`. The drop pages pass their own, which reads the dropped file.

## Images: copied through, never re-encoded

A browser bake holds decoded images. A canvas could encode them again, but it would re-compress a JPEG, and it cannot encode KTX2 at all. It would also make a page's file differ from the command's for the same asset. So a page keeps the source's bytes and copies them through, as the command does. The drop pages already hold every dropped file. A `.gltf` missing a texture bakes with a warning, as before, and its download is refused, naming the texture. An FBX's textures have no source bytes, so a textured FBX material is refused by name, in a page as in the command.

## A worker bake is writable

A rig-encoded file's preview skin is built from each slot's rest matrix, which only the bake knows. [ADR-0034](./0034-the-cli-bakes-to-a-versioned-vat-glb.md) kept those matrices beside the VAT, so a worker bake came back without them and could not be written. The drop pages always bake in a worker ([ADR-0026](./0026-a-worker-bake-copies-the-subtree-and-calls-bakevat.md)), so the worker now sends the rest matrices back with the VAT. `bakeVATInWorker`'s VAT writes the same bytes as `bakeVAT`'s, which `worker.test.ts` holds. Only a rig-encoded VAT that `loadVAT` read is still refused, because the file does not keep those matrices.

## Considered and rejected

- **Keep it internal, and let the example reach into the source.** The page would work, but a visitor could not do on their own page what the example does, and ADR-0032 holds the drop tool to the public API.
- **Export it from the core entry point.** One import line fewer, but three's `GLTFExporter` would land in every bundle that imports `bakeVAT`. The subpath isolation ([ADR-0005](./0005-single-package-isolated-subpath-exports.md)) exists to prevent exactly that.
- **Re-encode through a canvas, or copy with a canvas fallback for FBX.** Both are lossy where they apply, add a second image path, and let a page's file differ from the command's. The fallback would also only ever serve an FBX, whose materials are converted anyway.

## Consequences

- **The package has four entry points.** `three-vat/write` reaches `three` and three's `GLTFExporter`, and nothing else: not the command, nor its loaders. The core entry point, `webgl` and `tsl` still never reach the exporter, and `decode-paths.test.ts` pins both.
- **The drop pages load the writer lazily.** A page imports `three-vat/write` only when the visitor asks for a download, so a visit that never downloads never fetches the exporter.
- **The snippet has a file form.** Beside the bake, the drop pages' snippet can show `loadVAT` over the downloaded file, type-checked against the public API with the rest of the snippets (ADR-0032, amended).
- **What the writer takes is now public API**, and so is the shape of `SourceImages`. A change to either is a breaking change, like the file's format version is for the file.
