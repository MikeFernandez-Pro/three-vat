# Single package with isolated subpath exports

`three-vat` ships as one package with subpath exports: `three-vat` (core baker + offline loader), `three-vat/webgl` (GLSL patch), `three-vat/tsl` (node material).

The split is load-bearing, not cosmetic. Importing `three/tsl` or `three/webgpu` drags in the node-material system, and WebGL consumers must never pull it in. Keeping the surfaces in separate entry points guarantees a WebGL user's bundle never touches WebGPU/TSL code.
