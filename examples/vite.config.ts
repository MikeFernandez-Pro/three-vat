import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
// `vitest/config` re-exports vite's own `defineConfig` with the `test` block
// typed, so one config serves both the dev server and the test run.
import { defineConfig } from 'vitest/config'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

// Every `*.html` in this directory is a demo (ADR-0011): one per renderer, with
// no landing page in front of them — `index.html` *is* the WebGL demo, so the
// deployed root opens on a working crowd rather than on a choice of renderer
// most visitors cannot make. Globbed rather than listed, so adding a third demo
// is adding a file — no build-config change, and no chance of a page that runs
// in dev and is missing from the build. three-mesh-bvh discovers its examples
// the same way; three.js keys its gallery off the `<renderer>_` prefix, which
// lives on the entry module here (`src/webgl_crowd.ts`) now that the page it
// belongs to answers to `index.html`.
const pages = Object.fromEntries(
  readdirSync(here('.'))
    .filter((file) => file.endsWith('.html'))
    .map((file) => [file.replace(/\.html$/, ''), here(file)]),
)

// Import the library through its public specifiers (exactly as a consumer would),
// aliased to the TypeScript source so the demo runs against live library code
// with no build step. `dedupe` keeps a single copy of three across the alias.
export default defineConfig({
  // Relative asset URLs, so the built app runs wherever it is served from —
  // GitHub Pages puts it under `/three-vat/`, and a root-absolute `/assets/...`
  // would 404 there. The two pages link each other relatively for the same
  // reason, and so does the model URL (src/assets.ts).
  base: './',
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
  // way the demo does. What is left here is the demo's own — crowd layout, which
  // is pure math, and the WebGPU support probe — so they run in Node. The checks
  // that read this file rather than the demo (bundle shape, subpath deployment)
  // are release checks and live in `release/`, which imports it from there.
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
