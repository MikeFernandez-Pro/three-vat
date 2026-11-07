# A crowd's shadows are cast from a coarser level

`castVATShadowsFrom(crowd, options)` makes a `BatchedMesh` crowd with levels (ADR-0043) cast its shadows from one of its coarser levels. An instance already on a coarser level casts from its own. The frame is drawn as before; only the shadow maps draw fewer triangles. It is in both subpaths, `three-vat/webgl` and `three-vat/tsl`, because each renderer needs a different route, and it returns a handle whose `dispose()` puts the crowd back as it was.

## Why

A shadow map draws every caster's triangles again, from the light, and a crowd's shadow rarely needs its full detail. `@three.ez/instanced-mesh` has `addShadowLOD`; three-vat had nothing for it. Measured on the bench outside the repo, RTX 5080, 4,096 Soldiers, one directional light fitted to the crowd, a 4,096 map, every instance's shadow at a quarter of its 11,376 triangles, GPU best frame, median of runs: WebGL 8.91 ms with full shadows and 5.91 with the coarse ones; WebGPU 8.49 and 5.79, against about 5 ms with no shadows at all. A shadow from the full detail drew zero differing pixels against the crowd casting its own on both renderers, and the quarter-detail shadow differed on 0.42% of the frame's pixels. Through this API, three rounds: Soldier 8.46 to 6.11 ms on WebGL and 8.34 to 5.58 on WebGPU; Imp 9.85 to 6.40 and 9.65 to 6.52, its quarter-detail shadow differing on 0.36% of the pixels and its full-detail one on none.

## Two routes

- **WebGL swaps the geometry around the shadow pass.** Before each of the crowd's shadow draws, every live instance finer than the shadow level is moved to it with `setGeometryIdAt`, and after the draw each is put back on the id it had. three's `WebGLShadowMap` calls the carrier's `onBeforeShadow` and `onAfterShadow` around each shadow draw, and the batch rebuilds its draw list in its own `onBeforeShadow`, after the swap. Measured: 0.09-0.11 ms of CPU a frame for 4,096, the list rebuilds included; the GPU frame with the full detail swapped in was the crowd's own, 8.83 against 8.91 ms. A second batch cannot be used here: `WebGLShadowMap` tests the main camera's layers, not the shadow camera's, so nothing keeps a second batch out of the frame, and drawing it there with every vertex clipped cost 2.4 ms at full detail.
- **WebGPU draws the shadows from a second batch.** WebGPURenderer never calls `onBeforeShadow`: a shadow map is a render of the scene from the shadow camera inside the main one, started from the first receiver drawn, and a batch's draw lists are shared across passes, so a swap would leave the frame drawing the shadow's geometry. So a caster batch over the same VAT, playback and clock holds the levels from the shadow level down, as a child of the crowd, on layer 31, which only the given lights' shadow cameras are made to see; the crowd stops casting. Before its shadow draw it copies every live instance's matrix, visibility and level from the crowd through three's public API, so it follows a crowd that moves, hides, spawns and changes level. Measured: 0.18 ms of CPU a frame for 4,096 and no GPU cost, 5.61 against 5.64 ms; the caster at full detail drew the frame of the crowd casting its own, 8.88 against 8.49.

Either way the decode is the crowd's own: the shadow reads the same playback rows at the same clock, so the shadow follows each instance's clip, phase and crossfade.

## How it runs

- **The level and the ids** are `updateVATLevels`'s: `ids[l][k]` is what `addGeometry` gave level `l` of character `k` (ADR-0065). An atlas instance casts from its own character. Instances removed from the crowd are skipped, by the probe ADR-0065 uses.
- **WebGL's hooks** are the carrier's one wrapper (ADR-0063), which now holds the crossfade passes and what runs around a shadow draw: a swap runs ahead of the carrier's own `onBeforeShadow`, which builds the list, and the passes after it; the ids go back after the carrier's own `onAfterShadow`. Several crowds and passes on one carrier compose in that wrapper rather than stacking wrappers.
- **WebGPU's caster** is sized to the crowd's capacity and follows it if it grows. Its instance ids are the crowd's, so each reads the crowd's playback row. It culls nothing per instance (`perObjectFrustumCulled = false`), as a batch drawn in more than one pass must not on WebGPU, and is not culled as a whole, because its bounds would lag a moving crowd.

## Considered and not taken

- **A usage recipe.** The WebGPU route is public API today, but a caller would have to know that WebGL needs another one and why layers fail there.
- **The caller writing to both batches** on WebGPU, in place of the copy: free, and easy to get wrong the first time an instance moves.
- **Choosing each instance's shadow level by distance.** One level for every instance is what was measured, and an instance on a coarser level keeps its own; a distance band of its own can come when a crowd needs it.
- **A shadow level on an `InstancedMesh`.** It holds one geometry (ADR-0043).

## Consequences

- **WebGPU needs the lights.** Layer 31 is enabled on each given light's shadow camera, and a camera that enables every layer would draw the caster in the frame. `dispose()` leaves the layer enabled: nothing else is on it.
- **WebGPU holds the caster's buffers:** the levels from the shadow level down, a matrix and an id an instance.
- **Unmeasured:** phones, more than one shadow-casting light.
- **Coverage.** CI checks the swap and its restore on a real `BatchedMesh` beside a crossfade pass, an instance already coarser, an atlas character, removed instances and `dispose`; and the caster's layer, the lights, the copy of matrices, visibility and levels, a crowd that grows, and `dispose`. The bench checked the pixels and the timings above.
