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
A named animation range (e.g. `walk`, `run`) baked into a contiguous band of frame rows. The **clip table** maps each name to `{ startFrame, frames, fps }`.
_Avoid_: animation, action, track

**Frame**:
One baked time sample of the whole mesh — a single row (y) of a VAT texture. Vertices index the x axis.
_Avoid_: keyframe (a frame is a resampled snapshot, not an authored key)

**Delta**:
A baked position stored as `skinnedPosition − bindPosition`; the shader reconstructs with `position + delta`. Normals are stored absolute, not as deltas.
_Avoid_: offset, displacement

**Position texture / Normal texture**:
The two VAT layers — one for vertex positions (delta-encoded), one for vertex normals (absolute). Both are needed; lighting is visibly wrong with positions alone.

**Decode**:
The vertex-shader-side sampling of a VAT (two `texelFetch`es + `mix`) that turns texels back into displaced geometry. Each renderer has a **decode path**: **WebGL** (GLSL via `onBeforeCompile`) and **TSL** (node material).
_Avoid_: unpack, read

**Instance playback**:
The per-instance animation state — `{ clip, timeOffset, speed }` — carried as instanced attributes and read by every decode path. One contract, written once by the core baker surface, so both decode paths render the same crowd.
_Avoid_: instance state, instance data

**Instance desync**:
The `timeOffset` component of instance playback: the phase offset that stops a crowd from moving in lockstep. Names that one field, never the whole triple.
_Avoid_: jitter, stagger

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

**Count**:
The demo's single control: how many robots are on screen. The walking and running bands are a property of the count — they are what raising it reveals, not a layout the demo is arranged into.
_Avoid_: zone, density, crowd size
