# three-vat

three-vat bakes a glTF `AnimationClip` into GPU textures so hundreds or thousands of instanced characters animate with zero per-frame CPU cost — no per-instance `SkinnedMesh`.

## Language

**VAT (Vertex Animation Texture)**:
A texture (or pair of textures) holding per-vertex, per-frame deformation baked from an animation, sampled in the vertex shader to displace geometry. Also the name of the runtime data object bundling those textures with the merged geometry they index, their clip table and their bounds.
_Avoid_: morph texture, animation map

**Bake**:
The one-time conversion of an `AnimationClip` into VAT textures by sampling the posed mesh frame by frame on the CPU. The producer is the **baker**.
_Avoid_: encode (reserve that for the delta/format step), export, cook

**Clip**:
A named animation range (e.g. `walk`, `run`) baked into a contiguous band of frame rows. The **clip table** maps each name to its band — `{ startFrame, frames, fps }` — and to the **clip defaults**: the playback policy and speed every instance of that clip inherits, read at the bake from a configured `AnimationAction` and overridable per instance.
_Avoid_: animation, action, track

**Frame**:
One baked time sample of the whole mesh — a single row (y) of a VAT texture. Vertices index the x axis.
_Avoid_: keyframe (a frame is a resampled snapshot, not an authored key)

**Delta**:
A baked position stored as `skinnedPosition − bindPosition`; the shader reconstructs with `position + delta`. Normals are stored absolute, not as deltas.
_Avoid_: offset, displacement

**Position texture / Normal texture**:
The two VAT layers — one for vertex positions (delta-encoded), one for vertex normals (absolute). Lighting is visibly wrong with positions alone, so the normal layer is baked by default. `bakeNormals: false` drops it — halving the VAT — for the two setups that genuinely do not read it: an unlit material, and `flatShading: true`, where three derives a better normal from the deformed position. Any other shading material paired with such a VAT is refused, not rendered.

**Decode**:
The vertex-shader-side sampling of a VAT (two `texelFetch`es + `mix`) that turns texels back into displaced geometry. Each renderer has a **decode path**: **WebGL** (GLSL via `onBeforeCompile`) and **TSL** (node material).
_Avoid_: unpack, read

**Instance playback**:
The per-instance animation state — `{ clip, startTime, speed }`, the playback policy `{ loopMode, repetitions, endMode }` and the **pose-freeze fade** — laid out as the **pack**, carried by the **playback texture**, and read by every decode path. One contract, written once by the core baker surface, so both decode paths render the same crowd. Written for the whole crowd at creation and one instance at a time after that (`setVATInstance`), which is the only moment the CPU touches an instance.
_Avoid_: instance state, instance data

**Pose-freeze fade**:
The short blend a changed instance makes out of the animation it was playing: **one frozen phase** of the outgoing clip, blended away over `fadeDuration` — not a second clip still playing. Names what it is and what it is not, because the difference is the visible one: invisible over the tenth of a second a death needs, a visible skate over half a second, which is why the duration is capped (ADR-0015). Provisional; a real crossfade (#30) replaces it.
_Avoid_: crossfade, blend, transition

**Playback policy**:
The half of instance playback that says how a clip *repeats* rather than which one it is: the **loop mode** (`Repeat`, `Once`, `PingPong` — three's own `LoopRepeat` / `LoopOnce` / `LoopPingPong`), the repetition count, and the **end mode** (`Clamp` or `Rewind` — three's `clampWhenFinished`, as a pair of names). A crowd clamps by default where three rewinds: a one-shot in a crowd almost always has to stay in its final state, and a rewinding corpse standing back up is the failure the library would otherwise ship by default. An endless repeat count is spelled `-1`, because `Infinity` does not survive a `Float32Array`.
_Avoid_: loop settings, animation options

**Frame resolution**:
Turning an instance's playback into the two frame rows the vertex shader samples, the mix between them, whether the sampling **wraps** (crosses the clip's last row back into its first — a looping clip does, a ping-pong bounces instead, a finished one-shot must not) and whether playback has **finished**. Defined once, in core, as the pure function `resolveVATFrame(instance, time)`; each decode path transcribes it and none invents it, because it is otherwise reachable only inside a GLSL string and a TSL node graph, neither of which CI can evaluate without a GPU.
_Avoid_: playback state (it has none — this is a pure function of the clock), frame lookup

**Pack**:
The fixed-size layout instance playback is carried in: three RGBA-shaped slots — clip, playback, fade — rather than one field per slot. Three because thirteen one-float attributes would have blown the sixteen vertex attributes WebGL2 guarantees, and exactly three RGBA texels because the layout is meant to outlive the thing carrying it — which it did: it was three instanced `vec4`s in 1.x and is three texels of the **playback texture** from 2.0 (ADR-0016). The pack is the layout — it names that, never the values in it, and never what holds them.
_Avoid_: struct, buffer, payload

**Playback texture**:
What carries the **pack** to the shader from 2.0: one texture, three texels wide, one row per instance, read by the instance's *logical* index — and the object a caller holds to change one instance after the crowd is built. It replaces the instanced attributes of 1.x because an attribute is indexed by the *drawn slot*, and the drawn slot stops being the instance the moment a renderer culls per instance (ADR-0016). Three words that must not blur: instance playback is the values, the pack is their layout, the playback texture is what holds them.
_Avoid_: pack texture (the pack is the layout, not the texture), instance texture, playback attributes (1.x's carrier, gone)

**Instance desync**:
A crowd's instances not moving in lockstep, achieved by giving each one a **`startTime` in the past**: an instance that began a moment ago is that far into its clip already. Names that, never the whole pack.
_Avoid_: jitter, stagger, phase offset (the field it named, `timeOffset`, is gone)

**Crowd**:
Many VAT instances rendered in a single draw call with independent, desynced animation — the target workload. Contrast with cloned `SkinnedMesh`es (N draw calls, per-frame CPU skeletons).
_Avoid_: swarm, batch

### The demo

**Demo**:
A page a stranger opens to see the library work — one per renderer, WebGL the default. Not a test, not a harness, not a fixture: if a thing in the demo folder is not on that page, it does not belong there.
_Avoid_: example (it has meant the page, the test suite and the README snippet all at once), sample, playground

**Parity gate**:
The manual pixel-comparison release check that the WebGL and TSL decode paths produce the same image. A release step, not a demo — it lives outside the demo folder and reaches into it, never the reverse.
_Avoid_: parity test, parity example

**Script table**:
The `scripts` block in the root `package.json`, and the list `pnpm run` prints from it. It holds the verbs a person types — `dev` (opens the demo), `test`, `build`, `typecheck` — and nothing else: release and CI machinery is a `node` invocation in `scripts/` or `release/`, indexed by docs/releasing.md. It is the repository's front door, which is why it is pinned by the release suite.
_Avoid_: npm scripts, task runner, commands

**Hero image**:
The animated image at the top of the README: the demo's own count slider dragged from one robot to the whole crowd, captured headlessly by `node release/hero/capture.mjs`. Produced from the deployed page, never drawn or screenshotted by hand — so it cannot be prettier than the demo it advertises (ADR-0012). A release step, like the parity gate.
_Avoid_: screenshot, banner, teaser

**Texture panel**:
The baked VAT drawn on screen down the right of a demo page, one cursor per instance marking the frame row that instance is sampling. The demo's evidence, visible by default — not a diagnostic (ADR-0012).
_Avoid_: VAT debug view, debug panel

**HUD**:
The demo's readouts, top-left and on screen at rest: draw calls (emphasised, because it is the number that does not move), the robot count, and the VAT's dimensions and memory. Every figure is measured or derived, never stated.
_Avoid_: caption, overlay (that is the engineering overlay: stats-gl and frame timings, behind a toggle)

**Count**:
The demo's single control: how many robots are on screen. The walking and running bands are a property of the count — they are what raising it reveals, not a layout the demo is arranged into.
_Avoid_: zone, density, crowd size
