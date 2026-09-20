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

- [Texture ceilings](#texture-ceilings)
- [Halving the VAT: `bakeNormals: false`](#halving-the-vat-bakenormals-false)
- [Draw-call arithmetic](#draw-call-arithmetic)
- [Bake cost, and baking in a Web Worker](#bake-cost-and-baking-in-a-web-worker)
- [Loop modes: once, twice, back and forth](#loop-modes-once-twice-back-and-forth)
- [Declaring the defaults at the bake](#declaring-the-defaults-at-the-bake)
- [Changing one instance after the crowd is built](#changing-one-instance-after-the-crowd-is-built)
- [By hand, on either path](#by-hand-on-either-path)
- [Trade-offs](#trade-offs)
- [What 1.0 does not do](#what-10-does-not-do)

## Texture ceilings

A VAT is a flat `vertexCount` × `totalFrames` texture pair, so **both** axes are
bounded by the GPU's max texture dimension. The baker is renderer-agnostic and
defaults to a conservative `16384`; pass the real limit whenever you have a
renderer, or a bake that allocates on desktop can fail on mobile (commonly
4096–8192):

```ts
import { bakeVAT } from 'three-vat'
import { getMaxTextureSize } from 'three-vat/webgl' // or 'three-vat/tsl'

const vat = bakeVAT(gltf.scene, clips, {
  fps: 30,
  maxTextureSize: getMaxTextureSize(renderer),
})
```

Width is your vertex count and height is every frame of every clip stacked, so
the height axis is the one you steer: fewer clips, or a lower `fps`.

## Halving the VAT: `bakeNormals: false`

A VAT costs `verts × frames × 16 B × 2` — two layers, positions and normals.
`fps` and clip count steer the `frames` term. The other dial is the `× 2`:

```ts
const vat = bakeVAT(gltf.scene, clips, { bakeNormals: false })
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
// The pairing to reach for: half the memory, and correct deformed normals.
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

## Draw-call arithmetic

**Materials are never merged.** `vat.materials` lines up with
`vat.geometry.groups`, giving one draw call per material. VAT collapses
*instance* count, not *material* count — a 500-robot crowd with 3 materials is
3 draw calls, not 1 and not 500.

That is the whole cost model: the draw calls are the number of materials on the
source subtree, and adding instances adds none. If you want the crowd in one
call, merge the materials in your asset before baking; the library will not do
it for you, because collapsing materials changes what the crowd looks like.

## Bake cost, and baking in a Web Worker

A VAT is produced exactly one way — `bakeVAT` at runtime
([ADR-0010](./adr/0010-drop-the-offline-format-runtime-bake-is-the-library.md)).
There is no file format to write or load, so the one cost to budget is the bake
itself, once at load. Measured on `three@0.185.1` (Node, Apple Silicon, mean of
3 runs after warm-up):

| Asset | Clips | fps | Rows | Bake |
|---|---|---|---|---|
| `RobotExpressive` (rigid, 7 214 v) | 3 (the demo) | 30 | 158 | 97 ms |
| `RobotExpressive` | 5 | 30 | 313 | 178 ms |
| `RobotExpressive` | 14 (all) | 30 | 585 | 330 ms |
| `RobotExpressive` | 14 (all) | 60 | 1 168 | 659 ms |
| `Soldier` (skinned, 7 434 v) | 4 (all) | 30 | 113 | 250 ms |
| `Soldier` (skinned) | 4 (all) | 60 | 224 | 492 ms |

Cost is linear in `vertices × frames`, and **a skinned vertex costs ~4× per
frame row what a rigid one does** (2.2 ms/row here vs 0.56) — the four-weight
bone blend is the hot loop. So budget by rows, and halve `fps` before you cut
clips. A 20k-vertex skinned character with 6 clips at 30 fps extrapolates to
~1.8 s on this machine and several seconds on a mid-range phone — enough to
matter, and the point at which the bake belongs off the main thread.

It can go there as-is: **the baker is pure CPU and never touches the renderer**,
so it runs in a Web Worker, with the texel buffers transferred back at no copy
cost. The worker loads the glTF and bakes; the main thread rebuilds the
textures and the geometry from plain buffers.

```ts
// bake.worker.ts
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { bakeVAT } from 'three-vat'

self.onmessage = async ({ data: { url, fps, maxTextureSize } }) => {
  const gltf = await new GLTFLoader().loadAsync(url)
  const vat = bakeVAT(gltf.scene, gltf.animations, { fps, maxTextureSize })

  // Whatever typed array the bake chose — carried across as an opaque view,
  // never read as numbers here (see the note under this recipe).
  const position = vat.positionTexture.image.data as ArrayBufferView
  // `null` when the bake was told to skip it — see `bakeNormals` above.
  const normal = vat.normalTexture?.image.data as ArrayBufferView | undefined
  const index = vat.geometry.getIndex()

  self.postMessage(
    {
      position,
      normal,
      // Every attribute the merge produced — position, normal, and uv/color
      // when the source had them. Carry each itemSize rather than guessing it.
      attributes: Object.fromEntries(
        Object.entries(vat.geometry.attributes).map(([name, a]) => [
          name,
          { array: a.array, itemSize: a.itemSize },
        ]),
      ),
      index: index?.array,
      groups: vat.geometry.groups,
      clips: vat.clips,
      bounds: { min: vat.bounds.min.toArray(), max: vat.bounds.max.toArray() },
      vertexCount: vat.vertexCount,
      totalFrames: vat.totalFrames,
    },
    // Transferred, not copied — the texel buffers are the large part.
    [position.buffer, ...(normal ? [normal.buffer] : [])],
  )
}
```

```ts
// main thread
import * as THREE from 'three'
import { makeVATTexture } from 'three-vat'
import { createVATMesh, getMaxTextureSize } from 'three-vat/webgl' // or 'three-vat/tsl'
import type { VAT } from 'three-vat'

// `renderer` is your WebGLRenderer (or WebGPURenderer), already created — only
// the main thread can ask the GPU for its limits.
const worker = new Worker(new URL('./bake.worker.ts', import.meta.url), { type: 'module' })

function bakeInWorker(url: string, fps = 30): Promise<VAT> {
  return new Promise((resolve) => {
    worker.onmessage = ({ data: d }) => {
      const geometry = new THREE.BufferGeometry()
      for (const [name, { array, itemSize }] of Object.entries(d.attributes)) {
        geometry.setAttribute(name, new THREE.BufferAttribute(array, itemSize))
      }
      if (d.index) geometry.setIndex(new THREE.BufferAttribute(d.index, 1))
      for (const g of d.groups) geometry.addGroup(g.start, g.count, g.materialIndex)

      const bounds = new THREE.Box3(
        new THREE.Vector3(...d.bounds.min),
        new THREE.Vector3(...d.bounds.max),
      )
      // The union-of-all-frames volume, or a deformed crowd culls mid-animation.
      geometry.boundingBox = bounds.clone()
      geometry.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere())

      resolve({
        positionTexture: makeVATTexture(d.position, d.vertexCount, d.totalFrames),
        normalTexture: d.normal
          ? makeVATTexture(d.normal, d.vertexCount, d.totalFrames)
          : null,
        geometry,
        // One per group, in `materialIndex` order — see the note below.
        materials: d.groups.map(() => new THREE.MeshStandardMaterial()),
        clips: d.clips,
        bounds,
        vertexCount: d.vertexCount,
        totalFrames: d.totalFrames,
        encoding: 'delta',
      })
    }
    worker.postMessage({ url, fps, maxTextureSize: getMaxTextureSize(renderer) })
  })
}

const { mesh, time } = createVATMesh(await bakeInWorker('/robot.glb'), instances)
```

Two things do not cross the wire, both by nature rather than by omission:

- **Materials.** A `Material` holds textures and GPU state, so it has to be
  built on the main thread. The placeholder above is a stand-in: `materials`
  must have one entry per `geometry.groups[].materialIndex`, or every group past
  the first renders undefined. For a glTF's real materials, load it a second
  time on the main thread (the browser serves it from cache) and take
  `gltf.scene`'s materials in the same order the merge recorded them.
- **The renderer's `maxTextureSize`**, which only the main thread can ask for —
  read it there and pass it in, as the snippet does.

**The typed array behind `image.data` is not part of the contract.** Today both
textures hold a `Float32Array`; a narrower encoding
([#29](https://github.com/MikeFernandez-Pro/three-vat/issues/29)) may change
that in a minor release, on purpose and without a major. So the recipe moves the
buffer as an opaque view and hands it back to `makeVATTexture`, and code that
reads floats out of a VAT texture is reading an implementation detail.

A `bakeVATInWorker` helper is deferred, for the reason in
[What 1.0 does not do](#what-10-does-not-do).

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
]
```

| Field | Default | Means |
| --- | --- | --- |
| `loopMode` | `LoopMode.Repeat` | `Repeat`, `Once` or `PingPong` — `THREE.LoopRepeat` / `LoopOnce` / `LoopPingPong` |
| `repetitions` | endless for `Repeat`, `1` otherwise | How many times to play the clip. `INFINITE_REPETITIONS` (`-1`) is endless; `Infinity` does not survive a `Float32Array`, so the sentinel is converted once, at the boundary |
| `endMode` | `EndMode.Clamp` | `Clamp` holds the last frame, `Rewind` returns to the first |

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
// …and, for an instance mid-fade, `fadeRow` and `fadeWeight` alongside them.
```

`resolveVATFrame` is the **one definition** of what a loop mode means: both
decode paths transcribe it, neither invents it, and it is the only form of that
arithmetic CI can evaluate — a GLSL string and a TSL node graph both need a GPU.

## Declaring the defaults at the bake

Repeating `loopMode: LoopMode.Once, endMode: EndMode.Clamp` at every one of a
thousand corpses is a thousand chances to disagree. Declare it once instead:
`bakeVAT` takes an `AnimationClip` **or** an `AnimationAction`, in the same
array, and an action's configuration lands in the clip table.

```ts
const mixer = new THREE.AnimationMixer(gltf.scene)
const death = mixer.clipAction(deathClip)
death.loop = THREE.LoopOnce
death.clampWhenFinished = true

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
| `loop`, `repetitions`, `clampWhenFinished` | read into the clip table |
| `timeScale` | read as the clip's default `speed` |
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
clips is crossfade, and is future work — the short
[pose-freeze fade](#the-fade-and-its-limit) a changed instance gets is one
frozen pose, not a second clip still playing.

What a bare clip gets — `LoopMode.Repeat`, endless, `speed: 1`, `EndMode.Clamp`
— are the library defaults of the table above. `Clamp` is the deliberate
divergence from three, argued in the previous section; an action states which it
wants, and is believed. Which is the one place the two inputs part company, and
worth knowing before it surprises you: an action configured `LoopOnce` with
`clampWhenFinished` left alone **rewinds**, because that is what it says, while
the same clip handed over bare clamps. Say `clampWhenFinished = true` on the
action and the two agree again.

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

function onHit(enemyId: number) {
  setVATInstance(mesh.geometry, enemyId, {
    clip: vat.clips[2],      // "once, clamped" came with the bake
    startTime: time.value,
    fadeDuration: 0.1,       // blend out of whatever it was doing
  })
}
```

That is the whole controller. `mesh.geometry` is the geometry being rendered —
`createVATMesh` clones the bake's, so write to the mesh's, not to
`vat.geometry` — and `enemyId` is the instance's index, the same one
`setMatrixAt` takes. Only that instance's four floats per attribute are flagged
for upload, so a crowd of a thousand pays for the one that changed.

Nothing happens per frame afterwards. The written pack is a pure function of the
clock from there on, which is why there is no `update(dt)` here and no mixer:
the CPU touched this instance at the moment its animation changed, and will not
touch it again until the next one.

It is a plain function over a geometry rather than a mesh subclass on purpose —
a crowd rendered onto something other than a plain `InstancedMesh`
(`@three.ez/instanced-mesh`, say) writes its instances exactly the same way
([ADR-0014](./adr/0014-changing-an-instance-is-a-function-not-a-mesh-subclass.md)).

### Chaining: what happens when the clip ends

`endsAt` gives the exact clock time a finite animation finishes — the moment
`resolveVATFrame` first reports `finished` — or `null` for an endless loop. So
"play the hit reaction, then go back to walking" is one more write, scheduled at
a time already known:

```ts
import { endsAt, LoopMode, setVATInstance } from 'three-vat'

const react = { clip: hit, startTime: time.value, loopMode: LoopMode.Once }
setVATInstance(mesh.geometry, id, react)

const at = endsAt(react)
if (at !== null) {
  schedule(at, () => setVATInstance(mesh.geometry, id, { clip: walk, startTime: at }))
}
```

No per-frame polling, and no queue inside the library: scheduling is yours, and
the GPU never learns that a next clip exists.

### The fade, and its limit

`fadeDuration` freezes the pose the instance was in at `startTime` and blends
away from it, so the switch does not pop. Read that literally: it keeps **one
frozen phase** of the outgoing clip, not the clip still playing. A tenth of a
second into a death, nobody can see the difference. Half a second into a
walk → run transition, the instance skates — its walk stopped dead the instant
the transition began.

So `fadeDuration` is capped at `MAX_FADE_DURATION` (0.25s) rather than trusted,
and the fade is wall clock: the incoming clip's `speed` does not stretch it.

```ts
import { MAX_FADE_DURATION } from 'three-vat'
```

This fade is **provisional**. A real two-clip crossfade is a second live
playback state and four texel fetches per vertex; it is tracked separately and
will *replace* this, not sit beside it
([ADR-0015](./adr/0015-the-pose-freeze-fade-is-provisional-and-capped.md)). Use
it for short transitions into one-shots — which is what it is for — and do not
build anything else on `aVatFade`.

## By hand, on either path

`createVATMesh` is the exported primitives composed in the one order that is
correct. Reach for them directly only when you are rendering onto something
other than a plain `InstancedMesh`.

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
import { addVATInstanceAttributes } from 'three-vat'
import { createVATUniforms, createVATDepthMaterial, patchVATMaterial } from 'three-vat/webgl'

const uniforms = createVATUniforms()

// vat.geometry already carries the all-frames bounding box/sphere, so instances
// never cull mid-animation.
const geometry = vat.geometry.clone()
// Instance playback — `{ clip, startTime, speed }` per instance, plus the
// optional `{ loopMode, repetitions, endMode }` above — is a core contract both
// decode paths read, not a WebGL-only concept. It is carried as three instanced
// `vec4`s; `startTime` is an absolute clock time, so a crowd desyncs by having
// each instance start a moment in the past.
addVATInstanceAttributes(geometry, instances)

// One patched material per source material, sharing one clock.
const materials = vat.materials.map((source) => {
  const material = source.clone()
  patchVATMaterial(material, vat, uniforms)
  return material
})

const mesh = new THREE.InstancedMesh(geometry, materials, instances.length)
// Correct instanced shadows: depth for directional/spot lights, distance for point lights.
mesh.customDepthMaterial = createVATDepthMaterial(vat, uniforms)
mesh.customDistanceMaterial = patchVATMaterial(new THREE.MeshDistanceMaterial(), vat, uniforms)

// per frame:
uniforms.uVatTime.value = clock.elapsedTime
```

### TSL, and the zero-config default

```ts
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { addVATInstanceAttributes } from 'three-vat'
import { vatNodes } from 'three-vat/tsl'

const geometry = vat.geometry.clone()
addVATInstanceAttributes(geometry, instances)

// The mesh is built first, because the decode is built from it.
const material = new MeshStandardNodeMaterial()
const mesh = new THREE.InstancedMesh(geometry, material, instances.length)

// `geometry`: each instance plays its own clip, phase and rate.
// `instancedMesh`: the decode re-applies this mesh's instancing itself, because
// three applies the instance matrix to `positionLocal` *before* it reads
// `positionNode` — so the delta has to be added in the geometry's own space and
// instanced afterwards. Omit it only for a single, non-instanced mesh.
const { positionNode, time } = vatNodes(vat, { geometry, instancedMesh: mesh })
material.positionNode = positionNode

// per frame:
time.value = clock.elapsedTime
```

There is deliberately no `normalNode`: the decode writes `normalLocal` from
inside the vertex stage, exactly as the GLSL path writes `objectNormal`, and
three transforms and interpolates it from there. A material's `normalNode` is
built in the *fragment* stage and expected in view space, which is neither where
nor what a per-vertex, object-space VAT normal is.

Omit `geometry` and you get the zero-config default instead: every instance
plays `clipIndex`, phase-desynced by `desync` seconds hashed from
`instanceIndex`, with no attributes to write.

## Trade-offs

- **vs N × `SkinnedMesh`:** N draw calls + per-frame CPU skeletons → VAT is one
  draw call per material, zero per-frame CPU, 2 texel fetches per vertex. The
  headline.
- **vs bone-texture instancing:** smaller textures and supports blending, but
  more fetches per vertex. VAT also captures morph/non-skeletal deformation for
  free.
- **VAT limits:** no runtime IK/blending, discrete frames, memory cost
  (`verts × frames × 16 B × 2` textures — `× 1` with
  [`bakeNormals: false`](#halving-the-vat-bakenormals-false)). No clip
  crossfade, only a short fade out of a frozen pose — see below.
- **Skinned normals:** positions bake exactly under any rig. Normals reproduce
  what three's own skinning shader renders — linear-blend skinning transforms a
  normal by the skin matrix rather than its inverse-transpose, exact for rigid
  and uniformly-scaled bones, an approximation otherwise. Non-uniform bone scale
  is where that shows, so `bakeVAT` warns once, naming the bone.

## What 1.0 does not do

Named rather than left to be discovered. None of these is a known defect; each
is a decision, with the reasoning recorded where it was made.

- **No clip crossfade.** An instance switching clips blends out of a *frozen*
  pose — the [pose-freeze fade](#the-fade-and-its-limit), capped at 0.25s — not
  between two clips that are both still playing. A true crossfade doubles the
  per-vertex texel fetches (2 → 4) and adds per-instance transition state, which
  is not worth spending before the single-clip decode is proven on both paths
  ([ADR-0007](./adr/0007-v1-scope-library-only.md)). When it lands it replaces
  the freeze fade rather than joining it
  ([ADR-0015](./adr/0015-the-pose-freeze-fade-is-provisional-and-capped.md)).
- **No LOD.** Every instance samples the VAT at full vertex count, whatever its
  distance.
- **No `npx vat-bake` CLI, and no file format for it to write.** The offline
  format was removed in 1.0 and the runtime bake is the only way to produce a
  VAT ([ADR-0010](./adr/0010-drop-the-offline-format-runtime-bake-is-the-library.md));
  the design a CLI would build on is kept on record in the superseded
  [ADR-0003](./adr/0003-offline-format-float16-bin-plus-manifest.md), so
  reviving it is a decision rather than a fresh design problem.
- **No React/drei hook or component.** A downstream contribution rather than a
  library surface, and `createVATMesh` is what makes it thin enough to be one.
- **No `bakeVATInWorker` helper.** 1.0 ships the
  [recipe](#bake-cost-and-baking-in-a-web-worker) instead: adding a second,
  async way to bake while the API stabilizes is the two-entry-point split
  [ADR-0008](./adr/0008-a-vat-bakes-a-posed-subtree-not-a-skinnedmesh.md)
  refused, and demand should decide it.
- **glTF/GLB input only**, and multi-material meshes are rejected rather than
  split by geometry group — `GLTFLoader` emits one mesh per primitive, so the
  case is unreachable through the only input surface there is.
