# threeforge, read against three-vat

The question: is [tallslab/threeforge](https://github.com/tallslab/threeforge)
better than three-vat at animation, and if not, what could three-vat take
from it? Everything below about threeforge was read at commit
[`8ac4ceb`](https://github.com/tallslab/threeforge/commit/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d)
(version 0.10.0, 2026-09-21). Every link into its code is pinned to that
commit, so the line anchors stay true. Everything about three-vat was read on
`main` at `37a62d3`. That is the unreleased 4.0 line, where the rig encoding is
the default ([ADR-0027](../adr/0027-the-default-encoding-is-the-rig-where-the-asset-allows-it.md)).

## What threeforge is

threeforge is not an animation library. Its
[package.json](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/package.json#L4)
calls it a "frame-budget compiler and diagnostics for three.js games". It
batches naive scenes, measures every frame cost in a ledger, and explains what
to fix, through a CLI and an MCP server. Animation is one row of the
[README's cost table](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/README.md#L14),
"Skinning". It is shipped as two files in
[`src/skinning/`](https://github.com/tallslab/threeforge/tree/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/skinning),
about 16 kB of source out of a much larger compiler. The ledger's
`skinned-crowd` hint points users at those two files once a frame has 50
skinned draws
([hints.ts#L169-L175](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/ledger/hints.ts#L169-L175)).

So the comparison is narrower than the question implies. three-vat as a whole
is compared with one module of threeforge. Its other modules (static
batching, BVH culling, LOD, the character assembler, the ledger) come in only
where they touch animation.

## The two animation modules

[`bakeAnimationTexture`](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/skinning/bakeAnimationTexture.ts#L52-L145)
plays each clip through an `AnimationMixer` at the chosen fps
([L103-L113](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/skinning/bakeAnimationTexture.ts#L103-L113)).
It copies each distinct skeleton's `boneMatrices` into a `Float32Array`. Those
are three's own `bone.matrixWorld × boneInverse`. The layout is one row per
frame and four RGBA float texels per bone, the columns of a `mat4`
([L34](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/skinning/bakeAnimationTexture.ts#L34),
[L92](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/skinning/bakeAnimationTexture.ts#L92),
[L134](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/skinning/bakeAnimationTexture.ts#L134)).
The input must contain a `SkinnedMesh`, or the bake throws
([L70](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/skinning/bakeAnimationTexture.ts#L70)).

[`AnimatedInstances`](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/skinning/AnimatedInstances.ts#L87-L272)
builds one `Mesh` over an `InstancedBufferGeometry` for each skinned part of
the prototype. Each has a `MeshStandardNodeMaterial` whose `positionNode`
fetches four bone matrices per influence and applies three's skinning formula
([L185-L208](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/skinning/AnimatedInstances.ts#L185-L208)).

In three-vat's vocabulary this is a **rig encoding** with no vertex encoding
beside it. The format is wider (a full `mat4` per bone rather than a
quaternion, a translation and one scale), and the playback model is thinner.

## Dimension by dimension

### Technique

- **threeforge:** a baked bone-matrix texture, skinned in the vertex shader.
  There are no mixers and no skeletons on the CPU after the bake
  ([docs/skinning.md#L41-L54](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/docs/skinning.md#L41-L54)).
  Only skeletal animation is covered.
- **three-vat:** two encodings. The rig encoding stores a quaternion, a
  translation and a uniform scale per slot, in two RGBA float texels
  (`src/rig-texture.ts`). A slot is a bone, or a rigid part standing as a bone
  of weight one. The vertex encoding stores a half-float position delta and an
  octahedral normal per vertex. The default is the rig, falling back to
  vertices when an asset needs them (ADR-0027).

### Bake

- **threeforge:** synchronous and on the main thread, at runtime. It samples
  `mixer.setTime` once per frame per clip, and copies
  `bones × 16` floats per skeleton per frame. That is the same order of work
  as three-vat's rig bake. threeforge publishes no bake timing, so its speed
  is **unverified**. It has no worker path.
- **three-vat:** runtime, from the glTF (ADR-0001). The rig bake of Soldier is
  about 5 ms, and the vertex bake of the same asset is 1.4 s ([usage.md, the two
  encodings measured](../usage.md#the-two-encodings-measured)).
  `bakeVATInWorker` moves either bake off the main thread (ADR-0026).

### Memory per asset

- **threeforge:** `bones × 4 texels × 16 B` per frame, which is 64 B per bone.
  Its own figure for the Kenney mini characters (two 7-bone skeletons, 33
  clips at 30 fps) is a 56 × 450 texture of 400 KB
  ([docs/skinning.md#L27-L29](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/docs/skinning.md#L27-L29)).
  Each clip also stores `ceil(duration × fps) + 1` rows
  ([L88](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/skinning/bakeAnimationTexture.ts#L88)).
- **three-vat:** 32 B per slot per frame under the rig encoding, half of
  threeforge's layout. Slots are also deduplicated across skins that read the
  same bones. For Soldier (49 bones) that is about 3.1 kB per frame in
  threeforge's layout against about 1.5 kB in three-vat's (the arithmetic in
  [landscape.md](../landscape.md#a-second-encoding-the-rig-instead-of-the-vertices)).
  I did not bake the Kenney kit with three-vat, so the halving there is
  arithmetic from the formula, not a measurement (**unverified**).

### Per-instance playback

- **threeforge:** each instance has a `[clipStart, loopRows, timeOffset,
  speed]` instanced attribute, and all instances read one shared `time`
  uniform
  ([L98-L103](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/skinning/AnimatedInstances.ts#L98-L103),
  [L181](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/skinning/AnimatedInstances.ts#L181)).
  - Every clip loops. There is no once, no ping-pong, no repetition count and
    no end mode.
  - The phase is `time × speed + offset`, so changing an instance's speed
    mid-clip makes its pose jump.
  - Frames are nearest-row, with no interpolation: `floor`, then one row
    ([L182](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/skinning/AnimatedInstances.ts#L182)).
    The project's own design notes say this "is not pixel-identical to mixer
    interpolation", and the crowd e2e accepts a similarity of 3 %
    ([design.md#L423-L424](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/docs/design.md#L423-L424)).
  - The per-instance data is an instanced attribute, which is indexed by the
    drawn slot. That is the choice ADR-0016 moved away from.
- **three-vat:** each instance has `{ clip, startTime, speed }` and a playback
  policy (`Repeat`, `Once` and `PingPong`, repetitions, and a `Clamp` or
  `Rewind` end mode), with clip defaults read from an `AnimationAction`
  (ADR-0017). Rows are interpolated in the shader (ADR-0002). The state
  lives in a playback texture keyed by logical index, so `BatchedMesh` culling
  cannot scramble it (ADR-0016). A crowd can reserve capacity and spawn into
  it (ADR-0022).

### Clip blending and crossfade

- **threeforge:** none. Per-instance clip blending is listed under "What it
  does not do"
  ([docs/skinning.md#L56-L58](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/docs/skinning.md#L56-L58)),
  and cross-fading was considered and rejected
  ([design.md#L424-L426](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/docs/design.md#L424-L426)).
- **three-vat:** a crossfade between two clips that are both still playing,
  as a second live band in the pack (ADR-0025). There is still no blend tree.

### Renderer support

- **threeforge:** TSL only. It imports `MeshStandardNodeMaterial` from
  `three/webgpu`
  ([L30](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/skinning/AnimatedInstances.ts#L30)),
  so it runs on `WebGPURenderer` and on that renderer's WebGL2 backend. It has
  no GLSL path for the classic `WebGLRenderer`. The README targets r186's
  `three/webgpu`
  ([README.md#L3](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/README.md#L3)).
  The peer range is `three >= 0.180`.
- **three-vat:** both a GLSL path through `onBeforeCompile` and a TSL path,
  held to pixel parity by a release gate (ADR-0004, ADR-0009).

### Instancing, batching, LOD and culling

- **threeforge's `AnimatedInstances`:**
  - It draws once per part: 200 Kenney characters from 8 prototypes become 16
    part draws plus the ground
    ([docs/skinning.md#L82-L84](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/docs/skinning.md#L82-L84)).
    Its parts are not merged.
  - It sets `frustumCulled = false`
    ([L213](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/skinning/AnimatedInstances.ts#L213)),
    so an animated crowd has no culling at all. The library's BVH culling and
    LOD belong to the static compiler, not to this module.
  - It has no `BatchedMesh` support.
- **three-vat:**
  - One draw per material for the merged subtree, or one draw in total with
    `mergeFlatMaterials` (ADR-0028).
  - Two carriers: an `InstancedMesh`, or a `BatchedMesh`, which gives three's
    own per-instance frustum culling (ADR-0016).
  - No LOD ([usage.md](../usage.md#what-10-does-not-do)).

### Normals and tangents

- **threeforge:** the normal is `mat3(model) × mat3(skin) × normal`
  ([L206](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/skinning/AnimatedInstances.ts#L206)).
  Its docs admit this shades wrongly under non-uniform scale
  ([docs/skinning.md#L64-L65](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/docs/skinning.md#L64-L65)).
  The node never touches `tangentLocal`, so a normal-mapped part with a
  tangent attribute keeps its rest-pose tangent. That follows from reading the
  node, but I did not render it (**unverified**).
- **three-vat:** under the rig encoding, the normal and the tangent both come
  from the skin matrix. A bone scaled non-uniformly is refused at the bake.
  Under the vertex encoding, normals are baked octahedrally and three-vat warns
  about non-uniform scale.

### Morph targets and rigid parts

- **threeforge:** morph targets in the instanced path were rejected
  ([design.md#L426](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/docs/design.md#L426)).
  Only `SkinnedMesh` parts are collected
  ([L66-L69](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/skinning/bakeAnimationTexture.ts#L66-L69)),
  so a rigid, node-animated mesh in the prototype is silently left out.
- **three-vat:** the vertex encoding records morphs and node animation
  (ADR-0008). The rig encoding folds static morph influences into the rest pose,
  treats rigid parts as slots, and refuses animated morphs by name.

### Tooling

- **threeforge:** extensive general tooling: `analyze`, `inspect`,
  `optimize`, `explain` and an MCP server
  ([README.md#L27-L34](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/README.md#L27-L34)).
  None of it bakes animation. The CLI only mentions `bakeAnimationTexture` in
  `explain` text
  ([explain.ts#L111-L128](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/cli/explain.ts#L111-L128)).
  It has no offline animation format either.
- **three-vat:** no CLI and no offline format, both deliberately (ADR-0010).

### API, tests, maintenance and license

- **API.** threeforge's API is small and imperative: `setMatrixAt`,
  `setClipAt(i, name, { offset, speed })` and `setTime`
  ([docs/skinning.md#L31-L39](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/docs/skinning.md#L31-L39)).
  It reads well, but the instance count is fixed at construction and there is
  no one-call equivalent of `createVATMesh`'s carrier-agnostic primitives.
- **Tests.** The animation module has
  [8 unit tests](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/test/unit/animated-instances.test.ts)
  plus [3 bake tests](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/test/unit/bake-animation.test.ts).
  One of them compares every vertex with three's `applyBoneTransform`
  ([animated-instances.test.ts#L111](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/test/unit/animated-instances.test.ts#L111)).
  There is also a
  [GPU e2e that screenshots a mixer-driven original against its instanced twin](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/test/e2e/vat.spec.ts#L38-L95).
- **Maintenance.** The repository's first commit is from 2026-09-13, and it has
  383 commits by one author (`tallslab`). It published 0.1.0 to 0.10.0 in nine
  days
  ([CHANGELOG.md](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/CHANGELOG.md)),
  and is on npm as `threeforge@0.10.0`. The issue tracker has never had an
  issue.
  - The skinning module has
    [eight commits](https://github.com/tallslab/threeforge/commits/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/skinning).
  - The latest,
    [`ad99b53`](https://github.com/tallslab/threeforge/commit/ad99b53af719e3194cba421e4927950dc6d9bf04),
    fixed a loop that drifted 44 % of a character's pixels after one walk
    cycle.
  - It is very active and very young. Nobody else has used it in public yet.
- **License.** MIT
  ([LICENSE](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/LICENSE)),
  the same license as three-vat. Its code may be copied if the copyright
  notice is kept.

## Verdict

**For animation, threeforge is worse, and not by a small margin.** Its
animation module is roughly a subset of three-vat's rig encoding. It stores
twice the memory per bone, and it has no frame interpolation, no loop policies,
no crossfade, no morph or rigid-part support, no GLSL path, no worker bake, no
culling and no `BatchedMesh` carrier. It also draws once per part rather than
once per material. It does not fail on anything three-vat does.

Its trade-offs are genuinely different at the level of the whole library.
threeforge is for someone who has a naive three.js game scene and wants its
frame budget measured and cut, crowds included. For them, `AnimatedInstances`
is a good-enough crowd pass that sits next to a static batcher, a ledger and
an agent CLI. three-vat is for someone whose problem *is* the animated crowd.
The two could be used together (see candidate 5).

## Candidates to adopt

In order of value for cost.

### 1. Make the float32 `mod` at a loop boundary robust

- **What.** threeforge found that a float32 `mod(x, y)` computes
  `x - y × floor(x / y)`, and that shader division is not correctly rounded.
  Just below a multiple of `y`, the quotient can round up and leave a
  remainder a hair below zero. That remainder selects the row before the
  clip's first. threeforge's commit says it measured this through WebGPU on an
  Apple M1 even for whole `y`. The fix is one `select` that moves a negative
  remainder up one period.
- **Where in threeforge.**
  [AnimatedInstances.ts#L175-L182](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/skinning/AnimatedInstances.ts#L175-L182),
  with the reasoning in commit
  [`ad99b53`](https://github.com/tallslab/threeforge/commit/ad99b53af719e3194cba421e4927950dc6d9bf04).
- **Where it fits in three-vat.** The phase uses `fract`, which is safe for the
  non-negative local time it gets. The wrap of the next row still divides:
  `f0.add(1).mod(frames)` in `src/tsl.ts` (`resolveBand`, L523) and
  `mod( f0 + 1.0, frames )` in `src/webgl.ts` (L142). The ping-pong's
  `loops.mod(2)` does too (tsl L500, webgl L132).
  - Here `f0 + 1` and `frames` are whole numbers. A quotient that rounds just
    under 1 gives `f1 = frames`, one row past the band: the next clip's first
    row, or a row outside the texture.
  - The integer wrap can be written as a comparison and a select, with no
    division: `f1 = f0 + 1 >= frames ? 0 : f0 + 1`.
  - Transcribe it into `resolveVATFrame` first, then into both decode paths
    (ADR-0009). That conflicts with no ADR. It has to be a select, not an
    `if`, because a shader branch costs what it skips.
- **Whether three-vat is exposed.** It has not been observed there. This
  repository's parity runs have not covered an M1 (**unverified**).
- **Effort.** An hour, plus a structural test of the node graph.
- **License.** The idea is enough, and the code would be reusable anyway (MIT).

### 2. LOD under the rig encoding, by simplifying the merged geometry

- **What.** threeforge's `generateLods` runs meshoptimizer's simplifier over a
  geometry and "carries other attributes through the vertex remap". That
  includes `skinIndex` and `skinWeight`, since it copies every attribute.
- **Where in threeforge.**
  [src/lod/generateLods.ts#L39-L44](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/lod/generateLods.ts#L39-L44),
  and the simplify call at
  [L71](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/lod/generateLods.ts#L71).
- **Where it fits in three-vat.** A rig-encoded VAT's texture is indexed by
  slot, not by vertex. A simplified copy of `vat.geometry`, keeping its
  slot-remapped skin attributes, could read the same rig texture and the same
  playback texture. That is the "one texture, many meshes" follow-up
  [landscape.md](../landscape.md#a-second-encoding-the-rig-instead-of-the-vertices)
  names and leaves untested. Two ways it could ship:
  - As a `BatchedMesh` of two geometries. This is still one VAT and one
    sampler, so ADR-0002's one-texture-per-draw constraint holds.
  - As an example first, in the spirit of
    [ADR-0023](../adr/0023-a-one-geometry-batch-is-one-draw-on-webgpu-in-the-example-not-the-library.md).
- **What it conflicts with.**
  - The "No LOD" line in [usage.md](../usage.md#what-10-does-not-do). That is a
    documented decision but not an ADR, so this would need a new ADR.
  - A meshoptimizer dependency would weigh on ADR-0005's single-package
    posture. The caller could pass the simplified geometry instead.
  - It is impossible under the vertex encoding, whose texture width is the
    vertex count (ADR-0002).
- **Whether it works.** The `CONTEXT.md` **Carrier** entry says a batch
  carrying a VAT holds one geometry. Whether a `BatchedMesh` with two
  geometries decodes correctly has not been tried (**unverified**).
- **Effort.** Medium: a prototype page, then an ADR.
- **License.** The code may be reused (MIT). The simplifier is meshoptimizer's
  (MIT).

### 3. A GPU reference test against a mixer-driven `SkinnedMesh`

- **What.** threeforge's e2e sets the same clip and time on a mixer-driven
  original and on its instanced twin. It places both under a rotation that
  does not commute with the part offset, screenshots each alone, and requires
  the two to differ by under 3 %. It also checks that the render is visibly lit,
  so the normals matter.
- **Where in threeforge.**
  [test/e2e/vat.spec.ts#L38-L95](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/test/e2e/vat.spec.ts#L38-L95),
  with its scene in
  [test/app/scenes/vat.ts](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/test/app/scenes/vat.ts).
- **Where it fits in three-vat.**
  - three-vat already checks the bake on the CPU against `applyBoneTransform`
    (`src/bake.integration.test.ts`, about L348-L379).
  - Its [parity gate](../releasing.md) compares the GLSL decode with the TSL
    decode. A bug both decodes share therefore passes it: a normal matrix, an
    instance-matrix order, or a shadow pass.
  - A third image, three's own `SkinnedMesh` at the same frame time, would
    catch that. Because three-vat interpolates, the check can use a tighter
    threshold than threeforge's 3 %.
  - It belongs in `release/parity` beside the existing gate, which is outside
    the examples by rule (`CONTEXT.md`, **Parity gate**). It conflicts with no
    ADR.
- **Effort.** Small to medium. The playwright harness already exists.
- **License.** The idea is enough. The harness would be three-vat's own.

### 4. A texture atlas, to extend material merging past flat colours

- **What.** threeforge's `assembleCharacter` resamples every part's `map` (or
  its colour) into equal cells of one atlas. It remaps each part's UVs into its
  cell with an inset, and so draws a character with gear as one material.
- **Where in threeforge.**
  [src/character/assembleCharacter.ts#L152-L181](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/character/assembleCharacter.ts#L152-L181)
  for the atlas, and
  [L214-L223](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/character/assembleCharacter.ts#L214-L223)
  for the UVs.
- **Where it fits in three-vat.** It would be a `mergeTexturedMaterials` bake
  option beside `mergeFlatMaterials`, at the same place in the bake and for the
  same reason (ADR-0028's "an option, not a helper").
- **What it conflicts with.**
  - ADR-0028 defines a mergeable material as holding no texture. Atlasing would
    need its own ADR.
  - An atlas breaks repeating UVs, only resamples `map` and not the other
    maps, and reads pixels on the CPU, which a worker bake cannot do
    (ADR-0026).
- **Effort.** High, for a narrow class of assets.
- **License.** The code may be reused (MIT). Only the idea is likely to fit
  anyway.

### 5. Be legible to threeforge's ledger, for interoperability only

- **What.** threeforge attributes a draw to `vat-instanced` when
  `mesh.userData.forge.kind === 'vat'`
  ([src/ledger/reasons.ts#L166](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/ledger/reasons.ts#L166)).
  It counts a node-sampled texture only if it is listed in
  `material.userData.forgeTextures`
  ([src/memory/resources.ts#L185-L191](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/memory/resources.ts#L185-L191)).
  Without those markers, a three-vat crowd shows up in threeforge's report as
  an unexplained instanced draw, with its texture memory missed.
- **Where it fits in three-vat.** A paragraph in usage.md telling a
  threeforge user which two fields to set is enough. Writing another library's
  private `userData` convention from `createVATMesh` would couple the two, and
  should not happen.
- **Effort.** Minutes.
- **License.** Not applicable.

### Not worth adopting

- The `mat4` texel layout, which is twice the size.
- Nearest-frame playback.
- A shared clock with per-instance offsets. `startTime` is the better model,
  as 2.0 argued.
- One draw per part.
- The instanced-attribute carrier (ADR-0016).

## Sources

threeforge, at commit
[`8ac4ceb`](https://github.com/tallslab/threeforge/commit/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d):

- [README.md](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/README.md),
  [package.json](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/package.json),
  [LICENSE](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/LICENSE),
  [CHANGELOG.md](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/CHANGELOG.md)
- [src/skinning/bakeAnimationTexture.ts](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/skinning/bakeAnimationTexture.ts),
  [src/skinning/AnimatedInstances.ts](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/skinning/AnimatedInstances.ts)
- [docs/skinning.md](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/docs/skinning.md),
  [docs/design.md](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/docs/design.md#L412-L426)
- [src/lod/generateLods.ts](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/lod/generateLods.ts),
  [src/character/assembleCharacter.ts](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/character/assembleCharacter.ts),
  [src/ledger/hints.ts](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/ledger/hints.ts),
  [src/ledger/reasons.ts](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/ledger/reasons.ts),
  [src/memory/resources.ts](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/memory/resources.ts),
  [src/cli/explain.ts](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/cli/explain.ts)
- [test/unit/animated-instances.test.ts](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/test/unit/animated-instances.test.ts),
  [test/unit/bake-animation.test.ts](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/test/unit/bake-animation.test.ts),
  [test/e2e/vat.spec.ts](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/test/e2e/vat.spec.ts),
  [test/e2e/crowd.spec.ts](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/test/e2e/crowd.spec.ts),
  [test/app/scenes/crowd.ts](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/test/app/scenes/crowd.ts),
  [test/app/scenes/vat.ts](https://github.com/tallslab/threeforge/blob/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/test/app/scenes/vat.ts)
- The loop fix, commit
  [`ad99b53`](https://github.com/tallslab/threeforge/commit/ad99b53af719e3194cba421e4927950dc6d9bf04).
  The skinning history is
  [src/skinning commits](https://github.com/tallslab/threeforge/commits/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d/src/skinning).
- Repository metadata (created 2026-09-17, 0 issues ever, one contributor)
  from `gh api repos/tallslab/threeforge`, and the npm version from
  `npm view threeforge`.

three-vat, on `main` at `37a62d3`: [README.md](../../README.md),
[usage.md](../usage.md), [landscape.md](../landscape.md),
[CONTEXT.md](../../CONTEXT.md), [the ADR index](../adr/README.md), and
`src/rig-texture.ts`, `src/tsl.ts`, `src/webgl.ts`, `src/instance-playback.ts`,
`src/vat-texture.ts` and `src/bake.integration.test.ts`.
