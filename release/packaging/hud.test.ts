// The demo pages are one demo (ADR-0012): a visitor who opens the WebGPU page
// after the WebGL one meets the same argument, made with the same readouts, and
// only the decode path underneath differs.
//
// ADR-0011 duplicates those pages on purpose, and the duplication is what this
// guard protects: with nothing shared forcing the resemblance, a readout added
// to one page and forgotten on the other is a silent divergence. Read off the
// HTML by glob, so a third demo joins the comparison the moment its file lands —
// and compared page against page rather than against a list written here, so the
// contract is whatever the pages themselves agree on.
//
// What this does *not* pin is the resemblance ADR-0011 calls evidence. That
// claim is about the pages' VAT sections reading alike with no shared module
// forcing them to, and it is left exactly as unenforced as that ADR wants it.
// What is pinned here is the HUD's markup contract — which readouts a demo page
// offers its script — because that is a decision about the demo, not evidence
// about the library.
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { demo } from '../paths.js'

/**
 * Every demo page's HTML. All of them: there is no landing page any more
 * (ADR-0011 amendment), so every `*.html` beside the demo folder's root *is* a
 * demo — `index.html` included, which is the WebGL one.
 */
function demoPages(): [string, string][] {
  return readdirSync(demo('.'))
    .filter((file) => file.endsWith('.html'))
    .sort()
    .map((file) => [file, readFileSync(demo(file), 'utf8')])
}

const pages = demoPages()

/** The module a page runs, read off its one `<script src>`. */
function entryOf(html: string): string {
  return /<script[^>]*\bsrc="\/src\/([^"]+)"/.exec(html)?.[1] ?? ''
}

/** Whether a page offers a way to another, by the relative name it deploys under. */
function linksTo(html: string, page: string): boolean {
  return html.includes(`href="${page}"`)
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

describe('every demo page makes the same argument', () => {
  it('finds more than one page to compare', () => {
    // Guards the guard: one page agrees with itself trivially, and a glob that
    // matched nothing would agree harder still.
    expect(pages.length).toBeGreaterThan(1)
  })

  it.each(pages.map(([file]) => file))('%s carries the same HUD readouts as the others', (file) => {
    const [reference, referenceHtml] = pages[0]!
    const html = pages.find(([f]) => f === file)![1]!

    expect(hudElementIds(html), `${file} vs ${reference}`).toEqual(hudElementIds(referenceHtml))
  })
})

// A visitor following a link to the deployed site lands on a working crowd, not
// on a question they cannot answer (ADR-0011 amendment). The root *is* the WebGL
// demo — the path that works in every browser today — and the way to the other
// renderer is a link in the page chrome rather than a menu in front of it.
//
// A star, not a mesh: the root offers every other demo, and every other demo
// offers the way back. A third demo joins by linking home and being linked to,
// which is the shape the amendment describes — "every page links to every other"
// would grow back into the menu it deleted.
describe('the site opens on a demo', () => {
  const ROOT = 'index.html'

  it('runs the WebGL demo at the root, with nothing in front of it', () => {
    expect(entryOf(readFileSync(demo(ROOT), 'utf8'))).toBe('webgl_crowd.ts')
  })

  it.each(pages.filter(([file]) => file !== ROOT).map(([file]) => file))(
    'is reachable from the root, and offers the way back: %s',
    (file) => {
      const root = pages.find(([f]) => f === ROOT)![1]!
      const html = pages.find(([f]) => f === file)![1]!

      expect(linksTo(root, file), `${ROOT} → ${file}`).toBe(true)
      expect(linksTo(html, ROOT), `${file} → ${ROOT}`).toBe(true)
    },
  )
})
