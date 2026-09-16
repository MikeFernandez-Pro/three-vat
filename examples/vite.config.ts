import { fileURLToPath } from 'node:url'
// `vitest/config` re-exports vite's own `defineConfig` with the `test` block
// typed, so one config serves both the dev server and the test run.
import { defineConfig } from 'vitest/config'

// Import the library through its public specifiers (exactly as a consumer would),
// aliased to the TypeScript source so the demo runs against live library code
// with no build step. `dedupe` keeps a single copy of three across the alias.
export default defineConfig({
  resolve: {
    alias: {
      'three-vat/webgl': fileURLToPath(new URL('../src/webgl.ts', import.meta.url)),
      'three-vat/tsl': fileURLToPath(new URL('../src/tsl.ts', import.meta.url)),
      'three-vat': fileURLToPath(new URL('../src/index.ts', import.meta.url)),
    },
    dedupe: ['three'],
  },
  // Vitest reads this same config, so the demo's tests resolve `three-vat` the
  // way the demo does. The crowd layout is pure math, so they run in Node.
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
