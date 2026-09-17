# VAT project — design conversation report

> Context handoff file. Written 2026-09-13 after a design discussion in Claude Code.
> Topic: building a Vertex Animation Texture (VAT) toolkit for three.js / drei —
> bake a glTF `AnimationClip` into a data texture and animate hundreds of instanced
> characters with zero per-frame CPU (no SkinnedMesh per character).
> This is a **standalone open-source project idea**, not part of the Portfolio2024 app.

> **Status (2026-09-14):** Scaffolded, public on GitHub, and published to npm as
> [`three-vat@0.1.0`](https://www.npmjs.com/package/three-vat). Baker core + WebGL
> path are tested; the TSL/WebGPU path ships but awaits browser verification. This
> file is retained as the original design record — current status lives in
> `README.md` and `CHANGELOG.md`.

## The idea and the verdict

Proposed: a drei-style `useVAT` helper — pass a glTF's animation, get a data
texture that displaces vertices in the vertex shader, consumed by instanced
meshes for crowds.

Verdict: **good idea, real gap.** VAT is battle-tested in Unity/Unreal (Houdini
Labs VAT, OpenVAT, AutoVAT), but every existing baker is DCC-side with
engine-flavored output. Three.js-side there are only scattered demos — no
maintained npm package, no standard format, and drei has nothing. The unique
angle: **bake at runtime from the glTF itself** (any Mixamo/Sketchfab asset
works with zero pipeline), with an optional offline path sharing the same core
(cut before 1.0 — ADR-0010).

## Architecture decided

One pure core, three surfaces:

1. **`vat-core`** (framework-agnostic): baker + manifest format + shader chunks.
2. **`useVAT` drei-style hook** — runtime bake at load (~50–200 ms, wrap in
   drei's `suspend` keyed on gltf+options). DX gateway; works in sandboxes.
3. **CLI** `npx vat-bake model.glb --clips walk,run --fps 30` — same baker in
   Node (pure CPU math, no GL needed). Outputs textures + JSON manifest +
   optionally a skeleton/track-stripped .glb via glTF-Transform. Precedent:
   pmndrs' gltfjsx.
4. (Optional later) drag-and-drop web tool with live crowd preview, gltf.report-style.

Key property: the CLI's loader must produce the **exact same DataTexture** the
runtime hook produces — consumers can't tell which path baked it.

### Contribution strategy (decided order)

**Own package → propose hook to drei → three.js official example. Never a
three.js core PR** (core is minimal by philosophy; feature PRs get closed with
"make it external"; even examples/jsm is shrinking). Drei absorbing a thin
wrapper around a maintained external package is the proven path
(three-custom-shader-material, camera-controls model). Open a drei discussion
issue before PRing — pmndrs sometimes prefers ecosystem packages.

## Bake recipe (runtime)

- `AnimationMixer` on the SkinnedMesh, `mixer.setTime(f / fps)` per frame,
  `skinnedMesh.updateMatrixWorld(true)` + `skeleton.update()`, then
  `skinnedMesh.boneTransform(i, v)` per vertex → skinned position in mesh space.
- Texture layout: **x = vertexIndex, y = frame**, multiple clips stacked
  vertically with a clip table `{name, startFrame, frames, fps}`.
- `DataTexture`, RGBA, `FloatType`, `NearestFilter`, no mips. Frame
  interpolation done **manually in the shader** (two texelFetches + mix) —
  sidesteps float-linear-filtering support and precision wobble; 30 fps bake
  looks smooth lerped.
- **Store deltas** (`skinnedPos - bindPos`), shader does `position + delta` —
  precision where it matters, half-float friendly.
- Bake **normals too** (second texture; `boneTransform` is position-only —
  mirror its code with the normal matrix). Lighting is visibly wrong otherwise.
- **Expand geometry bounds to the union of all frames** or instances get
  wrongly frustum-culled mid-animation.
- Assert `vertexCount <= MAX_TEXTURE_SIZE` (16384); row-wrapping is future work.
- Memory math: verts × frames × 16 B × 2 textures (4k verts × 60 f ≈ 7.5 MB f32).

## Shader decode (WebGL2 / GLSL path)

```glsl
float t  = fract((uTime + aTimeOffset) / uDuration) * uFrames;
int   f0 = int(t), f1 = (f0 + 1) % int(uFrames);
vec3  p0 = texelFetch(uPosTex, ivec2(gl_VertexID, f0 + int(aClipStart)), 0).xyz;
vec3  p1 = texelFetch(uPosTex, ivec2(gl_VertexID, f1 + int(aClipStart)), 0).xyz;
vec3  transformed = position + mix(p0, p1, fract(t));
```

Instanced attributes: `aTimeOffset`, `aClipStart`, optional speed. Injection via
`onBeforeCompile` for a dependency-free drei PR (CSM would be nicer but adds a dep).

**Biggest WebGL gotcha: shadows.** InstancedMesh shadows use the depth/distance
material — must patch `customDepthMaterial` (+ `customDistanceMaterial` for
point lights) with the same chunk or crowds cast bind-pose shadows.
(TSL/WebGPU path does NOT have this problem — `positionNode` feeds the depth
pass automatically.)

## File format (offline path) — decided, then cut

> **Superseded by [ADR-0010](./adr/0010-drop-the-offline-format-runtime-bake-is-the-library.md).**
> The offline path never shipped past `0.3.0`: merging the bake subtree
> ([ADR-0008](./adr/0008-a-vat-bakes-a-posed-subtree-not-a-skinnedmesh.md)) made a
> texture-only file unrenderable, and a Web Worker answers the load-time cost the
> format existed for. The reasoning below is kept as the record of what was
> decided at the time.

- **KTX2 rejected as default**: its headline benefit (Basis/UASTC GPU
  compression) doesn't apply to float data; it'd just be a zstd container that
  costs every consumer the KTX2Loader + WASM decoder. Keep as optional
  `--format ktx2` later, maybe.
- **Canonical format: raw Float16 binary (.bin) + JSON manifest**, loaded by a
  ~20-line loader (fetch → ArrayBuffer → DataTexture, `HalfFloatType` uploads
  directly). Wire compression free via gzip/brotli (VAT texels are correlated,
  compresses well). `--precision float32` escape hatch for world-scale deforms.
- Manifest: `{ version, vertexCount, clips: [{name, startFrame, frames, fps}],
  bounds, encoding: "delta" }`. **Version it from day one** — the manifest IS
  the format.
- Clarified: KTX2 vs DataTexture was a category confusion — file-on-disk vs
  runtime object; runtime is always a DataTexture either way. The runtime hook
  never touches a file.

## Trade-offs to document honestly (README / PR)

- vs N × SkinnedMesh: N draw calls + per-frame CPU skeletons → VAT is 1 draw
  call, zero per-frame CPU, 2 texel fetches per vertex. This is the headline.
- vs bone-texture instancing: smaller textures, supports blending, but 4
  fetches × 4 influences per vertex; note as future work. VAT also captures
  morph targets / non-skeletal deformation for free (bakes final positions).
- VAT limits: no runtime IK/blending (crossfade between two clips = second
  sample pair, that's the ceiling); memory cost; discrete frames.

## three.js example plan (`webgpu_instancing_vat`)

- **One TSL example, not WebGL+TSL pair**: WebGPURenderer falls back to WebGL2,
  same TSL compiles to WGSL or GLSL; new GLSL examples aren't accepted anymore.
- **No texture asset in the repo — bake live** from an existing asset:
  `models/gltf/Soldier.glb` (already in repo, has idle/walk/run). For didactic
  clarity use FloatType + absolute positions (skip delta/f16 caveats). ~250
  lines total, readable top to bottom.
- TSL decode: `textureLoad` + `vertexIndex` (+ `instanceIndex` for the default
  desync); per-instance clip, desync and rate
  read from the instance-playback attributes both paths share (ADR-0009), with
  `hash(instanceIndex)` desync as the zero-config default when a geometry
  carries none. `material.positionNode` / `normalNode` on
  `MeshStandardNodeMaterial`. Shadows just work.
- Mechanics: `examples/webgpu_instancing_vat.html`, register in
  `examples/files.json` + `examples/tags.json`, screenshot via
  `npm run make-screenshot webgpu_instancing_vat`.
- **Redundancy question resolved with evidence** — read the source of
  `webgpu_skinning_instancing`: it is 30 instances, ONE shared skeleton in
  lockstep (same clip/pose/time, variation is color only), and still runs
  `mixer.update(delta)` every frame. The VAT example is categorically
  different: ~1000 instances, independent desynced animation, mixed clips,
  zero per-frame CPU, no bones in the shader. State this delta explicitly in
  the PR description to preempt "how is this different?". Precedent for
  technique-examples: `webgl_gpgpu_birds`.
- Risk: maintainer may say "extend the existing example" — counter-argued
  (would muddy both techniques). **Post a forum/issue heads-up before writing
  the file** — sunag owns TSL examples and has preferences; 10 minutes that
  turns review into a rubber stamp.
- Example is the cherry, not the cake: if declined, the same demo ships as the
  package showcase. Only the single-file format + files.json plumbing is
  three.js-specific.

## Showcase demo (the thing that sells it)

One Mixamo-style character, 2–3 baked clips, 500–1000 instances with random
timeOffset/clip/scale/hue, perf readout showing 1 draw call + flat CPU, and a
**toggle to 500 cloned SkinnedMesh** so the frame-time gap is visceral.

## Decisions locked 2026-09-14

- **Package name: `three-vat`** — verified free on npm (also free:
  `@three-vat/*` scope, `vat-baker`, `three-vat-baker`; bare `vat` is taken).
  Single package, subpath exports: `three-vat` (core baker), `three-vat/webgl`
  (GLSL `onBeforeCompile` patch), `three-vat/tsl` (node material). Subpath
  exports are load-bearing: importing `three/tsl`/`three/webgpu` drags in the
  node-material system, and WebGL consumers must never touch it.
- **Ship BOTH GLSL and TSL decode paths.** TSL's GLSL fallback belongs to
  `WebGPURenderer` (WebGPU→WebGL2 fallback); it does NOT make TSL materials
  run on the classic `WebGLRenderer`. GLSL path is mandatory for drei/today's
  users; TSL path is mandatory for the official example. The baker is
  renderer-agnostic pure CPU, so "both" is two thin adapters over one core.
- **Repo public from the first commit**; the announcement (forum post + drei
  discussion issue) waits until the showcase demo works. "Public" and
  "launched" are different events.
- Confirmed: three.js examples cannot import external npm packages (vendored
  `examples/jsm/libs` additions are effectively closed too) — the official
  example bakes inline and stays independent of the library, as planned.

## Prototype validation (2026-09-14) — recipe CONFIRMED

Throwaway prototype at `C:\Users\lezen\ThreJsJourney\vat-prototype\` (own git
repo, Vite + three 0.185, Soldier.glb baked at runtime). User-verified in
browser. Validated end to end on classic `WebGLRenderer`:

- CPU bake replicating `SkinnedMesh.applyBoneTransform` (blended
  `boneWorld × boneInverse` wrapped in bind space, `mixer.setTime` per frame);
  normals via the same skin matrix (`transformDirection`), matching three's
  own `skinnormal_vertex` (no inverse-transpose).
- Delta position texture + absolute normal texture, RGBA32F, NearestFilter,
  manual two-fetch lerp in the shader — smooth at 30 fps bake.
- Per-instance clip / timeOffset / speed via instanced attributes; scale via
  instance matrix; tint via `instanceColor`. Mesh-node transform folded into
  each instance matrix (`instanceMatrix × meshWorldMatrix`).
- Bounds expanded to the union of all baked frames → no culling pops.
- **Shadows work via patched `customDepthMaterial`** — after fixing the real
  gotcha below.
- SkinnedMesh-clone baseline (same transforms) craters at 500–1000 instances
  while VAT holds flat CPU and one crowd draw call. The headline claim holds.

**Hard-won lesson for the library (shader injection rule):** every injection
point into built-in materials must be SELF-CONTAINED. First attempt shared
decode locals between the `beginnormal_vertex` and `begin_vertex`
replacements; `MeshDepthMaterial`'s vertex shader contains
`#include <beginnormal_vertex>` *inside a dead `#ifdef USE_DISPLACEMENTMAP`
block*, so the shared locals were preprocessed away → depth program compile
error → instances silently cast no shadows. Fix: a `vatSample(sampler2D)`
GLSL function in the prelude; each chunk replacement calls it independently.
Also set `customProgramCacheKey` so patched materials never share a program
with unpatched ones.

Note: Soldier's `Idle` clip reads as near-static in a crowd (genuinely subtle
motion). The baker now records `maxDelta` per clip — near-zero maxDelta is
the diagnostic for a frozen-pose bake vs a subtle clip.

## Next steps (updated 2026-09-14)

1. Scaffold the real `three-vat` repo (fresh directory, public from commit 1):
   design the public API surface first (`/codebase-design`), record the
   already-made decisions as ADRs (`/domain-modeling`), build the baker core
   test-first (`/tdd` — pure CPU math, assert texel values, bounds, and
   CLI-loader/runtime-hook texture identity). Seed the repo with this report
   as `docs/DESIGN.md`; port the prototype's `vat.js` as reference material,
   not as code to keep.
2. Build the TSL variant of the decode (doubles as the three.js example draft).
3. Forum/issue heads-up for the example; drei discussion issue for the hook —
   only once the showcase demo is presentable.
4. Decisions still open: whether the hook API is `patchMaterial(material)`
   imperative, `<VATInstances>` declarative, or both (leaning both: hook =
   primitive, component = demo-friendly wrapper); normal encoding (full f16
   vs octahedral); crossfade support in v1 or not.

## Competitive landscape check (resolved 2026-09-13)

Verified that agargaro's @three.ez packages do NOT cover VAT:

- `@three.ez/instanced-mesh` (InstancedMesh2): Object3D-like per-instance
  proxies, per-instance culling/BVH/LOD/visibility/uniforms, and "skinning" —
  but its skinning is **bone-texture instancing**: `initSkeleton(skeleton)` +
  `mixer.update(time)` + `setBonesAt(index)`, i.e. per-frame CPU skeleton
  poses per animated instance. No baking, no AnimationClip→texture, no VAT.
- `@three.ez/batched-mesh-extensions`: same treatment for BatchedMesh
  (raycasting/culling/LOD/per-instance uniforms), also no animation baking.

Conclusion: VAT's ecosystem slot is empty; the packages are **complementary**
(a VAT-patched material runs on InstancedMesh2 fine — feature bullet, not
competition). Differentiation line for README/PRs: skinning-instancing (three's
example AND InstancedMesh2) = "CPU poses, GPU renders"; VAT = "GPU everything
after load".

Related but separate idea, parked: Object3D-like ergonomics for BatchedMesh
(`instance.position.x` instead of matrices). Verdict: don't build a package and
don't PR three.js core — contribute proxy parity to agargaro's
batched-mesh-extensions instead (InstancedMesh2 has `.instances[i]` proxies; the
BatchedMesh package appears not to). Whoever builds such a wrapper: use deferred
dirty-flag flush in onBeforeRender (not eager per-component write-through —
position.set() costs 3 setMatrixAt round trips), reuse three's built-in
Euler/Quaternion _onChange, create proxies lazily.

## Sources gathered

- Existing example: https://threejs.org/examples/webgpu_skinning_instancing.html
- TSL docs: https://threejs.org/docs/pages/TSL.html
- DCC bakers: https://extensions.blender.org/add-ons/openvat/ ,
  https://extensions.blender.org/add-ons/vat/ , https://nmancreative.com/ (AutoVAT),
  https://github.com/fuqunaga/VatBaker (Unity),
  https://www.sidefx.com/docs/houdini/nodes/out/labs--vertex_animation_textures-3.0.html
- three.js-side prior art: https://github.com/mikelyndon/r3f-webgl-vertex-animation-textures ,
  https://github.com/topics/vertex-animation-texture ,
  https://github.com/zadvorsky/three.bas ,
  https://discourse.threejs.org/t/animationclip-for-instancedmesh/35685 ,
  https://discourse.threejs.org/t/bringing-soft-and-fluid-body-vertex-animations-from-houdinifx-to-threejs/7411
- CLI precedent: https://github.com/pmndrs/gltfjsx
- Adjacent ecosystem (no VAT): https://github.com/agargaro/instanced-mesh ,
  https://github.com/agargaro/batched-mesh-extensions
- TSL guide: https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/
