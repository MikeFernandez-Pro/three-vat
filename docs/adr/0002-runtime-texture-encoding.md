# Runtime texture encoding: deltas, float, and manual in-shader interpolation

Positions are stored as `skinnedPos − bindPos` (delta) and normals as absolute vectors, in RGBA float `DataTexture`s laid out `x = vertexIndex, y = frame`, with clips stacked vertically. Textures use `NearestFilter` with no mips; frame interpolation is done manually in the shader (two `texelFetch`es + `mix`) rather than relying on GPU linear filtering.

Reasons: deltas keep precision where it matters and are half-float friendly; manual lerp sidesteps inconsistent float-linear-filtering support and precision wobble, and a 30 fps bake still looks smooth. Normals must be baked too (lighting is visibly wrong otherwise), and geometry bounds are expanded to the union of all frames to prevent mid-animation frustum culling.

## Why all clips share one texture, rather than one texture per clip

Clips are stacked as bands of rows in a **single** texture pair, addressed by a per-instance `aClipStart` row offset. They are not split into a texture per clip, and not into `sampler2DArray` layers.

This is because a sampler is a **uniform**: it is constant for a whole draw call, so instances in one draw cannot each read a different texture. Stacking turns "which clip" into an integer row offset, and an integer *can* vary per instance — which is precisely what makes a mixed-clip crowd render in one draw call, the capability that distinguishes this from three.js's `webgl_instancing_morph`. One texture per clip would force either one draw call per clip (losing the headline) or binding every clip at once — 14 clips is 28 samplers, and WebGL2 guarantees only 16 texture units per shader stage.

Stacking is also the cheaper layout, because clip lengths are uneven. A `sampler2DArray` (whose layer index *can* vary per instance) requires every layer to be the same size, so short clips pad out to the longest. For `RobotExpressive`'s 14 clips that is 1 400 rows against 585 stacked — **2.4× the memory**, purely padding 12-row `Sitting` out to 100-row `Dance`. Variable-height bands are the point, not an accident.

The costs we accept: adding or removing a clip means re-baking and re-uploading the whole texture (no independent streaming of clips), and `totalFrames` for all clips together must fit `maxTextureSize` (585 of 16 384 rows for the robot, so ~28× headroom). Should either bite, the answer is **several stacked textures**, each holding a group of clips, with the clip table carrying a texture index alongside `startFrame` — keeping per-instance selection within a group and staying under the sampler limit. It is not one texture per clip.
