// Build the demo: one vite build per page.
//
// Why not one build over every entry — which is what `vite build` does on its
// own, and what this package's `build` script used to be: rollup puts a module
// two entries share into a chunk they both import, and `three.module.js` is
// such a module. The WebGPU page never names it, but the addons beside its
// renderer do (OrbitControls, GLTFLoader, the two environments all import bare
// `three`), so the shared chunk carries `WebGLRenderer` and the GLSL shader
// library for the sake of the WebGL page — and a WebGPU visitor downloads
// three quarters of a megabyte of a renderer it will never start (#17).
//
// Built alone, each page's graph reaches one renderer and rollup shakes the
// other out. The cost is that the two pages no longer share a byte, which is
// the right trade here: nobody opens both, and the pages already duplicate
// everything above the library on purpose (ADR-0011).
//
// The guard on that is `release/packaging/payload.test.ts`, which runs this
// and reads the chunks it wrote.
import { rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'
import { pageNames } from './pages.mjs'

const here = (path) => fileURLToPath(new URL(path, import.meta.url))

/**
 * Build every page into `outDir`, one build at a time.
 *
 * Which page a build is for is passed to the config through `DEMO_PAGE`,
 * because a vite config describes one build and this is several. The config
 * refuses to build at all without it, so the reflex `vite build` fails loudly
 * rather than shipping the payload this script exists to avoid.
 *
 * @param {string} [outDir] Where the built pages land. Defaults to `dist/`.
 * @returns {Promise<string[]>} The page names built, in the order they were built.
 */
export async function buildDemos(outDir = here('dist')) {
  // Emptied once, here, rather than by each build: the second build would
  // otherwise delete the first page's assets.
  await rm(outDir, { recursive: true, force: true })

  try {
    process.env.DEMO_OUT_DIR = outDir
    for (const name of pageNames) {
      process.env.DEMO_PAGE = name
      await build({ configFile: here('vite.config.ts'), root: here('.') })
    }
  } finally {
    delete process.env.DEMO_PAGE
    delete process.env.DEMO_OUT_DIR
  }

  return pageNames
}

// `node build.mjs` — what `pnpm --filter three-vat-example build` runs. Guarded,
// because `payload.test.ts` imports this module to build into a scratch folder
// and must not also rebuild `dist/` on the way in.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildDemos()
}
