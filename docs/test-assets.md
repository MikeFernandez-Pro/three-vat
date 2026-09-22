# Test assets

Two real glTF files back the integration tests in `src/bake.integration.test.ts`.
They live in different places for one reason: size.

| Asset | Where | In git? | Proves |
| --- | --- | --- | --- |
| `RobotExpressive.glb` (464 KB) | `examples/public/` | yes — the demo loads it | the rigid, node-animated half of [ADR-0008](./adr/0008-a-vat-bakes-a-posed-subtree-not-a-skinnedmesh.md) |
| `Soldier.glb` (2.1 MB) | `test-assets/`, and a committed copy in `examples/public/` | the test copy no — gitignored; the example's yes | the skinned half: a 49-bone Mixamo-style character, 7 434 vertices, four clips |

Soldier's committed copy exists since the Soldier example
([ADR-0019](./adr/0019-examples-beside-the-demo.md)): the deployed pages load
it, and the Pages build copies `public/` and nothing else. It is the same pinned
bytes — the fetch script's digest holds for both — but the suite and the parity
gate keep reading `test-assets/`, so the folder the demo does not own stays the
one the release machinery reaches into.

## Getting `Soldier.glb`

```bash
node scripts/fetch-test-assets.mjs
```

That downloads it from a **pinned three.js tag** and checks its SHA-256 before
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

## Why the suite still passes without it

Each real-asset `describe` is wrapped in `describe.skipIf(assetMissing(…))`, so a
fresh clone with no network runs `pnpm test` green — you lose the real-asset
coverage, not the suite. Anyone touching the baker should run
`node scripts/fetch-test-assets.mjs` first.

CI does not get that leniency. `.github/workflows/ci.yml` runs the fetch before
the suite, and `assetMissing` (`src/test-utils.ts`) throws instead of skipping
whenever `CI` is set — because a skipped real-asset test in CI reads as a pass
while proving nothing.
