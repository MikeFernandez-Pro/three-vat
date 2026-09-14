# three-vat

[![npm version](https://img.shields.io/npm/v/three-vat.svg)](https://www.npmjs.com/package/three-vat)
[![license: MIT](https://img.shields.io/npm/l/three-vat.svg)](./LICENSE)

Bake a glTF `AnimationClip` into GPU textures and animate **hundreds or thousands of instanced characters with zero per-frame CPU** — one draw call, no `SkinnedMesh` per character.

VAT (Vertex Animation Texture) is battle-tested in Unity/Unreal but has been a gap on the three.js side: only scattered demos, no maintained package, nothing in drei. `three-vat` bakes the VAT **at runtime, directly from the glTF** — so any Mixamo/Sketchfab asset works with zero pipeline — with an optional offline path that produces the identical texture.

> **Status: early release — `0.2.0`, published on npm.** The baker core (skinning **and** morph targets) and WebGL decode are covered by tests. The TSL/WebGPU path ships but is verified visually, not yet by automated tests. See [`docs/DESIGN.md`](./docs/DESIGN.md) and [`docs/adr/`](./docs/adr) for the full rationale, and [`CHANGELOG.md`](./CHANGELOG.md) for release notes.

## Install

```bash
npm install three-vat three
```

`three` (>= 0.185) is a peer dependency.

## Bake

```ts
import { bakeVAT } from 'three-vat'

// gltf loaded via GLTFLoader; sourceMesh is the SkinnedMesh in it.
const clips = gltf.animations.filter((c) => c.name !== 'TPose')
const vat = bakeVAT(gltf.scene, sourceMesh, clips, { fps: 30 })
// vat: { positionTexture, normalTexture, clips, bounds, vertexCount, totalFrames, encoding }
```

## Render a crowd — WebGL (`WebGLRenderer`)

```ts
import { addInstancedVATAttributes, createVATUniforms, createVATDepthMaterial, patchVATMaterial } from 'three-vat/webgl'

const uniforms = createVATUniforms()

const geometry = sourceMesh.geometry.clone()
addInstancedVATAttributes(geometry, instances) // instances: { clip, timeOffset, speed }[]
geometry.boundingBox = vat.bounds.clone()       // union of all frames — avoids culling pops
geometry.boundingSphere = vat.bounds.getBoundingSphere(new THREE.Sphere())

const material = sourceMesh.material.clone()
patchVATMaterial(material, vat, uniforms)

const mesh = new THREE.InstancedMesh(geometry, material, instances.length)
mesh.customDepthMaterial = createVATDepthMaterial(vat, uniforms) // correct instanced shadows
mesh.castShadow = mesh.receiveShadow = true

// per frame:
uniforms.uVatTime.value = clock.elapsedTime
```

## Render a crowd — TSL (`WebGPURenderer`)

```ts
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { vatNodes } from 'three-vat/tsl'

const { positionNode, normalNode, time } = vatNodes(vat, { clipIndex: 0, desync: 10 })
const material = new MeshStandardNodeMaterial()
material.positionNode = positionNode
material.normalNode = normalNode

// per frame:
time.value = clock.elapsedTime
```

Shadows just work on the TSL path (`positionNode` feeds the depth pass). v1 plays one clip per material with per-instance phase desync; use the WebGL path for mixed-clip crowds.

## Offline (bake once, ship the texture)

```ts
import { serializeVAT, loadVAT } from 'three-vat'

const { manifest, position, normal } = serializeVAT(vat, { precision: 'float16' })
// write manifest as JSON, position/normal as .bin — then later:
const vat = loadVAT({ manifest, position, normal })
```

The canonical format is a raw Float16 `.bin` + versioned JSON manifest (KTX2 rejected as default — its GPU compression doesn't apply to float data). The loaded VAT is interchangeable with a freshly-baked one.

## Trade-offs

- **vs N × `SkinnedMesh`:** N draw calls + per-frame CPU skeletons → VAT is 1 draw call, zero per-frame CPU, 2 texel fetches per vertex. The headline.
- **vs bone-texture instancing:** smaller textures and supports blending, but more fetches per vertex. VAT also captures morph/non-skeletal deformation for free.
- **VAT limits:** no runtime IK/blending, discrete frames, memory cost (`verts × frames × 16 B × 2` textures). No clip crossfade in v1.

## Development

```bash
pnpm install
pnpm test        # baker core — pure CPU, no GPU needed
pnpm typecheck
pnpm build
pnpm example     # runs the bird-tornado demo in examples/ (models bundled)
```

## License

MIT
