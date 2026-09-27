# Shipping a crowd

The README gets one crowd on screen. This page is for the reader who already has
one and now has to make it survive a real project: texture ceilings, bake cost,
draw-call arithmetic, the shape of the API underneath `createVATMesh`, and what
the library deliberately does not do.

Nothing here is true on one renderer and false on the other. Where WebGL and
WebGPU genuinely differ — shadow materials, the clock's type, what the TSL node
builder needs to re-apply instancing — it is called out where it arises.

Two things worth knowing about how that claim is kept honest. The baker and the
WebGL decode are covered by tests; the TSL path is tested **structurally**,
because CI has no GPU, and that the two paths decode *pixel-identically* is a
manual gate a human runs before every release ([the parity
gate](./releasing.md)). And `WebGPURenderer` falls back to a WebGL backend on
its own when there is no adapter — silently, so a WebGPU page that does not
check for one first may be drawing through GLSL while claiming otherwise. The
demo's WebGPU page checks before it loads anything else, and so should yours.

- [Loading FBX](#loading-fbx)
- [Texture ceilings](#texture-ceilings)
- [Dropping the normal layer: `bakeNormals: false`](#dropping-the-normal-layer-bakenormals-false)
- [The rig encoding: `encoding: 'rig'`](#the-rig-encoding-encoding-rig)
- [Draw-call arithmetic](#draw-call-arithmetic)
- [Bake cost, and baking in a Web Worker](#bake-cost-and-baking-in-a-web-worker)
- [Checking an asset from the command line](#checking-an-asset-from-the-command-line)
- [Baking at build time: `loadVAT`](#baking-at-build-time-loadvat)
- [Loop modes: once, twice, back and forth](#loop-modes-once-twice-back-and-forth)
- [Declaring the defaults at the bake](#declaring-the-defaults-at-the-bake)
- [Changing one instance after the crowd is built](#changing-one-instance-after-the-crowd-is-built)
- [By hand, on either path](#by-hand-on-either-path)
- [A crowd that spawns and dies](#a-crowd-that-spawns-and-dies)
- [Your own GLSL after the decode](#your-own-glsl-after-the-decode)
- [Beside threeforge's ledger](#beside-threeforges-ledger)
- [Trade-offs](#trade-offs)
- [What 1.0 does not do](#what-10-does-not-do)

## Loading FBX

FBX is the second supported format beside glTF
([ADR-0031](./adr/0031-gltf-and-fbx-are-the-supported-formats.md)): the scene
`FBXLoader` builds
bakes as it is, under either encoding, and the suite holds that to three's own
skinning on two pinned FBX files. Two things are worth doing between the load
and the bake.

```js
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const root = await new FBXLoader().loadAsync('/character.fbx')
root.traverse((o) => {
  if (o.isMesh) o.geometry = mergeVertices(o.geometry)
})
const clips = root.animations.filter((clip) => clip.name !== 'Take 001')
const vat = bakeVAT(root, clips)
```

**Run `mergeVertices` first.** `FBXLoader` never builds an index: every
triangle gets three vertices of its own, so a Mixamo character arrives with
about five times the vertices it has — three.js's `Samba Dancing.fbx` is 165 960
as loaded and 35 440 merged. Every instance pays for those, and under the vertex
encoding the texture is that much wider and that much slower to bake. The
baker will not merge for you, because vertex order is the caller's: a merge
renumbers the vertices your own attributes and code may index by.

**Filter out `Take 001`.** Mixamo exports carry an empty clip by that name
beside the real one — no tracks, no duration. It is the FBX cousin of the
`TPose` advice in the README: a clip that animates nothing should not cost a
band of texture rows, so leave it out of the list you bake.

## Texture ceilings

A VAT is a flat texture pair, a frame to a row and every clip stacked, so
**both** axes are bounded by the GPU's max texture dimension. The baker is
renderer-agnostic and defaults to a conservative `16384`; pass the real limit
whenever you have a renderer, or a bake that allocates on desktop can fail on
mobile (commonly 4096–8192):

```ts
import { bakeVAT } from 'three-vat'
import { getMaxTextureSize } from 'three-vat/webgl' // or 'three-vat/tsl'

const vat = bakeVAT(gltf.scene, clips, {
  fps: 30,
  maxTextureSize: getMaxTextureSize(renderer),
})
```

Under the vertex encoding the width is your vertex count, up to the ceiling.
Past it, a frame spans as many rows as it needs, so a 7 214-vertex robot at a
phone's 4096 bakes two rows a frame, each 3 607 wide
([ADR-0030](./adr/0030-a-vertex-encoded-frame-spans-rows-past-the-ceiling.md)).
`vat.rowsPerFrame` says how many; it is `1`, and the texture is laid out as it
always was, wherever the vertices fit. The height is every frame of every clip
times that, so the height axis is the one you steer: fewer clips, or a lower
`fps`. A bake that runs out of rows says whether the frames alone did, or the
frames at so many rows each.

A frame that spans rows costs frames, and a little frame time. The two decode
paths add one integer modulo and one divide per texel fetch, and only for a
bake that spans: on desktop the idle robot crowd drew about 2% slower at two
rows a frame than at one, on either renderer, and a bake that fits one row
draws exactly as it did (the figures are in the ADR).

## Dropping the normal layer: `bakeNormals: false`

A vertex-encoded VAT costs `verts × frames × (8 B + 2 B)` — two layers,
positions and normals. The option belongs to that encoding: a rig-encoded VAT
has no normal layer to drop, so the snippet names the encoding. A position delta is four half-floats — floating point, so what it
loses is 0.061% of the delta and nothing at all at the rest pose; a normal is a
unit vector, stored as an octahedral pair of unsigned bytes — an eighth of what
four float channels cost it, for under a degree of angular error
([ADR-0002](./adr/0002-runtime-texture-encoding.md)). `fps` and clip count
steer the `frames` term. The other dial is the `+ 2 B`:

```ts
const vat = bakeVAT(gltf.scene, clips, { encoding: 'delta', bakeNormals: false })
// vat.normalTexture === null
```

Nothing else changes: same deltas, same clip table, same bounds. It is a
subtraction, not a second encoding, so neither decode path has anything new to
mirror — they simply do not sample or write a normal, and no sampler is left
bound for one. The bake gets cheaper too, not just smaller: the normal's three
stages — morph accumulation, the skin matrix, the part matrix — are skipped per
vertex per frame rather than computed and thrown away.

**Two setups are entitled to it**, and one of them is *better* without a baked
normal:

- **Unlit** — `MeshBasicMaterial`, and its node twin — never reads a normal, so
  the texture was pure waste.
- **`flatShading: true`** makes three derive the normal from screen-space
  derivatives of the **deformed** position, in the fragment stage. That is the
  correct normal for the posed mesh, computed for free; the baked one is not
  merely unnecessary there, it is redundant work. This is the documented
  pairing.

```ts
// The pairing to reach for: one layer fewer, and correct deformed normals.
for (const material of vat.materials) material.flatShading = true
const { mesh, time } = createVATMesh(vat, instances)
```

**A smooth-shaded lit material is refused, loudly.** Without a baked normal it
would light the crowd by its *rest-pose* normals — visibly wrong, and silent,
because the merged geometry still carries a rest normal for three to shade
with. That is the failure `bakeVAT` exists to prevent
([ADR-0002](./adr/0002-runtime-texture-encoding.md)), so both `createVATMesh`
calls throw rather than render it, naming the material and both fixes. Building
by hand on the TSL path is the one place the check cannot reach you: `vatNodes`
never sees your materials, so it writes no normal and says nothing.

`vat.normalTexture` is therefore `DataTexture | null`, which TypeScript will
point out at every consumer of your own that reads it.

## The rig encoding: `encoding: 'rig'`

A VAT records where a vertex ended up and never how it got there. That is the
**vertex encoding**, and the reason one `bakeVAT` call takes a skinned
character, a morph-target mesh and a hierarchy of rigid parts alike. The rig
encoding gives that up on purpose. A row holds the posed **rig** instead of
the posed vertices: one **slot** per bone — a rotation, a translation and a
uniform scale, two texels — in a **rig texture**, and the vertex shader skins
the rest-pose geometry from it, the way three's own skinning shader skins from a
bone texture. It is chosen per bake, for the whole subtree
([ADR-0018](./adr/0018-the-rig-encoding-is-a-second-encoding-opt-in-for-now.md)),
and since 4.0 it is the default wherever the asset allows it
([ADR-0027](./adr/0027-the-default-encoding-is-the-rig-where-the-asset-allows-it.md)).
Naming it pins it:

```ts
const vat = bakeVAT(gltf.scene, gltf.animations, {
  encoding: 'rig',
  fps: 30,
  maxTextureSize: getMaxTextureSize(renderer),
})
// vat.encoding === 'rig', and TypeScript narrows on it: `vat.rigTexture` is
// `slotCount × 2` texels wide and one row per baked frame, `vat.slotCount` is
// the rig's width, and there is no position or normal texture to read.
```

Everything above the sampling is untouched — the clip table, the pack, the
playback texture, `setVATInstance`, `endsAt`, the crossfade — so a
rig-encoded crowd is built, driven and rewritten exactly as the crowd in the
README is, on both decode paths and on both carriers. `createVATMesh` takes it
from `three-vat/webgl` and from `three-vat/tsl`; a `BatchedMesh` crowd reaches
it through the same primitives ([by hand, on either
path](#by-hand-on-either-path)); the crowd casts shadows on both paths, the
WebGL one through the depth and distance materials `createVATMesh` attaches and
the TSL one through its `positionNode`, which the depth pass reads anyway. What
changes is the sampling and the numbers, not the API.

Seen running, on the asset it was measured on:
**[WebGL](https://mikefernandez-pro.github.io/three-vat/webgl_soldier.html)** and
**[WebGPU](https://mikefernandez-pro.github.io/three-vat/webgpu_soldier.html)**
bake `Soldier.glb` twice at load, under both encodings, and toggle which crowd
is drawn while the count slider drives them (`examples/webgl_soldier.html` and
`examples/webgpu_soldier.html`;
[ADR-0019](./adr/0019-examples-beside-the-demo.md)).

### What it buys

Measured on Soldier — 7 434 vertices, 49 slots, three clips at 30 fps — on
branch `prototype/bone-encoding`, and tabled in full under
[trade-offs](#trade-offs):

- **Two orders of magnitude less texture:** 25.2 MB of position and normal
  texture becomes 177 kB of rig texture, because the rig is what the vertices
  were computed from and it is 49 slots wide where they are 7 434. (That bake
  is 7.9 MB today — both layers narrowed, in
  [#29](https://github.com/MikeFernandez-Pro/three-vat/issues/29) and
  [#73](https://github.com/MikeFernandez-Pro/three-vat/issues/73) — which is
  the same argument with a smaller number; see the note under
  [trade-offs](#trade-offs).)
- **A bake in milliseconds:** 1.4 s becomes 5 ms. The per-vertex loop the vertex
  encoding runs once per vertex per frame is hoisted out of the vertex entirely
  — the slot never depended on it — so the bake stops being a page freeze and
  the Web Worker recipe below stops being the answer to it.
- **The width stops mattering.** A vertex-encoded VAT is `vertexCount` wide,
  and past the ceiling each frame [spans several rows](#texture-ceilings), which
  divides the frames it can hold by as many. A rig texture is `slotCount × 2`
  wide — 98 texels for Soldier — so the width axis stops being a ceiling anyone
  meets, and the height axis (every frame of every clip) is the only one left to
  steer. It is
  checked against `maxTextureSize` the same way, and a rig wide enough to exceed
  it is refused naming the width and the slot count.
- **No normal texture, and none missing.** Normals and tangents come out of the
  skin matrix, as in three's own skinning, so a `normalMap` needs nothing baked
  for it.

### What it refuses, and what it folds

The price of a rig-shaped row is that a rig cannot express everything a glTF
can. What it cannot is **refused at the bake, by name, before a frame is
sampled** — the same posture as a non-unit `weight` or a smooth-shaded lit
material over a normal-less VAT — and never approximated:

- **A morph target whose influence a baked clip animates.** A slot moves a bone;
  a morph moves vertices where no bone does, so there is nothing to store it in.
  The refusal names the part, the target and every clip that drives it:

  ```
  three-vat: the rig encoding cannot bake this subtree: clips "flap", "flapAndSwing"
  animate morph target "flapper" of part "bird", its vertices moving where no bone
  does. A slot stores a rotation, a translation and one scale, not a per-vertex delta,
  and the vertex encoding (`encoding: 'delta'`) stores what a rig cannot
  ```

- **A bone, or a rigid part, that a clip scales unevenly, or that a parent
  shears** — quaternion plus one scale cannot store it, and the vertex encoding
  only approximates its normals anyway. A shear is caught even when the sheared
  axes come out one length, as an uneven parent scale over a rotated child can
  leave them. Named the same way, with the clip it happens in:

  ```
  three-vat: bone "arm" of "body" animates with non-uniform scale in clip "squash",
  which the rig encoding cannot store — a slot is a rotation, a translation and one
  scale, and the vertex encoding (`encoding: 'delta'`) stores what a rig cannot.
  Authored with a uniform scale, it bakes as a rig
  ```

Three shapes that look like refusals are not:

- **A morph influence no baked clip animates is a pose, not animation.** It is
  folded once into the rest geometry and the part skins normally — which is why
  the demo's `RobotExpressive` rig-bakes with all fourteen of its clips, every
  one of which carries a head morph track held flat at zero. An influence held
  at one value in one clip and another in the next is two poses, and is refused
  like a ramp.
- **A rigid, node-animated part is one slot of weight one** — Houdini's *rigid
  VAT*, and why the word here is *slot* and not *bone* — so a character mixing
  skinned and rigid parts bakes as one rig. Slots are keyed by the bone and the
  chain it is read through rather than by the part, so the meshes of one
  character on one rig share its slots: Soldier's body and visor come to 49
  slots, not 51.
- **A mirrored part, or one a clip scales to zero.** A negative scale is still
  one scale: the mirror rides in its sign, and the rotation stays a proper one.
  A part scaled to nothing keeps its last rotation at scale zero, so a clip that
  hides a part hides it
  ([#79](https://github.com/MikeFernandez-Pro/three-vat/issues/79)).

`bakeNormals: false` is **accepted and ignored**, not refused: there is no
normal texture to drop, and punishing the caller who switched encodings and left
their options alone would be the worse answer. A rig-encoded VAT has no
`normalTexture` at all, so the smooth-shaded-lit refusal that guards a
normal-less vertex VAT has nothing to guard here.

### Which one to reach for

Usually neither: the default, `encoding: 'auto'`, bakes the rig where the asset
allows it and falls back to the vertices where the rig encoding refuses it —
the two refusals above, parts that share slots moving apart, or a rig too wide
for the texture. It falls back on nothing else: a refusal both encodings share
still throws. Read `vat.encoding` to learn which one a bake chose. The default
bake's type is the `VAT` union for that reason; name an encoding to get the
narrow member back.

**A fallback says why on the VAT, and prints nothing**
([ADR-0029](./adr/0029-a-fallen-back-bake-says-why-on-the-vat-not-in-the-console.md)).
`vat.fallback` holds the rig refusal's message, the same one `encoding: 'rig'`
would have thrown, naming the morph, the clip and the part. It is `null` when
you asked for `'delta'` by name, and a rig-encoded VAT has no such field:

```ts
const vat = bakeVAT(gltf.scene, gltf.animations, { maxTextureSize: getMaxTextureSize(renderer) })
if (vat.encoding === 'delta' && vat.fallback) console.info(vat.fallback)
```

The console stays quiet because an asset that animates a face's morphs is an
ordinary asset, and the vertex encoding is the right one for it. Where the
vertex encoding then refuses too, the bake throws one error naming both
refusals, with the rig refusal as its `cause`. That is rarer than it was: a
character with an animated morph and more than 4096 vertices now bakes on a
phone's 4096, each frame spanning rows, and it is refused only where its frames
at that many rows each run out of height. There the rig's reason is still the
one to fix. `bakeVATInWorker` reports the same `fallback`; its rejection
carries the combined message but not the `cause`, which does not cross the
worker.

Name one when you need to know in advance. Ask for `'rig'` when a fallback
would be a bug — a crowd that has to fit a phone's memory should refuse loudly
rather than quietly grow by two orders of magnitude. Ask for `'delta'` when a
1.4× desktop frame ratio matters more than the memory, or when you want every
asset baked the same way whatever it is. The measured numbers behind that, on
both platforms, are under [trade-offs](#trade-offs), and
[ADR-0027](./adr/0027-the-default-encoding-is-the-rig-where-the-asset-allows-it.md)
records what the flip was decided on and what was still unmeasured.

**On phones, measure; there is no rule.** Pass the renderer's own
`maxTextureSize`, and bake on the target device. Pin `'delta'` only where it
both fits and is measured faster there. The two phones measured so far
disagree. On an iPhone 15 Pro Max the rig was the faster decode, 0.6× the
vertex encoding's frame for Soldier. On a Xiaomi Mi 9 (Adreno 640, WebGL, a
4096 ceiling) it was the slower one on the Fox sample, which both encodings fit:
16.4 ms against 12.9 ms at 340 instances, 1.28×. On that same phone the vertex
encoding refused Soldier and the robot outright, and the rig ran both. That was
before a frame could span rows; both now bake there under the vertex encoding
too, two rows a frame, and neither has been measured there that way. Two
phones from two vendors, on different assets, are not a pattern
([ADR-0027](./adr/0027-the-default-encoding-is-the-rig-where-the-asset-allows-it.md#android-measured-after-the-flip)).

## Draw-call arithmetic

**Materials are never merged unless you ask.** `vat.materials` lines up with
`vat.geometry.groups`, giving one draw call per material. VAT collapses
*instance* count, not *material* count — a 500-robot crowd with 3 materials is
3 draw calls, not 1 and not 500.

That is the whole cost model: the draw calls are the number of materials on the
source subtree, and adding instances adds none.

A mesh whose `material` is an array — a hand-built scene, an FBX or OBJ load,
`mergeGeometries(..., true)` — bakes one part per geometry group, each keeping
the material its group draws. The vertex encoding bakes it to the texels the
mesh split by hand into one mesh per material would, with two differences, both
things the split loses. Normals the mesh ships without are derived over the
whole mesh, so an edge two groups share is lit by the faces on both sides of
it. Under the rig encoding the groups of a rigid mesh read its one slot, where
the split's meshes would take one each. `GLTFLoader` never produces a material
array, emitting a mesh per primitive. An array whose geometry has no groups, or
a group drawing a material the array does not hold, is refused, naming the mesh
and the group.

### Merging flat materials: `mergeFlatMaterials`

When the materials differ only in their colour, the bake can make them one:

```ts
const vat = bakeVAT(gltf.scene, gltf.animations, { mergeFlatMaterials: true })
// RobotExpressive: vat.materials.length === 1, where it was 3
```

A material is **flat** when it has a `color`, no texture of any kind, and
`vertexColors` off, and when that colour is all it draws. So a
`ShadowMaterial` is not flat, nor is a node material with any node input
(`colorNode`, `outputNode` and the rest), nor a material whose shader you hooked
with `onBeforeCompile` or `customProgramCacheKey`, since the merged clone would
drop the hook. Two or more flat materials that agree on everything else —
type, roughness, metalness, emissive, side, opacity and the rest — become one
clone of the first, white, with `vertexColors` on. Each part's colour moves into
the merged geometry's `color` attribute, and three multiplies the two back
together when it shades. A flat material with nothing to merge with, and any
material that is not flat, is left exactly as it was.

It is off by default because it only ever helps flat-shaded assets: a textured
character has nothing to merge. Where it does merge, `vat.materials` holds a
material you did not create, named after the ones it replaced. Your own
materials are only read. It works under both encodings and in
`bakeVATInWorker`
([ADR-0028](./adr/0028-merging-flat-materials-is-a-bake-option.md)).

The merged-materials examples (`examples/webgl_merged.html` and
`examples/webgpu_merged.html`) bake the robot both ways and toggle between them,
with the renderer's draw-call count on screen.

### Textured parts: atlas them before the bake

Parts with different textures stay different materials, and draw one call each:
Soldier's body and visor are two. The library does not build a texture atlas,
and will not ([#96](https://github.com/MikeFernandez-Pro/three-vat/issues/96)).
Packing images means reading and redrawing pixels, which neither the command
line nor a worker can do. It also breaks textures that tile.

It does not need to. The bake already puts every part drawn by the same material
object into one group. So atlas the textures in your own tools before the asset
is loaded: one image, each part's UVs moved into its cell, and one material
shared by all of them. The crowd then draws once per pass, as a flat merge does,
under both encodings, in a worker, and from the command line. If the loader
hands two parts separate copies of that material, assign one of them to both
before you bake.

## Bake cost, and baking in a Web Worker

A VAT is baked by `bakeVAT` at runtime
([ADR-0010](./adr/0010-drop-the-offline-format-runtime-bake-is-the-library.md)),
unless it was baked at build time and is loaded from a
[baked file](#baking-at-build-time-loadvat). Baked at runtime, the one cost to
budget is the bake itself, once at load. The table is the **vertex encoding** unless it says rig,
measured on `three@0.186.0`, Windows x86-64. Chrome is a page's **first** bake on
its main thread, a fresh page each run, median of 5 — the one a page actually
pays, since it bakes once. Node is Node 22, median of 7 after two warm-up bakes:

| Asset | Clips | fps | Rows | Chrome, first bake | Node |
|---|---|---|---|---|---|
| `RobotExpressive` (rigid, 7 214 v) | 3 (the demo) | 30 | 158 | 156 ms | 164 ms |
| `RobotExpressive` | 14 (all) | 30 | 585 | 477 ms | 650 ms |
| `Soldier` (skinned, 7 434 v) | 4 (all) | 30 | 113 | 258 ms | 292 ms |
| `Soldier` (skinned) | 4 (all) | 60 | 224 | 470 ms | 557 ms |
| `Soldier`, rig encoding | 4 (all) | 30 | 113 | 60 ms | 44 ms |

Cost is linear in `vertices × frames`, and **a skinned vertex costs ~3× per
frame row what a rigid one does** (2.3 ms/row here vs 0.8, in Chrome) — the
four-weight bone blend is the hot loop. So budget by rows, and halve `fps`
before you cut clips. A 20k-vertex skinned character with 6 clips at 30 fps
extrapolates to ~1.8 s on this machine and several seconds on a mid-range
phone — enough to matter, and the point at which the bake belongs off the main
thread. The rig encoding is a different order of cost altogether, and Michelle's
16 340 vertices take 0.4 s against 3.3 s under the vertex encoding, in Node
([the two encodings, measured](#the-two-encodings-measured)).

A browser bake used to be the slow one. Up to 4.0.0 a page's first skinned bake
in Chrome ran **4.5× slower** than the figures above — Soldier at 60 fps took 2.3 s
— because zeroing the skin matrix with `fill(0)` once a vertex put the bone
blend into a V8 deopt cycle that lasted the whole bake, and a warm or rigid bake
never showed it. The loop zeroes by hand now; the comment where it does says
why.

It can go there as-is: **the baker is pure CPU and never touches the renderer**,
so it runs in a Web Worker. `bakeVATInWorker` takes the same arguments as
`bakeVAT`, plus the worker, and resolves with the same VAT
([ADR-0026](./adr/0026-a-worker-bake-copies-the-subtree-and-calls-bakevat.md)).
The worker is two lines:

```ts
// bake.worker.ts — the whole file
import { serveVATBakes } from 'three-vat'

serveVATBakes()
```

```ts
// main thread
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { bakeVATInWorker } from 'three-vat'
import { createVATMesh, getMaxTextureSize } from 'three-vat/webgl' // or 'three-vat/tsl'

const worker = new Worker(new URL('./bake.worker.ts', import.meta.url), { type: 'module' })

const gltf = await new GLTFLoader().loadAsync('/robot.glb')
const vat = await bakeVATInWorker(worker, gltf.scene, gltf.animations, {
  maxTextureSize: getMaxTextureSize(renderer),
})
const { mesh, time } = createVATMesh(vat, instances)
```

The page keeps drawing frames while the worker bakes. What happens underneath:

- **The subtree is copied, not moved.** The page sends what the bake reads:
  transforms, geometry, skins, morphs and the clips' tracks. The worker
  rebuilds that subtree and calls the same `bakeVAT` on it, so the VAT is the
  one a bake on the page would have produced, texel for texel. Your scene is
  only read, as it is by a bake on the page: a source geometry without normals
  is not given them by either, and the merged rest geometry derives its own.
  A track on anything but a node's transform or a mesh's morphs, such as a
  material colour, stays behind: the bake does not read it, and the worker has
  nothing to bind it to.
- **Materials never cross.** The worker bakes against numbered stand-ins, and
  the VAT comes back holding your own materials in `materialIndex` order.
  Textures stay on the page, so the worker never decodes an image.
- **A refusal rejects the promise** with the message `bakeVAT` would have
  thrown. Three things a bake reads cannot be copied, and each is refused
  before anything is sent: a bone outside the subtree, a keyframe track with a
  custom interpolant, and an attribute that is neither a `BufferAttribute` nor
  an interleaved one. glTF's cubic-spline tracks are carried.
- **One worker serves any number of bakes.** `serveVATBakes` ignores messages
  that are not bakes, so the worker may do other work besides.
- **The renderer's `maxTextureSize`** can only be read on the page, so pass it
  in as the snippet does.

The typed array behind each texture's `image.data` is not part of the
contract, and it is not the same array on every layer. The position texture
holds a `Uint16Array` of half-floats
([#73](https://github.com/MikeFernandez-Pro/three-vat/issues/73)), and the
normal texture holds a `Uint8Array` of octahedral pairs
([#29](https://github.com/MikeFernandez-Pro/three-vat/issues/29)). A narrower
encoding may change either in a minor release. Code that moves a VAT's buffers
itself should hand each one back to *that layer's* builder, `makeVATTexture` or
`makeVATNormalTexture`, and never read floats out of it.

The worker examples (`examples/webgl_worker.html` and
`examples/webgpu_worker.html`) run one bake both ways while a crowd walks, and
print the longest frame each run left. On the main thread, that
frame is the whole bake.

A worker moves the bake off the main thread but still spends it, on every
visit, for a result that never changes between visits. Where the asset is known
at build time, a [baked file](#baking-at-build-time-loadvat) removes the bake
instead, and there is nothing left to put in a worker: `loadVAT` only reads
texels that were baked already. The worker stays the answer for an asset that
only arrives at runtime, such as one a visitor drops onto the page.

## Checking an asset from the command line

`npx three-vat bake` answers the question an asset pipeline asks before any page
is written: will this asset bake, and how? It loads the file in Node, calls the
same `bakeVAT` a page calls, and prints what the bake chose
([ADR-0034](./adr/0034-the-cli-bakes-to-a-versioned-vat-glb.md)). This is its
**report** mode, and it writes nothing.

```text
$ npx three-vat bake public/RobotExpressive.glb --clips Idle,Walking,Wave
three-vat bake public/RobotExpressive.glb
config: none
encoding: rig, 58 slots
clips: 3, 184 frames
  Idle: 100 frames at 30 fps, repeat forever, clamp, speed 1
  Walking: 29 frames at 30.26 fps, repeat forever, clamp, speed 1
  Wave: 55 frames at 30 fps, repeat forever, clamp, speed 1
textures:
  rig: 116 x 184 RGBA32F, 341504 bytes
  total: 341504 bytes
vertices: 7214 as loaded, 7214 merged
materials: 3
bake time: 56 ms
```

The report is plain text, and the same asset with the same options prints the
same report, down to the byte, except for the last line. The bake time sits on
a line of its own so a diff can ignore it. Commit the report beside the asset,
and a change in how the asset bakes shows up in review. A fallback prints the
reason the bake kept on `vat.fallback`, on a `fallback:` line under the
encoding. `vertices` counts every mesh as the loader built it, then the merged
geometry the VAT indexes. The two differ for an FBX (below).

The input is a `.glb`, a `.gltf` with its buffers beside it, or an `.fbx`.
Meshopt geometry is decoded. KTX2 textures and every other image are never
decoded, because the bake never reads an image. An FBX is loaded as
[Loading FBX](#loading-fbx) says a page should load it: every mesh through
`mergeVertices`, and Mixamo's empty `Take 001` left out. Draco is refused,
because its decoder needs `fetch` and a Worker, which Node does not give it. The
refusal names the command that decodes the file first:

```bash
npx @gltf-transform/cli copy model.glb model.decoded.glb
```

### Flags

Each whole-bake flag is one of `bakeVAT`'s options:

| Flag | Option |
| --- | --- |
| `--fps <n>` | `fps` |
| `--clips <name,...>` | the clips to bake, in that order. Default: every clip in the file |
| `--encoding auto\|rig\|delta` | `encoding` |
| `--max-texture-size <n>` | `maxTextureSize`. Pass the smallest GPU you ship to |
| `--no-normals` | `bakeNormals: false` |
| `--merge-flat-materials` | `mergeFlatMaterials: true` |

Three more flags steer the command itself. `--max-bytes <n>` fails the bake when
the VAT's textures add up to more than `n` bytes, the `total` line of the
report. `--config <path>` names a config file. `--out <path>` also writes a
[baked file](#baking-at-build-time-loadvat), and the report gains a `written:`
line with its path and size.

### `vat.config.json`

Per-clip settings are declared in a file, not in flag syntax. The command looks
for `vat.config.json` beside the input, or reads the file `--config` names. It
is JSON, and the command never imports or evaluates it. Each key names an input
file, relative to the config's own folder, and one config serves every asset
in that folder:

```json
{
  "soldier.glb": {
    "clips": ["Idle", "Walk", "Run"],
    "encoding": "rig",
    "maxTextureSize": 4096,
    "maxBytes": 1000000,
    "clipDefaults": {
      "Run": { "loopMode": "once", "endMode": "rewind" },
      "Walk": { "speed": -1 },
      "Idle": { "loopMode": "pingpong", "repetitions": 3 }
    }
  }
}
```

An entry takes `fps`, `clips`, `encoding`, `maxTextureSize`, `bakeNormals`,
`mergeFlatMaterials` and `maxBytes`, and a `clipDefaults` table keyed by clip
name. That table holds the [clip defaults](#declaring-the-defaults-at-the-bake)
a page declares on an `AnimationAction`: `loopMode` (`repeat`, `once` or
`pingpong`), `repetitions` (leave it out for forever), `endMode` (`clamp` or
`rewind`) and `speed`, where a negative speed plays the clip
[backwards](#playing-backwards). The command configures an action with them and
hands it to `bakeVAT`, so the clip table is the bake's own reading of them. The
one exception is `endMode`. The bake never reads that off an action, so the
command writes it onto the clip table after the bake. Every default is printed
on its clip's line.

A flag beats the config, key by key. An entry for another file applies nothing.

### Exit codes

| Code | When |
| --- | --- |
| `0` | the asset baked, a fallback included |
| `1` | the asset was refused: both encodings refused it, the rig encoding refused it under `--encoding rig`, its textures came to more than `--max-bytes`, or `--out` cannot carry a texture one of its materials holds ([below](#the-materials-a-baked-file-carries)) |
| `2` | the command was: an unknown flag, clip name or config key, a config that is not JSON, an input it cannot read, cannot load, does not support, or will not decode (Draco), or an `--out` path it cannot write |
| `3` | the command itself crashed, a bug; its stack is printed, and worth reporting |

A fallback exits `0`, because a morph-animated asset is ordinary and the vertex
encoding is the right one for it. A pipeline that wants every character on the
rig encoding passes `--encoding rig`, and then a fallback is a failure. A
refusal prints `bakeVAT`'s own words, the same message a page would catch. The
bake time is never a budget, because it measures the machine and not the
asset.

## Baking at build time: `loadVAT`

A runtime bake is paid on every visit, for a result that never changes between
visits. `--out` pays it once, at build time. The command bakes the asset as a
page would, then writes a **baked file**: one `.glb` holding the merged
geometry, its materials and the VAT's texels
([ADR-0034](./adr/0034-the-cli-bakes-to-a-versioned-vat-glb.md)). The page loads
that instead of the source, and never bakes:

```bash
npx three-vat bake public/robot.glb --out public/robot.vat.glb
```

```ts
import { loadVAT } from 'three-vat'
import { createVATMesh } from 'three-vat/webgl' // or 'three-vat/tsl'

const vat = await loadVAT('/robot.vat.glb')
const { mesh, time } = createVATMesh(vat, instances)
```

`loadVAT` returns the VAT `bakeVAT` returned when the command baked it, texel
for texel: the same clip table with every [clip default](#declaring-the-defaults-at-the-bake)
you configured, a negative speed included, the same bounds, and the same
`fallback`. Nothing downstream of it can tell the two apart, on either decode
path. It reads the file with a plain `GLTFLoader`, or with yours, configured as
your page already configures it:

```ts
const vat = await loadVAT('/robot.vat.glb', { loader: myGLTFLoader })
```

The file is written under whichever encoding the bake chose, the rig where the
asset allows it and the vertex encoding where it fell back, and `--encoding`
picks one as it does in report mode. It is an ordinary glTF with an extension
of its own, `THREEVAT_vat`, which it declares as used and never as required.
So Blender, the Khronos viewer and any other glTF tool open it, and a file of
either encoding previews at its rest pose in any of them. A rig-encoded file
keeps each part in its own space, as the rig encoding does, so it also carries
a glTF skin: one joint per slot, each at its rest, which puts every part back
where it stands instead of stacked at its own origin. `loadVAT` never reads
that skin; the slots come from the rig texture, so a skin a tool rewrote could
only spoil the preview, never a crowd. The file deploys, caches and compresses
like any other `.glb`.

The vertex encoding is the one a baked file helps most. It is the expensive
bake, and it is where a morph-animated asset falls back to.

### The materials a baked file carries

A baked file carries its materials, so a page never loads the source asset just
to find them. What it carries depends on what the source held:

- **A glTF's textures, byte for byte.** Each image is copied out of the source
  file as it is: a JPEG stays that JPEG, and a KTX2 texture stays KTX2 under
  the same `KHR_texture_basisu` it was read through. Nothing is decoded or
  encoded again, so the file costs no image quality. The sampler, texture
  coordinate set and `KHR_texture_transform` of each map go with it. A baked
  file carries glTF's five core slots: `map`, `normalMap`, `emissiveMap`,
  `aoMap`, and `metalnessMap`/`roughnessMap` packed as the source packed them.
  A texture anywhere else, a clearcoat or sheen map for one, is refused by
  name and nothing is written.
- **A [flat merge](#merging-flat-materials-mergeflatmaterials)'s material, as
  it is.** Under `--merge-flat-materials`, the one white material and the
  vertex colours that now hold each part's colour are written as the bake left
  them.
- **An FBX's Phong and Lambert materials, converted to PBR.** glTF has one
  shading model, so three's exporter writes each as a `MeshStandardMaterial`,
  and `loadVAT` reads it back as one. Write mode's report names each
  conversion under its `materials:` line, and what it lost:

  ```text
  materials: 2
    Alpha_Body_MAT: MeshPhongMaterial written as MeshStandardMaterial, losing specular and shininess
    Alpha_Joints_MAT: MeshPhongMaterial written as MeshStandardMaterial, losing specular and shininess
  ```

  An FBX's textures are not carried: the command reads no image from an FBX,
  so a textured FBX material is refused under `--out`.

To restyle a crowd without a re-bake, hand `loadVAT` your own materials. They
replace the file's wholesale, one for each `materialIndex`, in that order, as
`vat.materials` holds them:

```ts
const vat = await loadVAT('/robot.vat.glb', { materials: [body, joints] })
```

An array of another length is refused, and the message names both counts.

### What `loadVAT` refuses

`loadVAT` refuses two kinds of file, each by name, rather than render garbage:

- **A file of another format version.** The file states a format version of its
  own, not the package's. `loadVAT` reads its own version only, and the message
  names both versions and asks for a re-bake. A release that leaves the
  encodings alone leaves every baked file valid. A release that changes what
  the file holds bumps the version, and the build step bakes again.
- **A file whose geometry was rewritten after the bake.** The texels are
  addressed by the merged vertex order, so a tool that reorders, welds or
  simplifies vertices breaks the file without breaking the glTF. The file
  records the vertex count and a digest of the rest positions, and `loadVAT`
  refuses one that no longer matches, naming an optimizer as the likely cause.
  Keep the baked file out of any `gltfpack` or `gltf-transform` pass that
  touches geometry.

A glTF that is not a baked file at all is refused too, and the message names
the command that writes one.

### Writing one on a page: `three-vat/write`

The command's writer is public too, for a baked file the command cannot make:
a subtree built in code, or a bake a page just ran. The drop example's download
is built on it. It is a subpath of its own, so three's `GLTFExporter` only lands
in a bundle that writes a file
([ADR-0035](./adr/0035-the-writer-is-public-as-three-vat-write.md)):

```ts
import { readSourceImages, writeBakedFile } from 'three-vat/write'

const gltf = await new GLTFLoader().loadAsync('/robot.glb')
const vat = bakeVAT(gltf.scene, gltf.animations) // or await bakeVATInWorker(...)
const bytes = await writeBakedFile(vat, { images: await readSourceImages(gltf.parser) })
```

`writeBakedFile` writes the file the command's `--out` writes, under whichever
encoding the bake chose. A VAT baked in a worker writes the same bytes as one
baked on the page. `readSourceImages` reads each texture's image out of that
same load, as the file holds it, because a baked file copies images through
and never encodes one again. An image inside a `.glb`, or embedded as a `data:`
URI, is read from the load itself. An image in a file beside a `.gltf` is
fetched from where the loader found the `.gltf`, or read by the function you
pass as the second argument. The drop example passes one that reads the
dropped file. A VAT without textures needs no images:

```ts
const bytes = await writeBakedFile(bakeVAT(proceduralRoot, clips))
```

The same materials are refused as under `--out`: a texture outside glTF's five
core slots, and one whose image bytes were never read from a glTF, which covers
every FBX texture. So is a rig-encoded VAT that `loadVAT` read: its preview
skin needs the slots' rest matrices, which the file does not keep.

## Loop modes: once, twice, back and forth

An instance does not have to loop forever. Three optional fields on a
`VATInstance` say how its clip repeats — the same three `THREE.AnimationAction`
spells:

```ts
import { EndMode, LoopMode } from 'three-vat'

const instances = [
  // The default: repeat, forever.
  { clip: walk, startTime: 0, speed: 1 },

  // A death. Plays once and stays down.
  { clip: death, startTime: hitAt, speed: 1, loopMode: LoopMode.Once },

  // A wave, exactly twice, then back to its first frame.
  { clip: wave, startTime: now, speed: 1, loopMode: LoopMode.Once, repetitions: 2, endMode: EndMode.Rewind },

  // Forward, then backward, without baking the reversed frames.
  { clip: idle, startTime: now, speed: 1, loopMode: LoopMode.PingPong, repetitions: 4 },

  // A door closing on its opening clip: the same band, played backwards.
  { clip: doorOpen, startTime: now, speed: -1, loopMode: LoopMode.Once },
]
```

| Field | Default | Means |
| --- | --- | --- |
| `loopMode` | `LoopMode.Repeat` | `Repeat`, `Once` or `PingPong` — `THREE.LoopRepeat` / `LoopOnce` / `LoopPingPong` |
| `repetitions` | endless for `Repeat`, `1` otherwise | How many times to play the clip. `INFINITE_REPETITIONS` (`-1`) is endless; `Infinity` does not survive a `Float32Array`, so the sentinel is converted once, at the boundary |
| `endMode` | `EndMode.Clamp` | `Clamp` holds the pose playback stopped on, `Rewind` returns to the one it started from — the last frame and the first playing forwards, the first and the last [backwards](#playing-backwards) |
| `speed` | the clip's, then `1` | Playback rate multiplier. **A negative speed plays the clip backwards** at its magnitude, from the band already baked ([below](#playing-backwards)). `0` is legal, and holds the first row |

**`Clamp` is the default, and three's `clampWhenFinished` is `false`.** The
divergence is deliberate: a one-shot in a crowd — a death, an impact — almost
always has to *stay* in its final state, and a rewinding corpse standing back up
is the failure a crowd library should not ship by default. Pass
`endMode: EndMode.Rewind` to get three's behaviour back.

**The last row of a clip is one sample before its end.** A bake samples `frames`
rows evenly over `[0, duration)` and never at `duration` itself: for a looping
clip the pose at `duration` *is* the pose at `0`, and baking it twice would
hitch every loop. So a clamped one-shot holds the pose at `duration − 1/fps`,
one bake interval short of the clip's final key. At 30 fps that is 33 ms of a
death nobody sees. If a clip's last key carries a settle that matters, author
it a frame earlier, or bake at a higher `fps`.

Nothing here costs a per-frame update. The whole playback state is written into
the instance's pack once, and every frame after that is a pure function of the
shared clock — which is the property that makes a VAT a VAT.

**That clock is a 32-bit float on the GPU.** `startTime` is carried as one, and
`uVatTime − startTime` is computed as one, so the resolution of an instance's
local time falls as the clock grows: about 1 ms after two hours, 8 ms after
eighteen, and a whole 30 fps frame after three days. A game that runs for an
evening never notices. A scene that runs for a week should reset the clock
between levels — and rewrite its `startTime`s with it — rather than let
`elapsedTime` grow unbounded.

That function is exported, so you can ask it the same question the shader
answers:

```ts
import { resolveVATFrame } from 'three-vat'

// The two VAT rows this instance samples at t = 3.2s, the blend between them,
// and whether it has run out of repetitions.
const { row, rowNext, mix, wraps, finished } = resolveVATFrame(instance, 3.2)
// …and `outgoing`, the band an instance mid-crossfade is blending away
// from — the same resolution, one level deep, with the weight beside it —
// or `null`, which is what almost every instance is.
```

`resolveVATFrame` is the **one definition** of what a loop mode means: both
decode paths transcribe it, neither invents it, and it is the only form of that
arithmetic CI can evaluate — a GLSL string and a TSL node graph both need a GPU.

### Playing backwards

A negative `speed` plays the band backwards, and nothing is baked for it
([ADR-0033](./adr/0033-a-negative-speed-plays-the-band-backwards-mirrored.md)):

```ts
setVATInstance(playback, i, { clip: walk, startTime: time.value, speed: -1 })
```

The pose a reversed instance shows at every moment is the pose forward playback
shows at the **mirrored** point of the clip — phase `1 − p` — and every rule
above applies to that mirrored phase. Its magnitude is the rate, so `-0.5` plays
backwards at half speed; `0` is not reversed, and still holds the first row.

| | Forwards | Backwards |
| --- | --- | --- |
| `Repeat` | first row to last, then through the seam | from the seam, last row down to first, then through the seam again |
| `Once` | starts on its first frame | starts on its **last** frame |
| `PingPong` | first, last, first | last, first, last |
| `Clamp`, when finished | holds the last frame | holds the **first** frame |
| `Rewind`, when finished | returns to the first frame | returns to the **last** frame |
| scheduled ahead | waits on its first row | waits on the pose it will start on: the last row, or the first for an endless `Repeat` |
| `endsAt` | `startTime + duration × repetitions / speed` | the same moment, from the speed's magnitude |

- **A reversed repeat starts at the seam.** The bake never samples
  `t = duration`, so the seam of a loop is its first row, and it is where both
  directions begin: the first interval backwards blends the first row into the
  last.
- **A play that runs out holds across its first interval.** Forwards, a clip
  ending on `Clamp` holds its last row across its final interval rather than
  blending toward the first. Backwards that interval comes first, so a reversed
  one-shot, or any reversed finite count, sits on its last row across its first
  interval — whichever end mode it has, since backwards the pose `Rewind`
  returns to is that same last row. Only the first repetition does; every one
  after it comes in through the seam.
- **A fractional count stops at the mirrored point**, at the moment forward
  playback would: `2.5` backwards is halfway through its third pass.

**Where it deliberately differs from three.** Three plays a negative `timeScale`
from its playhead downwards, so a one-shot played backwards from `time = 0` is
finished the instant it starts, and a three user sets `action.time =
clip.duration` first. There is no playhead here to set, only `startTime`, so a
reversed one-shot simply starts on its last frame. And a non-clamped action
with a negative `timeScale` is *disabled* by three when it finishes; here
`Rewind` returns it to the last frame, the pose it started from.

Turning an instance around mid-clip — continuing backwards from the pose it is
showing now — is not this: a write with a negative speed starts the clip from
its reversed beginning.

**The worked example** is the [crossfade](#the-crossfade) pair,
**[WebGL](https://mikefernandez-pro.github.io/three-vat/webgl_crossfade.html)**
and
**[WebGPU](https://mikefernandez-pro.github.io/three-vat/webgpu_crossfade.html)**:
a third of the switches write their clip with `speed: -1`, and fade into it and
back out of it like any other. The HUD counts the instances playing backwards
right now, asked of `resolveVATFrame` over the state the pack holds, and on the
texture panel their cursors climb the strip.

## Declaring the defaults at the bake

Repeating `loopMode: LoopMode.Once, endMode: EndMode.Clamp` at every one of a
thousand corpses is a thousand chances to disagree. Declare it once instead:
`bakeVAT` takes an `AnimationClip` **or** an `AnimationAction`, in the same
array, and an action's configuration lands in the clip table.

```ts
const mixer = new THREE.AnimationMixer(gltf.scene)
const death = mixer.clipAction(deathClip)
death.loop = THREE.LoopOnce

const vat = bakeVAT(gltf.scene, [walkClip, death, idleClip])

// "once, clamped" is not repeated here — it came with the clip.
const instances = corpses.map((c) => ({ clip: vat.clips[1], startTime: c.diedAt }))
```

An action costs the bake nothing: it already builds an `AnimationMixer` to pose
the mesh, so it reads `action.getClip()` for the geometry work and the action
for the clip table. A bare `AnimationClip` carries no configuration, so the
simple case still needs no mixer at all.

One rule decides what is read: **read configuration, ignore transport state,
refuse loudly what a VAT cannot represent.**

| Field | Treatment |
| --- | --- |
| `loop`, `repetitions` | read into the clip table |
| `timeScale` | read as the clip's default `speed`; negative is reversed |
| `clampWhenFinished` | **not read** — both inputs clamp (below) |
| `time`, `paused` | **ignored** |
| `weight !== 1` | **throws** |
| additive `blendMode` | **throws** |

`time` and `paused` are ignored because a VAT has no playhead of its own to
seed. Where an instance sits in its clip is a function of the shared clock and
that instance's `startTime`, and of nothing else — so a paused action, or one
left halfway through, describes a moment the bake has no place to put.

A non-unit `weight` and an additive `blendMode` both describe *several actions
blended at once*, which a single baked band cannot be. They are refused at the
bake rather than dropped silently, for the same reason a smooth-shaded material
paired with a normal-less VAT is refused: a pairing a VAT cannot honour is
better met here than in a frame that renders wrong. Blending between two baked
*clips* is a different thing and the library does it: the
[crossfade](#the-crossfade) an instance gets is a second band of the same bake,
still playing, blended per instance — not several actions combined into the one
pose a band can hold.

A negative `timeScale` is read as a reversed default: the clip's default
`speed` is that negative value, so every instance of the clip
[plays it backwards](#playing-backwards) unless its own `speed` says otherwise.
That override works both ways: a positive `speed` plays such a clip forwards,
and a negative one plays a forward clip backwards. The band baked is the forward one either way; only the
clip table records the direction. The one thing a three user does before
playing a one-shot backwards, `action.time = clip.duration`, is a playhead
position, and is ignored with the rest of them: a reversed one-shot here starts
on its last frame anyway.

What a bare clip gets — `LoopMode.Repeat`, endless, `speed: 1`, `EndMode.Clamp`
— are the library defaults of the table above. `Clamp` is the deliberate
divergence from three, argued in the previous section, and an action gets it
too: the end mode is the one field the bake does **not** read off the action.

`clampWhenFinished` is `false` on every action three hands out, so a `false` at
the bake is a decision and an untouched field wearing the same face, and the
bake cannot tell them apart. Reading it literally would mean the caller who
configures `death.loop = THREE.LoopOnce` and nothing else gets the corpse that
stands back up, while the caller who hands the clip over bare does not — the
promise broken exactly where it was being relied on. So both clamp, and
`clampWhenFinished = true` agrees with that rather than changing it.

An instance still asks for three's rewind, which is the finer grain anyway:

```ts
{ clip: vat.clips[1], startTime: hitAt, endMode: EndMode.Rewind }
```

None of this is baked into the texels: the bake records the policy as a default
and never encodes it, which is why one bake can serve a crowd that clamps and an
instance that rewinds
([ADR-0017](./adr/0017-loop-mode-is-a-playback-policy-not-bake-data.md)).

### Overriding an inherited default

Every field an instance names wins over the clip's, one field at a time. The
`VATInstance` fields are all optional now — all but `startTime`, which is a fact
about the instance and nothing else:

```ts
// Inherits the clip's loop, repetitions, end mode and speed.
{ clip: vat.clips[1], startTime: hitAt }

// Same clip, but this one crawls.
{ clip: vat.clips[1], startTime: hitAt, speed: 0.25 }
```

The one coupling is between `loopMode` and `repetitions`: a repetition count
belongs to the mode it was configured under. An instance that replaces
`loopMode` and says nothing about `repetitions` takes the count its *new* mode
implies — otherwise a one-shot over a clip baked to loop forever would inherit
"forever" and never finish.

## Changing one instance after the crowd is built

A crowd is written once, at creation. An enemy hit at `t = 12.3s` has to become
a dying enemy after that — and it costs exactly one write:

```ts
import { setVATInstance } from 'three-vat'

// `playback` came back from createVATMesh, beside `mesh` and `time`.
function onHit(enemyId: number) {
  setVATInstance(playback, enemyId, {
    clip: vat.clips[2],      // "once, clamped" came with the bake
    startTime: time.value,
    fadeDuration: 0.1,       // blend out of whatever it was doing
  })
}
```

That is the whole controller. `playback` is the crowd's **playback texture** —
the object `createVATMesh` returns beside the mesh and the clock, and the thing
this write goes into — and `enemyId` is the instance's index, the same one
`setMatrixAt` takes. Only that instance's row is flagged for upload, so a crowd
of a thousand pays for the one that changed.

Nothing happens per frame afterwards. The written pack is a pure function of the
clock from there on, which is why there is no `update(dt)` here and no mixer:
the CPU touched this instance at the moment its animation changed, and will not
touch it again until the next one.

It is a plain function over the playback texture rather than a mesh subclass on
purpose — a crowd rendered onto something other than a plain `InstancedMesh`
writes its instances exactly the same way
([ADR-0014](./adr/0014-changing-an-instance-is-a-function-not-a-mesh-subclass.md),
[ADR-0016](./adr/0016-the-pack-is-a-texture-keyed-by-instance-not-instanced-attributes.md)).

### What a write costs, per renderer

"Only that instance's row" is true of `WebGLRenderer`, which honours
`Texture.addUpdateRange` and issues one `texSubImage2D` per changed row. The
WebGPU backend does not read those ranges: it re-uploads the whole playback
texture whenever `needsUpdate` is set. So on the TSL path a `setVATInstance`
costs **80 bytes per instance** — five texels since the crossfade carries the
band an instance is leaving — once per frame in which anything changed:
27 kB for the demo's 340 robots, 1.3 MB at the 16 384-instance ceiling.

It is a per-change cost and never a per-frame one: a crowd that changes nothing
uploads nothing on either path. The library calls `addUpdateRange` regardless,
because it is what makes WebGL minimal and what WebGPU will pick up the day it
reads the field.

### Chaining: what happens when the clip ends

`endsAt` gives the exact clock time a finite animation finishes — the moment
`resolveVATFrame` first reports `finished` — or `null` for an endless loop. So
"play the hit reaction, then go back to walking" is one more write, scheduled at
a time already known:

```ts
import { endsAt, LoopMode, setVATInstance } from 'three-vat'

const react = { clip: hit, startTime: time.value, loopMode: LoopMode.Once }
setVATInstance(playback, id, react)

const at = endsAt(react)
if (at !== null) {
  schedule(at, () => setVATInstance(playback, id, { clip: walk, startTime: at }))
}
```

No per-frame polling, and no queue inside the library: scheduling is yours, and
the GPU never learns that a next clip exists.

### The crossfade

`fadeDuration` is a **crossfade**: the clip the instance was playing keeps
playing, carried in its own pack as a full playback state, and the shader blends
the two sampled poses by a weight it derives from the clock it was already
reading
([ADR-0025](./adr/0025-the-crossfade-is-a-second-live-band-in-the-pack.md)).
Both clips move for the length of the transition, so a half-second walk → run
reads as a transition rather than as a skate.

It is uncapped, and it is wall clock: the incoming clip's `speed` does not
stretch it. Either band may be playing [backwards](#playing-backwards), and each
keeps its own direction and its own end mode: turning into a reversed clip, the
outgoing band still plays forwards while it fades, and a reversed one-shot being
left clamps on its first frame if it runs out mid-transition, as it would have
alone. `0`, or no `fadeDuration` at all, is a cut; a negative or
non-finite duration is refused by name at the write.

There is no separate blend start — the transition begins when the incoming clip
does, which is what `crossFadeTo` means — so `startTime + fadeDuration` is the
moment it is over, and a caller chaining transitions waits that out. A write
over an instance that is *already* mid-transition replaces the outgoing band
with the one the instance was switching to and drops the older band at whatever
weight it still had: the pack holds two bands, and that pop is the one visible
discontinuity a caller can produce.

**The worked example** — a crowd whose instances each switch clip on their own
timer — about a third of the switches into a clip [played backwards](#playing-backwards) —
with a control that takes the transition from a cut to a long blend:
**[WebGL](https://mikefernandez-pro.github.io/three-vat/webgl_crossfade.html)**
and
**[WebGPU](https://mikefernandez-pro.github.io/three-vat/webgpu_crossfade.html)**.
Its texture panel is on by default, because it is that page's evidence: an
instance mid-transition draws two cursors, one per band, and both of them are
moving — which is the whole of what "both clips still playing" means. Source in `examples/webgl_crossfade.html` and
`examples/webgpu_crossfade.html`.

## By hand, on either path

`createVATMesh` is the exported primitives composed in the one order that is
correct. Reach for them directly only when you are rendering onto something
other than a plain `InstancedMesh` — a `BatchedMesh`
([below](#on-a-batchedmesh)) being the carrier this library supports and tests.

The call also absorbs the one place the renderers genuinely differ: on WebGL it
attaches the patched depth and distance materials the shadow passes need (miss
them by hand and the crowd's body animates while its shadow stays in the bind
pose); on TSL it attaches nothing, because `positionNode` already feeds the
depth pass. Either way you write `castShadow` and nothing else.

The returned `time` is the same `{ value }` clock on both paths. The one other
place the signatures differ is supplying your own: `options.time` is a
`THREE.IUniform` on the WebGL path and a TSL `uniform(0)` on the TSL path,
because that is what each renderer's material can read. Let the call make its
own and even that line is identical.

### WebGL

```ts
import { createVATPlaybackTexture } from 'three-vat'
import { createVATUniforms, createVATDepthMaterial, patchVATMaterial } from 'three-vat/webgl'

const uniforms = createVATUniforms()

// Instance playback — `{ clip, startTime, speed }` per instance, plus the
// optional `{ loopMode, repetitions, endMode }` above — is a core contract both
// decode paths read, not a WebGL-only concept. It is carried in a texture keyed
// by the instance's logical index; `startTime` is an absolute clock time, so a
// crowd desyncs by having each instance start a moment in the past.
const playback = createVATPlaybackTexture(instances)

// One patched material per source material, sharing one clock and one pack.
const materials = vat.materials.map((source) => {
  const material = source.clone()
  patchVATMaterial(material, vat, uniforms, playback)
  return material
})

// `vat.geometry` itself, not a clone: nothing per-crowd lives on it any more,
// and it already carries the all-frames bounding box/sphere, so instances never
// cull mid-animation.
const mesh = new THREE.InstancedMesh(vat.geometry, materials, instances.length)
// Correct instanced shadows: depth for directional/spot lights, distance for point lights.
mesh.customDepthMaterial = createVATDepthMaterial(vat, uniforms, playback)
mesh.customDistanceMaterial = patchVATMaterial(new THREE.MeshDistanceMaterial(), vat, uniforms, playback)

// per frame:
uniforms.uVatTime.value = clock.elapsedTime
```

### TSL, and the zero-config default

```ts
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { createVATPlaybackTexture } from 'three-vat'
import { vatNodes } from 'three-vat/tsl'

const playback = createVATPlaybackTexture(instances)

// The mesh is built first, because the decode is built from it — and off
// `vat.geometry` itself, which is what a crowd renders now.
const material = new MeshStandardNodeMaterial()
const mesh = new THREE.InstancedMesh(vat.geometry, material, instances.length)

// `playback`: each instance plays its own clip, phase and rate, read from its
// own row.
// `carrier`: the mesh the crowd rides. The decode re-applies its transform
// itself, because three applies it to `positionLocal` *before* it reads
// `positionNode` — so the delta has to be added in the geometry's own space and
// transformed afterwards — and the carrier is also what decides how the pack's
// row is addressed. Omit it only for a single, non-instanced mesh.
const { positionNode, time } = vatNodes(vat, { playback, carrier: mesh })
material.positionNode = positionNode

// per frame:
time.value = clock.elapsedTime
```

There is deliberately no `normalNode`: the decode writes `normalLocal` from
inside the vertex stage, exactly as the GLSL path writes `objectNormal`, and
three transforms and interpolates it from there. A material's `normalNode` is
built in the *fragment* stage and expected in view space, which is neither where
nor what a per-vertex, object-space VAT normal is.

Omit `playback` and you get the zero-config default instead: every instance
plays `clipIndex`, phase-desynced by `desync` seconds hashed from
`instanceIndex`, with no pack to write.

### On a `BatchedMesh`

A crowd can ride a `BatchedMesh` instead, on either path. Reach for it when you
want three.js's own **per-instance frustum culling and depth sorting** — a crowd
spread across a level, where most of it is off screen most of the time. That is
what this buys, and it is the whole of what it buys.

What it does **not** buy is the thing `BatchedMesh` is otherwise famous for:
several *different* characters in one draw call. A VAT is a texture, a sampler
is a uniform per draw call, and two characters are two VAT textures — so a
batch carrying a VAT holds **one geometry and N instances of it**, and a second
geometry is refused rather than left to sample another character's rows.
A `BatchedMesh` also takes a **single material** — it has no geometry groups —
so a multi-material bake, which is the usual case for a glTF character, stays
on the `InstancedMesh` carrier — unless its materials differ only in a flat
colour, in which case bake with
[`mergeFlatMaterials: true`](#merging-flat-materials-mergeflatmaterials) and the
batch gets one material that carries every colour. The batched examples do.

There is no batch-per-material arrangement to fall back on: a batch holds a
whole geometry, not one of its groups, so a second batch would draw the whole
crowd again. Patch a material for a batch and every group it covers is shaded
by that one material, which three will do without complaint; the library
cannot refuse it, because it is only ever handed one material at a time.

`createVATMesh` still returns an `InstancedMesh` crowd on both paths. The
`BatchedMesh` carrier is reached through the primitives:

```ts
// WebGL
const playback = createVATPlaybackTexture(instances)
const uniforms = createVATUniforms()
const material = vat.materials[0].clone()

// One geometry, N instances. A BatchedMesh takes its material at construction,
// so clone first and patch once the carrier exists.
const crowd = new THREE.BatchedMesh(
  instances.length,
  vat.geometry.getAttribute('position').count,
  vat.geometry.getIndex()?.count ?? 0,
  material,
)
const geometryId = crowd.addGeometry(vat.geometry)
for (const _ of instances) crowd.addInstance(geometryId)

// The carrier, so the decode resolves the pack row through
// `getIndirectIndex( gl_DrawID )` rather than `gl_InstanceID`.
patchVATMaterial(material, vat, uniforms, playback, crowd)
crowd.customDepthMaterial = createVATDepthMaterial(vat, uniforms, playback, crowd)
```

```ts
// TSL — same batch, named to `vatNodes` as the carrier it is.
const material = vat.materials[0].clone()
const crowd = new THREE.BatchedMesh(/* … as above … */)
material.positionNode = vatNodes(vat, { playback, carrier: crowd }).positionNode
```

Pass the carrier to `patchVATMaterial` — it is how the shader learns to spell
the instance index, and a material patched without it and then drawn on a batch
plays instance 0's clip on every instance, so the mismatch is refused on the
first draw rather than rendered. (The TSL path needs no such refusal: omitting
`carrier` there displaces in the wrong space, and a crowd whose limbs stretch
per instance announces itself.)

Leave `perObjectFrustumCulled` and `sortObjects` at their defaults: both are
`true`, the drawn slot is therefore a permutation that changes every frame, and
the decode reads the pack by the instance's *logical* index — `getIndirectIndex(
gl_DrawID )` on the GLSL path, `batchIndirectIndex` on the TSL one, which is
also why `three >= 0.186` is the peer floor
([ADR-0016](./adr/0016-the-pack-is-a-texture-keyed-by-instance-not-instanced-attributes.md)).
That the two paths agree on this carrier, and that permuting the draw order
changes no pixel, is checked by the [parity gate](./releasing.md).

`setVATInstance` is unchanged: it writes a row of the playback texture, which
knows nothing about what draws the crowd
([ADR-0014](./adr/0014-changing-an-instance-is-a-function-not-a-mesh-subclass.md)).

One thing the two renderers do not agree on, because three does not: the
**WebGL** backend draws a batch with one `multiDrawElements`, so a batched crowd
is one draw call at any population, while the **WebGPU** backend — WebGPU has no
multi-draw command — walks the same multi-draw and issues one `drawIndexed` per
*visible* instance, per pass, the shadow pass included. The culling and the
sorting — what the carrier is for — are the same on both; the call count is not.
On WebGPU a `BatchedMesh` does not batch.

A VAT batch can fold those draws back itself, because of the rule above: every
drawn slot shares the one geometry's range, and three's batched WGSL reads the
instance from `instanceIndex` — which is what three's per-instance draws set,
through `firstInstance` — so a single instanced draw of the visible count puts
the identical indices through the identical shader, culling and sorting intact.
The WebGPU batched example does exactly that, and its draw count is the WebGL
page's again (`examples/src/webgpu/collapse.ts`,
[ADR-0023](./adr/0023-a-one-geometry-batch-is-one-draw-on-webgpu-in-the-example-not-the-library.md)).
It is a workaround for three r186 that wraps the backend's private `_draw`, and
the library will not ship it: it is not about VAT — any one-range batch folds the
same way — and this library does not depend on an underscore
([ADR-0016](./adr/0016-the-pack-is-a-texture-keyed-by-instance-not-instanced-attributes.md)).
Copy the file if your crowd needs it, knowing you own it; it declines rather than
breaks on a three whose `_draw` it does not recognise, and it is one file to
delete the day three collapses a uniform batch itself.

Seen running, spawning and dying:
**[WebGL](https://mikefernandez-pro.github.io/three-vat/webgl_batched.html)** and
**[WebGPU](https://mikefernandez-pro.github.io/three-vat/webgpu_batched.html)**
ride a `BatchedMesh` of 256 reserved rows whose instances come and go while you
watch, with the rows drawn beside the field they stand in
(`examples/webgl_batched.html` and `examples/webgpu_batched.html`). That pair is
also where [a crowd that spawns and dies](#a-crowd-that-spawns-and-dies) below
is shown rather than described.

### The instance ceiling

The playback texture is one row per instance, so the crowd ceiling is the
texture ceiling. Past it `createVATPlaybackTexture` throws and says so, rather
than packing rows into a square and introducing a second way to index a pack.

Which ceiling is yours to say. Left alone, it is `MAX_TEXTURE_SIZE`, 16 384 —
a desktop figure. A phone reporting 4 096 then accepts a crowd of 5 000 and
fails at upload, as a WebGL error or a black crowd. Pass the renderer's real
limit, the same number you pass the bake:

```ts
import { createVATMesh, getMaxTextureSize } from 'three-vat/webgl'

const { mesh, playback } = createVATMesh(vat, instances, {
  maxTextureSize: getMaxTextureSize(renderer),
})
```

`createVATPlaybackTexture` takes the same `maxTextureSize` option, beside
`capacity`. The error names the number it checked against and where it came
from.

## A crowd that spawns and dies

Everything above sizes a crowd from the instances it is handed, which is a crowd
placed once at load. A game's crowd is the other shape: enemies spawn, die and
respawn, and what you know up front is the **ceiling**, not the population.

Both batched pages are this section, running:
**[WebGL](https://mikefernandez-pro.github.io/three-vat/webgl_batched.html)** and
**[WebGPU](https://mikefernandez-pro.github.io/three-vat/webgpu_batched.html)**.

Size the playback texture from that ceiling with a **capacity**. The rows are
reserved once; they are filled as instances appear, with the same
`setVATInstance` that changes one
([ADR-0022](./adr/0022-capacity-is-fixed-when-the-playback-texture-is-made.md)):

```ts
import { createVATPlaybackTexture, setVATInstance } from 'three-vat'

// 400 rows, none of them live yet — a level that starts empty.
const playback = createVATPlaybackTexture([], { capacity: 400 })

function spawn(at: THREE.Matrix4) {
  const id = crowd.addInstance(geometryId) // the carrier owns the numbering
  crowd.setMatrixAt(id, at)

  // The row is reserved, or it is a dead enemy's. Either way, write it.
  setVATInstance(playback, id, { clip: vat.clips[0], startTime: time.value })
}
```

Capacity defaults to the number of instances given, so an existing call is
unchanged. It is at least that many and at most the
[instance ceiling](#the-instance-ceiling); both are refused by name. A reserved
row holds one frame, held — not zeroes, which would be a band of no frames to
divide by.

### Row recycling, which is where this goes wrong

`BatchedMesh.addInstance` reissues the **lowest freed id**. A respawned enemy
therefore lands on a dead one's row routinely — a row still holding the death
clip, clamped on its last frame — and plays a corpse until something overwrites
it. Nothing warns you: the geometry is right, the matrix is right, and the
animation is somebody else's.

So **write the row before you make the instance visible**. The write above is
not an initialisation you can skip for a recycled id; it is the thing that makes
the id yours. The same holds on an `InstancedMesh`, where spawning is raising
`count` and dying is lowering it: a raised `count` re-exposes the row the last
occupant left behind.

And **a spawn is a cut, not a fade**. Write that row with a `fadeDuration` and
the [crossfade](#the-crossfade) does exactly what it promises: it blends out of
whatever the row was holding, which for a recycled id is the previous occupant.
That used to be a frozen pose; it is now a corpse that goes on *moving* for the
length of the fade, because both clips keep playing. Leave `fadeDuration` off a
spawn — the instance has nothing to blend out of that a player should see.

The library does not manage this, and that is a decision rather than an
omission. Managing it would mean owning the indices, and the carrier already
hands that numbering out — a pool here would be a second allocator over one set
of ids ([ADR-0014](./adr/0014-changing-an-instance-is-a-function-not-a-mesh-subclass.md)).
There is no `acquire`, no `release` and no free list.

### What capacity does not follow

`BatchedMesh.setInstanceCount` grows the carrier after construction. The
playback texture **does not follow it**: a texture does not grow in place, so
following it would mean rebuilding this one and rebinding it everywhere it is
bound. Capacity is fixed when the texture is made, which is why it is sized from
a ceiling.

If you genuinely have to grow, the recipe is that rebuild, in full:

1. `createVATPlaybackTexture(…, { capacity: bigger })` — a new texture.
2. Copy the old rows over, or re-write the live instances with `setVATInstance`.
3. Re-patch **every** material bound to the old one — the crowd's materials, and
   on the WebGL path the depth and distance materials `createVATMesh` attaches
   for the shadow passes. Miss those and the shadows animate from a freed
   texture.
4. `dispose()` the old texture.

Reserved rows past your live instances cost nothing to draw: three skips
inactive instances of a `BatchedMesh` entirely, and nothing past
`InstancedMesh.count` is drawn. They cost 80 bytes of texture each, which is
what buying the ceiling up front costs.

## Your own GLSL after the decode

A crowd that sways in wind, twists toward the player, squashes when it lands or
flinches when it is hit is deforming for reasons the library knows nothing
about — and should not. On the **TSL** path there is nothing to add: `positionNode`
is a value `vatNodes` hands back and you compose with it, so this whole section
is one you can skip. On the **WebGL** path `patchVATMaterial` takes
`onBeforeCompile` for itself, and the **post-decode hook** is how it hands the
seam back ([ADR-0021](./adr/0021-the-post-decode-hook-has-two-injection-points.md)):

```ts
import { createVATMesh } from 'three-vat/webgl'

const uTarget = { value: new THREE.Vector3() } // moved by your game, per frame

const { mesh, time } = createVATMesh(vat, instances, {
  hook: {
    // Folded into the library's own program key, never replacing it: two crowds
    // with different hooks must not share a compiled program.
    key: 'twist',
    uniforms: {
      uTarget,
      uHome: { value: homeTexture },     // one texel per instance: where it stands
      uTwistLimit: { value: Math.PI / 4 },
      uKnee: { value: knee },            // both off the baked bounds: the chunk runs
      uSpan: { value: span },            // before the instance matrix has scaled anything
    },
    // Ahead of three's shader, so a helper the two chunks share is declared once.
    prelude: /* glsl */ `
      uniform highp sampler2D uHome;
      uniform vec3 uTarget;
      uniform float uTwistLimit;
      uniform float uKnee;
      uniform float uSpan;

      // This instance's angle, read through the index three-vat declares for it.
      float twistAngle( const in int instance ) {
        vec4 home = texelFetch( uHome, ivec2( 0, instance ), 0 );
        vec2 toTarget = uTarget.xz - home.xy;
        return clamp( atan( toTarget.x, toTarget.y ), -uTwistLimit, uTwistLimit ) * home.z;
      }
      // Eased in with height so the feet stay planted — off the *rest* pose, so
      // the position and the normal are given the very same angle.
      vec3 twistY( const in vec3 v, const in float angle ) {
        float a = angle * smoothstep( uKnee, uKnee + uSpan, position.y );
        float s = sin( a ), c = cos( a );
        return vec3( c * v.x + s * v.z, v.y, -s * v.x + c * v.z );
      }`,
    position: 'transformed = twistY( transformed, twistAngle( vatInstanceIndex ) );',
    normal: 'objectNormal = twistY( objectNormal, twistAngle( vatInstanceIndex ) );',
  },
})
```

Seen running, and this is the page it was written against:
**[WebGL](https://mikefernandez-pro.github.io/three-vat/webgl_deform.html)** and
**[WebGPU](https://mikefernandez-pro.github.io/three-vat/webgpu_deform.html)** —
one crowd, twisted toward a target you drag, lit and casting shadows, deformed
by the hook on one page and by a composed node on the other
(`examples/webgl_deform.html`, `examples/webgpu_deform.html`).

### Two injection points, not one

`position` runs where three takes the position and `normal` where it takes the
normal, and there are **two** because three expands `beginnormal_vertex`
*before* `begin_vertex` and derives `transformedNormal` between them. A chunk
that moves the position cannot repair a normal that was already taken: the crowd
silhouettes as a twisted crowd and shades as an untwisted one. It looks correct
until a light moves across it, which is the failure this shape exists to
prevent — so write both, and give them the same angle.

Each chunk must also **stand alone**, because `MeshDepthMaterial` carries
`#include <beginnormal_vertex>` inside a block that can be dead
([ADR-0006](./adr/0006-shader-injection-must-be-self-contained.md)): anything
the normal chunk computes may silently never run, so the position chunk must not
depend on it. Shared work goes in the `prelude`, which is emitted ahead of
three's shader and is not an injection point.

### What is in scope

- **`transformed`**, at the position point: the posed vertex, in the geometry's
  own space, under either encoding — after the vertex decode added its delta,
  after the rig decode skinned the rest pose. Assign to it.
- **`objectNormal`**, at the normal point: the posed normal, same space.
- **`vatInstanceIndex`**, an `int`, declared for you at *both* points. It is this
  instance's **logical** index — `gl_InstanceID` on an `InstancedMesh`,
  `getIndirectIndex( gl_DrawID )` on a `BatchedMesh` — so your own per-instance
  data survives three's culling and sorting, and your chunk never has to know
  which carrier it is on. It is the one thing a chunk cannot write for itself.
- **Your `uniforms`**, bound beside the library's at every compile.
- Everything three itself has in scope there, `position` and `normal` included.
  Their space is the **encoding's**, not the bounds': the rest pose under the
  vertex encoding, the bind pose under the rig, which can be a different scale
  altogether (a hundredth of a unit tall on RobotExpressive). The twist above
  measures `position.y` against a knee read off the baked bounds, so it bakes
  with `encoding: 'delta'`: under the default, which picks the rig where it
  can, no vertex clears the knee and nothing turns.

### Everything the crowd draws with

`createVATMesh` threads the hook to the render materials, the depth material and
the distance material, because forgetting one is the bug: a twisted crowd
casting an untwisted shadow. Wiring a crowd [by hand](#by-hand-on-either-path),
pass the same options object to each — it carries the carrier too:

```ts
const patch = { carrier: batch, hook }
const material = patchVATMaterial(source.clone(), vat, uniforms, playback, patch)
const depth = createVATDepthMaterial(vat, uniforms, playback, patch)
```

Two smaller rules. A hook with neither chunk, or with a blank `key`, is
**refused** at the patch rather than ignored. And an `onBeforeCompile` you
assigned yourself is now **chained** rather than overwritten — it runs first,
against three's own shader. That chaining is a net, not the seam: build on the
hook, which is what the shadow materials, the program key and
`vatInstanceIndex` all follow.

## Beside threeforge's ledger

[threeforge](https://github.com/tallslab/threeforge) measures a scene's frame
budget draw by draw. It does not know a three-vat crowd, so it files one as a
plain instanced draw and can miss the textures the decode samples, which is
most of a crowd's memory. Two fields fix that, set by you, since `createVATMesh`
will not write another library's private convention:

```ts
const crowd = createVATMesh(vat, instances)
// The draw, attributed as a VAT crowd rather than a bare InstancedMesh.
crowd.mesh.userData.forge = { kind: 'vat' }
// The textures the decode samples, which threeforge cannot find in the
// material's properties. Listing one it already found costs nothing.
const textures = [
  ...(vat.encoding === 'rig' ? [vat.rigTexture] : [vat.positionTexture, vat.normalTexture]),
  crowd.playback.texture,
].filter(Boolean)
for (const material of [crowd.mesh.material].flat()) material.userData.forgeTextures = textures
```

Read against threeforge at
[`8ac4ceb`](https://github.com/tallslab/threeforge/tree/8ac4ceb08e15dd7882dd33a5aa57fac6f9e4975d):
`kind` in `src/ledger/reasons.ts`, `forgeTextures` in `src/memory/resources.ts`.
Both are its internals, not a published API, so check them again when you
upgrade it. Why the two libraries sit side by side rather than overlap is in
[research/threeforge.md](./research/threeforge.md).

## Trade-offs

Two comparisons, and since [ADR-0018](./adr/0018-the-rig-encoding-is-a-second-encoding-opt-in-for-now.md)
the second of them is inside the library rather than against a neighbour.

- **vs N × `SkinnedMesh`:** N draw calls + per-frame CPU skeletons → VAT is one
  draw call per material and zero per-frame CPU, under either encoding. The
  headline.
- **vs bone-texture instancing:** the packages that upload a bone texture from
  the CPU every frame are doing what [the rig encoding](#the-rig-encoding-encoding-rig)
  does, minus the bake — so the honest form of this comparison is now the table
  below, between this library's two encodings. What remains against those
  packages is where the data comes from: a VAT is written once at load and read
  by the GPU alone thereafter, and the vertex encoding captures morph and other
  non-skeletal deformation that no rig, theirs or ours, can express
  ([landscape.md](./landscape.md)).

### The two encodings, measured

One asset, both encodings, on the prototype the decision was taken from
(`prototype/bone-encoding`,
[#47](https://github.com/MikeFernandez-Pro/three-vat/issues/47)): Soldier,
7 434 vertices, 49 slots, three clips at 30 fps, a crowd of 340.

| | vertex encoding | rig encoding |
| --- | --- | --- |
| a row holds | a delta and a normal per vertex | a rotation, a translation and one scale per slot |
| the source it takes | anything `GLTFLoader` loads (ADR-0008) | a rig; what it cannot express is [refused](#what-it-refuses-and-what-it-folds) |
| texture | 25.2 MB | 177 kB |
| bake | 1.4 s | 5 ms |
| frame, 340 instances, RTX 5080 | 0.46 ms | 0.65 ms (1.4×) |
| frame, 340 instances, iPhone 15 Pro Max | 7.3 ms | 4.4 ms (0.6×) |

**The `texture` row is the bench's own figure, and the vertex encoding has got
narrower twice since.** A baked normal is two octahedral bytes rather than four
floats ([#29](https://github.com/MikeFernandez-Pro/three-vat/issues/29)) and a
position delta four half-floats rather than four floats
([#73](https://github.com/MikeFernandez-Pro/three-vat/issues/73)) — 32 B a
vertex-frame to 10 B — so the same Soldier bake is **7.9 MB** today and the
memory ratio is ~45× rather than ~140×. The table is left as measured, because
the frame rows below were measured against that bake and cannot be rescaled.

**Read the two frame rows together, and read neither as "the cost of the
encoding".** Both are *whole-frame* times for the whole 340-instance scene —
what the page took, everything in it included — not decode times measured in
isolation. On the RTX 5080 the rig decode costs 1.4× a frame that was 0.46 ms
to begin with: the four texels it reads are *dependent*, addressed from an
attribute, with the blend and the matrix reconstruction sitting behind them,
and the desktop has the bandwidth to make the vertex encoding's fat texture
free. On the iPhone it is 0.6× — faster — because there the 25 MB texture is a
stream of cache misses and the 177 kB one is cache-resident, so the dependent
fetches come back nearly free. The fetch *count* is not what drives either
number: 8 fetches and 32 landed within 15% of each other on the same bench,
which is why the line this section used to carry, a count of fetches, was
measuring the wrong axis.

**Two more measurements came in after the default flipped**, and both are
recorded in full in
[ADR-0027](./adr/0027-the-default-encoding-is-the-rig-where-the-asset-allows-it.md#android-measured-after-the-flip):

| | vertex encoding | rig encoding |
| --- | --- | --- |
| Fox (1 728 v), frame, 340 instances, Xiaomi Mi 9, WebGL | 12.9 ms | 16.4 ms (1.28×) |
| Soldier, bake, Xiaomi Mi 9 | refused: past `maxTextureSize` 4096 | 140 ms |
| Michelle (16 340 v, normal-mapped), texture | 85.6 MB | 1.1 MB |
| Michelle, bake, Node | 3.3 s | 0.4 s |

- **An Android phone, on the WebGL path** ([#77](https://github.com/MikeFernandez-Pro/three-vat/issues/77)):
  a Mi 9, Adreno 640, Android 11, Chrome 153. Where both encodings fit, the
  rig was the slower decode, the other way from the iPhone; the two phones
  measured different assets, so the ratios are not one quantity twice. Its
  4096 ceiling refused both shipped assets under the vertex encoding, and the
  rig ran them. WebGPU on Android is unmeasured, since Chrome enables it there
  only from Android 12.
- **A normal-mapped asset** ([#78](https://github.com/MikeFernandez-Pro/three-vat/issues/78)):
  Michelle bakes under the default as a rig, and the rig decode shades it
  pixel for pixel as three's own skinning does, on both renderers, with and
  without a tangent attribute. The vertex encoding is the one that differs, by
  1.6–4.9% of the character's pixels, because it keeps the rest-pose tangent
  while its baked normal turns.

- **VAT limits:** no runtime IK/blending, and discrete frames, under both
  encodings. Memory is where they part: `verts × frames × (8 B + 2 B)` for the
  vertex encoding — `× 8 B` with
  [`bakeNormals: false`](#dropping-the-normal-layer-bakenormals-false) — against
  `slots × 2 × frames × 16 B` for the rig, with no normal texture to drop.
  Blending between two baked clips is the [crossfade](#the-crossfade), under
  both encodings; blending *several* clips into one pose is neither.
- **Skinned normals:** positions bake exactly under any rig. Normals reproduce
  what three's own skinning shader renders — linear-blend skinning transforms a
  normal by the skin matrix rather than its inverse-transpose, exact for rigid
  and uniformly-scaled bones, an approximation otherwise. Non-uniform bone scale
  is where that shows, so `bakeVAT` warns once, naming the bone — and the rig
  encoding, which cannot store that scale at all, refuses it instead.
- **Merged attributes are all-or-nothing.** The merge always produces
  `position` and `normal`, and carries `uv`, `color` and `tangent` across when
  *every* mesh in the subtree has them — one part missing an attribute drops it
  for the whole crowd, because half a buffer of real values and half of zeroes
  shades worse than the attribute's absence. So a `normalMap` works, but only
  if every part was exported with tangents — as a plain vec4 `tangent`, the
  shape `GLTFLoader` produces; anything else (a vec3, an interleaved buffer)
  counts as a part without one and drops the attribute for the crowd rather
  than failing the bake. A bake preserves tangents, it never computes them.
  Anything else a source geometry carried is dropped; morph targets deliberately
  so, and skinning attributes with them under the vertex encoding, the VAT
  having replaced both — the rig encoding keeps `skinIndex` and `skinWeight`,
  remapped to slots, because they are what its decode reads. Two caveats on
  the preserved tangent, both inherited from three rather than added here: under
  the vertex encoding it is the *rest-pose* tangent — only `position` and
  `normal` are baked per frame — so under heavy deformation it lags its normal
  slightly, where the rig encoding transforms it by the skin matrix like the
  normal; and a mirrored part keeps the handedness it shipped with, since the
  merge no more flips `w` than three's own `BufferGeometry.applyMatrix4` does.

## What 1.0 does not do

Named rather than left to be discovered. None of these is a known defect; each
is a decision, with the reasoning recorded where it was made.

- **No blend tree.** An instance carries two bands — the clip it is playing and
  the one it is [crossfading](#the-crossfade) out of — and no more. Three
  actions combined at free weights, or an additive layer over a base pose, is
  not something a baked band can be: there is no skeleton left to combine
  ([ADR-0025](./adr/0025-the-crossfade-is-a-second-live-band-in-the-pack.md)).
- **No LOD.** Every instance samples the VAT at full vertex count, whatever its
  distance.
- **No reader for an older baked file.** `loadVAT` reads the
  [baked file](#baking-at-build-time-loadvat) format version of its own release
  and refuses any other, asking for a re-bake. Readers for older versions are
  deliberately not written, so no old format is maintained forever
  ([ADR-0034](./adr/0034-the-cli-bakes-to-a-versioned-vat-glb.md)). They could
  be added later without breaking anything.
- **No React/drei hook or component.** A downstream contribution rather than a
  library surface, and `createVATMesh` is what makes it thin enough to be one.
- **glTF and FBX are the inputs tested end to end.** Any other `Object3D`
  subtree is accepted and bakes, whatever loaded it, but the assets the suite
  pins are glTF and FBX ([ADR-0031](./adr/0031-gltf-and-fbx-are-the-supported-formats.md)).
