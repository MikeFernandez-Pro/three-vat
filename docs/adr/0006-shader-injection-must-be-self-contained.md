# Shader-chunk injection must be self-contained, with a custom program cache key

Each injection point into a built-in material's shader must be fully self-contained: a `vatSample(sampler2D)` GLSL helper in the prelude that every chunk replacement calls independently, never sharing decode locals across chunks. We also set `customProgramCacheKey` so patched materials never share a compiled program with unpatched ones.

> *Amended below:* a value both injection points read may be declared first thing in `main`, above every chunk. The rig's skin matrix is.

This is because `MeshDepthMaterial`'s vertex shader contains `#include <beginnormal_vertex>` inside a dead `#ifdef USE_DISPLACEMENTMAP` block — shared locals declared there get preprocessed away, breaking the depth program and silently dropping instanced shadows (crowds cast bind-pose shadows). This was found the hard way in the prototype. The TSL path is exempt: `positionNode` feeds the depth pass automatically.

## Amended: the rig's skin matrix is resolved once, ahead of the chunks

What this record forbids is a local one injection point declares and another reads, because the first may be preprocessed away. A local declared first thing in `main` is above every chunk and outside every block three keeps one in, so it cannot vanish, and neither point depends on the other.

The rig decode therefore resolves `vatSkinMatrix` once, in `main`'s first statement. At each injection point it ran twice a vertex, and on WebGL the compiler kept both. Removing the second call, against `@three.ez/instanced-mesh` 1.0.0-beta.1 as the yardstick:

| Best GPU frame, 2 048 instances, WebGL | two calls | one call |
| --- | --- | --- |
| Soldier | 3.82 ms | 2.78 ms (-27%) |
| Imp (Quaternius, CC0) | 5.46 ms | 3.35 ms (-39%) |

Measured with the rewrite applied to the compiled shader, on three r186, Chrome on Windows (ANGLE), an RTX 5080, 1600x900, dpr 1, no shadows, an `InstancedMesh`, six interleaved rounds, and the picture pixel-identical at a fixed clock. Phones and other compilers were not measured.

The vertex encoding keeps its own samplers at each point: what it reads there is a different texture.
