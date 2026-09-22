import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
// `vitest/config` re-exports vite's own `defineConfig` with the `test` block
// typed, so one config serves both the dev server and the test run.
import { defineConfig } from 'vitest/config'
import { withNavigationStrip } from './nav.mjs'
import { pageNames, pagePath } from './pages.mjs'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

// Which page this build is for. A vite config describes one build and the demo
// is several — one per page (#17, and `build.mjs` for why) — so which one is
// passed in rather than written here.
const only = process.env.DEMO_PAGE
if (only !== undefined && !pageNames.includes(only)) {
  throw new Error(`DEMO_PAGE=${only} is not a page here (${pageNames.join(', ')})`)
}

// Import the library through its public specifiers (exactly as a consumer would),
// aliased to the TypeScript source so the demo runs against live library code
// with no build step. `dedupe` keeps a single copy of three across the alias.
export default defineConfig({
  // Relative asset URLs, so the built app runs wherever it is served from —
  // GitHub Pages puts it under `/three-vat/`, and a root-absolute `/assets/...`
  // would 404 there. The two pages link each other relatively for the same
  // reason, and so does the model URL (src/assets.ts).
  base: './',
  plugins: [
    {
      // A bare `vite build` is the reflex, and it is the bug: one rollup build
      // over every page is what handed the WebGPU page the WebGL renderer in
      // the first place. Rather than quietly produce that again, refuse — the
      // demo is built by `build.mjs`, which runs this config once per page.
      // `apply: 'build'` keeps `vite` (the dev server, which needs no entry
      // list at all) and the release suite's plain import of this object clear
      // of it.
      name: 'three-vat:one-page-per-build',
      apply: 'build',
      buildStart() {
        if (only === undefined) {
          throw new Error('Set DEMO_PAGE, or build the demo with `node build.mjs` — one build per page (#17).')
        }
      },
    },
    {
      // The navigation strip, stamped into every page as it is served — the dev
      // server and the build alike — so no page writes its own (ADR-0019). The
      // strip is generated from the page table in `nav.mjs`; this hook only
      // says which page it is on, by the file vite is serving.
      name: 'three-vat:navigation-strip',
      transformIndexHtml(html, { filename }) {
        // Only a page in the table is stamped. vite runs this hook on every
        // HTML it serves, and a page outside the table — a prototype under
        // `prototype/`, the built copy under `dist/` — has no HUD title to hang
        // a strip on and would 500 in dev rather than open.
        const name = relative(here('.'), filename).replace(/\.html$/, '')
        return pageNames.includes(name) ? withNavigationStrip(html, name) : html
      },
    },
  ],
  resolve: {
    alias: {
      'three-vat/webgl': here('../src/webgl.ts'),
      'three-vat/tsl': here('../src/tsl.ts'),
      'three-vat': here('../src/index.ts'),
    },
    dedupe: ['three'],
  },
  build: {
    // Both handed over by `build.mjs`, which empties the directory once and
    // then adds a page at a time — so nothing here may empty it again.
    outDir: process.env.DEMO_OUT_DIR ?? 'dist',
    emptyOutDir: false,
    rollupOptions: { input: only === undefined ? {} : { [only]: pagePath(only) } },
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
