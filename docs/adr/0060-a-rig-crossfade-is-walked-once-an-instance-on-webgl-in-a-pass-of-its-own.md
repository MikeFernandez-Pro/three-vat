# A rig crossfade is walked once an instance on WebGL, in a pass of its own

> **Amends [ADR-0059](./0059-a-rig-crossfade-is-walked-once-an-instance-on-webgpu.md)**, under which the GLSL path walked the chain once a vertex because WebGL has no compute pass.

The blend is still the one ADR-0039 defines, and it is still walked once an instance and slot rather than once a vertex. On the GLSL path the walk now runs in a fragment shader, not a compute pass. A crowd from `createVATMesh` draws one triangle over two float render targets, with a column for each slot and a row for each instance. Each fragment walks its slot's chain with the vertex decode's own rows and functions, and writes the blended rotation to one target and the translation, with the scale in `w`, to the other. A fragment of an instance that is not fading is discarded. The vertex decode reads the two texels of a slot mid-crossfade and resolves no outgoing band of its own. Where the renderer cannot draw into float targets (no `EXT_color_buffer_float`), the vertex shader walks the chain as before.

## Why

ADR-0059 left WebGL with the walk once a vertex, and the cost it measured on WebGPU was there too. Measured on an RTX 5080, 1600x900, dpr 1, three r187, WebGLRenderer, best GPU frame, median of four interleaved rounds, in the bench outside the repo: 1,024 Soldiers all mid-fade took 10.06 ms walked and @three.ez/instanced-mesh 1.44. Imp took 12.90 ms and theirs 1.77.

With the pass, the same crowds draw the same pixels as the walk. Soldier all mid-fade takes 1.43 ms and Imp 1.69. With a tenth of the crowd mid-fade, Soldier takes 1.42 against 2.15 walked (theirs 1.33), and Imp 1.70 against 2.71 (theirs 1.55). Steady crowds are within 1% of the walk at 1,024 and 4,096. At 16,384 Soldiers drawn at 1/16 of their triangles, with 1,638 clip changes a frame, the pass takes 1.45 ms against 4.44 walked, and theirs 1.22.

## How it runs

- **Drawn before the crowd, and before its shadows.** `createVATMesh` wraps the mesh's `onBeforeRender` and `onBeforeShadow`. three calls both with the renderer, and it draws the shadow maps first, so a shadow reads the pass of the moment it is drawn at. The mesh's own hooks run first, including ones assigned after `createVATMesh`, as ADR-0059's carrier hook does.
- **Drawn in the middle of another draw, as three's own reflector draws.** The pass saves the render target, cube face and mip level it interrupted and puts them back afterwards. While it draws, the shadow maps' update, XR and the info counter's reset are held off.
- **Only while a fade can be running, once a moment.** This uses the same reading of the pack's crossfade texels as ADR-0059, `fadesUntilOf`, now in the playback module where both paths import it. Like ADR-0059's pass, it is drawn once at the crowd's first draw so that its program is not compiled at the first fade.
- **Decided as each program builds.** `onBeforeCompile` is the first place that sees the renderer. A material that reads the pass has a program key of its own, so a hand-patched crowd, which draws no pass, never shares its program.

## Considered options

- **One target, two columns a slot, the walk done once for each.** Rejected. It doubles the walk to save a second target. WebGL 2 draws to several targets at once.
- **Half-float targets.** Not taken. The pass would no longer draw the walk's pixels, and float targets are drawable wherever `EXT_color_buffer_float` is, which three asks for at start-up.
- **Transform feedback**, which is what three's WebGL backend uses for compute. Rejected. It writes a buffer, and a WebGL vertex shader cannot read a buffer at an index of its choosing. It would need a copy into a texture as well.

## Consequences

- **Memory: two RGBA32F texels a slot of every row.** That is 3.2 MB for 2,048 rows of a 49-slot rig, made with the crowd and freed with it.
- **One more draw while a fade can be running.** The renderer's info counts it: one call and one triangle.
- **Not everything on WebGL gets it.** A crowd wired by hand through `patchVATMaterial` draws no pass and walks once a vertex. So does the TSL path on WebGPURenderer's WebGL 2 fallback, and so does a renderer that cannot draw float targets.
- **Coverage.** CI reads the GLSL. Where the renderer can draw the pass, the vertex shader reads the two targets in every material the crowd draws with, and walks nowhere. Where it cannot, it walks. The pass shares the decode's row functions and walk character for character. It is drawn at the first draw and then only while a fade can be running, once a moment, from the shadow hook as well as the render hook, with the interrupted target put back. The bench showed the same pixels as the walk, zero differing, on r186 and r187: steady, mid-fade, with a moving clock, after a move, with shadows (with and without a moving clock), with instance colours, two crowds over one bake and two materials on one crowd. With the pass not drawn, a fade breaks there. The parity gate holds the two paths together.
- **Unmeasured:** phones on WebGLRenderer.
