# Runtime texture encoding: deltas, float, and manual in-shader interpolation

Positions are stored as `skinnedPos − bindPos` (delta) and normals as absolute vectors, in RGBA float `DataTexture`s laid out `x = vertexIndex, y = frame`, with clips stacked vertically. Textures use `NearestFilter` with no mips; frame interpolation is done manually in the shader (two `texelFetch`es + `mix`) rather than relying on GPU linear filtering.

Reasons: deltas keep precision where it matters and are half-float friendly; manual lerp sidesteps inconsistent float-linear-filtering support and precision wobble, and a 30 fps bake still looks smooth. Normals must be baked too (lighting is visibly wrong otherwise), and geometry bounds are expanded to the union of all frames to prevent mid-animation frustum culling.
