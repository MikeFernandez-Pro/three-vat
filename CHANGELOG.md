# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

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
