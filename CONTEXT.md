# three-vat

three-vat bakes a glTF `AnimationClip` into GPU textures so hundreds or thousands of instanced characters animate with zero per-frame CPU cost — no per-instance `SkinnedMesh`.

## Language

**VAT (Vertex Animation Texture)**:
A texture (or pair of textures) holding per-frame animation baked from a clip and sampled in the vertex shader — per-vertex deformation under the **vertex encoding**, the posed rig under the **rig encoding**. Also the name of the runtime data object bundling those textures with the merged geometry they index, their clip table and their bounds. The name stays whichever encoding the bake chose; "vertex" names the technique's origin, not a promise about what a row holds.
_Avoid_: morph texture, animation map

**Bake**:
The one-time conversion of an `AnimationClip` into VAT textures by sampling the posed mesh frame by frame on the CPU. The producer is the **baker**.
_Avoid_: encode (reserve that for the delta/format step), export, cook

**Posed skeleton**:
A rig's skin matrices — `boneWorld × boneInverse`, one per bone — for the single
frame the baker is sampling, held flat so the per-vertex loop reads an offset
rather than recomputing a matrix. One per *distinct* `Skeleton` object in the
subtree, because the meshes of one character routinely share one — though a
glTF loader gives each skin its own over shared bones, and it is the **slot**
table, not this, that dedupes those. It is the frame's skinning stated once,
which is the whole of why it exists (ADR-0010 addendum).
_Avoid_: bone cache, bone matrices (that is three's `Skeleton.boneMatrices`, a
different array in a different precision), skin cache

**Clip**:
A named animation range (e.g. `walk`, `run`) baked into a contiguous band of frame rows. The **clip table** maps each name to its band — `{ startFrame, frames, fps }` — and to the **clip defaults**: the playback policy and speed every instance of that clip inherits, read at the bake from a configured `AnimationAction` — all but the end mode, which is always `Clamp` from a bake (ADR-0017) — and overridable per instance.
_Avoid_: animation, action, track

**Frame**:
One baked time sample of the whole mesh — a single row (y) of a VAT texture. Vertices index the x axis under the vertex encoding; **slots** do under the rig encoding.
_Avoid_: keyframe (a frame is a resampled snapshot, not an authored key)

**Delta**:
A baked position stored as `skinnedPosition − bindPosition`; the shader reconstructs with `position + delta`. Normals are stored absolute, not as deltas.
_Avoid_: offset, displacement

**Position texture / Normal texture**:
The two VAT layers — one for vertex positions (delta-encoded), one for vertex normals (absolute). Lighting is visibly wrong with positions alone, so the normal layer is baked by default. `bakeNormals: false` drops it — halving the VAT — for the two setups that genuinely do not read it: an unlit material, and `flatShading: true`, where three derives a better normal from the deformed position. Any other shading material paired with such a VAT is refused, not rendered.

**Encoding**:
What a frame row of a VAT holds, chosen per bake, explicitly, and stated on the VAT. Two exist. The **vertex encoding** — the default — stores where every vertex ended up (position deltas, and a normal row beside it); it is source-agnostic, recording skinning, morph targets and node animation alike. The **rig encoding** stores the posed rig instead — one **slot** per bone, as a rotation, a translation and a uniform scale — and the shader skins the rest-pose geometry from it; two orders of magnitude smaller, bake-cheap, no vertex ceiling, and unable to express what a rig cannot: a morph target whose influence a baked clip animates, or a bone scaled differently per axis, both refused at the bake by name. A morph influence that is static across the baked clips is not animation and is folded into the rest pose.
_Avoid_: bone encoding, skin encoding, bones mode, rigid VAT (Houdini's name for a narrower thing: one matrix per rigid piece)

**Slot**:
The unit a rig-encoded row stores once per frame: a bone of a skinned part, or a rigid part standing as a single bone of weight one. Keyed by bone, bone inverse, bind matrix and placement rather than by part or by `Skeleton` object — every term of the chain a slot stores, and the placement being the identity for every part under three's default attached bind mode, so for a glTF the first three are the key — so the meshes of one character that read the same bones share its slots (a glTF loader gives each skin its own `Skeleton` over shared `Bone` nodes: Soldier's visor, RobotExpressive's hands), and so a second mesh on the same rig could read the same texture.
_Avoid_: bone (a slot may be a whole rigid part), joint, matrix

**Rig texture**:
The one texture a rig-encoded VAT holds in place of the position and normal textures: `x = slot`, `y = frame`, clips stacked as bands exactly as in the position texture. Baked once; distinct in kind from the **bone texture** the neighbouring packages upload from the CPU every frame, which is the dividing line the library sits on.
_Avoid_: bone texture, skin texture, matrix texture

**Decode**:
The vertex-shader-side sampling of a VAT that turns texels back into posed geometry — two fetches and a mix per vertex under the vertex encoding, a skinning from the rig texture under the rig encoding; the row arithmetic is the same for both. Each renderer has a **decode path**: **WebGL** (GLSL via `onBeforeCompile`) and **TSL** (node material).
_Avoid_: unpack, read

**Post-decode hook**:
The caller's own GLSL, run after the decode has posed the vertex — a wind sway, a twist toward a target, a per-instance squash: deformation that is the scene's and never the library's. Named for *when* it runs, because that is what makes it two hooks rather than one: three expands `beginnormal_vertex` before `begin_vertex` and derives `transformedNormal` between them, so a chunk that moves the position cannot repair the normal that was taken before it (ADR-0021). The **WebGL** path's answer to what a `positionNode` already gives the **TSL** path, which needs none.
_Avoid_: custom shader, user chunk, hook (alone — it says nothing about when), CSM

**Instance playback**:
The per-instance animation state — `{ clip, startTime, speed }`, the playback policy `{ loopMode, repetitions, endMode }` and the **pose-freeze fade** — laid out as the **pack**, carried by the **playback texture**, and read by every decode path. One contract, written once by the core baker surface, so both decode paths render the same crowd. Written for the whole crowd at creation and one instance at a time after that (`setVATInstance`), which is the only moment the CPU touches an instance.
_Avoid_: instance state, instance data

**Pose-freeze fade**:
The short blend a changed instance makes out of the animation it was playing: **one frozen phase** of the outgoing clip, blended away over `fadeDuration` — not a second clip still playing. Names what it is and what it is not, because the difference is the visible one: invisible over the tenth of a second a death needs, a visible skate over half a second, which is why the duration is capped (ADR-0015). Provisional; a real crossfade (#30) replaces it.
_Avoid_: crossfade, blend, transition

**Playback policy**:
The half of instance playback that says how a clip *repeats* rather than which one it is: the **loop mode** (`Repeat`, `Once`, `PingPong` — three's own `LoopRepeat` / `LoopOnce` / `LoopPingPong`), the repetition count, and the **end mode** (`Clamp` or `Rewind` — the two answers three's `clampWhenFinished` picks between, as a pair of names). A crowd clamps by default where three rewinds, from a bare clip and a configured action alike, and `Rewind` is asked for per instance: a one-shot in a crowd almost always has to stay in its final state, and a rewinding corpse standing back up is the failure the library would otherwise ship by default. An endless repeat count is spelled `-1`, because `Infinity` does not survive a `Float32Array`.
_Avoid_: loop settings, animation options

**Frame resolution**:
Turning an instance's playback into the two frame rows the vertex shader samples, the mix between them, whether the sampling **wraps** (crosses the clip's last row back into its first — a looping clip does, a ping-pong bounces instead, a finished one-shot must not) and whether playback has **finished**. Defined once, in core, as the pure function `resolveVATFrame(instance, time)`; each decode path transcribes it and none invents it, because it is otherwise reachable only inside a GLSL string and a TSL node graph, neither of which CI can evaluate without a GPU.
_Avoid_: playback state (it has none — this is a pure function of the clock), frame lookup

**Pack**:
The fixed-size layout instance playback is carried in: three RGBA-shaped slots — clip, playback, fade — rather than one field per slot. Three because thirteen one-float attributes would have blown the sixteen vertex attributes WebGL2 guarantees, and exactly three RGBA texels because the layout is meant to outlive the thing carrying it — which it did: it was three instanced `vec4`s when ADR-0009 shaped it, and is three texels of the **playback texture** from 2.0 (ADR-0016). Published 1.x never saw it — that release carried five one-float attributes, and the widening to three `vec4`s and the move to a texture both land in 2.0. The pack is the layout — it names that, never the values in it, and never what holds them.
_Avoid_: struct, buffer, payload

**Playback texture**:
What carries the **pack** to the shader from 2.0: one texture, three texels wide, one row per instance, read by the instance's *logical* index — and the object a caller holds to change one instance after the crowd is built. It replaces the instanced attributes of 1.x because an attribute is indexed by the *drawn slot*, and the drawn slot stops being the instance the moment a renderer culls per instance (ADR-0016). Three words that must not blur: instance playback is the values, the pack is their layout, the playback texture is what holds them.
_Avoid_: pack texture (the pack is the layout, not the texture), instance texture, playback attributes (1.x's carrier, gone)

**Capacity**:
How many rows the **playback texture** holds, which is not how many instances are alive in it: a crowd that spawns and dies reserves its rows once and fills them as it goes. Fixed when the texture is made, and deliberately not grown to follow a carrier's own `setInstanceCount` — a texture does not grow in place, and following it would mean rebuilding the texture and rebinding it on every patched material, the shadow ones included (ADR-0022). A reserved row nothing is playing in holds a first frame held, never zeroes, because a band of no frames divides by zero the day something samples it.
_Avoid_: max instances, pool, size

**Row recycling**:
What happens when a carrier hands back an instance index it had already given out: three's `BatchedMesh` reissues the *lowest* freed id, so the row is the dead instance's row, still holding its pack — a corpse's clip, clamped on its last frame — until `setVATInstance` overwrites it. The hazard of a spawning crowd, and it is in the reuse, not in the initialisation. The caller owns the index either way (ADR-0014, ADR-0022): the library reserves the rows and never allocates one.
_Avoid_: free list, pooling, slot reuse (a slot is a rig-encoded bone)

**Instance desync**:
A crowd's instances not moving in lockstep, achieved by giving each one a **`startTime` in the past**: an instance that began a moment ago is that far into its clip already. Names that, never the whole pack.
_Avoid_: jitter, stagger, phase offset (the field it named, `timeOffset`, is gone)

**Crowd**:
Many VAT instances rendered in a single draw call with independent, desynced animation — the target workload. Contrast with cloned `SkinnedMesh`es (N draw calls, per-frame CPU skeletons).
_Avoid_: swarm, batch

**Carrier**:
The mesh a crowd rides — what holds the instances and draws them. `InstancedMesh` on both paths from `createVATMesh`; `BatchedMesh` reached through the primitives, for three's own per-instance frustum culling and depth sorting. One character, though: a batch carrying a VAT holds one geometry and N instances of it, because a second character is a second VAT texture and a sampler is a uniform per draw call (ADR-0002). The word exists because the carrier is what the **playback texture** replaced the instanced attributes *for*: an attribute is indexed by the **drawn slot**, and a carrier that culls or sorts per instance permutes that slot every frame, so the pack has to be keyed by the instance's **logical index** instead — `getIndirectIndex( gl_DrawID )` in GLSL, `batchIndirectIndex` in TSL (ADR-0016).
_Avoid_: host, container, batch (that is one carrier, not the category)

### The gallery and the examples

**Example**:
A page presenting one feature of the library, with a control that produces the evidence rather than a caption that states it. One feature, two pages — one per renderer (ADR-0011) — and every pair is held to the same parity gate. A page stands on its own: the **gallery** frames it, never owns it, and an example opened at its own address works exactly as it does inside the shell. The word names a page and nothing else — not the test suite, not a README snippet, not the folder.
_Avoid_: showcase, feature page, sample, demo (there is no longer one — the robot crowd is an example like the rest)

**Gallery**:
The deployed root: the shell that lists every example in a sidebar and frames the one you pick in an iframe, with a filter for the renderer. Listed flat, one entry per page as three.js lists its own, rather than one entry per feature with a link per renderer — the parity of a pair is an argument the docs make, not a shape the sidebar has to carry. Generated from the **page table**, so a page added to the folder appears with no list edited; the shell is the one `*.html` in that folder the table excludes, by name (ADR-0020). Each example carries a link back to it, because a page opened on its own has no shell around it.
_Avoid_: menu, nav bar, navigation strip (the per-page strip ADR-0019 built and this replaced), index, showcase

**Page table**:
Every `*.html` in the examples folder but the **gallery**'s own shell, globbed rather than listed — `pages.mjs`, in plain JavaScript because vite's config, the build script, the gallery and the release suite all read it and cannot all read TypeScript. What a page says about itself is read off its file through the table too: the entry module its `<script src>` names, and so its renderer and its feature, and its title. One glob, so the build, the gallery and every guard agree about what a page is.
_Avoid_: page list, routes, manifest

**Parity gate**:
The manual pixel-comparison release check that the WebGL and TSL decode paths produce the same image. A release step, not an example — it lives outside the examples folder and carries its own page and its own scene, so no example is a fixture for it and changing one cannot move the gate.
_Avoid_: parity test, parity example

**Script table**:
The `scripts` block in the root `package.json`, and the list `pnpm run` prints from it. It holds the verbs a person types — `dev` (opens the gallery), `test`, `build`, `typecheck` — and nothing else: release and CI machinery is a `node` invocation in `scripts/` or `release/`, indexed by docs/releasing.md. It is the repository's front door, which is why it is pinned by the release suite.
_Avoid_: npm scripts, task runner, commands

**Hero image**:
The animated image at the top of the README: the crowd example's own count slider dragged from one robot to the whole crowd, captured headlessly by `node release/hero/capture.mjs`. Produced from the deployed page, never drawn or screenshotted by hand — so it cannot be prettier than the page it advertises (ADR-0012, ADR-0020). A release step, like the parity gate.
_Avoid_: screenshot, banner, teaser

**Texture panel**:
The baked VAT drawn on screen down the right of an example, one cursor per instance marking the frame row that instance is sampling; the rig texture under the rig encoding, the position and normal textures under the vertex encoding. The page's evidence, visible by default — not a diagnostic (ADR-0012). Carried by the pages whose feature it is evidence for, not by every page.
_Avoid_: VAT debug view, debug panel

**HUD**:
A page's readouts, top-left and on screen at rest: what the page's own feature is evidenced by, and nothing more — draw calls where a crowd's cost is the point, texture memory and bake time where an encoding is, and so on. The two pages of a pair carry the same readouts, readout for readout, which is the contract the release suite holds them to. Every figure is measured or derived, never stated — and a figure that does not speak to the page's feature is dropped rather than shown for completeness (ADR-0020).
_Avoid_: caption, overlay (that is the engineering overlay: three's Inspector on WebGPU, three's Stats behind a toggle on WebGL; ADR-0024)

**Count**:
The crowd example's single control: how many characters are on screen. The walking and running bands are a property of the count — they are what raising it reveals, not a layout the page is arranged into — and an asset says which of its clips plays each band. The control other examples reach for first when they need a crowd to show their own feature on.
_Avoid_: zone, density, crowd size

**Twist**:
The deform example's deformation, and the thing the **post-decode hook** is shown on: each instance yawing toward a **target** the pointer moves, by the angle from where it *stands* to it — clamped, so a crowd leans rather than spins, and eased in with height off the rest pose so its feet stay planted. Per instance and read *through the instance index*, out of the page's own **home texture** (one texel an instance: its cell, and the **gain** that is its share of the clamped angle), because reading your own per-instance data without knowing what draws the crowd is the whole of what the hook declares that index for. The position and the normal take the same angle: a twist in the position alone is the bug the two injection points exist to prevent, so the page is lit and casts shadows.
_Avoid_: lean, look-at, bend, rotation (the instance matrix already has one, and this is not it)
