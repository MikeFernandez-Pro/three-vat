import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
// `vitest/config` re-exports vite's own `defineConfig` with the `test` block
// typed, so one config serves both the dev server and the test run.
import { defineConfig } from 'vitest/config'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

// Every `*.html` in this directory is a page (ADR-0011): the landing page plus
// one demo per renderer. Globbed rather than listed, so adding `webgpu_crowd.html`
// is adding a file — no build-config change, and no chance of a page that runs in
// dev and is missing from the build. three-mesh-bvh discovers its examples the
// same way; three.js keys its gallery off the same `<renderer>_` prefix.
const pages = Object.fromEntries(
  readdirSync(here('.'))
    .filter((file) => file.endsWith('.html'))
    .map((file) => [file.replace(/\.html$/, ''), here(file)]),
)

// Import the library through its public specifiers (exactly as a consumer would),
// aliased to the TypeScript source so the demo runs against live library code
// with no build step. `dedupe` keeps a single copy of three across the alias.
export default defineConfig({
  resolve: {
    alias: {
      'three-vat/webgl': here('../src/webgl.ts'),
      'three-vat/tsl': here('../src/tsl.ts'),
      'three-vat': here('../src/index.ts'),
    },
    dedupe: ['three'],
  },
  build: {
    rollupOptions: { input: pages },
  },
  // Vitest reads this same config, so the demo's tests resolve `three-vat` the
  // way the demo does. The layout is pure math and the bundle-shape guard reads
  // the tree as text, so they run in Node.
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
