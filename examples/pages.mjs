// Which pages this demo app has — the page table.
//
// Every `*.html` in this folder is a page (ADR-0011, ADR-0019): the demo and
// each example, one per renderer, with no landing page in front of them —
// `index.html` *is* the WebGL demo, so the deployed root opens on a working
// crowd rather than on a choice of renderer most visitors cannot make. Globbed
// rather than listed, so adding a page is adding a file — no build-config
// change, and no chance of a page that runs in dev and is missing from the
// build. three-mesh-bvh discovers its examples the same way; three.js keys its
// gallery off the `<renderer>_` prefix, which lives on the entry module here
// (`src/webgl_crowd.ts`) now that the page it belongs to answers to
// `index.html`.
//
// Its own file, in plain JavaScript, because several callers need this one list
// and they cannot all read the same language: `vite.config.ts` (bundled by
// vite), `build.mjs` (run by bare `node`, which cannot load TypeScript),
// `nav.mjs` (the navigation strip, generated from this table) and
// `release/packaging/demos.ts`. Several globs of one folder would be several
// chances for the build and the guards on it to disagree about what a page is.
//
// Besides the list, this file reads what a page says about itself — its entry
// module, and so its renderer and its feature, and its title. Those used to be
// regular expressions repeated across the release suite; the strip needs them
// too, and one more copy would have been one too many.
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = (path) => fileURLToPath(new URL(path, import.meta.url))

/** Every page, by name — `index`, `webgpu_crowd` — in a stable order. */
export const pageNames = readdirSync(here('.'))
  .filter((file) => file.endsWith('.html'))
  .map((file) => file.replace(/\.html$/, ''))
  .sort()

/**
 * The page the deployed root opens on — the WebGL demo, with nothing in front
 * of it (ADR-0011 amendment). The one page whose name carries no renderer
 * prefix, and the one the navigation strip lists first.
 */
export const rootPage = 'index'

/**
 * The HTML file a page name stands for, as an absolute path.
 *
 * @param {string} name
 * @returns {string}
 */
export const pagePath = (name) => here(`${name}.html`)

/**
 * The two renderers a page can be.
 *
 * @typedef {'webgl' | 'webgpu'} Renderer
 */

/**
 * The renderer a `<renderer>_`-prefixed name claims; `null` when it claims none.
 *
 * The prefix is load-bearing (ADR-0011) and three.js keys its own gallery off
 * it. It lives on both a page's file and its entry module — except at the root,
 * where `index.html` has no prefix to carry and its entry module is the only
 * thing that says which page it is.
 *
 * @param {string} name A page name or an entry module name.
 * @returns {Renderer | null}
 */
export function rendererOf(name) {
  return name.startsWith('webgpu_') ? 'webgpu' : name.startsWith('webgl_') ? 'webgl' : null
}

/**
 * The feature an entry module shows, read off its `<renderer>_` prefix —
 * `crowd` for the demo, `soldier` for the first example. The entry rather than
 * the page's file, because the root has no prefix to read.
 *
 * @param {string} entry An entry module name, `webgl_crowd.ts`.
 * @returns {string}
 */
export function featureOf(entry) {
  return entry.replace(/^(webgl|webgpu)_/, '').replace(/\.ts$/, '')
}

/**
 * What a page says about itself, read off its HTML.
 *
 * @typedef {object} PageFacts
 * @property {string} name              The page name, `webgpu_crowd`.
 * @property {string} file              Its HTML file, relative to this folder: `webgpu_crowd.html`.
 * @property {string} entry             The module it runs, relative to `src/`; empty when the page names none.
 * @property {Renderer | null} renderer The renderer the entry claims.
 * @property {string} feature           The feature the entry shows.
 * @property {string} title             Its `<title>`, verbatim.
 */

/**
 * Read a page's facts off its file.
 *
 * Following the page's own `<script src>` and `<title>` rather than a naming
 * pattern is what keeps every reader of this true of pages that do not exist
 * yet — a page is covered the moment its file lands, with nothing here to
 * update.
 *
 * @param {string} name
 * @returns {PageFacts}
 */
export function pageFacts(name) {
  const html = readFileSync(pagePath(name), 'utf8')
  const entry = /<script[^>]*\bsrc="\/src\/([^"]+)"/.exec(html)?.[1] ?? ''
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? ''

  return { name, file: `${name}.html`, entry, renderer: rendererOf(entry), feature: featureOf(entry), title }
}
