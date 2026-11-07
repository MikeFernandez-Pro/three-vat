# A crowd draws its motion vectors from the previous frame's clock

> **Amends [ADR-0058](./0058-an-instancedmesh-crowd-reads-its-matrices-from-a-storage-buffer.md)**, which recorded that the decode never wrote a previous position, so a motion vector followed neither a moving limb nor, on the storage route, a moved instance.

On the TSL path, a build that draws velocity, a scene pass whose MRT has a `velocity` output as TRAA and motion blur use, now writes `positionPrevious`, three's per-vertex position at the previous frame. It is the crowd decoded a second time, from the same pack, at the clock the previous frame was drawn at. A crossfade there is read from a crossfade pass of its own at that clock, computed or drawn on the same route as this frame's (ADR-0059, ADR-0061). The previous frame's instance matrices place it: three's own on a `BatchedMesh` and on the WebGL 2 fallback, and on the storage route of ADR-0058 a second storage attribute, copied from the matrices after each draw as three copies its own. A build that draws no velocity does none of this and is the build it was. The GLSL path is unchanged: WebGLRenderer has no velocity pass to feed.

## Why

three's own skinning and instancing fill `positionPrevious` in a velocity build, from the previous frame's bones and matrices. The decode replaces the position three's skinning would compute, and left `positionPrevious` at the rest pose. Every limb's vector pointed back to where the bake's rest pose stands: TRAA smeared a crowd and motion blur dragged it toward a T-pose. Measured with the bench outside the repo, on the velocity buffer of one character over two frames 0.05 s apart, three r187, against three's mixer for the animation: that read is off by 420-2,260% of the mixer's own velocity. The decode now lands within 1.5-9.1% of it on WebGPU and on the fallback, on an `InstancedMesh` and a `BatchedMesh`, walking a clip, running and crossfading, and on the compute, drawn and walked routes alike.

The mixer is no truth for a move: three's skinned mesh counts a move of its root twice, once in the previous bones and once in the previous model matrix, so its vectors doubled a plain mesh's. A move is measured against a plain mesh moved as far, whose previous model matrix is the whole of its motion: the crowd adds 0.8% (Soldier) and 5.9% (Imp) more than it does, the gap between a posed silhouette and a rest one. With the previous storage matrices dropped, the same move was off by 600%.

## How it runs

- **The previous clock is one a clock**, a uniform shared by every crowd and material reading it, moved on at the first draw of each render that draws velocity: to the value the clock had at the last such render. That is how three keeps its own previous bones and matrices, copied after each draw that needs them. three's frame count would not do: only its own animation loop advances it, so an app drawing on a timer would never move the clock on. A crowd's first render has no earlier one, and reads its own clock: no motion.
- **The same pack at the previous clock.** No copy of the previous frame's pack is kept. On the frame a clip is cut, the vector reads as motion within the new clip rather than a jump to it.
- **The previous frame's crossfade pass** is the same pass at the previous clock, kept beside this frame's on the carrier and run from the same hook (ADR-0062), after the clock has moved on.
- **A drawn pass has a program key of its own.** Without one, the previous frame's drawn pass of a crowd drew this frame's poses, read back from its target: three keys a classic material's build by its parameters, with a node set on it counting only as an object.
- **A drawn pass three put off is not counted as run.** three draws nothing for a program still compiling, which its WebGL 2 fallback can do in parallel on its asynchronous path. A pass that recorded the moment anyway would not run again under a stopped clock. It counts its run by three's draw count, and runs again at the next draw.

## Considered options

- **Keep the previous frame's pack.** Rejected: a second playback texture a crowd, and a copy each frame something is written, for the one frame a cut happens on.
- **Walk the previous frame's crossfade once a vertex.** Rejected: the cost the passes exist to remove, in the velocity pass.
- **The live band only, for the previous frame.** Rejected: free, but a crossfade would be the one place the vectors lie.

## Consequences

- **A velocity build decodes twice**, and a crowd that fades runs two passes, paid only where velocity is drawn. Measured on an RTX 5080, 1600x900, three r187, WebGPU, best GPU frame, medians of four interleaved rounds, 1,024 crowds drawn through a scene pass with a `velocity` output, against the same with no previous decode (5.0.2's vectors): steady Soldiers 1.37 ms against 1.55 and Imps 1.78 against 1.88, cheaper, likely because three's own previous position, from matrices read as attributes, is replaced and goes unread (not measured apart); all mid-fade, Soldiers 1.82 against 1.59 and Imps 2.48 against 1.92.
- **Memory, where velocity is drawn:** a second crossfade pass's storage or targets, and on the storage route a second copy of the instance matrices.
- **Open: one case reads wrong intermittently.** On the WebGL 2 fallback, on an `InstancedMesh`, a crowd mid-crossfade drew one foot's vectors far off (the frame 56% off the mixer) in about half the runs that opened the bench's pages at once, and in none run one after another. The passes held the right poses for every slot when read back. A `BatchedMesh`, WebGPU and every other case did not show it. The cause is not known.
- **Coverage.** CI builds the decode with and without velocity: only the velocity build writes `positionPrevious`, from more fetches, with a second pass at a second clock, and on the storage route a second storage attribute. The previous clock moves on once a render, to the clock the last render drew velocity at, and is shared by every crowd on one clock. Each drawn pass has a program key of its own, and a pass three put off runs again. The bench measures the velocity buffer against the mixer and a plain moved mesh, as above, with a control for each that has to fail.
