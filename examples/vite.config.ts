import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

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
})
