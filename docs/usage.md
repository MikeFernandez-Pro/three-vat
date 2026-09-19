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
- [Draw-call arithmetic](#draw-call-arithmetic)
- [Bake cost, and baking in a Web Worker](#bake-cost-and-baking-in-a-web-worker)
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

  const position = vat.positionTexture.image.data as Float32Array
  const normal = vat.normalTexture.image.data as Float32Array
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
    [position.buffer, normal.buffer],
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
        normalTexture: makeVATTexture(d.normal, d.vertexCount, d.totalFrames),
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

A `bakeVATInWorker` helper is deferred, for the reason in
[What 1.0 does not do](#what-10-does-not-do).

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
// Instance playback — `{ clip, timeOffset, speed }` per instance — is a core
// contract both decode paths read, not a WebGL-only concept.
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
  (`verts × frames × 16 B × 2` textures). No clip crossfade — see below.
- **Skinned normals:** positions bake exactly under any rig. Normals reproduce
  what three's own skinning shader renders — linear-blend skinning transforms a
  normal by the skin matrix rather than its inverse-transpose, exact for rigid
  and uniformly-scaled bones, an approximation otherwise. Non-uniform bone scale
  is where that shows, so `bakeVAT` warns once, naming the bone.

## What 1.0 does not do

Named rather than left to be discovered. None of these is a known defect; each
is a decision, with the reasoning recorded where it was made.

- **No clip crossfade.** An instance cuts between clips, it does not blend.
  Crossfade doubles the per-vertex texel fetches (2 → 4) and adds per-instance
  transition state, which is not worth spending before the single-clip decode is
  proven on both paths ([ADR-0007](./adr/0007-v1-scope-library-only.md)).
  The instance-attribute layout reserves room for a second clip index, so it
  stays a non-breaking addition.
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
