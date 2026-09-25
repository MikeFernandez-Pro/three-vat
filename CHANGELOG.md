# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **A vertex-encoded frame spans rows past the texture ceiling**
  ([#86](https://github.com/MikeFernandez-Pro/three-vat/issues/86),
  [ADR-0030](./docs/adr/0030-a-vertex-encoded-frame-spans-rows-past-the-ceiling.md)).
  `bakeVAT` no longer refuses a mesh with more vertices than `maxTextureSize`
  (`vertexCount N exceeds maxTextureSize M; row wrapping is not implemented`).
  A frame's vertices continue onto the next row, the fewest rows that hold
  them, and both decode paths read the texel at column `v mod width`, row
  `frame × rowsPerFrame + v / width`. The robot's 7 214 vertices at a phone's
  4096 bake as two rows of 3 607 a frame. So an asset the rig refuses for an
  animated morph, with more vertices than the ceiling, now bakes on that phone.
- **`vat.rowsPerFrame`** on a vertex-encoded VAT says how many rows a frame
  takes. It is `1` wherever the vertices fit, and then the texture, the GLSL and
  the node graph are exactly what they were. The texture is `totalFrames ×
  rowsPerFrame` tall, so the frame ceiling tightens by the same factor, and a
  refusal says which limit it hit: the frames alone, or the frames at that many
  rows each.
- A frame that spans rows costs one integer modulo and one divide per texel
  fetch, and only in a bake that spans. On an RTX 5080 the idle robot crowd
  drew about 2% slower at two rows a frame than at one, on both renderers. A
  bake that fits one row measured the same as 4.0.0 (ADR-0030). The parity
  gate renders the spanned robot on both paths and requires each path to draw
  it as it draws the one-row bake.

## [4.0.0] - 2026-09-24

**Breaking: the default encoding is the rig, where the asset allows it.** A
bake that names no encoding now bakes the rig encoding, and falls back to the
vertex encoding where the rig encoding refuses the asset
([ADR-0027](./docs/adr/0027-the-default-encoding-is-the-rig-where-the-asset-allows-it.md)).
On Soldier that is 177 kB of texture instead of 7.9 MB, and a bake in
milliseconds instead of seconds. Every asset that baked before still bakes.
Two conditions ADR-0018 set for the flip were measured after it, and ADR-0027
records both. On an Android phone (a Xiaomi Mi 9, WebGL), the rig was 1.28× the
vertex encoding's frame on an asset both fit, and the vertex encoding refused
both shipped assets at the phone's 4096 ceiling, where the rig ran them
([#77](https://github.com/MikeFernandez-Pro/three-vat/issues/77)). On a
normal-mapped asset (Michelle), the rig decode shades as three's own skinning
does on both renderers
([#78](https://github.com/MikeFernandez-Pro/three-vat/issues/78)).

- **The default bake returns the `VAT` union**, not `DeltaVAT`. Narrow on
  `vat.encoding` before reading `positionTexture` or `rigTexture`, or pass
  `encoding: 'delta'` to keep 3.x's behaviour and its narrow type.
  `bakeVATInWorker` follows the same rule.
- **`encoding: 'auto'`** names the default. It falls back only on what the rig
  encoding refuses: an animated morph target, a non-uniform scale, parts
  sharing slots that move apart, and a rig too wide for the texture. A refusal
  both encodings share still throws.
- **`vat.fallback` says why a default bake fell back**, and nothing is printed
  ([ADR-0029](./docs/adr/0029-a-fallen-back-bake-says-why-on-the-vat-not-in-the-console.md)).
  It holds the rig refusal's message on a `DeltaVAT`, and is `null` when
  `'delta'` was asked for by name. `bakeVATInWorker` reports the same. Where
  the vertex encoding refuses too, as it does for a large character on a
  phone's 4096 ceiling, the error names both refusals and carries the rig
  refusal as its `cause`. It used to name only the vertex ceiling, which
  pointed at row wrapping when the fix was, say, an animated morph. The rig
  refusals are reworded so their advice reads right in both places.
- **A bake that throws mid-loop leaves the subtree at rest.** It used to leave
  it posed where it stopped, so a second bake of the same subtree measured its
  deltas from the wrong pose.
- **A bake leaves a geometry without normals as it found it.** It used to add
  a `normal` attribute to your geometry. It now derives normals for the merged
  rest geometry only, as a worker bake always has.
- **`bakeNormals: false` applies only to the vertex encoding**, as before. Pair
  it with `encoding: 'delta'` to be sure it takes effect.
- **The rig encoding draws a mirrored part and a part scaled to zero
  correctly, and refuses a shear**
  ([#79](https://github.com/MikeFernandez-Pro/three-vat/issues/79)). A mirror
  drew as a 180° turn, and a part a clip hid came back at full size. A shear
  whose axes came out one length passed the uniform-scale check; it is now
  refused, so `'auto'` falls back to the vertex encoding for it.
- **A looping clip wraps without a float `mod`.** At a band's last frame, a
  shader's `mod(frames, frames)` can round to `frames` rather than zero, one
  row past the band, and read the next clip's first row. Both decodes now
  wrap, and ping-pong, with a compare
  ([#79](https://github.com/MikeFernandez-Pro/three-vat/issues/79)).
- **A clip that ends on `Clamp` holds its last row across its last frame.**
  Across the final `1 / fps` of a one-shot, or of a finite `Repeat`, it used to
  blend toward its first row, then snap back to the end pose: a death clip
  morphed most of the way back to standing. `resolveVATFrame` and both decodes
  now hold the last row there, with the same row timing, and `wraps` reads
  `false`. Earlier repetitions, an endless `Repeat`, and `Rewind` still wrap
  ([#88](https://github.com/MikeFernandez-Pro/three-vat/issues/88)).
- **The robot examples now draw rig-encoded crowds.** The Soldier pages still
  compare both encodings, and the worker pages bake the vertex encoding on
  purpose.

### Also in this release

**Flat materials can merge into one.** `mergeFlatMaterials: true` collapses
materials that differ only in a flat colour into one material, and moves each
part's colour into the vertices. RobotExpressive then draws once per pass
instead of three times
([ADR-0028](./docs/adr/0028-merging-flat-materials-is-a-bake-option.md)). Off by
default, and a material with a texture is never merged, nor a
`ShadowMaterial`, a node material with a node input, or a material with an
`onBeforeCompile` or `customProgramCacheKey` of its own. Where it merges,
`vat.materials` holds a material you did not create. It works under both
encodings and in `bakeVATInWorker`. A new example pair, `webgl_merged` and
`webgpu_merged`, toggles it on the robot crowd, and the batched examples bake
with it, so their robots wear their colours again in the same number of draws.

**A bake can run in a Web Worker in one call.** `bakeVATInWorker(worker,
root, animations, options)` takes what `bakeVAT` takes, plus the worker, and
resolves with the same VAT, texel for texel, holding your own materials. The
worker module is two lines: import `serveVATBakes` and call it
([ADR-0026](./docs/adr/0026-a-worker-bake-copies-the-subtree-and-calls-bakevat.md)).
The page keeps drawing frames while the worker bakes.

- **The subtree is copied, not moved.** The worker rebuilds it and calls the
  same `bakeVAT`, so there is still one baker. Your scene is only read, and
  textures never cross, so the worker never decodes an image.
- **A refusal rejects the promise** with `bakeVAT`'s own message. A bone
  outside the subtree, a read track with a custom interpolant, and an attribute
  that is neither plain nor interleaved are refused before anything is sent.
  glTF cubic-spline tracks are carried, and so are `Object3D.pivot`,
  `Float16BufferAttribute`, and a mesh with no geometry, which is skipped as
  on the page.
- **Only the tracks the bake reads cross**: transforms, morphs and bones.
  A track on a material's colour or a light's intensity stays on the page, so
  the worker's bare stand-ins do not log three's "wasn't found" error for it
  ([#89](https://github.com/MikeFernandez-Pro/three-vat/issues/89)).
- **The manual Web Worker recipe is gone from `docs/usage.md`.** The helper
  replaces it. Code that moved buffers by hand keeps working, because
  `makeVATTexture` and `makeVATNormalTexture` are unchanged.
- **A new example pair, `webgl_worker` and `webgpu_worker`,** runs one bake in
  a worker and on the main thread while a crowd walks. It prints the longest
  frame each run left.

**A crowd too large for the GPU is refused by name.** `createVATMesh` and
`createVATPlaybackTexture` take a `maxTextureSize` option. Pass
`getMaxTextureSize(renderer)` and a crowd past the real limit throws, naming
the number and where it came from. Left out, the check stays at 16 384, so a
phone reporting 4 096 still takes a crowd of 5 000 and fails at upload
([#85](https://github.com/MikeFernandez-Pro/three-vat/issues/85),
[ADR-0022 amendment](./docs/adr/0022-capacity-is-fixed-when-the-playback-texture-is-made.md)).

[4.0.0]: https://github.com/MikeFernandez-Pro/three-vat/releases/tag/v4.0.0

## [3.1.0] - 2026-09-24

**A position delta is eight bytes, not sixteen** — the other half of the same
narrowing. The position texture is now `RGBAFormat` + `HalfFloatType`, so with
the normal layer below it a vertex-frame costs **10 B where it cost 32 B**
before this release (the demo's three clips, ~35 MB to ~11 MB)
([#73](https://github.com/MikeFernandez-Pro/three-vat/issues/73),
[ADR-0002 amendment](./docs/adr/0002-runtime-texture-encoding.md)). Half-float
is floating point and a delta is *relative*, so the cost is 0.061% of the delta
at every magnitude — 3.91 mm on `RobotExpressive`'s 6.38 m `Dance` throw, 3
microns on a 5 mm finger twitch, and exactly zero at the rest pose — and it is
scale-invariant, so an asset authored in centimetres loses the same fraction.
Neither decode changed by a line: a half-float sampler hands the shader floats,
so unlike the normal layer there is nothing to unpack. What buys the bytes buys
nothing else — the crowd ceiling is still rows against `maxTextureSize`.

- **`vat.positionTexture.image.data` is a `Uint16Array`** of half-floats where
  it was a `Float32Array`, on the same `(row * vertexCount + vertex) * 4`
  offset. As with the normal layer below, the typed array behind a VAT texture
  has not been part of the contract since 2.0, which is why this is a minor.
  Read one back with `DataUtils.fromHalfFloat`, three's own conversion, or move
  the buffer and hand it to `makeVATTexture` — which now takes a `Uint16Array`
  as well as a `Float32Array`, and still not any `TypedArray`. The Web Worker
  recipe in [docs/usage.md](./docs/usage.md#bake-cost-and-baking-in-a-web-worker)
  moves buffers opaquely, so it needs no edit this time.
- **`makeVATTexture` refuses a buffer that disagrees with its `type`.** It
  takes a `Uint16Array` as well as a `Float32Array` now, and the two are
  interchangeable to TypeScript — so a worker recipe that hands back the
  position buffer and names no type would build a float texture over
  half-floats and upload it without complaint. That pairing throws instead,
  naming both arrays.
- **A bake refuses a delta past 65 504**, half-float's ceiling, naming the
  value, the limit and the clip, frame and vertex it was reached at. An asset
  in millimetres with more than ~65 m of travel is the case: three's
  `toHalfFloat` would clamp it to the ceiling behind a console warning, which
  is a crowd with a limb at the horizon rather than a call that failed.
- **The rig and playback textures stay `FloatType`.** A rig texel is a
  quaternion and an *absolute* translation, and a `startTime` in seconds does
  not survive half precision — neither is a delta, so neither inherits the
  reasoning above.

**A baked normal is two bytes, not sixteen.** The normal texture is now
`RGFormat` + `UnsignedByteType`, each texel an **octahedral** unit vector —
8× smaller, and a bake goes from `verts x frames x 32 B` to
`verts x frames x 18 B` (the demo's three clips, ~35 MB to ~20 MB). The cost is
angular: 0.947° worst case and 0.32° mean, measured over `RobotExpressive` and
`Soldier`, bounded by the quantisation grid rather than by the geometry. It
shows as shading and never as geometry, so a silhouette is unchanged
([#29](https://github.com/MikeFernandez-Pro/three-vat/issues/29),
[ADR-0002 amendment](./docs/adr/0002-runtime-texture-encoding.md)). Nothing
above the sampling moved: same stacked bands, same `NearestFilter`, same manual
two-row lerp — and the decode unpacks each texel *before* that lerp, because
two octahedral pairs either side of the fold would interpolate through the
wrong half of the sphere. Position deltas narrowed too, in the same release —
see above.

- **`makeVATNormalTexture(data, width, height)` is new**, and is how the normal
  layer is rebuilt from a transferred buffer — the position, rig and playback
  layers keep `makeVATTexture`. If you bake in a Web Worker, the recipe in
  [docs/usage.md](./docs/usage.md#bake-cost-and-baking-in-a-web-worker) has
  changed by one line; `makeVATTexture` now takes a `Float32Array` rather than
  any `TypedArray`, so a copy that still hands it the normal buffer is a
  TypeScript error rather than a crowd rendering garbage. In plain JavaScript
  it is not caught — check the recipe by hand.
- **`vat.normalTexture.image.data` is a `Uint8Array`**, two bytes a texel
  (`(row * vertexCount + vertex) * 2`), where it was a `Float32Array` of four
  floats. The typed array behind a VAT texture has never been part of the
  contract — `docs/usage.md` and the `VAT` doc comment have said so since 2.0 —
  which is why this is a minor and not a major. Decode a texel with the
  exported **`decodeOctahedral`**; do not read the bytes.
- **`encodeOctahedral` and `decodeOctahedral` are exported.** They are the one
  definition of what a normal texel means, and both shader decodes are
  transcriptions of them, term for term — pinned in `src/octahedral.test.ts`,
  the one seam a test without a GPU can hold.
- `bakeNormals: false` no longer halves a VAT; it drops 2 B of the 10 B a
  vertex-frame costs. It remains the right call for an unlit or flat-shaded
  crowd, and the section documenting it is renamed accordingly.

[3.1.0]: https://github.com/MikeFernandez-Pro/three-vat/releases/tag/v3.1.0

## [3.0.0] - 2026-09-23

**An instance crossfades between two clips, and both of them keep playing.**
`setVATInstance(playback, id, { clip, startTime, fadeDuration })` — the call a
caller already writes — now blends out of a clip that is *still running*
rather than out of a frozen pose: the band the instance is leaving is carried in
its own pack as a full playback state, and the shader mixes the two sampled
poses by a weight it derives from the clock it already reads. One write at the
moment of the transition, nothing per frame afterwards. The pose-freeze fade is
removed rather than kept alongside, `fadeDuration` loses its cap, and both
decode paths resolve the outgoing band through the very same resolver they
resolve the live one with
([ADR-0025](./docs/adr/0025-the-crossfade-is-a-second-live-band-in-the-pack.md)).
This paragraph is the one place every break is listed. **`MAX_FADE_DURATION` is
removed** rather than deprecated — the cap existed only because a frozen pose
skates over anything longer than a tenth of a second, and there is no frozen
pose any more; a negative or non-finite `fadeDuration` is now refused by name at
the write, where an uncapped bad duration would otherwise be a crowd that
quietly never finishes transitioning, and zero and absent stay a cut.
**`VATInstance.from` changes shape**, from a frozen phase to the exported
`VATPlaybackState` — an instance in every respect except that it carries no
transition of its own — which `setVATInstance` fills by reading the row back
whole and which a caller may write by hand. **`resolveVATFrame` returns one
field where it returned two**: `outgoing`, a resolved frame with a weight, or
`null` rather than a weight of zero, so a reader with no interest in transitions
ignores one field instead of testing one; `endsAt` is untouched, and still
answers for the clip the instance is playing. **The playback texture is five
texels wide where it was three** — clip, playback, crossfade, outgoing clip,
outgoing playback, with the duration third so an instance that is not
transitioning reads the three texels it always did — so a row is 80 bytes
rather than 48, and a whole-texture upload on the TSL path costs 27 kB for 340
instances where it cost 16 kB. It stays `FloatType`: there are now two start
times in a row, and a start time in seconds does not survive half precision.

### Added

- **A real crossfade on both decode paths** (#69). The clip an instance is
  leaving keeps playing — keeping its own speed, loop mode and end policy — so
  an outgoing one-shot that runs out mid-transition clamps exactly as it would
  have, and a crossfade out of a finished one-shot leaves from the end pose it
  was holding. The weight is `1 - clamp((time - startTime) / duration, 0, 1)`,
  wall clock, so a half-speed incoming clip does not stretch it. A write over an
  instance that is already mid-transition replaces the outgoing band with the
  one it was switching to and drops the older one at whatever weight it still
  had: the pack holds two bands, and `startTime + fadeDuration` is what a caller
  waits out instead. The rig encoding blends per slot, before the skin matrix is
  composed and with the same hemisphere check the wrap needs, because a
  componentwise blend of two composed matrices shortens a limb as it turns.
- **The crossfade example, one page per renderer** (#71):
  `examples/webgl_crossfade.html` and `examples/webgpu_crossfade.html`, a crowd
  transitioning under a duration a visitor drags.
- **The parity gate compares a frame mid-transition** (#70), and proves it
  catches a wrong crossfade weight on either path.

### Changed

- **The GLSL vertex decode selects the outgoing band rather than branching
  around it** (#72). Measured, not reasoned: the `if` that was supposed to make
  a crossfade free when unused cost an idle crowd of 340 **10%** of its GPU
  frame on WebGL — a branch is not free because it is not taken, since the
  compiler holds registers for the side it skips. Selecting the live pair while
  the weight is zero, as the TSL path already did, puts the idle figure back
  where it was (0.283 ms against 0.282 ms before the crossfade). The rig
  encoding keeps its branch, which guards sixteen dependent fetches per vertex
  rather than two and never went outside the bound. Figures, method and the two
  attempts that did not work are in
  [ADR-0025](./docs/adr/0025-the-crossfade-is-a-second-live-band-in-the-pack.md#the-measurement-the-branch-is-the-one-that-costs).
- **Both decode paths resolve a band through one function of a (clip texel,
  playback texel) pair** (#68), so the outgoing band is a second call rather
  than a second transcription of the resolver's cascade.

### Removed

- **`MAX_FADE_DURATION`**, and with it the frozen-pose type and every fade
  branch in both decodes
  ([ADR-0015](./docs/adr/0015-the-pose-freeze-fade-is-provisional-and-capped.md)
  said nothing should be built on it, and this is that sentence being kept).

[3.0.0]: https://github.com/MikeFernandez-Pro/three-vat/releases/tag/v3.0.0

## [2.1.0] - 2026-09-22

**A second encoding: the rig, opt-in.** `bakeVAT(root, clips, { encoding:
'rig' })` bakes the posed rig — one **slot** per bone, two texels — instead of
the posed vertices, and the vertex shader skins the rest pose from it. On a
skinned character that is two orders of magnitude less texture, a bake in
milliseconds rather than seconds, no vertex ceiling, and a *faster* frame on a
phone; what a rig cannot express is refused at the bake, by name. Nothing about
2.0 changes: the default stays the vertex encoding, an existing `bakeVAT` call
returns the type it always did, and everything above the sampling — the clip
table, the pack, the playback texture, `setVATInstance`, the pose-freeze fade,
both carriers, both decode paths — is the contract 2.0 shipped
([ADR-0018](./docs/adr/0018-the-rig-encoding-is-a-second-encoding-opt-in-for-now.md)).
It arrives with the example that runs it, a parity gate that judges it, and the
usage guide rewritten around two encodings rather than one.

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
- **The parity gate compares a rig-encoded crowd, and reads the browser's
  console** (#57). `node release/parity/check.mjs` now bakes Soldier under
  the rig encoding beside the demo's robot under the vertex encoding, renders
  both through both decode paths in the same room at the same clock, and
  judges the rig case by name: the two paths must agree on it, and a
  deliberate one-frame slip on either path's rig crowd must fail — the one
  fault a rig can be handed, having no normal texture to bend. The gate drives
  the Chrome or Edge this machine has through `playwright-core` (headed, on
  the real GPU) for one reason: a WGSL compile error never reaches a pixel
  verdict — three reports it to the console, the pipeline never builds, and the
  render target keeps whatever frame it held. Every console line is printed,
  and any error fails the gate as its first check. Soldier is served from
  `test-assets/`, so `node scripts/fetch-test-assets.mjs` is now a
  prerequisite of the gate as well as of the real-asset suite
  ([docs/releasing.md](./docs/releasing.md)).
- **The first example: Soldier under an encoding toggle, on both renderers**
  ([ADR-0019](./docs/adr/0019-examples-beside-the-demo.md), #55).
  `webgl_soldier.html` and `webgpu_soldier.html` join the demo beside it, one
  per renderer and duplicated on purpose like the demo's pair. Each bakes
  Soldier — 7 434 vertices over 49 bones — twice at load, under the rig
  encoding and the vertex encoding, and keeps both crowds resident; the demo's
  count slider drives both, and an **encoding toggle** swaps which is drawn.
  The HUD is the demo's, readout for readout, and every figure is measured
  off the live bake or the renderer: the texture's dimensions read
  `slots × frames` under the rig encoding and `verts × frames` under the
  vertex encoding, its memory is the live texture's own bytes, the draw calls
  are the renderer's count for the frame, and both bake times stay on screen.
  The texture panel draws whichever texture is live, with a cursor per
  soldier. Soldier joins the example assets (`examples/public/Soldier.glb`,
  the test suite's pinned bytes, committed because the deployed page loads
  it), and the HUD facts helper, the crowd layout — which now takes which of
  an asset's clips plays each band — and the texture panel take both members
  of the `VAT` union. The HUD contract, deployment and payload guards cover the
  pair through the page table; the root's links are asked to reach its own
  pair rather than every page, since a strip generated from the page table
  (#56) is what reaches the examples.
- **A navigation strip on every page** (#56,
  [ADR-0019](./docs/adr/0019-examples-beside-the-demo.md)). Under each
  page's HUD title: one label per feature — the demo's robot crowd first,
  then each example — and a link per renderer beside it, the current page
  marked. It is generated from the page table (`examples/nav.mjs`) and
  stamped into each page as vite serves it, in dev and in the build alike,
  so no page writes a link list and a page added to the folder appears on
  every strip with nothing edited. The labels are the pages' own `<title>`s,
  whose one convention — `three-vat — <Renderer> <what it shows>` — the
  release suite now holds by name, along with the strip's contract: every
  page listed, the demo first, relative links, exactly one strip. Only a
  page in the table is stamped, so a prototype page beside them still opens
  in dev. The hand-written pair links in the page titles are gone; the HUD
  and deployment guards read the page as served. Still no landing page: the
  root is the WebGL demo, and the hero capture runs unchanged — its frames
  now show the strip under the title, as the deployed demo does.

- **The usage guide is written around two encodings** (#58). It gains
  [the rig encoding](./docs/usage.md#the-rig-encoding-encoding-rig) — what a
  row holds, the option that selects it, what is refused and how each message
  reads, what folds instead of being refused, that `bakeNormals: false` is
  accepted and ignored, that both decode paths and both carriers take it, and
  the example pages that run it — and its **trade-offs** are rewritten around
  the comparison ADR-0018 moved inside the library. The old "vs bone-texture
  instancing: … more fetches per vertex" line is gone: the prototype measured
  the fetch count and found it is not what drives the cost. In its place is the
  measured table, on both platforms — 25.2 MB against 177 kB, a 1.4 s bake
  against 5 ms, 0.46 ms against 0.65 ms on an RTX 5080 and 7.3 ms against
  4.4 ms on an iPhone 15 Pro Max — with the caveat that the desktop figures are
  whole-frame times for a 340-instance scene and the desktop ratio is not "the
  cost of the encoding". The README gains one line pointing a reader with a
  skinned character at the section, and the release suite pins the guide's
  contents list against its own sections and its figures against ADR-0018's
  table, so the two cannot drift.

[2.1.0]: https://github.com/MikeFernandez-Pro/three-vat/releases/tag/v2.1.0

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
  [docs/usage.md](./docs/usage.md#dropping-the-normal-layer-bakenormals-false).

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
