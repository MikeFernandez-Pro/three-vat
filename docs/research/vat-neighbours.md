# Three VAT neighbours, read against three-vat

The question: what can three-vat learn, borrow, add, drop or improve from
three other vertex animation texture projects? They are Babylon.js's baked
texture animations, [manthrax/three-vat](https://github.com/manthrax/three-vat)
(a different three.js project with the same name), and
[flement/VAT-blender-addon](https://github.com/flement/VAT-blender-addon).

Everything below was read from source, pinned so the line anchors stay true:

- **Babylon.js** at
  [`4236dc6`](https://github.com/BabylonJS/Babylon.js/tree/4236dc62d9fe4baa3d35336704e8248f707f3cc4)
  (`master`, 2026-10-02). Its documentation page is rendered client-side, so it
  was read from its source in BabylonJS/Documentation at
  [`e5880a0`](https://github.com/BabylonJS/Documentation/blob/e5880a03a09bb0b7adda5d060b9b104db50ea858/content/features/featuresDeepDive/animation/baked_texture_animations.md).
- **manthrax/three-vat** at
  [`2f8bf3d`](https://github.com/manthrax/three-vat/tree/2f8bf3da847f97e6ffb98705ed905b42991fe357).
- **flement/VAT-blender-addon** at
  [`e513fe5`](https://github.com/flement/VAT-blender-addon/tree/e513fe550a014745c8f0044928ef29d87f9b3a0b).

Everything about three-vat was read on `main` at `fe669f2`, the unreleased 4.0
line where the rig encoding is the default
([ADR-0027](../adr/0027-the-default-encoding-is-the-rig-where-the-asset-allows-it.md)).

Short links below: **BJS** is the Babylon.js tree at `4236dc6`, **BJS-doc** the
documentation source at `e5880a0`, **MX** the manthrax tree, **FL** the flement
tree.

## What each one is

### Babylon.js: `VertexAnimationBaker` and `BakedVertexAnimationManager`

Part of Babylon's core since 5.0. Despite the name, it is **a baked bone-matrix
texture**, not a per-vertex one. In three-vat's vocabulary it is a rig
encoding with no vertex encoding beside it.

- **Bake.** `bakeVertexDataSync(ranges, halfFloat)` takes the mesh's
  `Skeleton`, throws without one, and for every integer frame of every
  `AnimationRange` calls `scene.beginAnimation(skeleton, f, f)`,
  `scene.render()` and `skeleton.getTransformMatrices(mesh)`
  ([vertexAnimationBaker.ts#L44-L79](https://github.com/BabylonJS/Babylon.js/blob/4236dc62d9fe4baa3d35336704e8248f707f3cc4/packages/dev/core/src/BakedVertexAnimation/vertexAnimationBaker.ts#L44-L79)).
  The older `bakeVertexData` is async, one promise per frame
  ([L89-L138](https://github.com/BabylonJS/Babylon.js/blob/4236dc62d9fe4baa3d35336704e8248f707f3cc4/packages/dev/core/src/BakedVertexAnimation/vertexAnimationBaker.ts#L89-L138)).
  The docs say the bake "will play the entire animation visibly", which is why
  they recommend baking at build time
  ([BJS-doc#L184](https://github.com/BabylonJS/Documentation/blob/e5880a03a09bb0b7adda5d060b9b104db50ea858/content/features/featuresDeepDive/animation/baked_texture_animations.md?plain=1#L184)).
- **Encoding.** One row per frame, `(bones + 1) x 4` RGBA texels per row, so a
  full `mat4` per bone plus one spare. Float32, or half-float on request since
  2025-06 ([#16750](https://github.com/BabylonJS/Babylon.js/commit/1b42d926927fba554db35f1bac8327e84e0f5ab9)),
  `NEAREST_NEAREST`
  ([L145-L169](https://github.com/BabylonJS/Babylon.js/blob/4236dc62d9fe4baa3d35336704e8248f707f3cc4/packages/dev/core/src/BakedVertexAnimation/vertexAnimationBaker.ts#L145-L169)).
  Half-floats apply to the whole matrix, translation included
  ([L65-L68](https://github.com/BabylonJS/Babylon.js/blob/4236dc62d9fe4baa3d35336704e8248f707f3cc4/packages/dev/core/src/BakedVertexAnimation/vertexAnimationBaker.ts#L65-L68)).
  Only the skeleton is baked: no morph targets, no node-animated rigid parts.
- **Decode.** The shader include replaces Babylon's bone-texture skinning
  (`bonesVertex` is skipped under `BAKED_VERTEX_ANIMATION_TEXTURE`). It fetches
  four texels per influence, up to eight influences, and multiplies
  `finalWorld` by the blend
  ([bakedVertexAnimation.fx#L25-L49](https://github.com/BabylonJS/Babylon.js/blob/4236dc62d9fe4baa3d35336704e8248f707f3cc4/packages/dev/core/src/Shaders/ShadersInclude/bakedVertexAnimation.fx#L25-L49),
  [bakedVertexAnimationDeclaration.fx#L14-L33](https://github.com/BabylonJS/Babylon.js/blob/4236dc62d9fe4baa3d35336704e8248f707f3cc4/packages/dev/core/src/Shaders/ShadersInclude/bakedVertexAnimationDeclaration.fx#L14-L33)).
  So the normal comes from `finalWorld`, like the rest of Babylon's skinning
  ([default.vertex.fx#L121-L137](https://github.com/BabylonJS/Babylon.js/blob/4236dc62d9fe4baa3d35336704e8248f707f3cc4/packages/dev/core/src/Shaders/default.vertex.fx#L121-L137)).
- **Playback.** Each mesh or instance carries one `vec4`:
  `(startFrame, endFrame, offsetFrames, fps)`. All instances share one
  `manager.time`, which the caller advances
  ([bakedVertexAnimationManager.ts#L127-L162](https://github.com/BabylonJS/Babylon.js/blob/4236dc62d9fe4baa3d35336704e8248f707f3cc4/packages/dev/core/src/BakedVertexAnimation/bakedVertexAnimationManager.ts#L127-L162)).
  The frame is `floor`ed, so there is **no interpolation between frames**, and
  the docs say so: "the animations may not be as smooth ... because there is
  no interpolation between frames"
  ([bakedVertexAnimation.fx#L15-L23](https://github.com/BabylonJS/Babylon.js/blob/4236dc62d9fe4baa3d35336704e8248f707f3cc4/packages/dev/core/src/Shaders/ShadersInclude/bakedVertexAnimation.fx#L15-L23),
  [BJS-doc#L15](https://github.com/BabylonJS/Documentation/blob/e5880a03a09bb0b7adda5d060b9b104db50ea858/content/features/featuresDeepDive/animation/baked_texture_animations.md?plain=1#L15)).
  Every range loops, and after the first loop it wraps to the range's second
  frame rather than its first, because the bake stores the seam frame twice
  (the comment at L17). Blending is ruled out in the same sentence of the docs.
- **Per-instance control.** The `vec4` above, as an instanced buffer
  (`registerInstancedBuffer`) or a thin-instance buffer
  (`thinInstanceSetBuffer`)
  ([BJS-doc#L118-L148](https://github.com/BabylonJS/Documentation/blob/e5880a03a09bb0b7adda5d060b9b104db50ea858/content/features/featuresDeepDive/animation/baked_texture_animations.md?plain=1#L118-L148)).
  Desync is an offset in frames, and the docs admit that one instance starting
  at a chosen moment "is **not guaranteed by default**" and give a formula to
  compute the offset by hand
  ([BJS-doc#L155-L177](https://github.com/BabylonJS/Documentation/blob/e5880a03a09bb0b7adda5d060b9b104db50ea858/content/features/featuresDeepDive/animation/baked_texture_animations.md?plain=1#L155-L177)).
- **Integration.** This is Babylon's strength. The include is in the default,
  PBR, background and node-material vertex shaders, and also in the shadow
  map, depth renderer, outline, glow, selection, picking and volumetric light
  passes, on GLSL and WGSL both (the list from
  `gh search code bakedVertexAnimation --repo BabylonJS/Babylon.js`).
  Visual tests in CI render it under depth of field and volumetric light
  scattering
  ([visualization/config.json#L2793-L2811](https://github.com/BabylonJS/Babylon.js/blob/4236dc62d9fe4baa3d35336704e8248f707f3cc4/packages/tools/tests/test/visualization/config.json#L2793-L2811)).
  Since 2026-05-27 it also refreshes thin-instance **bounding info** from the
  baked texture, per instance, on the CPU
  ([commit 284fe34](https://github.com/BabylonJS/Babylon.js/commit/284fe34254804150d2ddf67c09116faea2fd3f2b)).
  It does so with a CPU copy of the shader's frame function
  ([abstractMesh.pure.ts#L131-L230](https://github.com/BabylonJS/Babylon.js/blob/4236dc62d9fe4baa3d35336704e8248f707f3cc4/packages/dev/core/src/Meshes/abstractMesh.pure.ts#L131-L230),
  [thinInstanceMesh.pure.ts#L95-L145](https://github.com/BabylonJS/Babylon.js/blob/4236dc62d9fe4baa3d35336704e8248f707f3cc4/packages/dev/core/src/Meshes/thinInstanceMesh.pure.ts#L95-L145)),
  and picking tests cover it
  ([babylon.thinInstancePicking.test.ts#L97-L120](https://github.com/BabylonJS/Babylon.js/blob/4236dc62d9fe4baa3d35336704e8248f707f3cc4/packages/dev/core/test/unit/Meshes/babylon.thinInstancePicking.test.ts#L97-L120)).
- **Tooling.** Serialisation is the texel array as base64 in JSON, "~1.3x
  larger than the original", without the geometry
  ([vertexAnimationBaker.ts#L175-L216](https://github.com/BabylonJS/Babylon.js/blob/4236dc62d9fe4baa3d35336704e8248f707f3cc4/packages/dev/core/src/BakedVertexAnimation/vertexAnimationBaker.ts#L175-L216)).
  There is no CLI. The WebGL1 path samples with `texture2D` instead of
  `texelFetch`
  ([bakedVertexAnimationDeclaration.fx#L24-L32](https://github.com/BabylonJS/Babylon.js/blob/4236dc62d9fe4baa3d35336704e8248f707f3cc4/packages/dev/core/src/Shaders/ShadersInclude/bakedVertexAnimationDeclaration.fx#L24-L32)).
- **License.** Apache-2.0.

### manthrax/three-vat: a Houdini VAT3 player for three.js

A runtime for **DCC-baked** Houdini-style VAT3 assets, with a Blender exporter
that writes the same convention
([README.md#L3-L11](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/README.md#L3-L11)).
It plays soft body, rigid body, particle and dynamic-mesh (fluid, changing
topology) variants, and an OpenVAT sample
([README.md#L107-L147](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/README.md#L107-L147)).
It was created 2026-06-29 and last pushed 2026-07-07, with 42 commits and 2
stars (`gh api repos/manthrax/three-vat`). It has **no license file**, so its
code cannot be copied, only its ideas.

- **Encoding.** A sidecar `_data.json` with Houdini's field names, a `_mesh.glb`
  and up to six textures: `_pos`, `_rot`, `_col`, `_lookup`, `_pos2` and
  `_spareCol`
  ([README.md#L89-L97](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/README.md#L89-L97),
  [exp_softBody_data.json](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/public/examples/exp_softBody/exp_softBody_data.json)).
  Positions are either HDR EXR or 8-bit PNG normalised to the asset's bounds
  ([VATEffect.js#L209-L215](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/VATEffect.js#L209-L215)).
  The loader inflates PNGs by hand into an `RGBA8` `DataTexture`, so no colour
  management touches the texels
  ([VATLoader.js#L69-L139](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/VATLoader.js#L69-L139)).
  A vertex finds its texel through a second UV channel, the Houdini
  convention.
- **Normals.** Two forms. The rotation texture holds a **per-vertex
  quaternion** that rotates a default normal and tangent, so one texel yields
  both
  ([VATEffect.js#L178-L195](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/VATEffect.js#L178-L195)).
  "Compressed normals" pack a normal into the position texel's alpha, on a 32
  x 32 grid
  ([VATEffect.js#L221-L232](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/VATEffect.js#L221-L232),
  and the exporter's
  [`pack_compressed_normals`](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/vat_export.py#L206-L224)).
  Rigid-body rotations are smallest-three quaternions, with the dropped
  component's index in the position alpha
  ([VATEffect.js#L604-L641](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/VATEffect.js#L604-L641),
  [`pack_rigid_quaternion`](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/vat_export.py#L109-L140)).
  For fast-spinning pieces, a rotations-per-frame value drives a multi-turn
  slerp
  ([VATEffect.js#L579-L601](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/VATEffect.js#L579-L601)).
- **Playback.** One animation per asset, looping. There is no clip table. A
  global time, speed and optional "display frame" with playback off drive it.
  Inter-frame interpolation is a uniform toggle
  ([VATEffect.js#L239-L262](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/VATEffect.js#L239-L262),
  [L665](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/VATEffect.js#L665)).
- **Per-instance control.** One instanced `vec2` attribute, `(timeOffset,
  speedScale)`, folded into the time as `(time + offset) * speed`
  ([VATEffect.js#L1411-L1417](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/VATEffect.js#L1411-L1417),
  [L1710-L1726](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/VATEffect.js#L1710-L1726)).
  The demo sets `frustumCulled = false` on its `InstancedMesh`
  ([index.html#L899](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/index.html#L899)).
- **Renderer support.** `WebGLRenderer` only, through `onBeforeCompile`, with
  custom depth and distance materials for shadows
  ([VATEffect.js#L1552-L1627](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/VATEffect.js#L1552-L1627)).
  There is no TSL path: neither `positionNode` nor `three/webgpu` appears in
  the source.
- **Tooling.** A Blender panel that infers the VAT mode from the selection,
  resamples to a chosen fps, picks a texture width, and shows an output-size
  estimate
  ([README.md#L149-L167](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/README.md#L149-L167),
  [vat_export.py#L311](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/vat_export.py#L311),
  [L1566-L1621](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/vat_export.py#L1566-L1621)).
  Its own status line says the API and asset conventions "keep getting
  refined"
  ([README.md#L171-L173](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/README.md#L171-L173)).

### flement/VAT-blender-addon: the Vertex Animation Toolkit

A Blender 4.2+ add-on, published as
[extensions.blender.org/add-ons/vat](https://extensions.blender.org/add-ons/vat/)
(already a source of [landscape.md](../landscape.md)), version 1.0.12
([blender_manifest.toml](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/VAT/blender_manifest.toml)).
It bakes any evaluated Blender mesh: cloth, soft body, geometry nodes, every
modifier, and armatures ([README.md#L106-L129](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/README.md#L106-L129)).
It ships a three.js demo. It was created 2024-12-22 and last pushed 2026-09-27,
with 24 stars. The manifest says **GPL-3.0-or-later**; the source header says
GPL-2.0-or-later
([__init__.py#L1-L17](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/VAT/__init__.py#L1-L17)).
Either way it cannot be copied into an MIT package; only its ideas can.

It has two tracks ([README.md#L9-L19](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/README.md#L9-L19)):

- **Track A, VAT texture.** Positions as offsets from the bind pose or as
  absolutes, in a half-float EXR or a bounds-normalised PNG. Normals as an
  8-bit RGB PNG, `(n + 1) / 2`, not octahedral
  ([__init__.py#L118-L150](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/VAT/__init__.py#L118-L150)).
  Three layouts: one strip, `WRAP` (near-square, power of two), or
  `WRAP_CROP`. Wrapping cuts the vertices into blocks, and each block holds
  every frame, so `row = block x F + (F - 1 - f)`
  ([__init__.py#L65-L116](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/VAT/__init__.py#L65-L116),
  [vat-material.js#L24-L33](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/demo-threejs/src/vat-material.js#L24-L33)).
  The demo's decode samples one row, with no interpolation between frames
  ([vat-material.js#L54-L61](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/demo-threejs/src/vat-material.js#L54-L61)).
- **Track B, storage buffer** (`vat-storage/3`). On disk: offsets as
  `u8x3`, `u16x3` or `f32x3`, quantised over the bake's min and max. Normals
  as `oct8x2` (2 B, "~0.7 deg max error"), `f32x3` or `none`
  ([README.md#L66-L74](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/README.md#L66-L74),
  [`_oct_encode`](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/VAT/__init__.py#L367-L378)).
  The file is vertex-major, and each vertex is delta-coded frame to frame.
  Static vertices store frame 0 only, with a bitmap in the sidecar. Diffs are
  zigzag LEB128 varints, and everything is gzipped. Every combination is
  packed and the smallest gzip wins
  ([`write_storage_buffer`, __init__.py#L408-L637](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/VAT/__init__.py#L408-L637)).
  **At load, the viewer expands it all back to `vec4f`**, so VRAM is 32 B per
  vertex-frame with normals
  ([vat-storage.js#L50-L61](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/demo-threejs/src/vat-storage.js#L50-L61),
  [L124-L125](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/demo-threejs/src/vat-storage.js#L124-L125),
  [README.md#L88-L100](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/README.md#L88-L100)).
  The decode reads a storage buffer by a vertex id recovered from `uv1.x`,
  because glTF export splits vertices on seams. It lerps between two frames,
  and can subsample the baked rows at playback with a "step" uniform
  ([vat-storage.js#L294-L322](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/demo-threejs/src/vat-storage.js#L294-L322)).
  An unknown `format` string is refused with a re-bake message
  ([L45-L49](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/demo-threejs/src/vat-storage.js#L45-L49)).
- **Playback and instances.** One animation per bake, driven by one `frame`
  uniform. The demo has no instancing, no clip table and no per-instance
  state (`InstancedMesh` appears nowhere in
  [main.js](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/demo-threejs/src/main.js)).
- **Renderer support.** The demo is `WebGPURenderer` with TSL
  ([main.js#L66](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/demo-threejs/src/main.js#L66)).
  A GLSL `onBeforeCompile` twin of Track A exists
  ([vat-material-gls.js](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/demo-threejs/src/vat-material-gls.js)),
  but the demo does not import it. Track B is WebGPU only.
- **Tooling.** The panel shows a raw size and a VRAM estimate before export. A
  "Bake (manual)" dry run validates without writing. Unbaked simulations abort
  rather than export a static mesh. Topology changes pad rows and warn
  ([README.md#L25-L37](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/README.md#L25-L37),
  [L124-L129](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/README.md#L124-L129)).
  The repository has "no automated tests, no CI"
  ([README.md#L148](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/README.md#L148)).

## Side by side

| | Babylon.js | manthrax/three-vat | flement addon | three-vat |
| --- | --- | --- | --- | --- |
| **What a row holds** | a `mat4` per bone, plus one spare | per vertex: position, rotation quaternion, optional colour and more (Houdini VAT3) | per vertex: offset or absolute position, and normal | rig: quaternion, translation, uniform scale per slot; vertex: position delta, octahedral normal |
| **Texel formats** | RGBA32F, or RGBA16F for the whole matrix | EXR (float) or 8-bit PNG over bounds | A: EXR half or PNG over bounds, RGB8 normals. B: u8/u16/f32 on disk, `vec4f` in VRAM | rig: RGBA32F, 32 B a slot. Vertex: RGBA16F delta (w is a constant 1) and RG8 normal, 10 B |
| **Normals** | from the blended matrix | quaternion texture (normal and tangent) or 10 bits in position alpha | A: 8-bit RGB. B: `oct8x2` or none | rig: from the skin matrix, tangent too. Vertex: octahedral, ~0.95 deg worst; rest-pose tangent |
| **Frame interpolation** | none, `floor` | optional toggle | A: none. B: lerp | always, in the shader (ADR-0002) |
| **Clips** | ranges, frame numbers in the instance `vec4` | one per asset | one per bake | clip table, bands in one texture, clip defaults from the action |
| **Policies** | loop only | loop only | loop only | repeat, once, ping-pong, counts, clamp or rewind, reverse, turn |
| **Blending** | none | none | none | crossfade between two live bands (ADR-0025, ADR-0039) |
| **Per-instance state** | instanced `vec4` (start, end, offset frames, fps) | instanced `vec2` (time offset, speed) | none | playback texture keyed by logical index (ADR-0016) |
| **Carriers** | instances, thin instances | `InstancedMesh` | single mesh | `InstancedMesh`, `BatchedMesh` |
| **Culling and picking** | per-instance animated bounds on the CPU (2026-05) | culling off in the demo | n/a | union bounds over every frame; picking by that box in the examples |
| **Renderers** | WebGL1, WebGL2, WebGPU (GLSL and WGSL) | WebGL only | TSL demo; GLSL twin unused | GLSL and TSL, held to a parity gate (ADR-0004) |
| **Passes covered** | shadow, depth, outline, glow, picking, volumetric light | render and shadow | render | render, depth and distance (shadows) |
| **Bake location** | runtime, by rendering each frame | Blender or Houdini | Blender | runtime in the page, a worker, or Node via the CLI |
| **Input** | a `Skeleton` | Houdini or Blender exports | any evaluated Blender mesh, simulations included | any `Object3D`; glTF and FBX supported (ADR-0031) |
| **Offline file** | base64 JSON, no geometry | sidecar JSON plus mesh plus textures | A: images plus `.glb`. B: gzipped `.bin`, JSON, `.glb` | one versioned `.vat.glb` (ADR-0034) |
| **License** | Apache-2.0 | none | GPL-3.0-or-later | MIT |

## What three-vat already does that a neighbour treats as a feature

Named so that nothing below recommends it twice.

- **Interpolated frames.** All three neighbours ship nearest-frame playback in
  at least one path. three-vat always lerps two rows
  ([ADR-0002](../adr/0002-runtime-texture-encoding.md)).
- **Desync without hand-computed offsets.** Babylon needs a formula to start
  an instance at a chosen moment. three-vat's `startTime` is that moment
  ([ADR-0009](../adr/0009-both-decode-paths-read-one-instance-playback-contract.md)).
- **Octahedral normals in two bytes.** flement's `oct8x2` is the same choice,
  and #29 measured three-vat's ([ADR-0002's amendment](../adr/0002-runtime-texture-encoding.md#amendment-29-2026-09-23-the-normal-layer-is-two-bytes-not-sixteen)).
- **A smaller rig than Babylon's.** Babylon stores 64 B a bone and a spare
  bone per row. three-vat stores 32 B a slot and dedupes slots across skins
  (`RigVAT.rigTexture`, `src/types.ts` L184-L203).
- **Refusing a stale or foreign file.** flement refuses an unknown format and
  warns on a `.bin` and `.glb` from different bakes. `loadVAT` refuses another
  format version, and refuses a geometry whose vertex count or rest positions
  moved (`src/load-vat.ts` L195-L215,
  [ADR-0034](../adr/0034-the-cli-bakes-to-a-versioned-vat-glb.md)).
- **A size estimate before committing.** Both Blender panels estimate output
  size. `three-vat bake` in report mode does the bake and writes nothing, and
  `--max-bytes` fails CI on a budget
  ([usage.md](../usage.md#checking-an-asset-from-the-command-line)).
- **Texels past the width ceiling.** flement wraps into blocks; three-vat
  spans rows per frame
  ([ADR-0030](../adr/0030-a-vertex-encoded-frame-spans-rows-past-the-ceiling.md)).
  The two are the same idea with different addressing, and neither is better.
- **One texture for every mesh on a rig.** Babylon's texture belongs to the
  skeleton, so any mesh skinned to it reads it. That is the LOD question,
  ticket #91, which is **parked**.

## Add

### 1. Per-clip bounds, for picking and other CPU queries

- **What a neighbour does.** Babylon recomputes each thin instance's bounds
  from the baked texture at that instance's current frame, on the CPU, so
  picking and culling see the pose rather than the rest. It mirrors the
  shader's frame function in TypeScript to do it
  ([commit 284fe34](https://github.com/BabylonJS/Babylon.js/commit/284fe34254804150d2ddf67c09116faea2fd3f2b),
  [abstractMesh.pure.ts#L131-L144](https://github.com/BabylonJS/Babylon.js/blob/4236dc62d9fe4baa3d35336704e8248f707f3cc4/packages/dev/core/src/Meshes/abstractMesh.pure.ts#L131-L144)).
- **How three-vat handles it.**
  - `vat.bounds` is one box, the union of every frame of every clip
    (`src/types.ts` L107). ADR-0002 chose the union so that no frame is culled
    mid-animation, and that stays right for the carrier's bounds.
  - The examples pick an instance by ray against that union box
    (`examples/src/shooting-gallery.ts` L34-L44). So a robot lying in its
    Death pose is hit where it would stand.
  - The CPU half Babylon had to write already exists: `resolveVATFrame`
    resolves an instance's rows from its pack and the clock, in core
    (`CONTEXT.md`, **Frame resolution**).
- **What it would be.**
  - A `bounds` per clip in the clip table, beside `maxDelta`, which the bake
    already measures by skinning every vertex on the CPU under either encoding
    (`src/types.ts` L62-L69).
  - Then a small helper, or just a documented recipe: the instance's clip from
    its pack, that clip's box, and the instance matrix.
  - Per-frame boxes would be tighter still, at 24 B a frame, but per-clip is
    the step that costs nearly nothing.
- **What it does not do.** It does not tighten `BatchedMesh` culling. three
  culls a batch instance by its geometry's box, which is per geometry, not per
  instance. Only picking, hover, hit tests and game logic gain.
- **Value and cost.** Small cost: a field in the clip table, and a format bump
  for the baked file (ADR-0034's rule). Medium value for anything game-shaped.
  Ho Ho No and the shooting gallery are the cases in this repository. It
  conflicts with no ADR.

### 2. Holding one instance at a chosen pose

- **What a neighbour does.** In Babylon, an instance with `fps = 0` shows
  `startFrame + offset`. The frame offset is independent of speed, so a
  per-instance still pose is one `vec4` write
  ([bakedVertexAnimation.fx#L15-L23](https://github.com/BabylonJS/Babylon.js/blob/4236dc62d9fe4baa3d35336704e8248f707f3cc4/packages/dev/core/src/Shaders/ShadersInclude/bakedVertexAnimation.fx#L15-L23)).
  manthrax has the same for the whole mesh: playback off, and a
  `u_displayFrame` shown instead
  ([VATEffect.js#L239-L247](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/VATEffect.js#L239-L247)).
- **How three-vat handles it.**
  - `speed: 0` is "a held first row, on purpose" (`src/types.ts` L39-L42).
  - Where an instance sits in its clip is "a function of the shared clock and
    that instance's `startTime`, and of nothing else", which is why an
    action's `paused` is ignored at the bake
    ([usage.md](../usage.md#declaring-the-defaults-at-the-bake), the table
    under it).
  - So there is no way to freeze one instance mid-walk. The nearest is a
    one-shot that clamps on its last row.
  - ADR-0009 removed `timeOffset` because `startTime` covers desync. It did
    not consider a pause.
- **What it would be.** A clip-time offset in the pack, applied after speed,
  so that `speed: 0` with an offset holds any pose. It would have to be
  transcribed into `resolveVATFrame` and both decodes (ADR-0009), and it has to
  be decided how it composes with a turn
  ([ADR-0036](../adr/0036-a-turn-retraces-and-the-blend-gets-a-start-of-its-own.md))
  and a crossfade.
- **Value and cost.** Medium cost: a contract change, with a free channel to
  find in the pack. Its value depends entirely on demand: freeze-frame
  effects, a paused game with live UI, or an editor scrubbing one instance.
  See the open questions.

## Improve

### 3. The position texel's fourth channel is a constant

- **What the neighbours do.** Houdini's VAT3, as manthrax decodes it, packs a
  compressed normal into the position texel's alpha, so a vertex-frame is one
  texel and one fetch
  ([VATEffect.js#L221-L232](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/VATEffect.js#L221-L232)).
  flement's storage layout is `u16x3` plus `oct8x2`, 8 B a vertex-frame
  ([armature_storage_vat.json](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/demo-threejs/public/examples/armature_storage/armature_storage_vat.json)).
- **How three-vat handles it.**
  - The position layer is `RGBA16F`, and its `w` is written as a constant 1 at
    every vertex-frame (`src/bake.ts` L1174-L1177, `HALF_ONE` at L1220). That
    is 2 of the 10 B a vertex-frame costs.
  - The normal sits in a second, `RG8` texture, so each band costs two fetches
    per row, four per vertex, and eight while crossfading.
  - WebGPU has no three-channel texture format, so `RGB16F` is not the fix.
- **Two ways to use the channel.**
  - **Houdini's: a coarse normal in the half's `w`.** A half holds every
    integer up to 2048 exactly, so 10 or 11 bits of octahedral normal fit. That
    drops the `RG8` texture: 8 B a vertex-frame, and one fetch a row. But the
    grid is 32 x 32 against today's 256 x 256, which is a step back from #29.
    Not recommended.
  - **flement's: `RGBA16UI`, quantised.** The position goes in as three `u16`
    over the bake's delta range, and the normal's two octahedral bytes in the
    fourth `u16`. That keeps #29's 0.95 deg, makes 8 B a vertex-frame, and
    halves the fetches.
    - The position error becomes uniform over the range instead of relative
      to each delta. At 1 m of range that is 2 m / 65 535, about 0.03 mm,
      against half-float's 0.061 % of the delta (arithmetic, **unverified** on
      a real asset).
    - Both decodes move to an integer sampler.
    - The baked file takes a version bump.
- **Value and cost.** 20 % less memory on the vertex encoding, and half its
  fetches. But the vertex encoding is the fallback since ADR-0027, so this
  only lands on assets whose clips animate morphs. The usage guide also found
  that fetch count was not what drove frame time between the two encodings
  ([usage.md](../usage.md#the-two-encodings-measured)). So the fetch saving
  must be measured, not assumed. Medium cost: ADR-0002's amendment and #73
  would be amended, and the parity gate re-run. Prototype first, if at all.
  #150 declined it ([landscape.md](../landscape.md#declined-leads)).

### 4. Tangents under the vertex encoding

- **What a neighbour does.** Houdini's rotation texture stores a per-vertex
  quaternion rather than a normal. Rotating the rest normal and the rest
  tangent by it yields both
  ([VATEffect.js#L178-L195](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/VATEffect.js#L178-L195),
  used at
  [L381-L410](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/VATEffect.js#L381-L410)).
- **How three-vat handles it.** The vertex encoding bakes only the position
  and the normal, and keeps the rest-pose tangent. On normal-mapped Michelle
  that differs from three's skinning by 1.6 to 4.9 % of the character's pixels.
  The rig encoding, which is the default, transforms the tangent and matches
  ([usage.md, the two encodings measured](../usage.md#the-two-encodings-measured)).
- **What it would be.** Under the vertex encoding, and only when the merged
  geometry carries a `tangent`, bake a rotation instead of a normal. That is
  four bytes a texel (`RGBA8`, smallest-three as manthrax's
  [`pack_rigid_quaternion`](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/vat_export.py#L109-L140)
  packs it), decoded as a rotation of both rest vectors.
- **Value and cost.** Low value. It fixes only a normal-mapped asset that the
  rig refuses, which means morph-animated and normal-mapped at once. It
  doubles the normal layer and adds a third layout to the parity gate. Worth
  recording, not building, until such an asset is reported. Recorded in
  [landscape.md](../landscape.md#declined-leads).

### 5. Passes that draw the scene with a material of their own

- **What a neighbour does.** Babylon puts the decode in every vertex shader
  that might draw a VAT mesh: shadow, depth, outline, glow, selection,
  picking, volumetric light. Its visual tests render a VAT under depth of
  field and light scattering
  ([visualization/config.json#L2793-L2811](https://github.com/BabylonJS/Babylon.js/blob/4236dc62d9fe4baa3d35336704e8248f707f3cc4/packages/tools/tests/test/visualization/config.json#L2793-L2811)).
- **How three-vat handles it.** `createVATMesh` patches the render material
  and attaches VAT depth and distance materials, so shadows are right on both
  paths ([usage.md](../usage.md#everything-the-crowd-draws-with)). But three's
  WebGL post-processing passes draw the scene under `scene.overrideMaterial`.
  At three 0.185.1, `BokehPass` does it for depth
  (`examples/jsm/postprocessing/BokehPass.js` L139), `OutlinePass` for its depth
  and mask (L331, L345), and `SSAOPass` for its normals and depth (L424). An
  override material is not VAT-patched. So under those passes, a crowd's depth
  of field, outline and ambient occlusion would follow the rest pose.
- **Rendered, at three 0.186.0.** One crowd under each pass, on each renderer:
  - **WebGL:** `OutlinePass`, `SSAOPass` and `BokehPass` all follow the rest
    pose, as the source said. `SAOPass`, `GTAOPass`, `SSRPass` and
    `RenderPixelatedPass` set `scene.overrideMaterial` the same way. They were
    read, not rendered.
  - **WebGPU:** `ao()` and `pass()` depth follow the animated pose. Both draw a
    mesh with its own material, or hand an override the material's
    `positionNode` (`Renderer.renderObject`). TSL `outline()` does not: it
    draws its depth and mask materials through `renderer.renderObject`
    directly, past that step
    (`examples/jsm/tsl/display/OutlineNode.js`, `updateBefore`), so its mask
    traces the rest pose.
- **What was done (#153).** A usage.md section names each pass's behaviour on
  each renderer ([usage.md](../usage.md#post-processing)). A pair of examples,
  `webgl_postprocessing` and `webgpu_postprocessing`, shows a hover outline and
  depth of field over a running squad, with a fix on/off switch. The WebGL
  fix swaps each VAT mesh's material for a VAT-patched copy of the pass's
  override around each of the pass's renders, with `allowOverride = false` on
  the copy. A `ShaderMaterial` copy shares the original's uniforms, because the
  pass writes them every frame. The WebGPU fix gives `outline()`'s mask
  material the outlined crowd's `positionNode`. It stays a recipe, not a
  library function, because both fixes touch three's private members.

### 6. The baked file's size on the wire

- **What a neighbour does.** flement's Track B exists to make files small. It
  reorders to vertex-major so gzip's 32 KB window sees one vertex's frames
  side by side. It then delta-codes each vertex frame to frame, varint-codes
  the diffs, stores static vertices once, and keeps whichever combination
  gzips smallest
  ([__init__.py#L408-L637](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/VAT/__init__.py#L408-L637)).
  Its decode at load is "~20 ms for 5k x 30f, ~0.3 s for 50k x 121f on
  desktop"
  ([README.md#L100](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/README.md#L100)).
- **How three-vat handles it.** A baked file holds the texels in buffer views,
  exactly as uploaded, and "deploys, caches and compresses like any other
  `.glb`" ([usage.md](../usage.md#baking-at-build-time-loadvat)). That leaves
  compression to HTTP. Frame-major half-floats are probably a poor fit for a
  32 KB window on a wide mesh.
- **Measured, on Michelle.** Her rig-encoded file is 3.0 MB raw and 2.0 MB
  under brotli. Her vertex-encoded file is 91 MB raw and 49 MB under brotli.
  Its position layer alone is 72 MB raw, and brotli brings it only to 34 MB
  (a ratio of 2.13). Stored instead as each half-float's bits less the same
  vertex's bits a frame earlier (frame 0 as is), as uint16, vertex-major, split
  into channel planes and then byte planes, that layer comes to 17 MB under
  brotli (a ratio of 4.20). Soldier's vertex-encoded file is 9.4 MB raw. It was
  not measured compressed. The transform was taken up as #154.
- **What it would be.** First, measure: gzip and brotli a vertex-encoded
  `Soldier.vat.glb` and `Michelle.vat.glb`. If the ratio is poor, add a
  file-only transform: vertex-major order, and a delta of each half's bits
  from the frame before, undone in `loadVAT` before upload. The runtime `VAT`
  would not change. The file's format version would.
- **Value and cost.** Only vertex-encoded files gain. A rig file is already
  small (177 kB for Soldier), and since ADR-0027 most files are rig files. So
  the measurement is cheap and the rest is medium cost. The decode adds load
  time, which is the very thing a baked file exists to save. Do the
  measurement, then decide.

## Drop, or don't adopt

Each looks tempting. Each fails on something this repository has already
decided or measured.

- **A full `mat4` a bone** (Babylon). It is twice the rig encoding's bytes, for
  nothing the decode uses (ADR-0018). threeforge was declined on the same
  point ([threeforge.md](./threeforge.md#not-worth-adopting)).
- **Half-float rig matrices** (Babylon's `halfFloat` flag). A half keeps
  0.05 % of a value, and in a skin matrix the translation is the large value.
  A character 50 m from its origin would be about 25 mm off (arithmetic). The
  rig texture is 177 kB for Soldier, so halving it saves too little to pay
  that.
- **Nearest-frame playback** (Babylon, flement's Track A). ADR-0002 chose
  manual interpolation.
- **Frame offsets on a shared clock, carried as instanced attributes**
  (Babylon, manthrax). `startTime` replaced the offset (ADR-0009). Instanced
  attributes are indexed by the drawn slot, which a culling carrier permutes
  (ADR-0016).
- **Baking by rendering each frame** (Babylon). three-vat samples the mixer
  and never renders, so a bake runs in a worker or in Node (ADR-0026,
  ADR-0034).
- **Texels without geometry** (Babylon's base64 JSON). That file cannot be
  rendered without re-running the merge, which is ADR-0010's finding and
  ADR-0034's reason for one `.glb`.
- **A WebGL1 path** (Babylon). three.js no longer has a WebGL1 renderer.
- **8-bit positions over the bounds** (manthrax's PNGs, flement's Normalize
  option, flement's `u8x3`). flement's own troubleshooting table blames it for
  banding
  ([README.md#L159](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/README.md#L159)).
  Half-float deltas lose nothing at the rest pose (ADR-0002's amendment).
- **Absolute positions** (flement's `ABSOLUTES`). Deltas are what make
  half-float safe (ADR-0002).
- **Storage buffers in place of textures** (flement's Track B). Expanded to
  `vec4f`, it costs 32 B a vertex-frame in VRAM, against three-vat's 10 B. It
  runs on WebGPU only, which ADR-0004 rules out as the sole path. And the width
  ceiling it escapes is already handled by rows per frame (ADR-0030).
- **Playback-time frame stepping** (flement's `step` uniform). A coarser bake
  is the `fps` option at the bake, and saves the memory too.
- **Texel addressing through a UV channel** (Houdini, flement). It exists
  because a DCC export can split vertices after the bake. three-vat bakes the
  geometry it then draws, and a baked file checks its vertex count and rest
  positions on load (ADR-0034).
- **Rotations per frame for fast spinners** (manthrax, from Houdini). Under the
  rig encoding, a slot that turns more than half a revolution between two
  baked rows interpolates the short way. The remedy is a higher `fps` at the
  bake. A per-slot spin count is a third texel per slot for a case nobody has
  reported.
- **One runtime for many VAT variants** (manthrax: soft, rigid, particle and
  dynamic-mesh variants behind one `applyVatDeformation`, an 83 KB effect).
  three-vat's input is an `AnimationClip` on a subtree
  ([ADR-0008](../adr/0008-a-vat-bakes-a-posed-subtree-not-a-skinnedmesh.md)),
  so topology never changes and particles never arise.
- **Reading third-party VAT files** (Houdini VAT3, OpenVAT, flement's tracks).
  It would be a second producer of a `VAT`, against conventions three-vat does
  not own. ADR-0001's angle is "no pipeline to install", and ADR-0034's format
  is the library's own. None of the three neighbours' code could be copied
  anyway: manthrax has no license and flement is GPL. It was left as an open
  question rather than ruled out, because it is the only route to simulated
  cloth and destruction. #150 declined it. The reason and what would reopen it
  are in [landscape.md](../landscape.md#declined-leads).

## Open questions for the user

1. **Pause.** Is holding one instance at an arbitrary pose wanted (item 2)?
   It is the one playback feature a neighbour has that three-vat cannot
   express, and it touches the pack.
2. **Simulations.** Should three-vat ever play DCC-baked simulation VATs:
   cloth, fluids, destruction? Today the route is shape keys exported as glTF
   morph targets, which the vertex encoding bakes. That costs a morph target
   per frame in the source file. If yes, which convention: OpenVAT,
   Houdini VAT3, or flement's?
3. **Per-clip bounds.** Is picking the motivating case (item 1)? If per-frame
   bounds are wanted for a game, they are a different size of change.
4. **The vertex encoding's texel.** Is a prototype of the 8 B `RGBA16UI`
   texel worth an afternoon (item 3), given that the vertex encoding is now
   the fallback?
5. **Post-processing passes.** Should the library offer a recipe for
   `overrideMaterial` passes on WebGL, or only document the limit (item 5)?
   *Answered (#150):* document it and show the recipe in an example pair, with
   no library function.
6. **Baked-file compression.** Run the gzip and brotli measurement before
   anything else in item 6? *Answered (#150):* measured on Michelle (item 6);
   the transform is #154.

## Sources

Babylon.js, at
[`4236dc6`](https://github.com/BabylonJS/Babylon.js/tree/4236dc62d9fe4baa3d35336704e8248f707f3cc4):

- [packages/dev/core/src/BakedVertexAnimation/vertexAnimationBaker.ts](https://github.com/BabylonJS/Babylon.js/blob/4236dc62d9fe4baa3d35336704e8248f707f3cc4/packages/dev/core/src/BakedVertexAnimation/vertexAnimationBaker.ts),
  [bakedVertexAnimationManager.ts](https://github.com/BabylonJS/Babylon.js/blob/4236dc62d9fe4baa3d35336704e8248f707f3cc4/packages/dev/core/src/BakedVertexAnimation/bakedVertexAnimationManager.ts)
- [Shaders/ShadersInclude/bakedVertexAnimation.fx](https://github.com/BabylonJS/Babylon.js/blob/4236dc62d9fe4baa3d35336704e8248f707f3cc4/packages/dev/core/src/Shaders/ShadersInclude/bakedVertexAnimation.fx),
  [bakedVertexAnimationDeclaration.fx](https://github.com/BabylonJS/Babylon.js/blob/4236dc62d9fe4baa3d35336704e8248f707f3cc4/packages/dev/core/src/Shaders/ShadersInclude/bakedVertexAnimationDeclaration.fx),
  [ShadersWGSL/ShadersInclude/bakedVertexAnimation.fx](https://github.com/BabylonJS/Babylon.js/blob/4236dc62d9fe4baa3d35336704e8248f707f3cc4/packages/dev/core/src/ShadersWGSL/ShadersInclude/bakedVertexAnimation.fx),
  [Shaders/default.vertex.fx](https://github.com/BabylonJS/Babylon.js/blob/4236dc62d9fe4baa3d35336704e8248f707f3cc4/packages/dev/core/src/Shaders/default.vertex.fx)
- [Meshes/abstractMesh.pure.ts](https://github.com/BabylonJS/Babylon.js/blob/4236dc62d9fe4baa3d35336704e8248f707f3cc4/packages/dev/core/src/Meshes/abstractMesh.pure.ts),
  [Meshes/thinInstanceMesh.pure.ts](https://github.com/BabylonJS/Babylon.js/blob/4236dc62d9fe4baa3d35336704e8248f707f3cc4/packages/dev/core/src/Meshes/thinInstanceMesh.pure.ts),
  [test/unit/Meshes/babylon.thinInstancePicking.test.ts](https://github.com/BabylonJS/Babylon.js/blob/4236dc62d9fe4baa3d35336704e8248f707f3cc4/packages/dev/core/test/unit/Meshes/babylon.thinInstancePicking.test.ts),
  [packages/tools/tests/test/visualization/config.json](https://github.com/BabylonJS/Babylon.js/blob/4236dc62d9fe4baa3d35336704e8248f707f3cc4/packages/tools/tests/test/visualization/config.json)
- Commits [284fe34](https://github.com/BabylonJS/Babylon.js/commit/284fe34254804150d2ddf67c09116faea2fd3f2b)
  (thin-instance bounds, 2026-05-27) and
  [1b42d92](https://github.com/BabylonJS/Babylon.js/commit/1b42d926927fba554db35f1bac8327e84e0f5ab9) (half-float
  option, 2025-06-16). The list of shaders that include the decode is from
  `gh search code bakedVertexAnimation --repo BabylonJS/Babylon.js`.
- The documentation page,
  <https://doc.babylonjs.com/features/featuresDeepDive/animation/baked_texture_animations>,
  read from its source at
  [`e5880a0`](https://github.com/BabylonJS/Documentation/blob/e5880a03a09bb0b7adda5d060b9b104db50ea858/content/features/featuresDeepDive/animation/baked_texture_animations.md).

manthrax/three-vat, at
[`2f8bf3d`](https://github.com/manthrax/three-vat/tree/2f8bf3da847f97e6ffb98705ed905b42991fe357):
[README.md](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/README.md),
[VATEffect.js](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/VATEffect.js),
[VATLoader.js](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/VATLoader.js),
[vat_export.py](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/vat_export.py),
[docs/dynamic-mesh-export.md](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/docs/dynamic-mesh-export.md),
[index.html](https://github.com/manthrax/three-vat/blob/2f8bf3da847f97e6ffb98705ed905b42991fe357/index.html),
and repository metadata (created 2026-06-29, no license) from
`gh api repos/manthrax/three-vat`.

flement/VAT-blender-addon, at
[`e513fe5`](https://github.com/flement/VAT-blender-addon/tree/e513fe550a014745c8f0044928ef29d87f9b3a0b):
[README.md](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/README.md),
[VAT/__init__.py](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/VAT/__init__.py),
[VAT/blender_manifest.toml](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/VAT/blender_manifest.toml),
[demo-threejs/src/vat-material.js](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/demo-threejs/src/vat-material.js),
[vat-material-gls.js](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/demo-threejs/src/vat-material-gls.js),
[vat-storage.js](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/demo-threejs/src/vat-storage.js),
[main.js](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/demo-threejs/src/main.js),
[armature_storage_vat.json](https://github.com/flement/VAT-blender-addon/blob/e513fe550a014745c8f0044928ef29d87f9b3a0b/demo-threejs/public/examples/armature_storage/armature_storage_vat.json),
and repository metadata (created 2024-12-22) from
`gh api repos/flement/VAT-blender-addon`.

three-vat, on `main` at `fe669f2`: [CONTEXT.md](../../CONTEXT.md),
[usage.md](../usage.md), [landscape.md](../landscape.md),
[the ADR index](../adr/README.md), `src/types.ts`, `src/bake.ts`,
`src/load-vat.ts`, `src/vat-texture.ts` and
`examples/src/shooting-gallery.ts`. The three post-processing passes were read
in `node_modules`, three 0.185.1, and rendered at three 0.186.0, where
`examples/jsm/tsl/display/OutlineNode.js` and `src/renderers/common/Renderer.js`
were read too.
