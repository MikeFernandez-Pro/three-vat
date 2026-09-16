# Offline format: raw Float16 binary + versioned JSON manifest

> **Superseded by [ADR-0010](./0010-drop-the-offline-format-runtime-bake-is-the-library.md).**
> The offline path is cut from the public surface: merging (ADR-0008) made a
> texture-only artifact unrenderable, and measured bake times did not justify a
> second versioned representation of a VAT. Retained because the reasoning below —
> and the single-`.glb` shape in ADR-0010 — is what a future CLI would build on.

The canonical on-disk format is a raw Float16 `.bin` blob plus a versioned JSON manifest (`{ version, vertexCount, clips, bounds, encoding }`), loaded by a ~20-line loader (fetch → `ArrayBuffer` → `DataTexture` with `HalfFloatType`, which uploads directly).

KTX2 was rejected as the default: its Basis/UASTC GPU compression doesn't apply to float data, so it would only be a zstd container that forces every consumer to load the KTX2Loader + WASM decoder — while wire compression comes free via gzip/brotli on the correlated texels. The manifest is versioned from day one because the manifest *is* the format.

Normals ship as full 3-channel f16 in v1; octahedral 2-channel encoding is deferred behind the manifest's `encoding` field, a non-breaking future addition. `--precision float32` and `--format ktx2` remain optional escape hatches.
