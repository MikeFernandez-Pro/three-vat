# Last Light's rats are culled on the GPU, on WebGPU

*Last Light*'s smooth play was bound by the page's main thread as soon as the
CPU was slower than a fast desktop: 17 to 38 ms a frame with 8,192 to 16,384
rats under a fourfold CPU throttle. Most of it was three's own per-frame work
on the rats' `BatchedMesh`, the matrices texture uploaded whole and the
multi-draw lists rebuilt for every pass, with the page composing every visible
rat's matrix on top (#166).

## The decision

On WebGPU the rats are culled on the GPU and drawn in one indirect draw a pass
(`games/last-light/src/gpucull.ts`, #168).

- **The states go up as they arrive.** The two **swarm** states the page
  stands the rats between are kept in two storage buffers, per rat
  `(x, y, z, heading)` and `(pitch, place)`. A new state goes into the buffer
  the sampled pair no longer reads, so each is uploaded once. Per frame only
  the blend between the two, the snap distance, the rats both hold and the
  view's six planes are set. The buffers are shaped as the swarm's own state,
  so a GPU step could write them later.
- **A compute pass culls.** One thread a rat blends it as the page did (the
  positions and pitch lerped, the heading the short way round, a rat moved
  faster than a run or not yet in the earlier state taken from the latest),
  tests it as a sphere of the cull margin against the view, and a rat in view
  takes a slot by an atomic add. There it writes its id, the decode's
  **logical index** (ADR-0051), and its finished transform; the count is the
  draw's instance count.
- **One mesh draws them.** The baked rat's geometry, indirect, at the
  capacity. Its vertex stage reads its **drawn slot**'s transform and decodes
  the rat through the logical index.
- **One view cull serves every pass.** The cull runs once a frame, before the
  passes, against the view camera; the scene, the sun's shadow and the lamp's
  cube all draw what it kept, as every pass drew the one culled batch before.
  The shadow cache is unchanged.
- **Stop motion.** Plain stop motion holds the pair and its blend between
  beats, uploading nothing. Staggered stop motion, where each rat keeps a beat
  of its own, has the page write every rat's held place into the current
  buffer with the blend at one: the one mode with per-rat work on the page.
- **The page keeps** its frustum test, without matrix work, for the eyes'
  trails; the playback rows of every rat whose gait changed, in view or not,
  since it no longer knows which are drawn; and the readout of rats in view,
  read back from the draw's arguments a few times a second, never awaited.

WebGL 2 has neither compute passes nor indirect draws, and keeps the
page-culled batch, unchanged (ADR-0023). `?batch` draws the batch on WebGPU
too, for measuring. One material serves both carriers: its tint and decode
read the logical index through whichever is in use.

## Considered

- **Blending in the vertex stage** rather than writing a transform from the
  cull. The prototype measured no GPU difference; the transform keeps the
  vertex stage simplest, and the blend in one place.
- **Culling per shadow camera.** More survivors to keep and a list per pass;
  every pass reading the one view cull is what the batch did, and a rat just
  outside the view still casts into it through the margin.
- **An instanced mesh, culled on the page.** Measured on 2026-10-06 and on
  branch `prototype/instanced-rats`: it gained GPU time and lost it on the CPU
  rewriting playback rows into drawn order every frame.
- **Keeping the batch.** The gate set before the prototype asked for a GPU
  gain, and there is none: the batch was already one draw a run of visible
  rats, by the collapse, so draw calls were never the GPU's cost. The CPU's
  gain is what the game is limited by, so it is kept as a CPU gain, at the
  GPU's expense.

## Consequences

Measured on 2026-10-09, RTX 5080, 1920x1000, smooth play under `?loop`, the
batch and the GPU's cull interleaved, two rounds each; medians of the page's
frame and the best GPU frame, in ms:

| rats, CPU | page, batch | page, GPU cull | GPU best, batch | GPU best, GPU cull |
|---|---|---|---|---|
| 2,000, 1x | 1.4-1.6 | 1.1 | 0.93-0.96 | 0.97-0.99 |
| 2,000, 4x | 7.7-9.4 | 5.9-6.1 | 0.92-0.94 | 0.96-0.98 |
| 8,192, 1x | 4.4 | 2.8 | 1.94 | 2.00-2.08 |
| 8,192, 4x | 17.8-22.1 | 14.0-14.3 | 1.78-2.35 | 1.85 |
| 16,384, 1x | 6.9-7.0 | 4.5-4.6 | 2.62-2.64 | 2.79-2.85 |
| 16,384, 4x | 28.6-31.1 | 19.5-19.7 | 2.50-2.74 | 2.84-2.85 |

- **The page's frame falls by a fifth to over a third** (20 to 37%): 16,384
  rats under the fourfold throttle run at 47 fps instead of 30.
- **The GPU's frame rises**, by the cull pass and the transform's storage
  reads: by 0.06 ms at most at 2,000, by up to 0.15 ms at 8,192, and at
  16,384 by 0.15 to 0.23 ms at 1x and by 0.1 to 0.35 ms under the throttle,
  against the batch's two rounds. Accepted.
- **Two small departures from the batch**, both unseen in play. Under plain
  stop motion, rats spawned between beats are drawn from the next beat, where
  the batch drew them at whatever place their arrays held. And a rat first in
  sight after a new state came in faces as the sampled pair blends it, where
  the page turned it as the latest state had it.
- **There are two rat carriers**, and a look change has to hold on both; the
  screenshots of both backends are checked by hand when either moves.
- **The rats-in-view readout lags** by up to a quarter of a second on WebGPU.
- **The cull's buffers are sized to the capacity once**, about 1.6 MB at
  16,384 rats. The playback rows are still sized to the count and rebuilt a
  size up as it grows, freeing the old texture; the page frees the cull's
  buffers when it leaves.
