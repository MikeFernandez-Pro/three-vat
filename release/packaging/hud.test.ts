// The two pages of a pair are one page (ADR-0011): a visitor who opens the
// WebGPU Soldier after the WebGL one meets the same argument, made with the
// same readouts, and only the decode path underneath differs.
//
// Per pair, and not across the site, because a page carries the readouts its
// own feature is evidenced by and nothing more (ADR-0020): the crowd pages
// count draw calls, the Soldier pages weigh a texture, and holding all four to
// one list of ids would be asking each to carry the other's evidence. What
// survives that is the claim that actually mattered — the two pages of a pair
// agree with each other.
//
// ADR-0011 duplicates those pages on purpose, and the duplication is what this
// guard protects: with nothing shared forcing the resemblance, a readout added
// to one page and forgotten on its twin is a silent divergence. Read off the
// page table, so a new pair joins the comparison the moment its files land —
// and compared page against page rather than against a list written here, so the
// contract is whatever the pages themselves agree on.
//
// What this does *not* pin is the resemblance ADR-0011 calls evidence. That
// claim is about the pages' VAT sections reading alike with no shared module
// forcing them to, and it is left exactly as unenforced as that ADR wants it.
// What is pinned here is the HUD's markup contract — which readouts a page
// offers its script — because that is a decision about the page, not evidence
// about the library.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { withGalleryLink } from '../../examples/gallery.mjs'
import { featureOf, pageFacts, pageNames, pagePath } from '../../examples/pages.mjs'

/**
 * Every example page's HTML, as a visitor receives it: the source with the way
 * back to the gallery stamped in (gallery.mjs, #62), because the one link a
 * page offers is the gallery's now and the source deliberately holds none.
 * Every page in the table, which is every `*.html` in the folder but the
 * gallery's own shell (ADR-0020) — the shell carries no HUD and is nobody's
 * pair.
 */
function demoPages(): [string, string][] {
  return pageNames.map((name: string) => [
    `${name}.html`,
    withGalleryLink(readFileSync(pagePath(name), 'utf8'), name),
  ])
}

const pages = demoPages()

/** The module a page runs, read off its one `<script src>` by the page table. */
function entryOf(file: string): string {
  return pageFacts(file.replace(/\.html$/, '')).entry
}

/**
 * The HUD a page declares: that `<div>` and its children, and nothing after it.
 * Bounded by counting `<div>`s rather than cut at the next closing tag, because
 * the HUD nests — and because what follows it on the WebGPU page is the
 * no-WebGPU notice, which is legitimately that page's alone.
 */
function hudMarkup(html: string): string {
  const start = html.indexOf('<div id="hud">')
  if (start === -1) return ''
  let depth = 0
  for (const tag of html.slice(start).matchAll(/<\/?div/g)) {
    depth += tag[0].startsWith('</') ? -1 : 1
    if (depth === 0) return html.slice(start, start + tag.index! + tag[0].length)
  }
  return html.slice(start)
}

/**
 * Every id inside a page's HUD — the readouts its script fills, and the
 * structure they hang on. All of it, rather than a filtered "readouts only":
 * the HUD's emphasis lives in that structure (`#draws` wrapping `#draw-count`
 * and `#draw-label` is what makes the one number big), so a page that flattened
 * it would be making the argument differently.
 */
function hudElementIds(html: string): string[] {
  return [...hudMarkup(html).matchAll(/id="([^"]+)"/g)].map((m) => m[1]!).sort()
}

/** Every feature on the site — `crowd`, `soldier` — with the pages that show it. */
function pairs(): [string, string[]][] {
  const byFeature = new Map<string, string[]>()
  for (const [file] of pages) {
    const feature = featureOf(entryOf(file))
    byFeature.set(feature, [...(byFeature.get(feature) ?? []), file])
  }
  return [...byFeature.entries()]
}

describe('the two pages of a pair make the same argument', () => {
  it('finds more than one page to compare', () => {
    // Guards the guard: one page agrees with itself trivially, and a glob that
    // matched nothing would agree harder still.
    expect(pages.length).toBeGreaterThan(1)
  })

  it.each(pairs())('the %s pages carry the same HUD readouts as each other', (_feature, files) => {
    const [reference, ...rest] = files
    const referenceHtml = pages.find(([f]) => f === reference)![1]!

    for (const file of rest) {
      const html = pages.find(([f]) => f === file)![1]!
      expect(hudElementIds(html), `${file} vs ${reference}`).toEqual(hudElementIds(referenceHtml))
    }
  })
})

describe('every feature is a pair of pages, one per renderer', () => {
  it.each(pairs())('%s is shown on exactly two pages', (_feature, files) => {
    // One per renderer (ADR-0011): a feature on WebGL only would read as one
    // the TSL path lacks, which is the split ADR-0016 committed never to
    // reopen. That the two pages of a pair *offer* each other was the strip's
    // claim and is not made any more — the gallery lists both, one click from
    // either (ADR-0020), and an example carries one link and that is the one
    // home.
    expect(files).toHaveLength(2)
  })
})
