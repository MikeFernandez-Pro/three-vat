# Test assets

Two real glTF files back the integration tests in `src/bake.integration.test.ts`.
They live in different places for one reason: size.

| Asset | Where | In git? | Proves |
| --- | --- | --- | --- |
| `RobotExpressive.glb` (464 KB) | `examples/public/` | yes — the demo loads it | the rigid, node-animated half of [ADR-0008](./adr/0008-a-vat-bakes-a-posed-subtree-not-a-skinnedmesh.md) |
| `Soldier.glb` (2.1 MB) | `test-assets/` | no — gitignored | the skinned half: a 49-bone Mixamo-style character, 7 434 vertices, four clips |

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

## Why the suite still passes without it

Each real-asset `describe` is wrapped in `describe.skipIf(assetMissing(…))`, so a
fresh clone with no network runs `pnpm test` green — you lose the real-asset
coverage, not the suite. Anyone touching the baker should run
`node scripts/fetch-test-assets.mjs` first.

CI does not get that leniency. `.github/workflows/ci.yml` runs the fetch before
the suite, and `assetMissing` (`src/test-utils.ts`) throws instead of skipping
whenever `CI` is set — because a skipped real-asset test in CI reads as a pass
while proving nothing.
