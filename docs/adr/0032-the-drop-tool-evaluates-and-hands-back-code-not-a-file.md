# The drop tool evaluates; it hands back code, not a file

The parked tool on [#97](https://github.com/MikeFernandez-Pro/three-vat/issues/97) was pitched as "drop a `.glb`, see the crowd, take the VAT". There is no VAT to take. [ADR-0010](./0010-drop-the-offline-format-runtime-bake-is-the-library.md) removed the offline format, because a VAT's textures are addressed by the merged geometry's vertex order and cannot be rendered without it. So the tool is an **evaluation tool** for three.js users. You drop your asset, it is baked in a worker, and it runs as a crowd with the bake's own readouts: the encoding chosen and any fallback reason, bake time, texture size, and the vertex count before and after the FBX merge. What you leave with is a snippet: the loader, `bakeVAT` with the options you picked, and `createVATMesh` from the page's decode path. It is enough to reproduce on your own page what you just saw. Decided on 2026-09-25.

## Considered and rejected

- **Download a baked file.** The single `.glb` that ADR-0010 rejected "for 1.0" would carry geometry, texel buffers and the clip table in `extras`. That brings the format back, with a loader in the library and a second versioned representation of a VAT to maintain forever. The tool would force a decision that belongs to the CLI ([#94](https://github.com/MikeFernandez-Pro/three-vat/issues/94)), which has the same "what does it write" question and should settle it on demand. If the format returns there, the tool can add a download then.
- **Export for other engines** (OpenVAT-style textures plus a mesh for Unity, Godot or Blender). That is a new audience, and the library's decode is not what they would run. It would make the tool a product rather than this library's evidence.

## Consequences

- **The tool is an Example**, a `webgl_drop` / `webgpu_drop` pair in the gallery ([ADR-0020](./0020-the-gallery-is-the-root.md), [ADR-0011](./0011-one-example-per-renderer-duplicated-on-purpose.md)). It is not a site of its own. Its feature is the bake of an asset the visitor brings, and every page-table guard applies to it unchanged.
- **It depends on nothing unbuilt.** It needs neither #94 nor the texture atlas (#96), so where it sits in the queue is a priority call, not a blocked edge.
- **The snippet is held to the public API.** It is type-checked in the suite, so a renamed option breaks a test, not a visitor's paste.
