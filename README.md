# three-vat

![The demo's count dragged from a single robot up to 340, the crowd filling the screen while the draw-call counter holds still at three — one per material](https://raw.githubusercontent.com/MikeFernandez-Pro/three-vat/main/docs/media/hero.gif)

**[Open the live demo →](https://mikefernandez-pro.github.io/three-vat/)** and drag the count from 1 robot to 340. The draw calls do not move.

Bake a glTF `AnimationClip` into GPU textures and animate **hundreds or thousands of instanced characters with zero per-frame CPU** — one draw call per material, no `SkinnedMesh` per character. Works on `WebGLRenderer` and `WebGPURenderer`, from the same baked VAT.

[![CI](https://github.com/MikeFernandez-Pro/three-vat/actions/workflows/ci.yml/badge.svg)](https://github.com/MikeFernandez-Pro/three-vat/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/three-vat.svg)](https://www.npmjs.com/package/three-vat)
[![license: MIT](https://img.shields.io/npm/l/three-vat.svg)](./LICENSE)

## Install

```bash
npm install three-vat three
```

`three` (>= 0.185) is a peer dependency.

## One crowd, start to finish

```ts
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { bakeVAT } from 'three-vat'
import { createVATMesh, getMaxTextureSize } from 'three-vat/webgl'
// WebGPURenderer? `from 'three-vat/tsl'` — that import is the only line that changes.

// The parts you already know — renderer, scene, camera, lights, clock — made
// however you usually make them. Nothing on this line is VAT-specific.
const { renderer, scene, camera, clock } = setUpYourScene()

const gltf = await new GLTFLoader().loadAsync('/robot.glb')

// Bake once, at load. Pass the subtree root — `gltf.scene` — and not a mesh
// inside it: the bake unit is the whole subtree, merged and recorded in root
// space. This same call takes
//   - a skinned character (Mixamo, Sketchfab, `Soldier.glb`)
//   - a morph-target mesh
//   - a hierarchy of rigid, node-animated parts (three's `RobotExpressive`)
//   - any mix of those in one subtree
// because a VAT records where a vertex ended up and never how it got there.
// Nothing to classify, and no variant of this call to go looking for.
const vat = bakeVAT(gltf.scene, gltf.animations, {
  fps: 30,
  maxTextureSize: getMaxTextureSize(renderer), // this GPU's real ceiling
})

// One entry per character: which clip it plays, its phase, its rate.
const instances = Array.from({ length: 500 }, (_, i) => ({
  clip: vat.clips[i % vat.clips.length],
  timeOffset: Math.random() * 2, // desync, so the crowd is not in lockstep
  speed: 0.9 + Math.random() * 0.2,
}))

// The crowd: one InstancedMesh, its geometry and materials already decoding the
// VAT, plus the clock that drives every instance.
const { mesh, time } = createVATMesh(vat, instances)
mesh.castShadow = mesh.receiveShadow = true
scene.add(mesh)

// Where each character stands is yours — the library never guesses a layout.
for (let i = 0; i < instances.length; i++) mesh.setMatrixAt(i, matrixFor(i))
mesh.instanceMatrix.needsUpdate = true
mesh.computeBoundingSphere() // or frustumCulled = false, if matrices move every frame

renderer.setAnimationLoop(() => {
  time.value = clock.getElapsedTime() // the whole per-frame cost of the animation
  renderer.render(scene, camera)
})
```

Two things worth knowing the first time:

- **Render `vat.geometry`, not your source mesh.** The merged vertex ordering is
  the baker's, and the textures are indexed by it. `createVATMesh` does this for
  you; by hand, clone that geometry and no other.
- **Materials are never merged.** A 500-robot crowd with 3 materials is 3 draw
  calls — not 1, and not 500. VAT collapses instance count, not material count.

<details>
<summary><b>Does it work with my model?</b></summary>

If `GLTFLoader` loads it and it has an `AnimationClip`, yes — the four shapes
listed in the snippet above, and any mix of them, through that one call.

The bake unit is the **subtree**, not the mesh
([ADR-0008](./docs/adr/0008-a-vat-bakes-a-posed-subtree-not-a-skinnedmesh.md)),
which is where the one real mistake lives: pass `gltf.scene`, or the node you
want animated, never a `SkinnedMesh` you fished out of it.

Positions bake exactly under any rig; normals match what three's own skinning
shader draws, which is approximate under non-uniform bone scale — `bakeVAT`
warns once and names the bone. A rest-pose track such as Mixamo's `TPose` bakes
to a frozen band and reports it as a near-zero `clip.maxDelta`: filter those out
of `gltf.animations` rather than spending texture rows on them.

</details>

<details>
<summary><b>Going bigger: texture limits, bake cost, Web Workers</b></summary>

The VAT is one `vertexCount` × `totalFrames` texture pair, so both axes hit the
GPU's texture ceiling. Always pass `maxTextureSize: getMaxTextureSize(renderer)`
as above: the default is a desktop-shaped guess, and mobile is often 4096.

The bake is CPU work done once at load — about 100 ms for the demo's robot, and
seconds for a 20k-vertex skinned character with many clips. It never touches the
renderer, so it moves into a Web Worker as-is.

**[docs/usage.md](./docs/usage.md)** has the measured bake-cost table, the
worker recipe, the draw-call arithmetic, and the primitives underneath
`createVATMesh` for when you are not rendering onto a plain `InstancedMesh`.

</details>

<details>
<summary><b>What it does not do</b></summary>

No clip crossfade (instances cut between clips), no LOD, no baking CLI or file
format, no React/drei binding, glTF input only. Each is a decision rather than a
gap, and each is written up with its reasoning in
**[docs/usage.md](./docs/usage.md#what-10-does-not-do)**, alongside the
trade-offs against `SkinnedMesh` and bone-texture instancing.

Both decode paths — GLSL on `WebGLRenderer`, TSL on `WebGPURenderer` — read one
shared instance-playback contract and export the same `createVATMesh`, so
nothing documented here is true on one renderer and false on the other. That the
two decode *pixel-identically* is a manual gate before every release
([docs/releasing.md](./docs/releasing.md)).

</details>

<details>
<summary><b>Development</b></summary>

```bash
pnpm i
pnpm run dev    # opens the demo — this and the line above are the whole setup
```

Three more verbs, and that is the table:

```bash
pnpm test       # every suite: the baker core, the release suite, the demo's own
pnpm typecheck  # all three tsconfigs: library, release suite, demo
pnpm build      # the published library (`pnpm run build:watch` to watch)
```

`examples/` is the demo — one page per renderer, self-contained on purpose
([ADR-0011](./docs/adr/0011-one-example-per-renderer-duplicated-on-purpose.md)),
deployed from `main` on every push. Release steps are `node` invocations rather
than table entries, the parity gate among them and required
([docs/releasing.md](./docs/releasing.md)). The suite is green on a fresh clone
with no network: real-asset tests skip when their asset is missing, so fetch it
before touching the baker ([docs/test-assets.md](./docs/test-assets.md)).

</details>

Deeper: [docs/](./docs) · [CHANGELOG.md](./CHANGELOG.md) · [live WebGPU demo](https://mikefernandez-pro.github.io/three-vat/webgpu_crowd.html)

## License

MIT
