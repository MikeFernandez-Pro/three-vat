# Shader-chunk injection must be self-contained, with a custom program cache key

Each injection point into a built-in material's shader must be fully self-contained: a `vatSample(sampler2D)` GLSL helper in the prelude that every chunk replacement calls independently, never sharing decode locals across chunks. We also set `customProgramCacheKey` so patched materials never share a compiled program with unpatched ones.

This is because `MeshDepthMaterial`'s vertex shader contains `#include <beginnormal_vertex>` inside a dead `#ifdef USE_DISPLACEMENTMAP` block — shared locals declared there get preprocessed away, breaking the depth program and silently dropping instanced shadows (crowds cast bind-pose shadows). This was found the hard way in the prototype. The TSL path is exempt: `positionNode` feeds the depth pass automatically.
