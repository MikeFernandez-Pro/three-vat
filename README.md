# three-vat

[![CI](https://github.com/MikeFernandez-Pro/three-vat/actions/workflows/ci.yml/badge.svg)](https://github.com/MikeFernandez-Pro/three-vat/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/three-vat.svg)](https://www.npmjs.com/package/three-vat)
[![license: MIT](https://img.shields.io/npm/l/three-vat.svg)](./LICENSE)

Bake a glTF `AnimationClip` into GPU textures and animate **hundreds or thousands of instanced characters with zero per-frame CPU** — one draw call, no `SkinnedMesh` per character.

VAT (Vertex Animation Texture) is battle-tested in Unity/Unreal but has been a gap on the three.js side: only scattered demos, no maintained package, nothing in drei. `three-vat` bakes the VAT **at runtime, directly from the glTF** — so any Mixamo/Sketchfab asset works with zero pipeline, and there is exactly one way to produce a VAT.

> **Status: early release — `0.3.0`, published on npm.** The baker core (skinning, morph targets **and** rigid node-animated subtrees) and the WebGL decode are covered by tests. The TSL/WebGPU path is tested structurally — CI has no GPU, so the node graph is asserted, and that the two paths decode pixel-identically is a manual release gate. See [`docs/DESIGN.md`](./docs/DESIGN.md) and [`docs/adr/`](./docs/adr) for the full rationale, and [`CHANGELOG.md`](./CHANGELOG.md) for release notes.

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

## Render a crowd — WebGL (`WebGLRenderer`)

```ts
import { createVATMesh } from 'three-vat/webgl'

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

One call clones the baked geometry, writes the instance-playback attributes, patches one material per material group, and attaches the shadow-pass materials — the depth material for directional and spot lights, the distance material for point lights. Those last two are the step hand-wiring usually misses, and the symptom is a crowd whose shadows are stuck in the bind pose while its body animates.

Instance matrices and `castShadow`/`receiveShadow` stay yours: only you know where the crowd stands and whether the scene has shadows at all.

<details>
<summary>The same thing by hand, when you are not rendering onto a plain <code>InstancedMesh</code></summary>

```ts
import { addVATInstanceAttributes } from 'three-vat'
import { createVATUniforms, createVATDepthMaterial, patchVATMaterial } from 'three-vat/webgl'

const uniforms = createVATUniforms()

// vat.geometry already carries the all-frames bounding box/sphere, so instances
// never cull mid-animation.
const geometry = vat.geometry.clone()
// Instance playback — `{ clip, timeOffset, speed }` per instance — is a core
// contract both decode paths read, not a WebGL-only concept ([ADR-0009](./docs/adr/0009-both-decode-paths-read-one-instance-playback-contract.md)).
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

## Render a crowd — TSL (`WebGPURenderer`)

```ts
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { addVATInstanceAttributes } from 'three-vat'
import { vatNodes } from 'three-vat/tsl'

const geometry = vat.geometry.clone()
// The same core contract, and the same `instances` array, as the WebGL path.
addVATInstanceAttributes(geometry, instances) // instances: { clip, timeOffset, speed }[]

// Pass the geometry and each instance plays its own clip, phase and rate.
const { positionNode, normalNode, time } = vatNodes(vat, { geometry })
const material = new MeshStandardNodeMaterial()
material.positionNode = positionNode
material.normalNode = normalNode

const mesh = new THREE.InstancedMesh(geometry, material, instances.length)
mesh.castShadow = mesh.receiveShadow = true

// per frame:
time.value = clock.elapsedTime
```

Shadows just work on the TSL path (`positionNode` feeds the depth pass) — no depth material, unlike WebGL. Omit `geometry` and you get the zero-config default instead: every instance plays `clipIndex`, phase-desynced by `desync` seconds hashed from `instanceIndex`, with no attributes to write.

## Offline format — deprecated, removed in 1.0

> **Do not use `serializeVAT` / `loadVAT`.** They still ship in `0.3.0` for
> compatibility and are removed in `1.0`
> ([ADR-0010](./docs/adr/0010-drop-the-offline-format-runtime-bake-is-the-library.md)).

The format stores the texel buffers and a manifest, but *not* the geometry. Since
`0.3.0` a bake merges the whole subtree into a new vertex set and the textures are
indexed by that ordering, so a serialized VAT can only be rendered by reloading the
source glTF and re-running the merge — the work the file existed to save. A VAT
restored by `loadVAT` has no `geometry` or `materials`, so it is **not**
interchangeable with a freshly-baked one, whatever earlier releases claimed.

Bake at runtime instead. The baker is pure CPU and touches no renderer, so if bake
time hurts on load, run `bakeVAT` in a Web Worker and transfer the texel buffers back.

## Trade-offs

- **vs N × `SkinnedMesh`:** N draw calls + per-frame CPU skeletons → VAT is 1 draw call, zero per-frame CPU, 2 texel fetches per vertex. The headline.
- **vs bone-texture instancing:** smaller textures and supports blending, but more fetches per vertex. VAT also captures morph/non-skeletal deformation for free.
- **VAT limits:** no runtime IK/blending, discrete frames, memory cost (`verts × frames × 16 B × 2` textures). No clip crossfade in v1.
- **Skinned normals:** positions bake exactly under any rig. Normals reproduce what three's own skinning shader renders — linear-blend skinning transforms a normal by the skin matrix rather than its inverse-transpose, exact for rigid and uniformly-scaled bones, an approximation otherwise. Non-uniform bone scale is where that shows, so `bakeVAT` warns once, naming the bone.

## Development

```bash
pnpm install
pnpm fetch:test-assets   # Soldier.glb — too big for git, so the skinned real-asset tests skip without it
pnpm test                # baker core — pure CPU, no GPU needed
pnpm typecheck
pnpm build
pnpm example             # runs the robot-crowd demo in examples/ (model bundled)
```

The suite is green on a fresh clone with no network: the real-asset tests skip
when their asset is missing. Run `pnpm fetch:test-assets` before touching the
baker, so a real skinned character is actually being baked — see
[docs/test-assets.md](./docs/test-assets.md).

## License

MIT
