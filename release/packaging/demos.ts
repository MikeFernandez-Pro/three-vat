// Which pages the demo app has, and which renderer each one is.
//
// Two release suites need the same answer and would otherwise each carry their
// own: `bundles.test.ts` reads the import graph to check a page reaches one
// decode path, and `payload.test.ts` reads the built chunks to check it ships
// one renderer. They have to agree about which page is which, or the second
// would happily bless a page the first was never checking.
//
// The list itself is not this file's to invent: it comes from `pages.mjs`, the
// demo's own glob and the one vite builds from, so a guard can never be checking
// a different set of pages than the build produced.
import { readFileSync } from 'node:fs'
import { pageNames } from '../../examples/pages.mjs'
import { demo } from '../paths.js'

/** A demo page and the module it runs. */
export interface DemoPage {
  /** The HTML file, relative to the demo folder. */
  html: string
  /** Its entry module, relative to `src/`; empty when the page names none. */
  entry: string
}

/**
 * Every page vite would build, with the entry module each one loads.
 *
 * Following the page's own `<script src>` rather than a naming pattern is what
 * keeps both guards true of pages that do not exist yet — a third demo is
 * covered the moment its file lands, with nothing here to update.
 */
export function demoPages(): DemoPage[] {
  return pageNames.map((name: string) => {
    const html = `${name}.html`
    const src = /<script[^>]*\bsrc="\/src\/([^"]+)"/.exec(readFileSync(demo(html), 'utf8'))?.[1]
    return { html, entry: src ?? '' }
  })
}

/** The two renderers a demo can be. */
export type Renderer = 'webgl' | 'webgpu'

/**
 * The renderer a `<renderer>_`-prefixed name claims; `null` when it claims none.
 *
 * The prefix is load-bearing (ADR-0011) and three.js keys its own gallery off
 * it. It lives on both a page's file and its entry module — except at the root,
 * where `index.html` has no prefix to carry and its entry module is the only
 * thing that says which demo it is.
 */
export function rendererOf(name: string): Renderer | null {
  return name.startsWith('webgpu_') ? 'webgpu' : name.startsWith('webgl_') ? 'webgl' : null
}
