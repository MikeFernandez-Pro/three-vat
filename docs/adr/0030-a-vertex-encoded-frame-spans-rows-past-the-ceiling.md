# A vertex-encoded frame spans rows past the texture ceiling

Amends [ADR-0002](./0002-runtime-texture-encoding.md), which owns the texture layout. Decided for [#86](https://github.com/MikeFernandez-Pro/three-vat/issues/86) on 2026-09-25.

Under the vertex encoding, a frame whose vertices outnumber `maxTextureSize` now spans several rows. The bake no longer refuses it with `vertexCount N exceeds maxTextureSize M; row wrapping is not implemented`. The layout is:

- **`rowsPerFrame = ceil(vertexCount / maxTextureSize)`** rows a frame, and **`width = ceil(vertexCount / rowsPerFrame)`**. That is the fewest rows that hold the frame, each as narrow as that allows, so a frame leaves fewer than `rowsPerFrame` texels unused at its end, not up to a whole row.
- **Vertex `v` of frame `f`** is at column `v mod width`, row `f × rowsPerFrame + floor(v / width)`. Equivalently, it is texel `f × rowsPerFrame × width + v`. A frame's texels are contiguous, so the bake writes a spanned frame with the offset it always used, at a longer stride.
- **The VAT says so.** `DeltaVAT.rowsPerFrame` is `1` wherever the vertices fit, and then the texture is the one every earlier bake produced, texel for texel. `totalFrames` still counts frames, and so does the clip table. The texture is `totalFrames × rowsPerFrame` tall.
- **The frame ceiling tightens by the same factor**, and its refusal says which limit it hit. Frames that would not fit one row each get the message they always had. Frames that fit one row each but not at `rowsPerFrame` rows each are refused naming both numbers, the vertex count and the row width.

The rig encoding is untouched. Its frame is one row, and its width is set by the rig, not the mesh.

## Why now, when the rig default made it rarer

An asset that falls back to the vertex encoding is one the rig encoding refused ([ADR-0027](./0027-the-default-encoding-is-the-rig-where-the-asset-allows-it.md)). The usual cause is a clip that animates a morph target, and a face rig is the ordinary case. [#77](https://github.com/MikeFernandez-Pro/three-vat/issues/77) showed the ceiling is real: a Xiaomi Mi 9 reports 4096 and refused both shipped assets under the vertex encoding. So an asset with animated morphs and more than 4096 vertices had no encoding at all on that phone ([ADR-0029](./0029-a-fallen-back-bake-says-why-on-the-vat-not-in-the-console.md)). It has one now. RobotExpressive's 7 214 vertices at 4096 bake as two rows of 3 607 a frame, and every texel equals the one-row bake's (`bake.integration.test.ts`).

## The decode: literals, and nothing where a frame is one row

Both decode paths turn the vertex index into a texel coordinate with the stride, and **both emit the span arithmetic only for a bake that spans**. That decision is made when the material is built, from `rowsPerFrame`, and is not a branch in the shader. ("A GLSL branch costs what it skips": guarding two fetches once cost an idle crowd 10%, #72.)

- **GLSL.** A one-row bake gets `ivec2( gl_VertexID, row )`, the exact text it had. A spanned bake gets `ivec2( gl_VertexID % W, row * R + gl_VertexID / W )` with `W` and `R` as integer literals. Literals rather than uniforms, because the layout belongs to the bake and never changes under a material, and a divide by a constant is the cheapest one a compiler is handed. The price is one program per layout, so a spanned layout adds `:rows{R}x{W}` to the program cache key. Otherwise two crowds whose materials agree in every parameter three reads would share one program and one would read the other's rows. The shadow materials are the case that makes this real, since they are identical for every VAT. A one-row bake keeps the key it had.
- **TSL.** The same arithmetic as integer nodes: `vertexIndex.mod(W)`, and `row.mul(R).add(vertexIndex.div(W))`. `R` and `W` are `int` constants, which three emits as `%` and `/` on `i32`. The spanned row node is built once per band row and shared by the position and normal fetches. A second `int()`-typed node over the same hoisted `select` loses its cast in the WGSL builder (three r185, the bug `tsl.test.ts` already pins), and a span adds exactly such a node per row.

Every other part of ADR-0002 stands: stacked bands, `NearestFilter`, no mips, the manual two-row lerp, half-float positions and octahedral normals.

## Measured

The idle robot crowd (`webgl_crowd.html` and `webgpu_crowd.html`, 340 robots, never transitioning), forced to the vertex encoding. GPU frame time from each page's own stats-gl, best frame of about 1 200 (WebGL) and 1 440 (WebGPU) collected over 6 s after 4 s of warm-up. RTX 5080, Chrome 154, 240 Hz. Three rounds, interleaved: before, one row, spanned, per page per round. *Before* is `src/` at 4.0.0 (`fc13cfa`). *One row* is this change at the page's own ceiling, where 7 214 vertices fit. *Spanned* is this change at `maxTextureSize: 4096`, two rows of 3 607 a frame.

| Renderer | Before (4.0.0) | After, one row | After, two rows a frame |
| --- | --- | --- | --- |
| WebGL | 0.2516 · 0.2508 · 0.2517 ms | 0.2520 · 0.2498 · 0.2529 ms | 0.2567 · 0.2595 ms |
| WebGPU | 0.2211 · 0.2228 · 0.2221 ms | 0.2220 · 0.2224 · 0.2206 ms | 0.2260 · 0.2266 · 0.2263 ms |

- **One row costs nothing.** The one-row figures sit inside the spread of the before figures on both renderers. This is expected, because the GLSL is the same text and the node graph is the same graph. It is measured rather than assumed because the acceptance criteria asked for it.
- **Two rows a frame cost about 2%**: +2.5% on WebGL and +1.9% on WebGPU against *before*. The within-label spread is under 1%, so this is a real cost of the modulo and divide, not noise. It is the price of an asset baking at all where it used to be refused, and a bake pays it only where its vertices outnumber the ceiling.
- **One run is discarded.** The second-round WebGL spanned run reported a best frame of 0.043 ms, with a median of 0.21 ms. A sixth of any other run's frame for the same work is a timer query misread, not a frame, so it is left out of the table. It is reported here rather than removed silently.

This is desktop only. The phone the change is for, the Mi 9, has not drawn a spanned bake yet. What two rows a frame cost there, where the vertex texture's reads are the bottleneck, is unmeasured.

## The parity gate

The gate bakes the robot a second time at `maxTextureSize: 4096` (`SPAN_CASE`) and checks that the bake actually spans. It renders the crowd from that bake on both paths, then asks two things. Do the two paths agree on it? And does each path draw it as that same path draws the one-row bake? The second check is within one path, so a stride both paths got wrong the same way is still caught. Cross-path parity would call such a stride agreement. The two bakes hold the same texels in different places, so a correct decode draws the same pixels from either. On the release run both paths did: 0 of 27 829 drawn pixels differed. Dropping the row offset from the GLSL stride for one run failed the GLSL within-path check alone, on 67% of drawn pixels, and the cross-path check with it.

## Consequences

- `DeltaVAT` gained a required field, `rowsPerFrame`. A caller who builds a `DeltaVAT` by hand, which the library does not support (ADR-0010), has one more field to fill. The worker's wire record carries it.
- A test that walks a vertex layer by `row × vertexCount + v` is only right for a one-row bake. `deltaTexel` in `src/test-utils.ts` restates the layout from the texture's own width, not from the library's helper, so a layout the bake and the decode agreed on wrongly is still caught there.
- "Wrap" is taken. In the frame resolution, **wraps** means a loop crossing its band's last row back into its first. This layout is **rows per frame** in the code and the glossary, and a frame *spans* rows.
