# Where this sits, and where it goes

For a reader deciding whether `three-vat` is the right tool, or thinking about
contributing to it. Nothing here is API: how a VAT works is
[usage.md](./usage.md), and why it works that way is [adr/](./adr).

This page is what survived auditing the original design report against the
ADRs — the decisions moved out to where they are argued, and what was left is
the part no ADR covers: the neighbours, and the plan past 1.0.

## The gap

VAT is battle-tested elsewhere. Houdini Labs' Vertex Animation Textures,
OpenVAT and AutoVAT for Blender, VatBaker for Unity — every one of them runs
DCC-side and emits engine-flavoured output. The three.js side has scattered
demos, no maintained npm package, and nothing in drei.

The angle that makes this a library rather than a fifth baker: it
[bakes at runtime from the glTF itself](./adr/0001-bake-vat-at-runtime-from-gltf.md),
so any Mixamo or Sketchfab asset works with no pipeline to install — and, since
[ADR-0008](./adr/0008-a-vat-bakes-a-posed-subtree-not-a-skinnedmesh.md), with
nothing for the caller to classify either.

## The neighbours, and why they are not competitors

The nearest packages animate instances by **posing skeletons on the CPU and
uploading the bones**. That is the real dividing line, and it is worth stating
as one: skinning-instancing is *CPU poses, GPU renders*; VAT is *GPU everything
after load*.

- **[`@three.ez/instanced-mesh`](https://github.com/agargaro/instanced-mesh)**
  (InstancedMesh2) — per-instance culling, BVH, LOD, visibility and uniforms,
  plus skinning by bone texture: `initSkeleton`, `mixer.update`, `setBonesAt`
  per animated instance. No baking, no `AnimationClip` → texture. It is
  **complementary**: a VAT-patched material renders on an InstancedMesh2 fine,
  which is the motivating case for keeping the primitives underneath
  `createVATMesh` exported
  ([ADR-0009](./adr/0009-both-decode-paths-read-one-instance-playback-contract.md)).
- **[`@three.ez/batched-mesh-extensions`](https://github.com/agargaro/batched-mesh-extensions)**
  — the same treatment for `BatchedMesh`. Also no animation baking.
- **three.js's own `webgpu_skinning_instancing`** — 30 instances sharing *one*
  skeleton in lockstep (same clip, same pose, same time; the variation is
  colour), still running `mixer.update(delta)` every frame. Read the source
  before assuming overlap: it is a different technique, not a smaller version
  of this one.

## Where this goes next

The contribution order is **own package → propose a hook to drei → an official
three.js example**, and never a three.js core PR: core is minimal by philosophy,
feature PRs get closed with "make it external", and even `examples/jsm` is
shrinking. Drei absorbing a thin wrapper around a maintained external package is
the proven path — `three-custom-shader-material` and `camera-controls` both went
that way. Open a drei *discussion* issue before any PR; pmndrs sometimes prefers
the ecosystem package to stay one.

An official example would be `webgpu_instancing_vat`, and the shape is already
decided:

- **TSL only there, not a page per renderer.** Upstream does not accept new
  GLSL examples, and `WebGPURenderer` falls back to WebGL2 anyway. This repo's
  own demo goes the other way on purpose — one page per renderer, because its
  job is to show a reader *their* code
  ([ADR-0011](./adr/0011-one-example-per-renderer-duplicated-on-purpose.md)).
- **No texture asset in the repository — bake live** from `models/gltf/Soldier.glb`,
  which is already there and has idle/walk/run. Examples cannot import npm
  packages, so it carries its own ~250-line inline bake and stays independent of
  this library. For didactic clarity it would use `FloatType` and absolute
  positions, skipping the delta and half-float caveats the library takes on.
- **Say the delta out loud in the PR**, against `webgpu_skinning_instancing`
  above: ~1000 instances, independently desynced, mixed clips, zero per-frame
  CPU, no bones in the shader. The precedent for a technique-example is
  `webgl_gpgpu_birds`.
- **Post a forum or issue heads-up before writing the file.** sunag owns the TSL
  examples and has preferences; ten minutes there turns review into a rubber
  stamp. The likely pushback is "extend the existing example", which would muddy
  both techniques.

The example is the cherry, not the cake. If it is declined, the same argument is
already shipped as [the demo](../examples)
([ADR-0012](./adr/0012-the-demo-is-an-argument-not-a-showcase.md)); only the
single-file format and the `files.json` plumbing are three.js-specific.

## Parked, and deliberately not built here

A drag-and-drop web tool — drop a `.glb`, see the crowd, take the VAT — in the
shape of gltf.report. It is the best demonstration this library could have and
it is not a library surface, so it waits behind everything that is.

`Object3D`-like ergonomics for `BatchedMesh` — `instance.position.x` instead of
matrices. Adjacent, frequently wanted, and the right home is a proxy-parity
contribution to `batched-mesh-extensions` (InstancedMesh2 already has
`.instances[i]`), not a new package and certainly not a core PR. Whoever builds
it: flush dirty flags in `onBeforeRender` rather than writing through eagerly —
a `position.set()` costs three `setMatrixAt` round trips — reuse three's built-in
`Euler`/`Quaternion` `_onChange`, and create the proxies lazily.

## Sources

- Existing example: <https://threejs.org/examples/webgpu_skinning_instancing.html>
- TSL reference: <https://threejs.org/docs/pages/TSL.html> and
  <https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/>
- DCC bakers: <https://extensions.blender.org/add-ons/openvat/>,
  <https://extensions.blender.org/add-ons/vat/>, <https://nmancreative.com/>
  (AutoVAT), <https://github.com/fuqunaga/VatBaker> (Unity),
  <https://www.sidefx.com/docs/houdini/nodes/out/labs--vertex_animation_textures-3.0.html>
- three.js-side prior art:
  <https://github.com/mikelyndon/r3f-webgl-vertex-animation-textures>,
  <https://github.com/zadvorsky/three.bas>,
  <https://github.com/topics/vertex-animation-texture>,
  <https://discourse.threejs.org/t/animationclip-for-instancedmesh/35685>,
  <https://discourse.threejs.org/t/bringing-soft-and-fluid-body-vertex-animations-from-houdinifx-to-threejs/7411>
- CLI precedent, should one ever ship: <https://github.com/pmndrs/gltfjsx>
