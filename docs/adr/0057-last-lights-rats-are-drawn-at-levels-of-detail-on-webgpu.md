# Last Light's rats are drawn at levels of detail, on WebGPU

> Amends [ADR-0052](./0052-last-lights-rats-are-culled-on-the-gpu-on-webgpu.md),
> whose cull drew every survivor at the whole rat.

Since the swarm steps on the GPU (ADR-0053), the CPU is no longer what holds
the frame back. In the sewers the GPU is. With 16,384 rats, the GPU frame is
5.2 ms and the page holds 151 fps, while the page's CPU stays at 0.5 ms
whatever the count. The cost grows with the rats drawn: 1.0 ms at 1,000,
2.5 ms at 8,192. The rat is 1,820 triangles, and ~14,000 survive the cull,
so the view takes ~25 million triangles a frame. Most rats stand 30 to 80
pixels long. Turning off the rats' shadows into the torch's cube changed
nothing. Drawing every rat at a simplified index instead
took the 16k frame to 4.0 ms at half the triangles, 3.0 ms at a quarter and
2.2 ms at a tenth.

ADR-0043's levels need a BatchedMesh to switch an instance's geometry, and
WebGPU's carrier has none: one indirect draw over the cull's survivors.

## The decision

The cull sorts each survivor into a **level of detail** by how many pixels
long it stands in the drawing buffer, and each level is a draw of its own
(`games/last-light/src/gpucull.ts`, `rats.ts`).

- **Three levels:** near, middle and far, each with its own share of the
  body's triangles and of the eyes', and the pixels it is drawn from. Built
  at 80 and 35 px with the whole rat, a quarter and a tenth (1,820, 502 and
  217 triangles); set from the panel the same day to 238 and 145 px with
  45% of the body and 30% of the eyes, 20% and 12%, and 6% of each
  (the middle 347 triangles and the far 104).
- **Each level has its own rim,** its strength and width times the rats'
  rim (`ShellToonMaterial`'s `rimScale`), so a far rat's silhouette can read
  stronger or softer than a near one's.
- **The eyes are simplified apart from the body,** and less. In the fog the
  eyes are most of what a far rat shows (the doodle verdicts), so the body's
  triangles are never spent on them, nor theirs on the body.
- **A level keeps every vertex** and draws fewer, as ADR-0043 has it: each
  level's geometry is the rat's over a simplified index of meshoptimizer's,
  so the decode reads the same columns and nothing is baked again. The
  simplifier runs at load; until it is ready every level draws the whole rat.
- **The survivor list stays whole.** The trails, the eyes' records and the
  count in view read it as before. After it, the same buffer holds one list
  a level, `capacity` long each, of slots in the whole list. The draws'
  arguments are one buffer: the whole list's count first, then a level's
  arguments each, which its mesh reads at its own offset. The reset pass
  writes each level's index count, so changing a level's index uploads
  nothing from the page.
- **One material over every level.** A per-object uniform reads
  `userData.ratLevel` and picks the list the instance's slot comes from. So
  the panel's colours, the glow and the boil reach every level at once.
- **By pixels, not metres:** the projection's scale times the buffer's
  height. A sharper screen or a closer camera draws more of the rat, and the
  levels hold on any camera.
- **Over the depth of field's blur:** a rat's pixels are divided by the
  radius, in pixels, the depth of field smears it over at its depth, by the
  same circle of confusion as `post.ts`'s, and never by less than one. A
  rat in focus keeps its level; a blurred one, near or far, is drawn no
  finer than it shows, and its change of level is lost in the blur. Without
  the depth of field nothing changes. (Suggested by Cody Bennett.)

Measured on the sewers' corridor, 1920x1000 on an RTX 5080, still swarm:
GPU best 5.2 to 3.1 ms at 16k rats (151 to ~225 fps), 3.0 to 2.0 ms at
8k, 1.4-2.0 to 1.3 ms at 2k. At 16k, 3,200 rats were at the whole rat, 4,600
at the quarter and 8,400 at the tenth.

## Considered options

- **Octahedral impostors.** Rejected for now. The rats are animated: an
  impostor would need its views times every baked frame times each gait, or
  rats sliding in one pose. The torch, the fill, the rim and the eyes would
  need normals and depth baked with it. And the far rats stand in the fog.
  Worth a look past 30k rats, or if the far level is still too heavy; the
  camera's narrow range of pitch would need only a ring of headings.
- **Freezing the far rats' animation, or one clip for all.** Rejected. The
  cost is the vertices drawn, not the clip they read; the cheaper far
  decode saved 0.1 to 0.4 ms on top of a 25% level (ADR-0043). The gaits
  are how the swarm reads.
- **`firstInstance` in each level's arguments, over one list.** Rejected: a
  non-zero first instance in an indirect draw needs WebGPU's optional
  `indirect-first-instance` feature.
- **A storage buffer a level for the counts.** Rejected: the cull's kernel
  already binds seven, and WebGPU promises eight.

## Consequences

- WebGL 2's carrier, the batch, draws every rat whole as before.
- A rat can change level from one frame to the next as it crosses a limit;
  the levels pop rather than blend. At 35 and 80 px it has not shown, but
  it is the first thing to look at if it does.
- The levels start from `LEVELS` in `rats.ts`. The panel's rats folder has
  a "levels of detail" folder that turns them on and off, tints each rat by
  its level, and moves the limits and the shares; a moved share simplifies
  the level again. `?lod=0` starts with them off.
- A fourth draw holds the whole rat: every rat while the levels are off,
  and the left of the view when it is split against them. `#lod` is the
  page to show them: 16,384 rats in the open arena, the fog solid from 8 m,
  no stop motion, the depth of field kept since the levels count it; 1 turns the levels on and off, 2 tints
  each rat by its level, 3 splits the view into the levels and the same
  tinted, 4 into the whole rat and the levels. The split goes rat by rat, by
  which side of the view each stands, never through one. The readout line shows the
  rats in view at each level and its triangles.
