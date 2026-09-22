// Which pages this app has — the page table.
//
// Every `*.html` in this folder is a page (ADR-0011, ADR-0020) — one example
// per renderer, globbed rather than listed, so adding a page is adding a file:
// no build-config change, and no chance of a page that runs in dev and is
// missing from the build. three-mesh-bvh discovers its examples the same way;
// three.js keys its gallery off the `<renderer>_` prefix, which every page here
// carries now that the demo is gone and the robot crowd is `webgl_crowd` /
// `webgpu_crowd` like any other feature.
//
// The one exception is `index.html`, the **gallery**'s own shell (ADR-0020). It
// is excluded here by name — a line in the glob, rather than moving every
// example into a subfolder and revisiting each non-recursive packaging glob —
// because it is not an example and must never list itself as one. It is still
// built and served: {@link buildPages} is what the build loops over, and it is
// the table with the shell put back in front.
//
// Its own file, in plain JavaScript, because several callers need this one list
// and they cannot all read the same language: `vite.config.ts` (bundled by
// vite), `build.mjs` (run by bare `node`, which cannot load TypeScript),
// `gallery.mjs` (the sidebar, generated from this table) and
// `release/packaging/demos.ts`. Several globs of one folder would be several
// chances for the build and the guards on it to disagree about what a page is.
//
// Besides the list, this file reads what a page says about itself — its entry
// module, and so its renderer and its feature, and its title. Those used to be
// regular expressions repeated across the release suite; the gallery needs them
// too, and one more copy would have been one too many.
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = (path) => fileURLToPath(new URL(path, import.meta.url))

/**
 * The gallery's shell — the deployed root, and the one `*.html` in this folder
 * that is not an example (ADR-0020). Excluded from {@link pageNames} so it
 * never appears in its own sidebar, and named here so the build can be handed
 * it explicitly.
 */
export const shellPage = 'index'

/** Every example page, by name — `webgl_crowd`, `webgpu_soldier` — in a stable order. */
export const pageNames = readdirSync(here('.'))
  .filter((file) => file.endsWith('.html'))
  .map((file) => file.replace(/\.html$/, ''))
  .filter((name) => name !== shellPage)
  .sort()

/**
 * The example the gallery frames when a visitor arrives without asking for one.
 *
 * The WebGL crowd, because it is the page that works in every browser today —
 * the same reason it used to *be* the root (ADR-0011 amendment). Now it is
 * framed by the shell rather than served as it, which is the whole of what
 * ADR-0020 changed about where a visitor lands.
 */
export const defaultPage = 'webgl_crowd'

/** Every page a build has to produce: the shell, then the table it is excluded from. */
export const buildPages = [shellPage, ...pageNames]

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
 * it. It lives on both a page's file and its entry module, and the two have to
 * agree — there is no prefix-less page left to excuse (ADR-0020). `null` is
 * what a name that forgot to say which renderer it is comes back as, so the
 * guards can fail it by name rather than let it bundle both.
 *
 * @param {string} name A page name or an entry module name.
 * @returns {Renderer | null}
 */
export function rendererOf(name) {
  return name.startsWith('webgpu_') ? 'webgpu' : name.startsWith('webgl_') ? 'webgl' : null
}

/**
 * The feature a name shows, read off its `<renderer>_` prefix — `crowd` for the
 * robot crowd, `soldier` for the Soldier example.
 *
 * Takes an entry module or a page name; both carry the prefix, and the `.ts` a
 * module's name ends in is dropped. A group level would be
 * `webgl_<group>_<feature>`, and there is none yet (ADR-0020) — eight features
 * do not make sections — so nothing here has to know about one.
 *
 * @param {string} entry An entry module name, `webgl_crowd.ts`, or a page name.
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
