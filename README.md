# three-vat

[![CI](https://github.com/MikeFernandez-Pro/three-vat/actions/workflows/ci.yml/badge.svg)](https://github.com/MikeFernandez-Pro/three-vat/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/three-vat.svg)](https://www.npmjs.com/package/three-vat)
[![license: MIT](https://img.shields.io/npm/l/three-vat.svg)](./LICENSE)

Bake a glTF `AnimationClip` into GPU textures and animate **hundreds or thousands of instanced characters with zero per-frame CPU** — one draw call, no `SkinnedMesh` per character.

VAT (Vertex Animation Texture) is battle-tested in Unity/Unreal but has been a gap on the three.js side: only scattered demos, no maintained package, nothing in drei. `three-vat` bakes the VAT **at runtime, directly from the glTF** — so any Mixamo/Sketchfab asset works with zero pipeline, and there is exactly one way to produce a VAT.

## Live demos

- **[WebGL crowd](https://mikefernandez-pro.github.io/three-vat/)** — 340 robots, mixed clips, one mesh, through the GLSL decode path. It is the site's root, so the link opens on a running crowd.
- **[WebGPU crowd](https://mikefernandez-pro.github.io/three-vat/webgpu_crowd.html)** — the same crowd through the TSL decode path, on `WebGPURenderer`.

Both pages carry a live draw-call counter and a view of the baked textures, with
cursors on the frame rows each instance is sampling, and each links to the other.
Source in [`examples/`](./examples); they deploy from `main` on every push.

> **Status: `1.0.0`** — the npm badge above reads the registry, so it is the one to trust for what is actually published. The library is **three surfaces**, and all three work: the core baker (`three-vat`), the WebGL/GLSL decode (`three-vat/webgl`), and the WebGPU/TSL decode (`three-vat/tsl`). The two decode paths read one shared instance-playback contract and export the same `createVATMesh`, so nothing documented here is true on one renderer and false on the other. Where the renderers genuinely differ — shadow materials, the `time` clock's type, and what the TSL node builder needs to re-apply instancing — it is called out where it arises. The baker and the WebGL decode are covered by tests; the TSL path is tested structurally, because CI has no GPU, and that the two paths decode *pixel-identically* is a manual release gate ([`pnpm parity`](./docs/releasing.md)). See [`docs/DESIGN.md`](./docs/DESIGN.md) and [`docs/adr/`](./docs/adr) for the full rationale, [What 1.0 does not do](#what-10-does-not-do) for the deferred work, and [`CHANGELOG.md`](./CHANGELOG.md) for release notes.

## Install

```bash
npm install three-vat three
```

`three` (>= 0.185) is a peer dependency.

## Bake

```ts
import { bakeVAT } from 'three-vat'

// gltf loaded via GLTFLoader — pass the subtree root, not a mesh.
const clips = gltf.animations.filter((c) => c.name !== 'TPose')
const vat = bakeVAT(gltf.scene, clips, { fps: 30 })
// vat: { positionTexture, normalTexture, geometry, materials, clips, bounds, ... }
```

The bake unit is the **whole subtree**, merged into one vertex set and recorded in root space ([ADR-0008](./docs/adr/0008-a-vat-bakes-a-posed-subtree-not-a-skinnedmesh.md)). A VAT only records *where a vertex ended up*, never how it got there, so one call handles a single `SkinnedMesh`, a morph-target mesh, a hierarchy of rigid node-animated parts (three.js `RobotExpressive`), or any mix — with no classification by the caller.

Two consequences worth knowing up front:

- **Render `vat.geometry`, not your source mesh.** The merged vertex ordering is the baker's, and the textures are indexed by it.
- **Materials are never merged.** `vat.materials` lines up with `vat.geometry.groups`, giving one draw call per material. VAT collapses *instance* count, not *material* count — a 500-robot crowd with 3 materials is 3 draw calls, not 1 and not 500.

The VAT is a flat `vertexCount` × `totalFrames` texture pair, so **both** axes are bounded by the GPU's max texture dimension. The baker is renderer-agnostic and defaults to a conservative `16384`; pass the real limit whenever you have a renderer, or a bake that allocates on desktop can fail on mobile (commonly 4096–8192):

```ts
import { getMaxTextureSize } from 'three-vat/webgl' // or 'three-vat/tsl'

const vat = bakeVAT(gltf.scene, clips, {
  fps: 30,
  maxTextureSize: getMaxTextureSize(renderer),
})
```

## Render a crowd

One call on either renderer. The import line is the only difference:

```ts
import { createVATMesh } from 'three-vat/webgl' // WebGLRenderer
// import { createVATMesh } from 'three-vat/tsl'  ← WebGPURenderer: the only line that changes
```

```ts
// instances: { clip, timeOffset, speed }[] — one per character.
const { mesh, time } = createVATMesh(vat, instances)
mesh.castShadow = mesh.receiveShadow = true
scene.add(mesh)

// place the crowd
for (let i = 0; i < instances.length; i++) mesh.setMatrixAt(i, matrix)
mesh.instanceMatrix.needsUpdate = true
mesh.computeBoundingSphere() // or frustumCulled = false, if matrices change every frame

// per frame:
time.value = clock.elapsedTime
```

The call clones the baked geometry, writes the per-instance playback attributes, and prepares one material per material group — so a crowd mixes clips, phases and playback rates on either renderer, from the same `instances` array ([ADR-0009](./docs/adr/0009-both-decode-paths-read-one-instance-playback-contract.md)).

Shadows are the one place the renderers genuinely differ, and the call absorbs it: on WebGL it attaches the patched depth and distance materials the shadow passes need (miss them by hand and the crowd's body animates while its shadow stays in the bind pose); on TSL it attaches nothing, because `positionNode` already feeds the depth pass. Either way you write `castShadow` and nothing else.

Instance matrices and `castShadow`/`receiveShadow` stay yours: only you know where the crowd stands and whether the scene has shadows at all.

The returned `time` is the same `{ value }` clock on both paths. The one other place the signatures differ is supplying your own: `options.time` is a `THREE.IUniform` on the WebGL path and a TSL `uniform(0)` on the TSL path, because that is what each renderer's material can read. Let the call make its own — as above — and even that line is identical.

<details>
<summary>By hand on WebGL, when you are not rendering onto a plain <code>InstancedMesh</code></summary>

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

</details>

<details>
<summary>By hand on TSL, and the zero-config default</summary>

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

Omit `geometry` and you get the zero-config default instead: every instance plays `clipIndex`, phase-desynced by `desync` seconds hashed from `instanceIndex`, with no attributes to write.

</details>

## Bake cost, and baking in a Web Worker

A VAT is produced exactly one way — `bakeVAT` at runtime
([ADR-0010](./docs/adr/0010-drop-the-offline-format-runtime-bake-is-the-library.md)).
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

## Trade-offs

- **vs N × `SkinnedMesh`:** N draw calls + per-frame CPU skeletons → VAT is 1 draw call, zero per-frame CPU, 2 texel fetches per vertex. The headline.
- **vs bone-texture instancing:** smaller textures and supports blending, but more fetches per vertex. VAT also captures morph/non-skeletal deformation for free.
- **VAT limits:** no runtime IK/blending, discrete frames, memory cost (`verts × frames × 16 B × 2` textures). No clip crossfade — see [What 1.0 does not do](#what-10-does-not-do).
- **Skinned normals:** positions bake exactly under any rig. Normals reproduce what three's own skinning shader renders — linear-blend skinning transforms a normal by the skin matrix rather than its inverse-transpose, exact for rigid and uniformly-scaled bones, an approximation otherwise. Non-uniform bone scale is where that shows, so `bakeVAT` warns once, naming the bone.

## What 1.0 does not do

Named rather than left to be discovered. None of these is a known defect; each
is a decision, with the reasoning recorded where it was made.

- **No clip crossfade.** An instance cuts between clips, it does not blend.
  Crossfade doubles the per-vertex texel fetches (2 → 4) and adds per-instance
  transition state, which is not worth spending before the single-clip decode is
  proven on both paths ([ADR-0007](./docs/adr/0007-v1-scope-library-only.md)).
  The instance-attribute layout reserves room for a second clip index, so it
  stays a non-breaking addition.
- **No LOD.** Every instance samples the VAT at full vertex count, whatever its
  distance.
- **No `npx vat-bake` CLI, and no file format for it to write.** The offline
  format was removed in 1.0 and the runtime bake is the only way to produce a
  VAT ([ADR-0010](./docs/adr/0010-drop-the-offline-format-runtime-bake-is-the-library.md));
  the design a CLI would build on is kept on record in the superseded
  [ADR-0003](./docs/adr/0003-offline-format-float16-bin-plus-manifest.md), so
  reviving it is a decision rather than a fresh design problem.
- **No React/drei hook or component.** A downstream contribution rather than a
  library surface, and `createVATMesh` is what makes it thin enough to be one.
- **No `bakeVATInWorker` helper.** 1.0 ships the [recipe](#bake-cost-and-baking-in-a-web-worker)
  instead: adding a second, async way to bake while the API stabilizes is the
  two-entry-point split [ADR-0008](./docs/adr/0008-a-vat-bakes-a-posed-subtree-not-a-skinnedmesh.md)
  refused, and demand should decide it.
- **glTF/GLB input only**, and multi-material meshes are rejected rather than
  split by geometry group — `GLTFLoader` emits one mesh per primitive, so the
  case is unreachable through the only input surface there is.

## Development

```bash
pnpm install
pnpm fetch:test-assets   # Soldier.glb — too big for git, so the skinned real-asset tests skip without it
pnpm test                # baker core and the release suite — pure CPU, no GPU needed
pnpm test:examples       # the demo's own suite (crowd layout, WebGPU support probe)
pnpm typecheck
pnpm typecheck:release
pnpm typecheck:examples
pnpm build
pnpm example             # serves the demo pages in examples/ (model bundled)
pnpm parity              # cross-path pixel-diff gate — needs a GPU and a WebGPU browser
```

`examples/` is a workspace package, so one `pnpm install` at the root covers
both it and the library. It is a multi-page app: one page per renderer, each
self-contained by design
([ADR-0011](./docs/adr/0011-one-example-per-renderer-duplicated-on-purpose.md)).
There is no landing page — `index.html` is the WebGL demo, so a link to the site
opens on a running crowd, and each page links to the other in its HUD. The build
entries are globbed from those HTML files, so adding a demo is adding a file.
`pnpm build:examples` produces the static site that `.github/workflows/pages.yml`
publishes from `main`; it builds with a relative base, so it also runs from any
subpath or a `file://` open.

The WebGPU page checks for an adapter before it loads anything else and points
at the WebGL demo when there is none — `WebGPURenderer` would otherwise fall
back to its WebGL backend and quietly draw the WebGPU demo through GLSL.

`pnpm parity` is the one check that is not in CI and not optional. It renders
one bake through both decode paths at the same camera, lights and time and
compares the frames pixel by pixel — the only thing that can catch a decode
subtly wrong on one path only, and the only thing that needs a real GPU on both
backends. It is a **required gate before publishing**, not a test; see
[docs/releasing.md](./docs/releasing.md) for what it checks and how to read a
failure.

The suite is green on a fresh clone with no network: the real-asset tests skip
when their asset is missing. Run `pnpm fetch:test-assets` before touching the
baker, so a real skinned character is actually being baked — see
[docs/test-assets.md](./docs/test-assets.md).

## License

MIT
