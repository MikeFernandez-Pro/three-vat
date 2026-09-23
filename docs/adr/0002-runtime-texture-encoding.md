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

Position deltas stay `RGBAFormat` + `FloatType` for now; see the amendment
below, which is where that half landed.

## Amendment (#73, 2026-09-24): the position layer is eight bytes, not sixteen

The other half of #29, and with it the last of the opening sentence's "RGBA
float": **position deltas are `RGBAFormat` + `HalfFloatType`.** Four half-floats
a texel where there were four floats, and again nothing above the sampling
moves — same layout, same bands, same `NearestFilter`, same manual lerp. Unlike
the normal layer this needs **no unpacking at all**: a half-float sampler hands
the shader floats, so both decodes read the texture they always did and neither
grew a line.

A vertex-frame is now `8 B + 2 B = 10 B`, down from 18 B and from the 32 B this
record originally specified — the demo's three clips from ~35 MB to ~11 MB. What
it buys is bytes and not capability: the binding ceiling is rows against
`maxTextureSize`, which this does not move.

The sentence at the top calling deltas "half-float friendly" is now measured
rather than asserted. Half-float is **floating point**, so its error is
proportional to what it holds: 0.061% of the delta at every magnitude, which is
3.91 mm on `RobotExpressive`'s 6.38 m `Dance` throw, 3 microns on a 5 mm finger
twitch, and exactly zero at the rest pose, where the delta is zero. That is a
property of storing *deltas* rather than absolute positions, and it is
scale-invariant — an asset authored in centimetres loses the same 0.061%, so
there is no unit-dependent tolerance to state and no escape hatch to build. The
decode-identity tests are held to that relative bound for the same reason a
normal's tolerance is an angle: a tolerance in millimetres would be asserting
the asset rather than the format.

**Range is the real limit, and the bake refuses rather than clips.** Half-float
tops out at 65 504; three's own `toHalfFloat` clamps anything past it and warns
to the console, which would ship a crowd with a limb at the horizon behind a
log line. So `bakeVAT` checks every component it writes and throws, naming the
value, the limit, and the clip, frame and vertex it was reached at. An asset in
millimetres with more than ~65 m of travel is the case this exists for.

Two layers stay `FloatType`, deliberately. The **rig texture**, whose texels are
a quaternion and an *absolute* translation-plus-scale — none of the reasoning
above about relative error applies to a coordinate, and narrowing it is its own
question against its own measurements. And the **playback texture**, because a
`startTime` in seconds does not survive half precision (one second of resolution
at 2 048 s) and a crossfading row carries two of them.

`unpackAlignment` needs nothing here, unlike on the normal layer: an RGBA
half-float row is `8 × width` bytes, a multiple of 4 at any width.
