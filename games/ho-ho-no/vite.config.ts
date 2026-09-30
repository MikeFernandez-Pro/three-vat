import { fileURLToPath } from 'node:url'
// `vitest/config` re-exports vite's `defineConfig` with the `test` block typed,
// so one config serves the dev server, the build and the headless tests.
import { defineConfig } from 'vitest/config'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

// The game is one page and one program (ADR-0038), so this
// is a plain vite app: none of the examples' one-build-per-page machinery.
export default defineConfig({
  // Relative asset URLs: Pages serves the game under
  // `/three-vat/games/ho-ho-no/`, and a root-absolute `/models/...` would 404.
  base: './',
  resolve: {
    // The library's public specifiers, aliased to its source as the examples
    // do, so the game runs against live library code with no build step. The
    // package still depends on `three-vat` through `workspace:*`; the alias
    // only decides which of its files that name means here.
    alias: [
      { find: 'three-vat/tsl', replacement: here('../../src/tsl.ts') },
      { find: 'three-vat/write', replacement: here('../../src/write.ts') },
      { find: /^three-vat$/, replacement: here('../../src/index.ts') },
    ],
    dedupe: ['three'],
  },
  build: {
    // Top-level await in the entry: the renderer and the assets are awaited.
    target: 'es2022',
    // The entry carries Rapier's WASM inline (the compat build, so the same
    // module runs in the browser and under vitest in Node): about 3 MB, 1 MB
    // gzipped. Known, and not a warning worth reading on every build.
    chunkSizeWarningLimit: 4096,
  },
  test: {
    // The simulation is below the renderer seam: no renderer, DOM or audio, so
    // it runs in plain Node with Rapier's WASM (the compat build inlines it).
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
