# Runtime texture encoding: deltas, float, and manual in-shader interpolation

Positions are stored as `skinnedPos − bindPos` (delta) and normals as absolute vectors, in RGBA float `DataTexture`s laid out `x = vertexIndex, y = frame`, with clips stacked vertically. Textures use `NearestFilter` with no mips; frame interpolation is done manually in the shader (two `texelFetch`es + `mix`) rather than relying on GPU linear filtering.

Reasons: deltas keep precision where it matters and are half-float friendly; manual lerp sidesteps inconsistent float-linear-filtering support and precision wobble, and a 30 fps bake still looks smooth. Normals must be baked too (lighting is visibly wrong otherwise), and geometry bounds are expanded to the union of all frames to prevent mid-animation frustum culling.

## Why all clips share one texture, rather than one texture per clip

Clips are stacked as bands of rows in a **single** texture pair, addressed by a per-instance `aClipStart` row offset. They are not split into a texture per clip, and not into `sampler2DArray` layers.

This is because a sampler is a **uniform**: it is constant for a whole draw call, so instances in one draw cannot each read a different texture. Stacking turns "which clip" into an integer row offset, and an integer *can* vary per instance — which is precisely what makes a mixed-clip crowd render in one draw call, the capability that distinguishes this from three.js's `webgl_instancing_morph`. One texture per clip would force either one draw call per clip (losing the headline) or binding every clip at once — 14 clips is 28 samplers, and WebGL2 guarantees only 16 texture units per shader stage.

Stacking is also the cheaper layout, because clip lengths are uneven. A `sampler2DArray` (whose layer index *can* vary per instance) requires every layer to be the same size, so short clips pad out to the longest. For `RobotExpressive`'s 14 clips that is 1 400 rows against 585 stacked — **2.4× the memory**, purely padding 12-row `Sitting` out to 100-row `Dance`. Variable-height bands are the point, not an accident.

The costs we accept: adding or removing a clip means re-baking and re-uploading the whole texture (no independent streaming of clips), and `totalFrames` for all clips together must fit `maxTextureSize` (585 of 16 384 rows for the robot, so ~28× headroom). Should either bite, the answer is **several stacked textures**, each holding a group of clips, with the clip table carrying a texture index alongside `startFrame` — keeping per-instance selection within a group and staying under the sampler limit. It is not one texture per clip.

## Amendment (#29, 2026-09-23): the normal layer is two bytes, not sixteen

The opening sentence above says "RGBA float `DataTexture`s", and that is now
true of the position texture only. **Normals are stored octahedrally, as two
unsigned bytes — `RGFormat` + `UnsignedByteType`.** Everything else in this
record stands unchanged: same `x = vertexIndex, y = frame` layout, same stacked
bands, same `NearestFilter` with no mips, same manual two-`texelFetch` lerp in
the shader. What a row *holds* narrowed; nothing above the sampling moved.

A normal is a **unit vector**, so three of those sixteen bytes carried a value
in `[-1, 1]` and the fourth carried nothing at all. Octahedral encoding — the
octahedron `|x| + |y| + |z| = 1` projected to the plane, its far hemisphere
folded into the corners — puts the whole sphere in two channels, and eight bits
each resolves it to **0.947° worst case, 0.32° mean**, measured over
`RobotExpressive` and `Soldier` in #29. The error is bounded by the
quantisation grid rather than by the geometry, which is why the two unrelated
assets landed within 0.001° of each other. Houdini encodes VAT normals this way
for the same reason.

That is an 8× cut on the layer and takes a bake from `verts × frames × 32 B` to
`verts × frames × 18 B` — the demo's three clips from ~35 MB to ~20 MB. The
error shows up as **shading and never as geometry**, which is what made this
the half of #29 that could land on its own: a wrong position moves a silhouette,
a wrong normal moves a highlight. The one place sub-degree normal steps could
surface is a sharp specular highlight on a near-mirror material; the fallback
there is `RG16`, four bytes rather than two and still 4× smaller than float.

**The mapping is defined once, on the CPU** (`src/octahedral.ts`), and the two
shader decodes are transcriptions of it, term for term. This matters more than
the bytes: two encodings that have to agree in four places — encoder, GLSL
decode, TSL decode, and the demo's texture panel — is a bug class CI cannot
catch, because the only thing proving the two *shaders* agree is the parity
gate, which is manual and GPU-only. So the arithmetic itself is pinned in
`src/octahedral.test.ts`, the one seam a GPU-less test can hold, and the gate
is left catching transcription slips rather than design errors.

Two consequences worth stating. A decoded normal is **unpacked before the lerp,
never after** — two octahedral pairs either side of the fold interpolate
through the wrong half of the sphere — so the manual two-row mix this record
requires stays a mix of vectors, renormalised as it always was. And the normal
texture sets `unpackAlignment = 1`: an `RG8` row is `2 × width` bytes, and the
default alignment of 4 would misread every row of an odd-width bake.

Position deltas stay `RGBAFormat` + `FloatType`. The sentence above calling
them "half-float friendly" is still the plan and still unproven in the code:
#29 measured 3.91 mm worst-case error over `RobotExpressive` (0.061% relative,
and exactly zero at the rest pose, which is what storing *deltas* buys), but
the range check that a half-float bake needs — half tops out at 65 504 — is not
written. That half is a separate ticket.
