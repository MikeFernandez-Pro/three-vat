# InstancedMesh2, read against three-vat

The question: how does
[`@three.ez/instanced-mesh`](https://github.com/agargaro/instanced-mesh)
(`InstancedMesh2`) do levels of detail and animation, how does that compare
with three-vat's levels of detail (ADR-0043) and its animation model, and
would three-vat's decode now work on it? Everything below about InstancedMesh2
was read in its source at commit
[`1909c14`](https://github.com/agargaro/instanced-mesh/commit/1909c146e3ea044345b2b1b2bb2b721c8cf073d5)
(version 0.3.16, committed 2026-10-01), on 2026-10-03. Every link into its
code is pinned to that commit, so the line anchors stay true. Everything about
three-vat was read on `main` at `4530464`, which adds levels of detail (#91).

0.3.16 is also the version the September interop prototype vendored
(`git show d50f63d`, branch `prototype/three-ez-interop`), so that prototype's
findings about the library still describe this code. What has changed since
is three-vat's side.

## What InstancedMesh2 is

A replacement for `InstancedMesh` that culls, sorts and picks a level per
instance on the CPU, then draws the survivors through an indirection
([package.json#L3-L4](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/package.json#L3-L4)).
It subclasses `Mesh` and sets `isInstancedMesh = true` so three's
`WebGLRenderer` draws it instanced
([InstancedMesh2.ts#L205-L208](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/InstancedMesh2.ts#L205-L208)).
Per-instance data lives in square data textures: matrices, colours, custom
uniforms and bones
([InstancedMesh2.ts#L96-L115](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/InstancedMesh2.ts#L96-L115)).
Which instance a drawn slot is comes from one instanced attribute,
`instanceIndex`
([InstancedMesh2.ts#L92-L95](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/InstancedMesh2.ts#L92-L95)).

It is not an animation library. Its animation is three's own skinning, with
the bone matrices moved into a texture keyed by instance. It bakes nothing.

## 1. Levels of detail

### API

- `addLOD(geometry, material, metric, hysteresis)` adds a render level, and
  `addShadowLOD(geometry, metric, hysteresis)` a shadow level
  ([LOD.ts#L183-L222](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/LOD.ts#L183-L222)).
- `setFirstLODMetric`, `updateLOD`, `updateShadowLOD`, `updateAllLOD`,
  `updateAllShadowLOD` and `removeLOD` adjust them
  ([LOD.ts#L63-L139](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/LOD.ts#L63-L139)).
- The metric is a camera distance by default, or a screen-size fraction with
  `useDistanceForLOD: false` at construction
  ([InstancedMesh2.ts#L26-L30](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/InstancedMesh2.ts#L26-L30),
  [L272](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/InstancedMesh2.ts#L272)).
  An orthographic camera refuses the distance mode
  ([FrustumCulling.ts#L162-L164](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/FrustumCulling.ts#L162-L164)).

### How levels are stored

- **Each level is a child `InstancedMesh2`** with its own geometry, created
  in `addLevel` and added under the parent. Two levels given the same
  geometry share one child
  ([LOD.ts#L224-L256](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/LOD.ts#L224-L256)).
  The geometries are whatever the caller passes. Nothing ties a level's
  vertices to the full geometry's, and nothing simplifies for the caller.
- **The children read the parent's per-instance data.** `patchLevel`
  redefines each child's `matricesTexture`, `colorsTexture`,
  `uniformsTexture`, `morphTexture`, `boneTexture`, `skeleton` and bind
  matrices as getters onto the parent
  ([LOD.ts#L384-L444](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/LOD.ts#L384-L444)).
  They also share its `availabilityArray`
  ([InstancedMesh2.ts#L277](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/InstancedMesh2.ts#L277)).
  So an instance keeps its logical id, and with it all its data, on every
  level. That is the same property three-vat gets from `setGeometryIdAt`.
- **Each level has its own index buffer**, a `Uint32Array` of the full
  capacity, uploaded as a raw WebGL buffer
  ([InstancedMesh2.ts#L374-L390](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/InstancedMesh2.ts#L374-L390)).
  The culling pass fills one list per level
  ([FrustumCulling.ts#L360](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/FrustumCulling.ts#L360)).

### How a level is chosen

- **Per instance, every frame, on the CPU**, inside the culling pass that
  `onBeforeRender` runs once per frame and camera
  ([InstancedMesh2.ts#L301-L320](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/InstancedMesh2.ts#L301-L320),
  [FrustumCulling.ts#L194-L202](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/FrustumCulling.ts#L194-L202)).
- **The metric** is the squared distance from the instance's position to the
  camera in distance mode. In screen-size mode it is `r² / (d² tan²(fov/2))`
  under a perspective camera, and `2r / viewHeight` under an orthographic one,
  with `r` the geometry's bounding radius times the instance's largest scale
  ([FrustumCulling.ts#L514-L524](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/FrustumCulling.ts#L514-L524)).
  The level is a linear walk down the levels
  ([LOD.ts#L142-L162](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/LOD.ts#L142-L162)).
- **With a BVH, in distance mode**, the level comes from the BVH traversal
  (`bvh.js`'s `frustumCullingLOD`). It falls back to the walk when the
  traversal returns `null` for a node
  ([FrustumCulling.ts#L419-L433](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/FrustumCulling.ts#L419-L433),
  [InstancedMeshBVH.ts#L220-L244](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/InstancedMeshBVH.ts#L220-L244)).
  How `bvh.js` assigns a node's level is in that dependency, which I did not
  read (**unverified**).
- **The hysteresis has no memory.** In distance mode a level's threshold is
  lowered by `metric × hysteresis`, and the instance's previous level is never
  consulted
  ([LOD.ts#L145-L150](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/LOD.ts#L145-L150)).
  That moves the boundary rather than making a band, so an instance sitting
  on the moved boundary can still flip level every frame. Screen-size mode
  ignores hysteresis entirely
  ([L155-L159](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/LOD.ts#L155-L159)).
  The value is also applied to the *squared* distance
  ([L143](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/LOD.ts#L143)),
  so a hysteresis of 0.1 moves the boundary by about 5 % of the distance, not
  10 %. The file opens with a TODO about exactly this
  ([L4](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/LOD.ts#L4)).
- **With `sortObjects`**, the levels are cut from the sorted list by squared
  distance, and hysteresis plays no part. The code says this path "doesn't
  support screen space LOD"
  ([FrustumCulling.ts#L365-L390](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/FrustumCulling.ts#L365-L390)).

### Draw calls, CPU and shadows

- **One instanced draw per level**, per material group, since each level is
  its own mesh with its own `count`
  ([FrustumCulling.ts#L392-L395](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/FrustumCulling.ts#L392-L395)).
  A three-level crowd is three draws in the colour pass, and three more per
  shadow-casting light.
- **Per-frame CPU**, for each camera that renders the mesh:
  - A linear pass over every instance: a sphere test, then a distance or
    screen metric. A BVH replaces the pass with a tree traversal
    ([FrustumCulling.ts#L462-L512](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/FrustumCulling.ts#L462-L512)).
  - Each level's index list is re-uploaded with `bufferSubData`, 4 bytes per
    drawn instance. It is flagged dirty every frame unconditionally (the code
    says `// TODO improve`)
    ([FrustumCulling.ts#L345-L350](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/FrustumCulling.ts#L345-L350),
    [GLInstancedBufferAttribute.ts#L54-L68](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/utils/GLInstancedBufferAttribute.ts#L54-L68)).
  - The repository publishes no timing for any of this. Its benchmarks cover
    instances, matrices, the BVH and sorting
    ([benchmarks/index.ts#L4-L7](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/benchmarks/index.ts#L4-L7)).
- **Shadow LOD** is a separate list of levels. In the shadow pass the mesh is
  culled against the shadow camera, but the level is measured from the *main*
  camera (`performFrustumCulling(shadowCamera, camera)`)
  ([InstancedMesh2.ts#L285-L299](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/InstancedMesh2.ts#L285-L299)).
  It uses the shadow list if one exists, the render list if not
  ([FrustumCulling.ts#L170-L172](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/FrustumCulling.ts#L170-L172)).
  Sorting is off in that pass
  ([L352-L353](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/FrustumCulling.ts#L352-L353)).
  A shadow-only level gets a placeholder `ShaderMaterial`
  ([LOD.ts#L234](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/LOD.ts#L234)).
  A custom depth material is not shared with the level children. That is an
  open TODO
  ([InstancedMesh2.ts#L15](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/InstancedMesh2.ts#L15)),
  and `patchLevel` forwards no `customDepthMaterial`.

### Against three-vat's levels

| | InstancedMesh2 | three-vat (ADR-0043) |
|---|---|---|
| Carrier | a child mesh per level | one `BatchedMesh` holding every level |
| Draws | one per level and pass | one multi-draw for all levels |
| Level geometry | anything the caller gives | the source's vertices under a simplified index |
| Choosing a level | the library, per frame, by distance or screen size | the caller, with `setGeometryIdAt` |
| Hysteresis | a shifted threshold, no memory | none (the caller's) |
| Shadow levels | yes, chosen from the main camera | no; the shadow pass draws the level the caller set |
| Instance keeps its data | yes, the children read the parent's textures | yes, the id is the playback row |
| Renderers | `WebGLRenderer` only | WebGL and WebGPU |
| Measured | nothing published | 4 096 Soldiers: 6.9 → 2.6 ms (WebGL rig), 4.1 → 1.7 ms (WebGL vertex) at 25 % |

## 2. Animation

### Model

- **`initSkeleton(skeleton)`** allocates one bone texture for the whole
  capacity and sets the skeleton's bones to `matrixAutoUpdate = false`
  ([Skeleton.ts#L24-L41](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/Skeleton.ts#L24-L41)).
  `createInstancedMesh2From` calls it for a `SkinnedMesh`
  ([CreateFrom.ts#L11-L20](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/utils/CreateFrom.ts#L11-L20)).
- **There is one skeleton, posed once per instance.** The caller poses the
  shared skeleton, usually with one shared `AnimationMixer` set to that
  instance's time. `setBonesAt(id)` then walks the bones: `updateMatrix`,
  `matrixWorld = parent.matrixWorld × matrix`, and then
  `matrixWorld × boneInverse` written into the instance's block of the
  texture
  ([Skeleton.ts#L43-L103](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/Skeleton.ts#L43-L103)).
  It is not a mixer per instance. The world matrix is built bone by bone from
  the parent's, so it assumes the `bones` array lists parents before children.
  I did not test a skeleton that does not (**unverified**).
- **The library's own example** shares one mixer and one action across 5 000
  Soldiers. It calls `mixer.setTime(t × speed + offset)` before each
  instance's `updateBones()`
  ([examples/skeleton.ts#L33-L34](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/examples/skeleton.ts#L33-L34),
  [L72-L76](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/examples/skeleton.ts#L72-L76),
  [L113-L114](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/examples/skeleton.ts#L113-L114)).

### Bone texture

- **Layout.** RGBA float, four texels (one `mat4`) per bone, and
  `bones × 4` texels per instance, contiguous, in a square texture
  ([Skeleton.ts#L30](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/Skeleton.ts#L30),
  [L69](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/Skeleton.ts#L69),
  [SquareDataTexture.ts#L47-L49](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/utils/SquareDataTexture.ts#L47-L49)).
  That is 64 B per bone per instance, and it holds the current pose only. For
  Soldier's 49 bones, it is 3.1 kB per instance (arithmetic, not measured).
- **The shader** replaces three's `skinning_pars_vertex` globally. It reads
  bone `i` of instance `instanceIndex` at
  `(bonesPerInstance × instanceIndex + i) × 4`, four texel fetches per matrix
  ([instanced_skinning_pars_vertex.glsl#L10-L26](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/shaders/chunks/instanced_skinning_pars_vertex.glsl#L10-L26),
  [ShaderChunk.ts#L30](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/shaders/ShaderChunk.ts#L30),
  [InstancedMesh2.ts#L471-L478](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/InstancedMesh2.ts#L471-L478)).
  With three's four influences, plus the instance matrix, that is 20 texel
  fetches per vertex, from one pose with no interpolation.
- **Upload.** `setBonesAt` marks the instance's texture row dirty, and the
  next render uploads the dirty rows with one `texSubImage2D` per contiguous
  run
  ([Skeleton.ts#L65](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/Skeleton.ts#L65),
  [SquareDataTexture.ts#L165-L171](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/utils/SquareDataTexture.ts#L165-L171),
  [L226-L237](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/utils/SquareDataTexture.ts#L226-L237),
  [L283-L285](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/utils/SquareDataTexture.ts#L283-L285)).
- **Growth.** `resizeBuffers` resizes the matrices, colours, morph and
  uniforms textures, but not the bone texture
  ([Capacity.ts#L19-L64](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/Capacity.ts#L19-L64)).
  It runs automatically when instances outgrow the capacity
  ([L80-L87](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/Capacity.ts#L80-L87)).
  What a skinned mesh does after growing is therefore **unverified**: I read
  it but did not run it.

### Cost per frame

- **CPU**, for each instance animated that frame: one mixer evaluation over
  every track, then `bones × (updateMatrix + two 4×4 multiplies)`, then that
  instance's row upload. It is linear in animated instances, and the library
  offers nothing to reduce it.
- **Animation LOD is the example's, not the library's.** The example animates
  only instances that pass culling, from the `onFrustumEnter` callback. It
  steps each one at 5 to 60 fps according to its distance. Beyond level 0, it
  skips 36 hand and foot bones by swapping the action's private
  `_propertyBindings` and `_interpolants`, and the mixer's `_bindings` and
  `_nActiveBindings`
  ([examples/skeleton.ts#L7-L19](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/examples/skeleton.ts#L7-L19),
  [L96-L127](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/examples/skeleton.ts#L96-L127)).
  `setBonesAt` takes the skip set as its third argument
  ([Skeleton.ts#L56-L58](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/Skeleton.ts#L56-L58)).
  An instance off screen keeps its last pose until it re-enters.
- **GPU**: three's skinning, read from a texture. The levels share the
  parent's bone texture, so a skinned crowd's levels animate together
  ([LOD.ts#L421-L443](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/LOD.ts#L421-L443)).
- **No figures.** The library publishes no timing for skinning.

### Against three-vat's animation

- **three-vat:** the pose is baked once per clip (ADR-0001). Per instance it
  holds only a playback row (`clip`, `startTime`, `speed`, policy and
  crossfade band) in a texture keyed by logical index (ADR-0016). It has no
  per-frame CPU work and uploads only when an instance's playback changes
  (`setVATInstance`, `addUpdateRange`). Rows are interpolated in the shader.
  ADR-0043 rejected the throttled-update kind of animation LOD for that
  reason: "A VAT crowd has no per-frame CPU cost to cut."
- **InstancedMesh2:** any pose a mixer, IK or game code can produce, unique
  per instance, at a CPU and upload cost paid each frame by each animated
  instance. Its memory scales with instances, and three-vat's with clips.

## 3. Reordering, culling, and three-vat on InstancedMesh2

### How it reorders

- The culling pass writes the logical ids of the instances that survive into
  `instanceIndex.array`, in BVH or sort order. `count` becomes the number
  that survive
  ([FrustumCulling.ts#L279-L340](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/FrustumCulling.ts#L279-L340)).
  Per-instance culling is on by default
  ([InstancedMesh2.ts#L187](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/InstancedMesh2.ts#L187)).
- The vertex shader declares `attribute uint instanceIndex` and fetches the
  matrix from `matricesTexture` at that index
  ([instanced_pars_vertex.glsl#L1-L16](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/shaders/chunks/instanced_pars_vertex.glsl#L1-L16)).
  That chunk is appended to three's `batching_pars_vertex`, and the matrix
  fetch to `batching_vertex`. `project_vertex`, `worldpos_vertex` and
  `defaultnormal_vertex` are patched to accept the indirect define
  ([ShaderChunk.ts#L18-L28](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/shaders/ShaderChunk.ts#L18-L28)).
- So `gl_InstanceID` is the drawn slot and `instanceIndex` is the instance.
  The library makes this exact substitution in three's own code: it rewrites
  `morphinstance_vertex`, replacing `gl_InstanceID` with `instanceIndex`
  ([ShaderChunk.ts#L33-L35](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/shaders/ShaderChunk.ts#L33-L35)).

### Would three-vat's decode work on it today? No, and it fails silently

- **What still works.** This is what the September prototype found, and the
  code is unchanged:
  - `InstancedMesh2` chains the material's `onBeforeCompile` (three-vat's
    patch) before its own. It also chains `customProgramCacheKey`
    ([InstancedMesh2.ts#L440-L479](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/InstancedMesh2.ts#L440-L479)).
  - The VAT column is `gl_VertexID` (`columnOf`), which no reordering touches.
  - The instance matrix still comes from InstancedMesh2's texture, because
    three-vat replaces only `begin_vertex` and `beginnormal_vertex`.
- **What breaks.** `InstancedMesh2` has `isInstancedMesh` and no
  `isBatchedMesh`, so `isBatchedCarrier` answers `false`. `patchVATMaterial`
  then picks `INSTANCE_ID.instance`, which is `gl_InstanceID`, and
  `guardCarrierMismatch` agrees, so nothing is refused. The pack is fetched at
  the drawn slot rather than the instance. Once culling has reordered the list
  (the prototype saw `[0, 1, 20, 21, 40, …]` with 340 robots), every instance
  after the first reordered slot plays another instance's clip, time and
  crossfade. Under levels, slot `s` of level 2 reads row `s` too. This is the
  September failure again, except that it now reads a texture by slot where it
  then read attributes by slot.
- **The pose itself is still right.** The vertex encoding and the rig
  encoding both decode correctly. Only the choice of row is wrong.
- **landscape.md overstates it.** Its sentence "a VAT-patched material
  renders on an InstancedMesh2 fine" holds only with
  `perObjectFrustumCulled = false` and `sortObjects = false`, which keep
  `instanceIndex` the identity.

### What the fix would be

ADR-0016 moved the pack to a texture keyed by logical index, and that is the
change the prototype said interop would need. So the remaining gap is
narrow:

1. **A third spelling of the index.** That means `INSTANCE_ID` gains
   `'int( instanceIndex )'`. The attribute is declared in the chunk appended
   to `batching_pars_vertex`, so it is in scope at `begin_vertex`, for the
   same reason `getIndirectIndex` is. It exists only under
   `USE_INSTANCING_INDIRECT`, which InstancedMesh2's own `onBeforeCompile`
   defines after three-vat's has run
   ([InstancedMesh2.ts#L448](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/InstancedMesh2.ts#L448)).
   Since it is a define, it is resolved at compile time, and the order does
   not matter.
2. **Classification.** Recognise `isInstancedMesh2`
   ([InstancedMesh2.ts#L86](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/InstancedMesh2.ts#L86))
   in `carrier.ts`. Add it to `CARRIER_NAME` and to the program key, since
   the key already carries the carrier. Make `guardCarrierMismatch` refuse an
   `InstancedMesh2` drawn with the plain spelling. Today's silent failure is
   the case that guard exists to catch.
3. **The depth material** needs the same spelling. InstancedMesh2 culls and
   reorders again for each shadow camera, then patches the depth material in
   `onBeforeShadow`
   ([InstancedMesh2.ts#L285-L299](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/InstancedMesh2.ts#L285-L299)).
   Under levels, `customDepthMaterial` has to be set on each child in
   `LODinfo.objects`, because `patchLevel` does not forward it.

That is a few lines of GLSL selection, and none of the arithmetic changes. It
is **not rendered**: no page has checked it (**unverified**). Constraints the
caller would carry:

- **Capacity.** InstancedMesh2 grows its capacity on its own, but three-vat's
  playback texture has a fixed row count (ADR-0022). The playback texture has
  to be created for InstancedMesh2's eventual capacity, or a new id reads past
  it.
- **Reused ids.** `removeInstances` frees ids, and `addInstances` hands them
  out again
  ([Instances.ts#L125-L193](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/Instances.ts#L125-L193)).
  A reused id keeps its old playback row until `setVATInstance` rewrites it.
- **Bounds.** InstancedMesh2 culls by the geometry's bounding sphere
  ([FrustumCulling.ts#L305-L310](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/FrustumCulling.ts#L305-L310)).
  three-vat's bake, loader and `createVATLODs` set that sphere to the
  all-frames bounds (`src/bake.ts`, `src/lod.ts` `bounded`), so no frame is
  culled mid-animation.
- **Levels.** `createVATLODs`'s `levels[l][0]` would work as InstancedMesh2
  levels as they are. Each shares the source's attributes under its own
  index, so `gl_VertexID` is the bake's own number, and the modulo is
  harmless below the width (ADR-0043 says so for `InstancedMesh`). Every
  level reads the same playback row because `instanceIndex` is logical. That
  would give a VAT crowd automatic distance or screen-size levels, and shadow
  levels, at one draw per level, on WebGL.
- **Policy.** ADR-0016 put this package "out of scope permanently". It also
  rejected adopting its `instanceIndex` as the core id source, because that
  would put a WebGL-only, single-maintainer dependency into the contract.
  The fix above takes no dependency. It recognises a flag, as `carrier.ts`
  does for `isBatchedMesh`. But it is a carrier with no TSL path, the
  WebGL-only split ADR-0016's scope section refused for `BatchedMesh`. It
  needs its own ADR either way.

## 4. WebGPU and TSL

None, at this commit. The library is built on `WebGLRenderer` internals:

- The `renderer` parameter is typed `WebGLRenderer`
  ([InstancedMesh2.ts#L48-L53](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/InstancedMesh2.ts#L48-L53)).
- `instanceIndex` is a raw `gl.createBuffer`
  ([GLInstancedBufferAttribute.ts#L35-L45](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/utils/GLInstancedBufferAttribute.ts#L35-L45)).
- Textures upload through `gl.texSubImage2D`
  ([SquareDataTexture.ts#L257-L293](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/utils/SquareDataTexture.ts#L257-L293)).
- The shader work is global `ShaderChunk` edits and `onBeforeCompile`
  ([ShaderChunk.ts](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/shaders/ShaderChunk.ts)).
- It even swaps `renderer.properties.get` during each render
  ([PropertiesOverride.ts#L34-L49](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/utils/PropertiesOverride.ts#L34-L49)).

`src/` contains no `webgpu`, `tsl` or `NodeMaterial`. The peer range is
`three >= 0.186.0`
([package.json#L71-L73](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/package.json#L71-L73)).
For WebGPU, three-vat's own TSL path is what applies, on `BatchedMesh`.

## 5. What to learn, and where three-vat is stronger

### Where three-vat is stronger

- **Draws.** All levels go in one multi-draw (ADR-0043), against one draw per
  level and pass.
- **Measured levels.** ADR-0043 measured 4 096 Soldiers from 6.9 to 2.6 ms
  (WebGL rig) and 4.1 to 1.7 ms (WebGL vertex) at 25 %, pixel-identical
  against a reference, with no cost to a VAT without levels. InstancedMesh2
  publishes no LOD timing at all.
- **Animation cost.** It does no per-frame CPU work for animation, and it
  interpolates rows. InstancedMesh2's crowd pays a mixer evaluation and a
  bone walk per animated instance per update.
- **Memory.** The per-instance state is 80 B (ADR-0025). InstancedMesh2 needs
  `bones × 64 B` per instance, which is 3.1 kB for Soldier, though three-vat
  pays for the bake instead.
- **Renderers.** It has a WebGPU path with parity held by a gate (ADR-0009).
- **Global state.** It patches only its own materials, not three's global
  `ShaderChunk` or `renderer.properties`.

### Where InstancedMesh2 is stronger

- Level choice, culling (linear or BVH), sorting and shadow levels are built
  in.
- Arbitrary, non-baked poses per instance: procedural bones, IK, anything a
  mixer can blend.
- No bake time or bake memory.

### Candidates

In order of value for cost.

1. **A level-choosing recipe in usage.md, with real hysteresis.**
   - **What.** ADR-0043 leaves the choice to the caller and adds no per-frame
     pass. InstancedMesh2's metrics are short and worth copying as a
     documented recipe
     ([FrustumCulling.ts#L514-L524](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/FrustumCulling.ts#L514-L524)):
     squared distance, or `r² / (d² tan²(fov/2))`. Its hysteresis is the
     part not to copy. A band needs the previous level, and the caller
     already has it, since they set it with `setGeometryIdAt`.
   - **Conflicts.** None, as documentation.
   - **Effort.** Small.
2. **Shadow levels.**
   - **What.** Drawing shadows from a cheaper level, chosen from the main
     camera, is the one LOD feature three-vat has no counterpart for. On
     `BatchedMesh` an instance has one geometry id for every pass, so it
     would take a second, shadow-only batch over the same VAT and playback
     texture.
   - **Status.** Whether that is cheaper than it costs has not been
     measured (**unverified**).
   - **Effort.** Medium: a prototype page first.
3. **InstancedMesh2 as a WebGL carrier.**
   - **What.** The three changes in section 3.
   - **Payoff.** WebGL users get the library's automatic levels, shadow
     levels and BVH culling over a VAT.
   - **Conflicts.** ADR-0016's "out of scope permanently" and the
     WebGL-only split. It needs a new ADR, and a render check that is the
     prototype's stripes test, culled.
   - **Effort.** Small in code, medium with the ADR and the check.
   - **Decide.** Even if it is declined, the guard should refuse an
     `InstancedMesh2` carrier by name. Today it renders the wrong clips with
     no error.

### Not worth adopting

- A live skeleton posed per instance in place of the bake.
- A full `mat4` per bone.
- One draw per level.
- Hysteresis without memory.
- Global `ShaderChunk` rewrites.

## Sources

InstancedMesh2, at commit
[`1909c14`](https://github.com/agargaro/instanced-mesh/commit/1909c146e3ea044345b2b1b2bb2b721c8cf073d5)
(shallow clone, `git rev-parse HEAD`):

- [src/core/InstancedMesh2.ts](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/InstancedMesh2.ts),
  [src/core/InstancedMeshBVH.ts](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/InstancedMeshBVH.ts)
- [src/core/feature/LOD.ts](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/LOD.ts),
  [FrustumCulling.ts](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/FrustumCulling.ts),
  [Skeleton.ts](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/Skeleton.ts),
  [Capacity.ts](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/Capacity.ts),
  [Instances.ts](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/feature/Instances.ts)
- [src/core/utils/SquareDataTexture.ts](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/utils/SquareDataTexture.ts),
  [GLInstancedBufferAttribute.ts](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/utils/GLInstancedBufferAttribute.ts),
  [PropertiesOverride.ts](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/core/utils/PropertiesOverride.ts)
- [src/shaders/ShaderChunk.ts](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/shaders/ShaderChunk.ts),
  [instanced_pars_vertex.glsl](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/shaders/chunks/instanced_pars_vertex.glsl),
  [instanced_skinning_pars_vertex.glsl](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/shaders/chunks/instanced_skinning_pars_vertex.glsl)
- [src/utils/CreateFrom.ts](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/src/utils/CreateFrom.ts),
  [examples/skeleton.ts](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/examples/skeleton.ts),
  [benchmarks/index.ts](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/benchmarks/index.ts),
  [package.json](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/package.json)
- The README only to locate the API
  ([README.md#L193-L221](https://github.com/agargaro/instanced-mesh/blob/1909c146e3ea044345b2b1b2bb2b721c8cf073d5/README.md#L193-L221)).

three-vat, on `main` at `4530464`: `src/lod.ts`, `src/carrier.ts`
(`assertVATCarrier`, `assertLODCarrier`), `src/webgl.ts` (`columnOf`,
`texelOf`, `INSTANCE_ID`, `guardCarrierMismatch`), `src/tsl.ts`
(`instanceIdOf`, `vertexDecode`), `src/instance-playback.ts`,
[ADR-0043](../adr/0043-a-level-of-detail-repeats-the-vertices-and-the-decode-wraps-the-column.md),
[ADR-0016](../adr/0016-the-pack-is-a-texture-keyed-by-instance-not-instanced-attributes.md),
[landscape.md](../landscape.md), and the interop prototype, commit `d50f63d`
on `prototype/three-ez-interop` (`prototype-three-ez/README.md`). three's
`isInstancedMesh` → `USE_INSTANCING` mapping was checked in
`node_modules/three/src/renderers/webgl/WebGLPrograms.js` (r186, L124, L209).
