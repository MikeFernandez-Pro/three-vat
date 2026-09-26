import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    webgl: 'src/webgl.ts',
    tsl: 'src/tsl.ts',
    // Writing a baked file (ADR-0035): its own entry, so three's exporter lands
    // in the chunk of a page that downloads a bake and in no other.
    write: 'src/write.ts',
    // The bake command's `bin` (ADR-0034). An entry of its own, so the loaders
    // it reaches for land in its chunk and never in a page's.
    bin: 'src/bin.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  treeshake: true,
  // three and its subpaths are peer deps — never bundle them. Keeping the
  // node-material system (three/tsl, three/webgpu) external is what lets a
  // WebGL-only consumer of `three-vat/webgl` avoid pulling it in.
  external: ['three', 'three/tsl', 'three/webgpu'],
})
