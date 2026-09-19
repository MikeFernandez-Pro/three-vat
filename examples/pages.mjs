// Which pages this demo app has.
//
// Every `*.html` in this folder is a demo (ADR-0011): one per renderer, with no
// landing page in front of them — `index.html` *is* the WebGL demo, so the
// deployed root opens on a working crowd rather than on a choice of renderer
// most visitors cannot make. Globbed rather than listed, so adding a third demo
// is adding a file — no build-config change, and no chance of a page that runs
// in dev and is missing from the build. three-mesh-bvh discovers its examples
// the same way; three.js keys its gallery off the `<renderer>_` prefix, which
// lives on the entry module here (`src/webgl_crowd.ts`) now that the page it
// belongs to answers to `index.html`.
//
// Its own file, in plain JavaScript, because three callers need this one list
// and they cannot all read the same language: `vite.config.ts` (bundled by
// vite), `build.mjs` (run by bare `node`, which cannot load TypeScript), and
// `release/packaging/demos.ts`. Three globs of one folder is three chances for
// the build and the guards on it to disagree about what a page is.
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = (path) => fileURLToPath(new URL(path, import.meta.url))

/** Every page, by name — `index`, `webgpu_crowd` — in a stable order. */
export const pageNames = readdirSync(here('.'))
  .filter((file) => file.endsWith('.html'))
  .map((file) => file.replace(/\.html$/, ''))
  .sort()

/**
 * The HTML file a page name stands for, as an absolute path.
 *
 * @param {string} name
 * @returns {string}
 */
export const pagePath = (name) => here(`${name}.html`)
