// `docs/` is the other half of ADR-0013: the README gets a beginner one crowd on
// screen, and everything a reader needs only once they have committed lives
// here. A folder is a worse place to put depth than a page, because a folder has
// no first sentence — a reader who follows a link from the README lands on a
// file listing and has to guess which of six names is theirs.
//
// So three things are pinned, each of which decays silently (#27):
//
//   1. **A front door exists, and stays one screen.** `docs/README.md` is what
//      GitHub renders for the folder; the budget is what keeps it a signpost
//      rather than a seventh page.
//   2. **It names every page.** A page nobody links is a page nobody finds, and
//      the next one to land here will be added by whoever is already writing it
//      — not by whoever remembers the index.
//   3. **Nothing in `docs/` is code.** A source file in a documentation folder
//      reads as something to import, and the dead prototype reference that used
//      to sit here was neither runnable nor the library. Git remembers it.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { root } from '../paths.js'
import { NOT_A_PAGE } from './pages.js'

const DOCS = root('docs')
const INDEX = join(DOCS, 'README.md')

/**
 * One screen. The index's whole job is to hand a reader off in the first few
 * seconds, and a signpost that scrolls has stopped being one. It costs 20 lines
 * today; the headroom is there for a page or two to be added with the sentence
 * that says who it is for — not for the index to start explaining anything.
 */
const INDEX_LINE_BUDGET = 40

/** What the folder offers a reader: the pages beside the index, and the folders under it. */
function browsable(): { pages: string[]; folders: string[] } {
  const pages: string[] = []
  const folders: string[] = []

  for (const entry of readdirSync(DOCS)) {
    if (statSync(join(DOCS, entry)).isDirectory()) folders.push(entry)
    else if (entry.endsWith('.md')) pages.push(entry)
  }

  return { pages, folders }
}

/** Every file under `docs/`, at any depth — including the folders that hold no page. */
function everyFile(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? everyFile(path) : [path]
  })
}

describe('the docs folder a reader lands in', () => {
  const index = readFileSync(INDEX, 'utf8')
  const { pages, folders } = browsable()

  it('opens on a front door that fits one screen', () => {
    const lines = index.split('\n')

    expect(lines[0], 'the index does not open on a heading').toMatch(/^# /)
    expect(
      lines.length,
      `the docs index runs to ${lines.length} lines; it is budgeted ${INDEX_LINE_BUDGET}. It is a signpost, not a page`,
    ).toBeLessThanOrEqual(INDEX_LINE_BUDGET)
  })

  it('names every page it sits beside, and says who each is for', () => {
    const entries = [...index.matchAll(/\[[^\]]+\]\(\.\/([^)\s]+)\)([^\n]*)/g)]
    const named = new Map(entries.map((match) => [match[1]!.replace(/\/$/, ''), match[2]!]))

    for (const page of pages) {
      if (page === 'README.md') continue
      expect(named.has(page), `the docs index does not name ./${page}`).toBe(true)
      // A bare list of filenames is the file listing a reader already had. The
      // index earns its line by saying who the page is for, on the same line.
      expect(
        named.get(page)!.replace(/[^\w]/g, ''),
        `the docs index links ./${page} but says nothing about who it is for`,
      ).not.toHaveLength(0)
    }

    // The same rule the link check reads, so the two suites cannot disagree
    // about what this folder holds.
    for (const folder of folders.filter((name) => !NOT_A_PAGE.has(name))) {
      expect(named.has(folder), `the docs index does not name ./${folder}/`).toBe(true)
    }
  })

  it('holds documentation and nothing to import, at any depth', () => {
    const code = everyFile(DOCS)
      .filter((path) => /\.(js|mjs|cjs|ts|tsx|jsx)$/.test(path))
      .map((path) => relative(root('.'), path))

    expect(
      code,
      'a source file is sitting in docs/ — a documentation folder is the one place dead code reads as an example',
    ).toEqual([])
  })
})
