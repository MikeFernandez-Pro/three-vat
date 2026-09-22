// What counts as a page a reader browses to.
//
// Two suites need the same answer and would otherwise each carry their own: the
// index check beside this file, which asserts the docs front door names every
// page it sits beside, and the link check in `readme.test.ts`, which follows
// every link on every page. Splitting the rule in two means the next folder
// that is not a page gets added to one of them, and the suites quietly stop
// agreeing about what `docs/` contains — which is the failure this whole corner
// of the release suite exists to catch (#27).
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { root } from '../paths.js'

/**
 * Folders under `docs/` that hold no page. `agents/` is configuration for the
 * coding-agent skills this repository uses; `media/` is the images the pages
 * embed. A reader is never sent to either, so neither is indexed and neither is
 * walked for links.
 */
export const NOT_A_PAGE = new Set(['agents', 'media'])

/**
 * A GitHub heading's anchor: lower-cased, punctuation dropped, spaces
 * hyphenated. Here rather than in either suite because both need it and a
 * second spelling of a slug rule is a second answer to "does this link land" —
 * the link check follows `#fragment`s with it, and the usage guide's own
 * contents list is checked against it.
 */
export function anchor(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

/** Every Markdown page under `dir`, skipping the folders that hold none. */
export function markdownPages(dir: string): string[] {
  const found: string[] = []

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (!NOT_A_PAGE.has(entry)) found.push(...markdownPages(path))
    } else if (entry.endsWith('.md')) found.push(path)
  }

  return found
}

/** Every Markdown page this repository publishes: the root pages a reader lands on, plus `docs/`. */
export function publishedPages(): string[] {
  const rootPages = readdirSync(root('.'))
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => root(entry))

  return [...rootPages, ...markdownPages(root('docs'))]
}
