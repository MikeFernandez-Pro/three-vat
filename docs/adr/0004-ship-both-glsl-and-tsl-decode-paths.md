# Ship both GLSL (WebGL) and TSL decode paths

The baker is renderer-agnostic pure CPU, so the two decode adapters over it are thin. We ship both. The GLSL `onBeforeCompile` patch is mandatory for drei and today's `WebGLRenderer` users; the TSL node-material path is mandatory for the planned official three.js example and `WebGPURenderer`.

One path cannot cover both audiences: TSL's GLSL fallback belongs to `WebGPURenderer` (its WebGPU→WebGL2 fallback), and does *not* make TSL materials run on the classic `WebGLRenderer`.
