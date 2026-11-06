# A rig crossfade is walked once an instance, on WebGPU

> **Amends [ADR-0039](./0039-a-rig-crossfade-blends-each-slot-as-the-mixer-does-about-its-pivot.md)**, which walked the chain once a vertex and rejected a pass of its own for the walk.

The blend ADR-0039 defines is unchanged: each slot of an instance mid-crossfade is walked up its chain, seen from its parent at both bands, blended about its pivot and composed back down. What changes is where the walk runs. Where the vertex stage reads storage buffers, a compute pass walks it once an instance and slot, into a storage buffer, and the vertex decode reads what it wrote. Where the vertex stage cannot, on the WebGL 2 fallback, on a device with no storage buffers for that stage (ADR-0058), on the GLSL path, and for a crowd drawn with no carrier, the chain is walked once a vertex as before.

## Why

The walk is the same for every vertex of an instance, but it was paid by each of them. Soldier has 49 slots and about 7,400 vertices, each reading 2.5 slots with weight on average, so a fading Soldier walked about 370 times more chains than its pose needs. ADR-0039 did not measure what that cost. Measured since, RTX 5080, 1600x900, dpr 1, best GPU frame, the bench outside the repo, interleaved: 1,024 Soldiers all mid-fade took 11.24 ms against 1.21 steady, and @three.ez/instanced-mesh, which blends matrix rows instead, 1.65. On an iPhone, 2,048 Soldiers all mid-fade ran at 385-480 ms a frame and theirs at 97. Their blend deforms the mesh, judged by eye beside three's mixer, and off it by 16-21% of the silhouette's pixels at half weight against 0.5-2.5% for this one, so their way was not taken.

Walked once an instance, with the same pixels as the walk: 1,024 Soldiers all mid-fade 1.24 ms, a tenth mid-fade 1.22 against 2.22, Imp 1.46 against 13.73 and theirs 2.20. On an iPhone, frame time over three interleaved rounds at 2,048 Soldiers: all mid-fade 48 ms against 466-477 walked and theirs 98-103 typical, with stalls of 4 s; a tenth mid-fade 41-42 against 90-95 and 61-63. A crowd of 512 that had never faded, all turned at once 4 s in: no frame over 17 ms at the turn, where the walk took one of 87 ms in each of three rounds.

## How it runs

- **Started by the carrier.** `vatNodes` wraps the carrier's `onBeforeRender`, which three calls with the renderer before every pass the mesh is drawn in, the shadow pass included, and a `compute` made there reaches the GPU ahead of the draw. No call changes: `createVATMesh` and a mesh handed to `vatNodes` get it alike. The carrier's own `onBeforeRender` still runs, first, and so does one assigned after `vatNodes`: the property keeps the pass behind whatever it is set to, since replacing it would leave a fade reading storage nobody wrote.
- **Only while a fade can be running.** The pass reads, off the pack's crossfade texels, the clock time from which no row is blending, again each time the pack changes, and runs while the clock is short of it: a crowd with nothing fading runs nothing. A row paused short of its blend's end keeps it running.
- **Once a moment.** Not again for the same clock and pack, however many passes the carrier is drawn in.
- **Compiled at the first draw.** The pass runs once then, fading or not, so its shader is not compiled at the first fade.
- **Decided as the shader builds**, as ADR-0058's matrices are: the builder is the first thing that knows what the renderer can do.

## Considered options

- **Blend matrix rows, as instanced-mesh does.** Rejected: it deforms the mesh, judged by eye.
- **Share the walk among a vertex's slots,** whose chains overlap. Rejected: a smaller gain for a harder shader, and still once a vertex.
- **A cheaper rotation blend inside the walk.** Not tried: the pass made it unneeded.
- **Skip the walk for a slot with no weight.** Measured on WGSL: 2-4%. Such slots point at bone 0, the top of every chain, so their walk was already short.
- **A pool of fading instances** rather than a slot for every row. Not taken yet: it caps how many can fade at once, for memory nobody has been short of.

## Consequences

- **Memory: two texels of storage a slot of every row**, 3.2 MB for 2,048 rows of a 49-slot rig, 26 MB for 16,384, made the first time a shader asks for it and freed with the carrier.
- **Steady crowds:** within 1% on the PC (1.21 against 1.20 ms at 1,024), and 25-31% faster on the iPhone (27-40 against 38-54 ms at 2,048, theirs 42-57), where the vertex shader no longer carries the walk it skipped.
- **Thousands of clip changes a frame** still favour instanced-mesh: 16,384 at 1/16 of the triangles with 1,638 changes a frame, 1.56 ms against 1.37, from 5.19.
- **WebGL is unchanged.** It has no compute pass; phones that fall back to it keep the walk, and its cost.
- **Coverage.** CI reads the WGSL: no walk in the vertex shader where it can read storage, the walk where it cannot, a pass that compiles reading nothing unassigned, and when it runs. The same pixels as the walk, on r186 and r187, steady, mid-fade, with a moving clock, after a move, with shadows, instance colours, two crowds over one bake and two materials on one crowd, came from the bench: exact on an `InstancedMesh`, within one level of one channel on one or two pixels of a `BatchedMesh`. Turning the pass off there breaks the fade. The parity gate holds the two paths together.
