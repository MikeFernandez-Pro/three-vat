# Test assets

Three real glTF files and two FBX files back the integration tests in `src/bake.integration.test.ts`.
They live in different places for one reason: size.

| Asset | Where | In git? | Proves |
| --- | --- | --- | --- |
| `RobotExpressive.glb` (464 KB) | `examples/public/` | yes — the demo loads it | the rigid, node-animated half of [ADR-0008](./adr/0008-a-vat-bakes-a-posed-subtree-not-a-skinnedmesh.md) |
| `Soldier.glb` (2.1 MB) | `test-assets/`, and a committed copy in `examples/public/` | the test copy no — gitignored; the example's yes | the skinned half: a 49-bone Mixamo-style character, 7 434 vertices, four clips |
| `Michelle.glb` (3.1 MB) | `test-assets/` | no — gitignored | the normal-mapped case: a 65-bone Mixamo character, 16 340 vertices, a normal map on its body, two clips |
| `Samba Dancing.fbx` (3.5 MB) | `test-assets/` | no — gitignored | the common Mixamo FBX case: two skinned meshes that load non-indexed at 165 960 vertices and merge to 35 440, one clip beside an empty `Take 001` |
| `RotationTest.fbx` (19 KB) | `test-assets/` | no — gitignored | the FBX-only transform: a rigid cube animated through its node’s pre- and post-rotation, a transform glTF does not carry |

Soldier's committed copy exists since the Soldier example
([ADR-0019](./adr/0019-examples-beside-the-demo.md)): the deployed pages load
it, and the Pages build copies `public/` and nothing else. It is the same pinned
bytes — the fetch script's digest holds for both — but the suite and the parity
gate keep reading `test-assets/`, so the folder the demo does not own stays the
one the release machinery reaches into.

## Getting the fetched assets

```bash
node scripts/fetch-test-assets.mjs
```

That downloads each one from a **pinned three.js tag** and checks each one's SHA-256 before
writing. The pin matters because the tests assert exact vertex counts; `dev`
would silently re-author the asset under them. To move to a newer three.js,
bump `THREE_TAG` in `scripts/fetch-test-assets.mjs`, run it, and paste the
digest it reports as the new expected value — then re-run the tests, because a
changed asset can legitimately change the counts they assert.

## What Soldier's four clips are for

`Idle`, `Run` and `Walk` are the moving clips: each must bake a `maxDelta` far
from zero, or the bake froze. `TPose` is the opposite control — the rig's rest
pose *is* its T-pose, so that clip legitimately bakes as a frozen pose
(`maxDelta` ≈ 0.001). Asserting both directions is what makes `maxDelta` a real
diagnostic: a uniformly broken bake cannot be near zero on one clip and far
from it on the other three.

## What the two assets prove about the rig encoding

The same file also bakes both assets under the rig encoding
([ADR-0018](./adr/0018-the-rig-encoding-is-a-second-encoding-opt-in-for-now.md)).
Soldier is the skinned case: 49 slots — its visor's two bones are the body's
neck and head, so it adds none — a CPU compose-and-skin held to the mixer
vertex for vertex, and a digest pin on its rig texels beside the vertex ones.

RobotExpressive is the case the ADR got wrong, and the suite says so rather
than remembering it. Every one of its fourteen clips carries a morph track on
each of the three head meshes, but every track is flat at zero — a pose written
down, not animation — so the fold rule applies, the asset *takes* the rig
encoding (58 slots: fifteen rigid parts and the hands' 43 shared bones), and
its rig bake is pinned against its vertex bake. The refusal the spec asked to
see is pinned too, on the asset the ADR believed it had: the same clips with
the head's `Angry` target made to ramp, refused once, naming all three head
parts and all fourteen clips.

## What Michelle is for

Soldier is textured but carries no normal map, so it cannot show that the rig
decode's normal, and the tangent a normal map reads, come out right
([#78](https://github.com/MikeFernandez-Pro/three-vat/issues/78)). Michelle
can. It is the one skinned glTF with a normal map among three.js's example
models and Khronos's sample assets, and it is only ever the suite's, so it is
fetched like Soldier's test copy rather than committed. The suite pins two things on it: that
the default bake picks the rig encoding (65 slots, 549 rows), and that the rig
texels skin the normal and a computed tangent as three's own skin matrix does,
on both clips. The pixels are not in the suite. They are the render check
recorded in
[ADR-0027](./adr/0027-the-default-encoding-is-the-rig-where-the-asset-allows-it.md#a-normal-mapped-asset-measured-after-the-flip).

## What the two FBX files are for

FBX is the second supported format
([ADR-0031](./adr/0031-gltf-and-fbx-are-the-supported-formats.md)), and the
baker has no FBX code to test — it bakes whatever subtree `FBXLoader` built. So
the suite loads each file the way [the usage guide](./usage.md#loading-fbx) tells
a caller to — every mesh through `mergeVertices`, `Take 001` filtered out — and
holds both encodings to the oracle Soldier's are held to: a second load posed by
three's `AnimationMixer`, in root space, at the same tolerances. It also pins
that the default bake takes the rig encoding. Samba is the file a Mixamo user
actually has. RotationTest is small, but its transform is the one piece of FBX
that glTF never exercises. FBXLoader asks for textures that cannot load under
Node, so the FBX blocks stub `TextureLoader`'s load, and only for themselves.

## Why the suite still passes without them

Each real-asset `describe` is wrapped in `describe.skipIf(assetMissing(…))`, so a
fresh clone with no network runs `pnpm test` green — you lose the real-asset
coverage, not the suite. Anyone touching the baker should run
`node scripts/fetch-test-assets.mjs` first.

CI does not get that leniency. `.github/workflows/ci.yml` runs the fetch before
the suite, and `assetMissing` (`src/test-utils.ts`) throws instead of skipping
whenever `CI` is set — because a skipped real-asset test in CI reads as a pass
while proving nothing.
