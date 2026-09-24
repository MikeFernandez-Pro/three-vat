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
- **[threeforge](https://github.com/tallslab/threeforge)**: a frame-budget
  compiler for three.js games (batcher, diagnostics ledger, CLI, MCP server),
  and not an animation library. Its `src/skinning/` bakes bone matrices into a
  texture and skins from it in TSL, which is a smaller version of the rig
  encoding: a full matrix a bone, the nearest frame rather than an
  interpolated one, loop only, no morphs and no `WebGLRenderer` path. It is
  worth reading for three things it does that three-vat does not: a guarded
  float `mod` at the loop boundary (filed on #79), LOD by simplifying a
  skinned geometry, and a GPU test against three's own `SkinnedMesh`. The
  comparison, with a citation for each claim, is
  [research/threeforge.md](./research/threeforge.md).

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

### A second encoding: the rig instead of the vertices

> **Decided — [ADR-0018](./adr/0018-the-rig-encoding-is-a-second-encoding-opt-in-for-now.md),
> from the measurement on `prototype/bone-encoding` (#47).** The paragraphs
> below were the case for a prototype and are kept as written. Two of their
> claims did not survive it: the cache does *not* absorb the fetches on a
> discrete GPU (the rig decode is ~1.4× the frame time there, and the fetch
> count is not what drives it), and it absorbs them completely on a phone,
> where the rig decode is ~0.6× — faster than the vertex encoding, not slower.
> The encoding ships opt-in, per bake, vertex by default; the ADR records why
> and when the default is meant to flip. The "one texture, many meshes" claim
> is still untested and is a follow-up, not part of that decision.

The "vs bone-texture instancing" line in [usage.md](./usage.md#trade-offs)
compares this library to a technique. It could also be a second **encoding**
inside it — baking, per frame, the skin matrix of every bone rather than the
position of every vertex, and skinning in the vertex shader from that texture.
Houdini Labs already files this under VAT as its *rigid* mode beside the *soft*
one, and the `VAT` type's `encoding` field is the slot that has been waiting
for a second value since 0.1.

What it buys is not marginal, measured on the assets in this repository:

- **Memory.** `Soldier` (7 434 vertices, 49 bones) costs 238 kB per frame as
  a VAT and 3.1 kB as `mat4`s — 1.5 kB as quaternion + translation. Two orders
  of magnitude.
- **The vertex ceiling disappears.** A VAT's width is `vertexCount`, so a
  20 000-vertex skinned character on a 16 384 GPU is not expensive, it is
  refused. A bone texture's width is `bones × 4`.
- **The bake becomes free.** 49 matrices per frame instead of four weights per
  vertex per frame — exactly the matrices #44 computes once per frame.
- **Normals and tangents come from the matrix**, as in three's own skinning:
  no second texture, and `normalMap` works without #41's fix.
- **One texture, many meshes.** Every mesh sharing a rig shares the texture, so
  LOD and a mixed crowd of Mixamo characters in one `BatchedMesh` draw both
  stop being the impossibilities #42 and "No LOD" declare — a sampler is still
  a uniform per draw, but the sampler no longer belongs to one vertex set.

What it costs, and why it is a second encoding rather than a replacement: it
cannot express morph targets, so the source-agnosticism ADR-0008 built the
library on holds only for the vertex encoding; and it spends 8–32 texel fetches
per vertex where a VAT spends 4–6 — the one number nobody has measured on the
340-robot bench, and the reason this is a prototype first. It is **not** a
switch the baker flips when it sees a `SkinnedMesh`: a subtree mixes rigid,
skinned and morphed parts (`RobotExpressive` is all three), so the choice is
per bake, explicit, and refused loudly when the asset carries a morph
animation the encoding cannot store — as `weight`, `blendMode` and a
normal-less VAT under a lit material are refused today.

The 2.0 architecture is what makes this cheap later: the playback texture and
`resolveVATFrame` choose *which rows* and *how to mix them* and know nothing
about what a row holds, so a second encoding changes the sampling and nothing
upstream of it. Tracked as #47; sequenced after 2.0 ships.

### Two candidates from threeforge

Neither one is decided. Both are argued, with sources, in
[research/threeforge.md](./research/threeforge.md).

- **LOD under the rig encoding.** A rig texture is indexed by slot, not by
  vertex. So a simplified copy of `vat.geometry` that keeps its skin
  attributes reads the same rig texture and the same playback texture. That
  makes LOD possible without a second bake, which the vertex encoding can
  never offer, because its texture width is the vertex count. It reverses the
  usage guide's "No LOD", so it needs an ADR. It is also the concrete entry
  point for the LOD wayfinder. Whether a `BatchedMesh` of two geometries
  decodes one VAT correctly is untried.
- **A third image in the parity gate: three's own `SkinnedMesh`.** The gate
  compares GLSL with TSL, so a bug both decodes share passes it: a normal
  matrix, an instance-matrix order, or a shadow pass. Rendering the
  mixer-driven original at the same frame time would catch that. It conflicts
  with no ADR.

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
