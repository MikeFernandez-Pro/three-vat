// Which pages the demo app has, and which renderer each one is.
//
// Two release suites need the same answer and would otherwise each carry their
// own: `bundles.test.ts` reads the import graph to check a page reaches one
// decode path, and `payload.test.ts` reads the built chunks to check it ships
// one renderer. They have to agree about which page is which, or the second
// would happily bless a page the first was never checking.
//
// Neither the list nor the facts are this file's to invent: both come from
// `pages.mjs`, the demo's own page table — the glob vite builds from, and the
// reader of each page's own `<script src>` — so a guard can never be checking a
// different set of pages than the build produced, and a third demo is covered
// the moment its file lands, with nothing here to update. What is left here is
// the shape the two suites read, and the renderer helper re-exported from the
// table so they keep one import.
import { pageFacts, pageNames, rendererOf } from '../../examples/pages.mjs'

export { rendererOf }
export type { Renderer } from '../../examples/pages.mjs'

/** A demo page and the module it runs. */
export interface DemoPage {
  /** The HTML file, relative to the demo folder. */
  html: string
  /** Its entry module, relative to `src/`; empty when the page names none. */
  entry: string
}

/** Every page vite would build, with the entry module each one loads. */
export function demoPages(): DemoPage[] {
  return pageNames.map((name: string) => {
    const { file, entry } = pageFacts(name)
    return { html: file, entry }
  })
}
