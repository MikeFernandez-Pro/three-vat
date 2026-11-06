# A rig crossfade is walked once an instance where the vertex stage reads no storage

> **Amends [ADR-0059](./0059-a-rig-crossfade-is-walked-once-an-instance-on-webgpu.md)**, under which the TSL path walked the chain once a vertex wherever the vertex stage could not read storage: on WebGPURenderer's WebGL 2 fallback, and on a WebGPU device with no storage buffers for that stage.

The blend is still ADR-0039's, walked once an instance and slot. Where the vertex stage reads storage, the compute pass of ADR-0059 still runs. Where it cannot, the TSL path now draws the walk as [ADR-0060](./0060-a-rig-crossfade-is-walked-once-an-instance-on-webgl-in-a-pass-of-its-own.md) draws it on the GLSL path. One triangle covers two float render targets, with a column for each slot and a row for each instance. Each fragment walks its slot's chain with the compute pass's own clock, weight, bands and walk. It writes the rotation to one target and the translation, with the scale in `w`, to the other. A fragment of an instance that is not fading is discarded. The vertex decode reads the two texels as textures. A WebGL 2 fallback that cannot draw float targets, with no `EXT_color_buffer_float`, walks once a vertex as before.

## Why

The fallback is what a phone without full WebGPU runs, and it walked once a vertex. Measured on an RTX 5080, 1600x900, dpr 1, three r187, WebGPURenderer forced onto WebGL 2, median frame time of four interleaved rounds, uncapped, in the bench outside the repo: 1,024 Soldiers all mid-fade ran at 10.51 ms a frame walked and 1.59 drawn. Imp ran at 14.96 against 1.88. With a tenth of the crowd mid-fade, Soldier ran at 2.31 against 1.67 and Imp at 2.80 against 1.95. Steady crowds ran level: Soldier 1,024 at 1.44 against 1.57, Soldier 4,096 at 4.51 against 4.45, Imp 4,096 at 6.52 against 6.97. Frame time is the measure here because the fallback's GPU timer reads above the frame time itself, the walk's included, and the pass's draw throws it off further (see Consequences).

On WebGPU, the drawn route costs what the compute route does. Forced onto it, 1,024 Soldiers all mid-fade took 1.26 ms of GPU against 1.24 computed and 11.32 walked. Imp took 1.45 against 1.46 and 14.15. A device with no vertex-stage storage takes the drawn route. None was at hand to measure it on.

## How it runs

- **The route is decided as the shader builds**, as ADR-0058 and ADR-0059 decide theirs. The order is the compute pass where the vertex stage reads storage, the drawn pass where the renderer can draw float targets, and the walk otherwise.
- **Started by the carrier's `onBeforeRender`, on the same terms as the compute pass.** It runs at the first draw, then only while a fade can be running, once a moment.
- **Drawn in the middle of another draw.** The pass saves the render target, cube face, mip level and outputs (MRT) it interrupted, and the function the renderer draws an object with, and puts them all back. A shadow map draws every object as its depth through a function of its own, and drew the pass's triangle that way too, so a fading crowd under a shadow-casting light filled the frame.
- **Its targets are set up as the shader that reads them builds** (`initRenderTarget`). A crowd's first draw binds them before the pass first draws into them. three r186 then made a target's textures again when the pass first drew, under a draw still waiting to be sent that read the old ones, and WebGPU refused the submit.
- **The texel is the screen coordinate.** three counts it from the top on both backends, as it counts a target's rows when it loads a texel of one.

## Considered options

- **The compute pass on the fallback.** Rejected. three's WebGL backend computes through transform feedback into a buffer, and the vertex stage there reads a buffer only as an attribute, never at an index of its choosing.
- **One target with two columns a slot.** Rejected, as in ADR-0060: it doubles the walk to save a target, where both backends draw to several at once.

## Consequences

- **Memory is as ADR-0059's:** two RGBA32F texels a slot of every row, freed with the carrier.
- **One more draw while a fade can be running,** counted by the renderer's info.
- **The fallback's GPU timer is not to be trusted with the pass running.** Several runs read no timestamp at all. With `trackTimestamp`, read frame time on the fallback instead.
- **Coverage.** CI reads the WGSL. Where the vertex stage reads no storage, the vertex shader walks nowhere and binds the two targets. Where floats cannot be drawn either, it walks. The pass's fragment walks, discards, writes two outputs and reads nothing unassigned. It is drawn at the first draw and then only while a fade can be running, once a moment, with the target, outputs and object function it interrupted put back, and its targets set up as the shader builds. The bench showed the walk's pixels on r186 and r187, on the fallback and on WebGPU forced onto the drawn route: steady, mid-fade, with a moving clock, after a move, with shadows (with and without a moving clock), with instance colours, two crowds over one bake and two materials on one crowd. An `InstancedMesh` was exact or off by one level of one channel on up to two pixels. A `BatchedMesh` was off on up to four pixels at its silhouettes. With the pass not drawn, a fade breaks there. The parity gate holds the two paths together.
- **Unmeasured:** a phone on the fallback, and a WebGPU device with no vertex-stage storage.
- **Not fixed here:** on the TSL path, a crowd's first draw comes before its pass exists, on either route, because the pass is made as the shader builds. A crowd already mid-fade at its first draw reads poses nobody wrote, for that one frame. This was so for ADR-0059's compute pass too.
