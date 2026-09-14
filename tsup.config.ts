import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    webgl: 'src/webgl.ts',
    tsl: 'src/tsl.ts',
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
