import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
// `vitest/config` re-exports vite's own `defineConfig` with the `test` block
// typed, so one config serves both the dev server and the test run.
import { defineConfig } from 'vitest/config'
import { withGallery, withGalleryLink } from './gallery.mjs'
import { buildPages, pageNames, pagePath, shellPage } from './pages.mjs'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

// Which page this build is for. A vite config describes one build and this app
// is several — one per page (#17, and `build.mjs` for why) — so which one is
// passed in rather than written here. The gallery's shell is one of them: it is
// outside the page table by design (ADR-0020) and still has to be built, so the
// build is handed it explicitly rather than through the table it is excluded
// from.
const only = process.env.DEMO_PAGE
if (only !== undefined && !buildPages.includes(only)) {
  throw new Error(`DEMO_PAGE=${only} is not a page here (${buildPages.join(', ')})`)
}

// Import the library through its public specifiers (exactly as a consumer would),
// aliased to the TypeScript source so the pages run against live library code
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
      // app is built by `build.mjs`, which runs this config once per page.
      // `apply: 'build'` keeps `vite` (the dev server, which needs no entry
      // list at all) and the release suite's plain import of this object clear
      // of it.
      name: 'three-vat:one-page-per-build',
      apply: 'build',
      buildStart() {
        if (only === undefined) {
          throw new Error('Set DEMO_PAGE, or build the pages with `node build.mjs` — one build per page (#17).')
        }
      },
    },
    {
      // The gallery, stamped in as pages are served — the dev server and the
      // build alike — so nothing writes down a list of pages (ADR-0020). Two
      // stamps, one hook: the shell gets the sidebar generated from the page
      // table, and every example gets the one link back to it. Which of the two
      // a file is, is the only thing this hook decides; the markup is
      // `gallery.mjs`.
      name: 'three-vat:gallery',
      transformIndexHtml(html, { filename }) {
        // Nothing else is stamped. vite runs this hook on every HTML it serves,
        // and a file that is neither the shell nor a page in the table — a
        // prototype under `prototype/`, the built copy under `dist/` — has no
        // HUD title to hang a link on and would 500 in dev rather than open.
        const name = relative(here('.'), filename).replace(/\.html$/, '')
        if (name === shellPage) return withGallery(html)
        return pageNames.includes(name) ? withGalleryLink(html, name) : html
      },
    },
  ],
  resolve: {
    alias: [
      { find: 'three-vat/webgl', replacement: here('../src/webgl.ts') },
      { find: 'three-vat/tsl', replacement: here('../src/tsl.ts') },
      { find: /^three-vat$/, replacement: here('../src/index.ts') },
      {
        // three's Inspector (ADR-0024) is written against bare `three`, and one
        // of its modules imports it as a namespace -- the whole classic build,
        // WebGLRenderer included, which no tree-shaking can drop. Resolved to
        // the node build instead, for those importers only: it is a superset of
        // the classic one and the WebGPU pages carry it already, so the pages
        // keep shipping one renderer (release/packaging/payload.test.ts). Every
        // other importer of `three` -- the WebGL pages above all -- resolves as
        // it always did.
        find: /^three$/,
        replacement: 'three',
        customResolver(_source, importer) {
          if (importer && /[\/]examples[\/]jsm[\/]inspector[\/]/.test(importer)) {
            return this.resolve('three/webgpu', importer, { skipSelf: true })
          }
          return null
        },
      },
    ],
    dedupe: ['three'],
  },
  build: {
    // Both handed over by `build.mjs`, which empties the directory once and
    // then adds a page at a time — so nothing here may empty it again.
    outDir: process.env.DEMO_OUT_DIR ?? 'dist',
    emptyOutDir: false,
    rollupOptions: { input: only === undefined ? {} : { [only]: pagePath(only) } },
  },
  // Vitest reads this same config, so the examples' tests resolve `three-vat`
  // the way the pages do. What is left here is the pages' own — crowd layout,
  // which is pure math, and the WebGPU support probe — so they run in Node. The checks
  // that read this file rather than a page (bundle shape, subpath deployment)
  // are release checks and live in `release/`, which imports it from there.
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
