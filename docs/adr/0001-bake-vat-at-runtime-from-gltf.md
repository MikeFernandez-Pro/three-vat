# Bake VAT at runtime from the glTF

Every existing VAT baker (Houdini Labs, OpenVAT, AutoVAT, Unity's VatBaker) runs DCC-side and emits engine-flavored output; there is no maintained three.js-side path. We bake the VAT directly from a loaded glTF's `AnimationClip` on the CPU — driving an `AnimationMixer` frame by frame and reading `boneTransform` per vertex — so any Mixamo/Sketchfab asset works with zero external pipeline. The same pure-CPU baker also runs offline in Node, so the runtime and offline paths produce identical textures. Trade-off: a one-time ~50–200 ms bake at load, accepted in exchange for eliminating the DCC toolchain.

## Addendum (2026-09-25): not only glTF

The title names glTF because it was the only format in view. The bake reads a posed subtree, never a file (ADR-0008). Which formats the project stands behind is [ADR-0031](./0031-gltf-and-fbx-are-the-supported-formats.md): glTF and FBX are supported, and any other subtree is accepted.
