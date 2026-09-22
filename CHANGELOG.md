# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **A second encoding: `bakeVAT(root, clips, { encoding: 'rig' })` bakes the
  posed rig instead of the posed vertices**
  ([ADR-0018](./docs/adr/0018-the-rig-encoding-is-a-second-encoding-opt-in-for-now.md)).
  One **slot** per bone — a rotation, a translation and a uniform scale, two
  texels — in a **rig texture** laid out like the position texture, and the
  vertex shader skins the rest-pose geometry from it: two orders of magnitude
  less texture than the vertex encoding on a skinned character, no vertex
  ceiling, and normals and tangents out of the skin matrix with no normal
  texture at all. Everything above the sampling is unchanged — the clip table,
  the pack, the playback texture, `setVATInstance`, `endsAt`, the pose-freeze
  fade, both carriers — and both decode paths render it: WebGL with its depth
  and distance materials patched, TSL through the same node primitives the
  vertex decode uses, skinning position, normal and tangent from the rig
  texture (#52). `VAT` is now `DeltaVAT | RigVAT`; an existing
  `bakeVAT` call keeps returning `DeltaVAT`, and the default stays the vertex
  encoding. What a rig cannot store is refused at the bake by name, before a
  frame is sampled: a morph target whose influence any baked clip animates
  (naming the part, the target and every clip that drives it), and a bone
  some vertex reads, or a rigid part, that a clip scales unevenly. A morph
  influence no clip animates is a pose, folded once into the rest geometry;
  a rigid, node-animated part is one slot of weight one, so a character
  mixing skinned and rigid parts bakes; and slots are keyed by skeleton and
  bind matrix rather than by part, so the meshes of one character on one rig
  share its slots (#53).

## [2.0.0] - 2026-09-21

**Instance playback, and the carrier the pack had to move for.** A crowd's
instances now play different clips, loop different ways, finish at known times
and can be rewritten one at a time after the crowd is built — and because the
pack moved off instanced attributes to do it, a crowd can ride a `BatchedMesh`
and take three.js's own per-instance culling and sorting with it. This
paragraph is the one place every break is listed.
**`VATInstance.timeOffset` is gone**, replaced by `startTime`, an absolute clock
time that may be in the past (`timeOffset: x` becomes `startTime: -x / speed`);
**the pack's layout is three RGBA `vec4`s** — clip, playback and fade — carried
in a playback `DataTexture` keyed by the instance's logical index, where 1.x had
five floats in instanced attributes; **`addInstancedVATAttributes` is removed**,
deprecated since 1.0.0 and writing a pack that no longer exists;
**`addVATInstanceAttributes` is replaced by `createVATPlaybackTexture`**, which
returns that texture rather than mutating a geometry, and which refuses an empty
crowd; **`setVATInstance` takes the playback texture as its first argument**
and not a geometry — the function is new here, but the spec (#32) published the
geometry spelling, so it is listed with the rest; **`image.data` is declared
opaque**, so a narrower encoding (#29) can land as a minor; **Node 20 is the
floor**, where 1.x said 18; and **the peer floor moves to `three >= 0.186`**,
which is where `batchIndirectIndex` is exported and therefore where the TSL path
can find a batched instance's logical index without reading a private field.
The primitives underneath `createVATMesh` move with the pack: **`vatNodes`'
`instancedMesh` option is now `carrier`** and takes either carrier, and
**`patchVATMaterial`, `createVATDepthMaterial` and `vatNodes` take the playback
texture** where the last two took a geometry. Three smaller ones travel with
them: **`createVATMesh` renders the bake's own geometry** instead of a clone, so
two crowds over one bake share a geometry and its bounds and its disposal
follows the bake's; **`VAT.normalTexture` is `DataTexture | null`**, which
TypeScript surfaces at every consumer that reads it; and **the `VATInstance`
alias in `three-vat/webgl` is gone** — import it from `three-vat`.

There is no shim for any of them: the package has no users on the 1.x playback
contract, and two spellings of one field is the drift
[ADR-0009](./docs/adr/0009-both-decode-paths-read-one-instance-playback-contract.md)
exists to prevent.

### Added

- **`setVATInstance(playback, index, instance)` changes one instance's animation
  after the crowd is built** — the event-driven half of instance playback. An
  enemy hit at `t = 12.3s` becomes a dying enemy in one write of one texture
  row, only that row is flagged for upload, and the CPU never touches it again:
  every frame after the write is `resolveVATFrame` of the shared clock. It is a
  function over the crowd's playback texture rather than an `InstancedMesh`
  subclass, so a crowd rendered onto something else writes instances the same
  way
  ([ADR-0014](./docs/adr/0014-changing-an-instance-is-a-function-not-a-mesh-subclass.md)).
  On WebGL that row is one `texSubImage2D`; the WebGPU backend ignores
  `Texture.addUpdateRange` and re-uploads the image, so a change there costs
  48 bytes per instance once per frame in which anything changed — documented
  at [docs/usage.md](./docs/usage.md#what-a-write-costs-per-renderer).

- **`endsAt(instance)` gives the exact clock time a finite animation finishes**,
  or `null` for an endless loop — the moment `resolveVATFrame` first reports
  `finished`. Chaining one clip to the next is therefore a single CPU write
  scheduled at a known time rather than a per-frame poll, and the chain stays
  caller-side: the GPU never learns that a next clip exists.

- **A short fade out of the pose an instance was in**, so a switch mid-animation
  does not pop: pass `fadeDuration` to `setVATInstance` and the pose it was
  holding at `startTime` is frozen into the pack's fade texel and blended away
  over that many wall-clock seconds, on both decode paths alike. It freezes **one phase**
  of the outgoing clip rather than keeping it playing — invisible across the
  tenth of a second a death needs, a visible skate across half a second — so
  `fadeDuration` is capped at `MAX_FADE_DURATION` (0.25s) and the constant
  carries the reason. Provisional by design: a real two-clip crossfade (#30)
  replaces it, and nothing else should be built on the fade texel
  ([ADR-0015](./docs/adr/0015-the-pose-freeze-fade-is-provisional-and-capped.md)).
  `VATFrame` gains `phase`, `fadeRow` and `fadeWeight`, so a caller can ask the
  shader's question about the fade too. See
  [docs/usage.md](./docs/usage.md#changing-one-instance-after-the-crowd-is-built).

- **`bakeVAT` takes an `AnimationAction` wherever it takes an `AnimationClip`**,
  and reads the action's configuration into the clip table as that clip's
  playback defaults. Configure the animation the way three already taught you —
  `action.loop = THREE.LoopOnce` — and every instance that plays it inherits
  "once" from the action and "clamped" from the library, without the caller
  saying either again; an instance still overrides any field it names. `VATClip`
  therefore carries `loopMode`, `repetitions`, `endMode` and `speed` alongside
  its frame band, and every policy field of a `VATInstance` — `speed` included —
  is now optional. An action costs the bake nothing, since it already builds an
  `AnimationMixer` to pose the mesh; a bare `AnimationClip` carries no
  configuration and still needs no mixer at all, taking the library defaults
  (repeat, forever, speed 1, clamping). One rule decides what an action
  contributes: **read configuration, ignore transport state, refuse loudly what
  a VAT cannot represent.** `loop`, `repetitions` and `timeScale` are read;
  `clampWhenFinished` is not, because `false` is what it holds on every action
  three hands out and the bake cannot tell that apart from a caller who said
  nothing — so an action clamps exactly as a bare clip does, and an instance
  names `endMode: EndMode.Rewind` for three's behaviour; `time` and `paused` are
  ignored, because a VAT has no playhead of its own to seed; a non-unit `weight`
  or an additive `blendMode` throws, naming the clip — both describe several
  actions blended at once, which one baked band cannot be. See
  [docs/usage.md](./docs/usage.md#declaring-the-defaults-at-the-bake).

- **`bakeVAT(root, clips, { bakeNormals: false })` bakes positions only**, halving
  the VAT: `verts x frames x 16 B x 2` becomes `x 1`. It is a subtraction, not a
  second encoding — the deltas, the clip table and the bounds are the ones a full
  bake produces — so neither decode path has a new encoding to mirror; each simply
  does not sample or write a normal, and leaves no sampler bound for one. The bake
  is cheaper as well as smaller: the normal's three stages are skipped per vertex
  per frame rather than computed and discarded. Correct
  for the two setups that never read a baked normal: an unlit material, and
  `flatShading: true`, where three derives the normal from screen-space
  derivatives of the *deformed* position, per fragment, which is a better normal
  than the bake could store. Pairing it with a smooth-shaded lit material is
  refused by both `createVATMesh` calls, naming the material and both fixes, rather
  than lighting the crowd by its rest pose (ADR-0002). See
  [docs/usage.md](./docs/usage.md#halving-the-vat-bakenormals-false).

- **`LoopMode` and `EndMode` are exported from `three-vat`** — the numbers
  `THREE.LoopRepeat` / `LoopOnce` / `LoopPingPong` and `clampWhenFinished` name,
  as values an instance's pack can carry, and what each one means — `Once`
  holding its last frame, `PingPong` bouncing rather than wrapping — is
  `resolveVATFrame`, transcribed by both decode paths and invented by neither.
  An instance that says nothing still repeats forever, which is exactly the
  previous behaviour.

- **A VAT crowd can ride a `BatchedMesh`**, on both decode paths, and gets
  three.js's own per-instance frustum culling and depth sorting from it — the
  case the playback texture was moved for, now proven rather than promised
  ([ADR-0016](./docs/adr/0016-the-pack-is-a-texture-keyed-by-instance-not-instanced-attributes.md)).
  `perObjectFrustumCulled` and `sortObjects` stay at their defaults, so the
  drawn slot is a permutation that changes every frame, and each path resolves
  the instance's *logical* index the way three resolves its own: the GLSL decode
  through `getIndirectIndex( gl_DrawID )`, the TSL decode through the
  `batchIndirectIndex` varying — no private field on either side. The carrier is
  named to the primitives (`patchVATMaterial(…, playback, carrier)` on WebGL,
  `vatNodes(vat, { carrier })` on TSL) and `createVATMesh` keeps returning an
  `InstancedMesh` crowd on both paths; `setVATInstance` is unchanged, because it
  writes a row of the playback texture and knows nothing about what draws the
  crowd. **One character per batch**: a VAT is a texture and a sampler is a
  uniform per draw call, so a batch holds one geometry and N instances of it and
  a second geometry is refused rather than left sampling another character's
  rows — and a `BatchedMesh` takes one material, so a multi-material bake stays
  on the `InstancedMesh` carrier. See
  [docs/usage.md](./docs/usage.md#on-a-batchedmesh), and a material patched for
  one carrier and drawn on the other is refused on its first draw rather than
  rendered — without the carrier, a batch plays instance 0's clip on every
  instance and nothing in the picture says so. The parity gate grows three
  checks for it: the two paths agreeing on a batched crowd, and — on each path —
  the crowd being pixel-identical with its draw order reversed, which is the
  stripe test in one number. Its batch carries a fourth instance outside the
  frustum, so three culls it and no drawn slot is its own instance: the culling
  half of the permutation, which is the half ADR-0016 measured as the one that
  broke, and not just the sorting half.

### Changed

- **The peer floor moves to `three >= 0.186`.** `batchIndirectIndex` is the
  symbol that forces it: three exports it from `three/tsl` in r186 and not in
  r185, and without it the TSL path cannot find a batched instance's logical
  index without reading `_indirectTexture` — which ADR-0016's stop condition
  forbids. A carrier that shipped on WebGL alone would have reopened the split
  [ADR-0009](./docs/adr/0009-both-decode-paths-read-one-instance-playback-contract.md)
  closed, so the floor moves and both paths land together.

- **`vatNodes`' `instancedMesh` option is now `carrier`**, and takes either
  carrier — the word `CONTEXT.md` gives the concept, and the one the WebGL
  path's `patchVATMaterial` already used. One option rather than one per
  carrier, because the two things the decode needs from it — whose transform to
  re-apply, and which index to read the pack row at — have to come from the
  same object.

- **A skinned bake poses each skeleton once per frame**, not once per vertex per
  weight, which makes a skinned bake roughly **1.2× faster**
  (`Soldier`, 4 clips, 30 fps: 269 → 239 ms) and takes the skinned-to-rigid cost
  ratio ADR-0010 measured from ~4× to ~3×. `boneWorld × boneInverse` was being
  recomputed inside the per-vertex loop — about 30 000 matrix multiplies per
  frame row on `Soldier` to produce the same 49 answers; it is now 49. The baked
  texels are byte-for-byte what they were, pinned by a digest in
  `src/bake.integration.test.ts`, and nothing about the API or the rigid and
  morph-only paths changes.

- **Instance playback is carried in a `DataTexture` keyed by the instance's
  logical index**, not in instanced attributes: `x = field`, `y = instance`,
  RGBA float, three texels wide — clip (start row, frames, fps, speed),
  playback (start time, loop mode, repetitions, end mode) and fade. Build one
  with `createVATPlaybackTexture(instances)`; `createVATMesh` returns it as
  `playback` beside the mesh and the clock, and both decode paths fetch row
  `gl_InstanceID` / `instanceIndex` out of it.

  A vertex attribute with divisor 1 is indexed by the **drawn slot**, and the
  drawn slot stops being the instance the moment a renderer culls or sorts per
  instance: measured on `@three.ez/instanced-mesh`, the slot-to-instance map
  breaks at slot 2 and a mixed-clip crowd becomes mush; on `BatchedMesh`, which
  is not instanced-drawn at all, every vertex reads element 0 and the whole
  crowd plays instance 0's clip. A row keyed by the logical index is what three
  itself does for the same problem, in `_matricesTexture`
  ([ADR-0016](./docs/adr/0016-the-pack-is-a-texture-keyed-by-instance-not-instanced-attributes.md)).

  The *layout* is unchanged — the pack was already three RGBA-shaped `vec4`s
  (ADR-0009) — which is why not one line of either decode's arithmetic moved.
  `PACK_TEXELS` replaces `PLAYBACK_ATTRIBUTES` as the single spelling of the
  layout. The crowd ceiling becomes `MAX_TEXTURE_SIZE`, 16 384 instances,
  asserted with a message that says so; the texture is `FloatType` and stays
  that way, because a `startTime` in seconds does not survive half precision.

- **`createVATMesh` renders the bake's own geometry instead of a clone of it.**
  The clone existed for the playback attributes and for nothing else, so with
  the pack in a texture two crowds over one bake share one geometry — and its
  all-frames bounds — and its disposal follows the bake's rather than a crowd's.
  `patchVATMaterial`, `createVATDepthMaterial` and `vatNodes` take the playback
  texture where the last two took a geometry.

- **`VAT.normalTexture` is `DataTexture | null`**, which TypeScript surfaces at
  every consumer that reads it. The Web Worker recipe in `docs/usage.md`, which
  rebuilds both textures by hand, is updated alongside.
- **A WebGL VAT material's program cache key now distinguishes the two patches.**
  A normal-less VAT injects a different vertex shader off the same material
  parameters, and the shadow materials have nothing else to tell them apart —
  `createVATDepthMaterial` builds the identical `MeshDepthMaterial` for either
  kind of VAT — so one shared key would have handed a second crowd the first's
  compiled program (ADR-0006).

- **The documentation carries the decisions the code now makes.** Loop mode is a
  playback policy and not bake data, argued at last in
  [ADR-0017](./docs/adr/0017-loop-mode-is-a-playback-policy-not-bake-data.md);
  `docs/adr/` gains an [index](./docs/adr/README.md) so every decision is
  reachable by name; the README carries an **Upgrading from 1.x** note; and the
  `clampWhenFinished` divergence is documented at the option a caller meets —
  a bake clamps where three rewinds, whether it was handed a clip or an action,
  and [ADR-0017](./docs/adr/0017-loop-mode-is-a-playback-policy-not-bake-data.md)
  carries the amendment that made the two agree.

- **Node 20 is the floor** (`engines.node`: `>=20`, was `>=18`). Node 18 has
  been end-of-life since April 2025 and the demo's toolchain never ran on it, so
  the 18 leg of CI tested a runtime nobody ships and could not build the demo.
  The library uses no Node API; the floor only says where a bake is known to
  run in Node or a Web Worker. CI now runs 20 and 22, and the demo's payload
  guard runs on both.

- **The typed array behind a VAT texture's `image.data` is declared not to be
  part of the contract.** Both are `Float32Array` today. Saying so now, in a
  release that is already breaking, is what lets a narrower encoding (#29 —
  half-float deltas, octahedral normals) land later as a minor rather than a
  major. The Web Worker recipe in `docs/usage.md` moves the buffer as an opaque
  view accordingly, and the `VAT` type says the same on its doc comment.

### Removed

- **`VATInstance.timeOffset` is replaced by `startTime`**, an absolute clock time
  in seconds that may be in the past — and **desync is exactly that**: an
  instance that began a moment ago is that far into its clip. One fewer number,
  and the field an event-driven one-shot ("this enemy died at `t = 12.3`") needs
  in order to be expressible at all. Removed outright rather than shimmed: the
  package has no users on the new contract, and two spellings of one field is
  the drift ADR-0009 exists to prevent. Replace `timeOffset: x` with
  `startTime: -x / speed`.
- **A crowd of no instances is refused.** `addVATInstanceAttributes([])` wrote
  three empty attributes and `createVATMesh(vat, [])` gave you a mesh drawing
  nothing; `createVATPlaybackTexture([])` throws instead, because the playback
  texture is one row per instance and there is no zero-row texture. Nothing is
  lost with it: the texture is sized at creation, so an empty crowd could never
  have been grown by `setVATInstance` either — build the crowd at the size it
  may reach and move the unused instances offscreen, as `mesh.count` already
  lets the demo do.
- **`addVATInstanceAttributes` is replaced by `createVATPlaybackTexture`**, with
  no compatibility path. It wrote three `InstancedBufferAttribute`s onto a
  geometry; the pack is a texture now, and an attribute cannot carry it to a
  renderer that culls per instance (ADR-0016). The producer returns the playback
  texture rather than mutating a geometry, which is also what makes
  `setVATInstance`'s first argument honest.
- **`addInstancedVATAttributes` and the `VATInstance` alias in `three-vat/webgl`**,
  deprecated since 1.0.0 — import `VATInstance` from `three-vat`. They wrote a
  pack that no longer exists, so keeping the names would have promised a
  contract this path can no longer read.

### Fixed

- **The TSL crowd drew nothing on WebGPU, and the parity gate said so.** The
  decode built a fresh `int()` conversion for every texture fetch, and the
  second one over `f1` — a `select` the builder hoists into an if/else-assigned
  variable — came out of three r185's WGSL builder without its cast: the
  position fetch read `i32( nodeVar )`, the normal fetch the bare `f32`, and the
  vertex shader failed to compile. On WebGPU an invalid pipeline invalidates the
  whole command buffer, so the crowd was silently dropped and the render target
  kept the previous frame. The two band rows are now built once and shared by
  every fetch on both textures, which is the shape the builder handles, and a
  structural test pins that the position and normal fetches read the same row
  nodes. Found by `node release/parity/check.mjs`, whose "decode paths render
  the same pixels" check is the only one that could have seen it.

[2.0.0]: https://github.com/MikeFernandez-Pro/three-vat/releases/tag/v2.0.0

## [1.0.1] - 2026-09-19

**No published code changed.** This release ships one artifact: the README, as
npm renders it. `src/` differs from `1.0.0` only in three comments, one error
message and the test that pins it, all of which name a script `pnpm run` no
longer holds — nothing that reaches `dist`, and `files` is `dist` alone, so the
three entry points build byte-for-byte the output they built at `1.0.0`. The
version is a patch for that reason, and the release exists because the package
page is the front door for every reader who has not already found the
repository: leaving the old 371-line README live on npm while the repo
carries the rewrite is two front doors disagreeing about what this library is.

### Changed

- **The README is the rewritten one.** 371 lines became 94 visible ones, written
  for a reader who has never heard of a vertex animation texture: the crowd
  moving above the fold, a link to the live demo, install, and a single snippet
  that runs from glTF load to render loop. Nothing was cut — the texture
  ceilings, the measured bake-cost table, the Web Worker recipe, the draw-call
  arithmetic, the by-hand primitives on both decode paths and what 1.0 does not
  do all moved intact to [docs/usage.md](./docs/usage.md), which the README links
  from the section that summarises each ([ADR-0013](./docs/adr/0013-the-readme-is-beginner-first-depth-lives-in-docs.md)).
- **The hero image is a picture of the demo being shipped**, captured from the
  built demo by `node release/hero/capture.mjs` rather than taken by hand, and
  re-captured after the last change to the demo. It is an absolute raw URL, which
  is the one image form both npm and GitHub draw.
- **`docs/` has a front door** — a one-screen index naming each page and the
  reader it is for. The dead prototype reference file and `DESIGN.md` are gone;
  every section of the latter was already an ADR's own subject or had moved to
  `docs/usage.md`, and what no ADR covered survives as
  [docs/landscape.md](./docs/landscape.md).
- **`pnpm run` holds four verbs a person types.** `pnpm run dev` opens the demo
  instead of watch-building the library (that is `build:watch` now), and the
  release plumbing left the table for `node` invocations indexed by
  [docs/releasing.md](./docs/releasing.md) — `node release/parity/check.mjs`,
  `node release/hero/capture.mjs`, `node scripts/fetch-test-assets.mjs`,
  `node scripts/release.mjs`. Breaking for a contributor typing an old script
  name; invisible to anyone installing the package.

[1.0.1]: https://github.com/MikeFernandez-Pro/three-vat/releases/tag/v1.0.1

## [1.0.0] - 2026-09-17

The 1.0 release: **three library surfaces that all work** — the core baker
(`three-vat`), the WebGL/GLSL decode (`three-vat/webgl`) and the WebGPU/TSL
decode (`three-vat/tsl`) — with documentation that is true on both renderers.
The fourth surface, the offline format, is removed. What changed since `0.3.0`
is below; the two breaking entries are the type collapse and that removal.

**Deferred, and named so 1.0 is not read as promising them:** animation
crossfade (an instance cuts between clips, it does not blend), LOD, the
`npx vat-bake` CLI and any file format for it to write, a React/drei hook or
component, and a `bakeVATInWorker` helper — 1.0 ships the Web Worker recipe in
the documentation instead. The reasoning for each is in
[What 1.0 does not do](./docs/usage.md#what-10-does-not-do).

### Added

- **`pnpm parity` — the cross-path pixel-diff release gate.** One bake, rendered through the GLSL decode on `WebGLRenderer` and the TSL decode on `WebGPURenderer` at the same camera, lights and animation time, compared pixel by pixel in a real browser on a real GPU. Everything else in this suite verifies structure — attributes present, node graph builds, materials counted, bundles isolated — and none of it can catch a decode subtly wrong on one path only, which is exactly the risk of shipping two of them ([ADR-0004](./docs/adr/0004-ship-both-glsl-and-tsl-decode-paths.md)). It stays out of pull-request CI on purpose: headless WebGPU is not a dependable target and a flaky gate gets disabled, so it is a required manual step before publishing instead ([docs/releasing.md](./docs/releasing.md)). Every run proves its own tolerance still has teeth by deliberately slipping each path one baked frame and requiring the gate to fail on it, and it separates "the backends shade differently" from "the decodes disagree" by first comparing a rest-pose frame with no VAT in it. The half that decides pass or fail is pure and runs in CI with the rest of the examples suite — which is what lets a gate CI cannot run still be trusted when a human runs it.
- **The demos are live**, at [mikefernandez-pro.github.io/three-vat](https://mikefernandez-pro.github.io/three-vat/) — a WebGL crowd and a WebGPU one, deployed from `main` on every push, and linked above the fold in the README. For a library whose pitch is "one draw call, thousands of characters", a running crowd is worth more than any paragraph. The WebGPU page is also the first real consumer of `createVATMesh` on the TSL path: hold it next to the WebGL page and the VAT section reads the same on both, with nothing shared forcing the resemblance ([ADR-0011](./docs/adr/0011-one-example-per-renderer-duplicated-on-purpose.md)). It asks the browser for a WebGPU adapter before loading anything else and points at the WebGL demo when there is none — `WebGPURenderer` falls back to a WebGL backend on its own, which would have drawn the WebGPU demo through GLSL and said nothing.
- **`createVATMesh(vat, instances)` on the WebGL path.** One call returns a renderable `InstancedMesh` plus the clock that drives it — the baked geometry cloned, the instance-playback attributes written, one patched material per material group, and both shadow-pass materials attached (`customDepthMaterial` for directional and spot lights, `customDistanceMaterial` for point lights) — replacing the block of geometry cloning, attribute wiring, per-material patching and depth-material attachment every user copied out of the README. The shadow materials are the step that wiring by hand most often drops, and the symptom — a crowd whose body animates while its shadow stays in the bind pose — reads as a bug in the bake rather than in the wiring. Instance matrices and `castShadow`/`receiveShadow` stay the caller's, because they are scene decisions. The primitives it composes (`addVATInstanceAttributes`, `patchVATMaterial`, `createVATDepthMaterial`, `createVATUniforms`) are all still exported and unchanged, for rendering onto something other than a plain `InstancedMesh`. The returned `VATCrowd` type lives in core, so the TSL path can return the same one.
- **`createVATMesh` on the TSL path too, with the same signature and the same return.** `three-vat/tsl` exports the call `three-vat/webgl` does, so moving a crowd between `WebGLRenderer` and `WebGPURenderer` is one import line and no other edit — the point at which decode-path parity is something a user can feel rather than something this file claims. The asymmetry is absorbed rather than passed on: the TSL path attaches no depth material, because `positionNode` already feeds the depth pass, and nobody has to know which renderer needs which. Materials are cloned from the bake and carry the whole decode as `positionNode` — the normal with it — so a glTF's own `MeshStandardMaterial` keeps its maps and settings — three converts it to its node twin at build time and takes the nodes with it. Structural parity is now a test (`src/decode-paths.test.ts`): both paths write the same instance attributes from the same array, cull against the same bounds, and hand back a clock driven the same way. Pixel parity is the manual release gate, `pnpm parity`, which ships in this release too (above). The same file pins ADR-0005's bundle isolation by parsing each entry point's import graph — `three-vat/webgl` and `three-vat` reach nothing but `three`, and the walker is itself tested against every import shape that reaches a bundle, the side-effect `import 'three/webgpu'` included.
- **`addVATInstanceAttributes` is exported from `three-vat`.** Instance playback — the per-instance `{ clip, timeOffset, speed }` triple — is one contract owned by the core entry point, instead of a WebGL-only concept the TSL path cannot see. Moving it is what makes the two decode paths able to render the same crowd; the TSL decode reads it too, as of the entry below ([ADR-0009](./docs/adr/0009-both-decode-paths-read-one-instance-playback-contract.md)). The attribute names and layout are documented on the function as the shared contract. Nothing renderer-specific moved with it: the core entry point still imports only `three`, so a WebGL-only consumer's bundle is unchanged.
- **The TSL decode reads instance playback.** `vatNodes(vat, { geometry })` reads the per-instance clip, phase and rate from the same contract attributes the GLSL decode reads, so a single TSL-rendered crowd mixes clips, phases and playback rates — previously a WebGL-only capability the README had to send mixed-clip users away for ([ADR-0009](./docs/adr/0009-both-decode-paths-read-one-instance-playback-contract.md)). Omit `geometry` and the previous behaviour is unchanged: every instance plays `clipIndex`, desynced by a phase hashed from `instanceIndex`. A geometry carrying only part of the contract now throws instead of rendering a crowd frozen in frame 0.
- **The TSL path has automated tests.** Structural node-graph tests run in CI with no GPU: the graph builds, it carries the expected uniform, attribute and texture nodes, it falls back to the hashed desync only when it should, and an out-of-range `clipIndex` throws. These catch a `three` release renaming a TSL primitive, which until now would have shipped silently broken.

### Changed

- **BREAKING against `0.3.0` — `BakedVAT` and `VAT` are one type, `VAT`.** The split existed only so `loadVAT` could return a VAT without geometry; with the loader gone, every VAT carries the `geometry` and `materials` it is indexed by. `bakeVAT` returns the same object it did — this renames a type, it does not change a shape, so `import type { BakedVAT }` becomes `import type { VAT }` and nothing else moves. ADR-0007's four library surfaces are now three: core baker, WebGL decode, TSL decode.

### Deprecated

- **`addInstancedVATAttributes` from `three-vat/webgl`**, along with the `VATInstance` type exported there. Both are re-exported under their old names and are removed in the next minor version — import `addVATInstanceAttributes` and `VATInstance` from `three-vat` instead.

### Removed

- **BREAKING against `0.3.0` — the offline format is gone.** `serializeVAT`, `loadVAT`, `SerializedVAT`, `SerializeOptions`, `VATManifest` and `VATPrecision` are removed from the public API, along with `src/offline.ts` and its tests ([ADR-0010](./docs/adr/0010-drop-the-offline-format-runtime-bake-is-the-library.md)). They were deprecated one release, never worked for a merged bake, and could not be made to without shipping the geometry too: since `0.3.0` a bake merges the whole subtree and the textures are indexed by *that* vertex ordering, so a file holding texels and a manifest can only be rendered by reloading the source glTF and re-running the merge — the work the file existed to save. Cutting it leaves one way to produce a VAT, and one versioned representation of one to maintain. What it bought — bake time at load — is answered by documentation instead: the baker is pure CPU and touches no renderer, so it runs in a Web Worker with the texel buffers transferred back, and the README now carries that recipe plus the measured bake costs (rows, fps and skinned-vs-rigid) to budget against. `bakeVATInWorker` stays deferred; demand should decide it.

### Fixed

- **The TSL decode added its displacement in the wrong space, and its normals in the wrong stage.** A WebGPU crowd had heads, arms and other parts drifting and stretching independently on every instance, while the same VAT rendered correctly through GLSL. Two causes, both about *where* a correct node is evaluated rather than which node it is. First: three applies the instance matrix to `positionLocal` **before** it reads a material's `positionNode` — `NodeMaterial.setupPosition` runs morph, skinning, displacement, batching and `instancedMesh()` and only then assigns from `positionNode`, and `Instance.js` does `positionLocal.assign( instanceMatrix.mul( positionLocal ).xyz )`. So `positionLocal.add( delta )` added a delta baked in the geometry's own space to a position already rotated, scaled and moved into the instance's, and the displacement was never rotated or scaled with the instance it belonged to. The GLSL path is correct because `begin_vertex` adds the delta and `project_vertex` applies `instanceMatrix` afterwards. Second: `normalNode` is built in the **fragment** stage (three reaches it from `normalView` through `builder.context.setupNormal()`) and is expected in **view** space, so a per-vertex object-space VAT normal handed over there skipped both the instance matrix and the normal matrix — and took `vertexIndex` into the fragment stage with it, where `IndexNode` does not return the vertex index at all but turns itself into a varying, so every fragment read a linearly *interpolated* index addressing neither of the vertices it lay between. The decode is now one vertex-stage function that displaces from `positionGeometry`, writes the normal to `normalLocal`, and hands both back to three's own `instancedMesh()` — which is exactly what the GLSL path relies on when it writes `transformed` and `objectNormal` and lets three transform and interpolate them. **`vatNodes` no longer returns a `normalNode`**, because a VAT normal cannot be one; it takes an `instancedMesh` option instead, which `createVATMesh` passes for you. Found by the new cross-path pixel-diff gate — the only check in this repository that could have found it, since every node involved was correct and only its stage and space were wrong.

- **The baker morphs normals.** `bakeVAT` read `morphAttributes.position` and nothing else, so a mesh whose *normals* morph baked the rest normal — correctly carried through the skin and part matrices, and then stored as gospel. three does not ignore them (`morphnormal_vertex` accumulates weighted normal targets under `USE_MORPHNORMALS`), so the same asset lit one way as a `SkinnedMesh` and another as a VAT — a library that ships a whole second texture for lighting filling part of it with the wrong vectors ([ADR-0002](./docs/adr/0002-runtime-texture-encoding.md)). Normal targets now accumulate exactly as position targets do, in both `morphTargetsRelative` modes, before the skin matrix and the part matrix are applied. A mesh with morph positions but no morph normals bakes byte-for-byte as it did; anything with normal targets re-lights, which is why this lands before `1.0` rather than after it.

## [0.3.0] - 2026-09-16

### Changed

- **BREAKING — the unit of a bake is a posed subtree, not a mesh.** `bakeVAT(root, mesh, clips, options)` is now `bakeVAT(root, clips, options)`: the baker walks every `Mesh` under `root`, merges them into one vertex set and records where each vertex ended up in root space ([ADR-0008](./docs/adr/0008-a-vat-bakes-a-posed-subtree-not-a-skinnedmesh.md)). One call now handles a single `SkinnedMesh`, a morph-target mesh, a hierarchy of rigid node-animated parts (three.js `RobotExpressive`), or any mix — with no classification by the caller. Previously a rigid node-animated character baked to all-zero deltas and tripped the library's own "frozen pose" diagnostic.
- **BREAKING — `bakeVAT` returns `BakedVAT`**, a `VAT` plus the merged `geometry` and the ordered `materials`. The merged vertex ordering is the baker's own and the textures are indexed by it, so callers must render `vat.geometry` rather than cloning their source mesh. `materials` lines up with `geometry.groups[].materialIndex`, giving one draw call per material — VAT collapses instance count, not material count.
- `vat.geometry` carries the union-of-all-frames bounding box and sphere, so instances no longer cull mid-animation.
- Example replaced: a `RobotExpressive` crowd, the asset that motivated the posed-subtree bake.

### Added

- **Morph-target baking is applied per part**, alongside skinning, so a subtree mixing skinned, morphed and rigid meshes bakes correctly in one pass.
- `maxTextureSize` bake option, plus `getMaxTextureSize(renderer)` exported from both `three-vat/webgl` and `three-vat/tsl`. Both VAT axes — `vertexCount` (width) and `totalFrames` (height) — are now checked against it. The baker is renderer-agnostic and cannot query the GPU itself, and its conservative `16384` default is a desktop figure: mobile GPUs commonly report 4096 or 8192, so a bake that allocates on desktop could fail on a phone.
- Meshes with interleaved attributes, or with a material array, are now rejected with a named error rather than baking silently wrong data.

### Fixed

- Absolute morph targets (`morphTargetsRelative === false`) measured each target against the partially-morphed vertex instead of the base vertex, skewing the result whenever more than one target was active. glTF targets are always relative, so this never affected a glTF asset.

### Deprecated

- **The offline format.** `serializeVAT`, `loadVAT` and their types still ship but are removed in 1.0 ([ADR-0010](./docs/adr/0010-drop-the-offline-format-runtime-bake-is-the-library.md)). The format stores texels and a manifest but not the geometry, and since this release the textures are indexed by the merged ordering — so a loaded VAT cannot be rendered without re-running the merge, which is the work the file existed to save. The README's claim that a loaded VAT was "interchangeable with a freshly-baked one" is corrected. Bake at runtime; run `bakeVAT` in a Web Worker if load-time bake cost hurts.

[1.0.0]: https://github.com/MikeFernandez-Pro/three-vat/releases/tag/v1.0.0
[0.3.0]: https://github.com/MikeFernandez-Pro/three-vat/releases/tag/v0.3.0

## [0.2.0] - 2026-09-14 — never published

> This version was tagged in the changelog and in `package.json` but **never
> reached npm**; the registry went straight from `0.1.0` to `0.3.0`. Everything
> below shipped in `0.3.0`. Recorded rather than deleted so the version history
> stays honest.

### Added

- **Morph-target baking** — `bakeVAT` now bakes morph-target meshes as well as skinned ones, applying morph then skinning per vertex to match three's own pipeline. This makes the "morph/non-skeletal deformation for free" promise real and unlocks assets like the three.js Flamingo/Parrot/Stork. The `mesh` parameter widened from `SkinnedMesh` to `Mesh` (non-breaking — a `SkinnedMesh` is a `Mesh`).
- `bakeVAT` derives vertex normals from the base geometry when the source ships without a `normal` attribute (some morph assets are position + color only).

### Changed

- `addInstancedVATAttributes` strips the geometry's morph targets, which the VAT supersedes. Besides dropping now-dead buffers, this avoids a crash in three's morph path when the geometry is drawn as an `InstancedMesh` (which has no `morphTargetInfluences`).
- Example replaced: a flat toon-shaded, three-species **bird tornado** with live GUI controls (funnel shape/speed, per-species scale/count, motion toggles) and a CPU/GPU/draw-call perf panel, superseding the soldier crowd-vs-benchmark demo.


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
