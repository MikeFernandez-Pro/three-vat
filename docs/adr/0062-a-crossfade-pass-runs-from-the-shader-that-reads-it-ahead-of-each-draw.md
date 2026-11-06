# A crossfade pass runs from the shader that reads it, ahead of each draw

> **Amends [ADR-0059](./0059-a-rig-crossfade-is-walked-once-an-instance-on-webgpu.md) and [ADR-0061](./0061-a-rig-crossfade-is-walked-once-an-instance-where-the-vertex-stage-reads-no-storage.md)**, under which the carrier's `onBeforeRender` started the TSL path's crossfade pass.

On the TSL path, the crossfade pass, computed or drawn, now runs from the decode's own shader. The decode adds an `OnBeforeObjectUpdate` to it. three runs that node after the shader is built and before anything the shader binds is read, ahead of every draw of the carrier, a shadow map's included. The pass still runs only while a fade can be running, and once a moment. It runs at a crowd's first draw where something is fading then, and at its second draw where nothing is, which still compiles it ahead of any fade. The carrier's `onBeforeRender` is left as it was, and nothing in the library sets it or wraps it.

## Why

The pass is made as the shader that reads it builds, because the build is the first place that knows the renderer and so the route (ADR-0058, ADR-0059). three builds a carrier's shader in its first draw, after it has called the carrier's `onBeforeRender`. So at a crowd's first draw, the hook that ran the pass ran before the pass existed, and the draw read poses nobody had written. A crowd already mid-crossfade at its first draw showed that for one frame. Measured with the bench outside the repo, three r187, 340 Soldiers all mid-fade, the first frame drawn: on WebGPU 15.5% of the frame differed from the walk, and on the WebGL 2 fallback the fade did not show at all. Run from the shader, the first frame is the walk's pixels on both, and on WebGPU forced onto the drawn route.

## Why an idle crowd waits a draw

Run ahead of a crowd's first draw, the compute pass left every later draw of that crowd slower, though it ran once and the crowd's shader was the same. Measured on an RTX 5080, 1600x900, three r187, best GPU frame, medians of four interleaved rounds: 1,024 steady Soldiers drew in 1.26 ms against 1.19 walked, with the pass run once at the first draw. Run at the second draw instead, as before this change, they drew in 1.20. Never run, they drew in 1.19. Imp showed none of it (1.30 against 1.29). Why the GPU keeps that cost is not known.

## Considered options

- **Run the pass from `onBeforeRender` and make it earlier,** as the GLSL path does: `createVATMesh` there builds its pass before any draw (ADR-0060), and its first frame was already right. Rejected for TSL. The route is not known before the build. A crowd made with `vatNodes` has no constructor of the library's to make the pass in.
- **Keep the `onBeforeRender` wrapper beside the new trigger.** Rejected. It ran nothing the new trigger did not, and it redefined a property of the caller's mesh to do it.

## Consequences

- **A crowd's `onBeforeRender` is the caller's alone again.** ADR-0059's promises about it (yours runs first, set before or after) are moot, and so are its tests.
- **A crowd already fading at its first draw keeps the cost above.** It needs the pass before that draw. 1,024 Soldiers faded from their first frame and steady after drew in 1.24 ms against 1.16 walked, and all mid-fade in 1.30 against 1.24 when the pass first ran at the second draw. Imp drew level (1.28 against 1.27). A correct first frame was taken over those 5-7%.
- **Every build of the decode runs the pass:** the render pass, each shadow map, and each material of a crowd with several. Once a moment keeps that to one run.
- **Coverage.** CI fires the nodes a build asks three to run ahead of a draw, as three does. The pass runs from them at the first draw where something is fading, at the second where nothing is, then only while a fade can be running, from a shadow map's build as well, once a moment. Nothing runs from `onBeforeRender`. The bench draws the first frame of a crowd mid-fade, with and without shadows, on WebGPU, on the fallback, and on WebGPU forced onto the drawn route, against the walk. Built from the code before this change, the same check fails.
