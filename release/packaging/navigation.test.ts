// The navigation strip: every page carries the way to every other page, the
// demo first, and none of them writes that list down (ADR-0019, #56).
//
// The strip is generated from the page table — `pages.mjs`, the same glob vite
// builds from — and stamped into each page as it is served, in dev and in the
// build alike, so a page added to the folder appears on every page with no list
// edited. Read here off the page *as served*, through the same function the
// vite plugin calls, because the source file deliberately holds no strip: a
// guard that read the source would be asserting the absence of the thing.
//
// What is pinned is the contract the ticket states — every page listed, the
// demo first, relative links, the current page marked — and the convention the
// generator leans on: a page's `<title>` says which renderer it runs and what
// it shows, and that is where the strip's labels come from. Whether the strip
// *fits* at phone width is a browser question, checked by eye at 400 px and not
// here.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { navigationStrip, withNavigationStrip } from '../../examples/nav.mjs'
import { pageFacts, pageNames, pagePath, rootPage } from '../../examples/pages.mjs'
import type { PageFacts } from '../../examples/pages.mjs'

const ROOT = rootPage

/** Every page as a visitor receives it: the source file with the strip stamped in. */
const served: [string, string][] = pageNames.map((name: string) => [
  name,
  withNavigationStrip(readFileSync(pagePath(name), 'utf8'), name),
])

const facts: PageFacts[] = pageNames.map((name: string) => pageFacts(name))

/** Every strip on a page. One is the contract; the count is what the first test pins. */
function stripsOf(html: string): string[] {
  return [...html.matchAll(/<nav id="navigation"[\s\S]*?<\/nav>/g)].map((m) => m[0])
}

/** The strip's links, in the order a reader meets them. */
function linksOf(strip: string): { href: string; current: boolean; text: string }[] {
  return [...strip.matchAll(/<a\b([^>]*)>([^<]*)<\/a>/g)].map((m) => ({
    href: /href="([^"]*)"/.exec(m[1]!)?.[1] ?? '',
    current: m[1]!.includes('aria-current="page"'),
    text: m[2]!,
  }))
}

describe('every page carries the navigation strip', () => {
  it('finds more than one page to carry it', () => {
    // Guards the guard: a glob that matched nothing would pass everything below.
    expect(served.length).toBeGreaterThan(1)
  })

  it.each(served)('%s carries exactly one strip', (_name, html) => {
    expect(stripsOf(html)).toHaveLength(1)
  })

  it.each(served)('%s lists every page in the page table, the demo first', (_name, html) => {
    const [strip] = stripsOf(html)
    const hrefs = linksOf(strip!).map((link) => link.href)

    expect(hrefs[0]).toBe(`${ROOT}.html`)
    expect([...hrefs].sort()).toEqual(pageNames.map((n: string) => `${n}.html`).sort())
  })

  it.each(served)('%s links relatively, so the deployed site works under its base path', (name, html) => {
    const [strip] = stripsOf(html)

    for (const { href } of linksOf(strip!)) {
      expect(href, `${name} → ${href}`).toMatch(/^[a-z0-9_]+\.html$/)
    }
  })

  it.each(served)('%s marks itself, and only itself, as the current page', (name, html) => {
    const [strip] = stripsOf(html)
    const current = linksOf(strip!).filter((link) => link.current)

    expect(current.map((link) => link.href)).toEqual([`${name}.html`])
  })

  it('rides the HUD column, under the title, so it scrolls with it and never meets the texture panel', () => {
    for (const [name, html] of served) {
      // Directly under the title, rather than merely above the draw-call
      // readout the demo used to be asked about: a page carries the readouts
      // its own feature is evidenced by (ADR-0020), so there is no one readout
      // to place the strip against — and "nothing of the page's own comes
      // between" is the claim that was meant anyway.
      const title = /<div id="title">[\s\S]*?<\/div>/.exec(html)
      const after = title ? html.slice(title.index! + title[0].length).trimStart() : ''

      expect(title, `${name} has no title`).not.toBeNull()
      expect(after.startsWith('<nav id="navigation"'), `${name}: the strip follows the title`).toBe(true)
    }
  })

  it('refuses a page without a HUD title to ride', () => {
    expect(() => withNavigationStrip('<!doctype html><html><head></head><body></body></html>', ROOT)).toThrow(
      /title/,
    )
  })

  it('refuses a page that hand-writes a strip', () => {
    // The strip is generated or it is nothing: a page that wrote its own would
    // be the hand-written list growing back (ADR-0011 amendment).
    const [, html] = served[0]!

    expect(() => withNavigationStrip(html, ROOT)).toThrow(/already/)
  })
})

describe('the strip is generated from the page table', () => {
  /** A feature nobody has built, as two pages that follow the conventions. */
  const HORSE: PageFacts[] = [
    { name: 'webgl_horse', file: 'webgl_horse.html', entry: 'webgl_horse.ts', renderer: 'webgl', feature: 'horse', title: 'three-vat — WebGL horse herd' },
    { name: 'webgpu_horse', file: 'webgpu_horse.html', entry: 'webgpu_horse.ts', renderer: 'webgpu', feature: 'horse', title: 'three-vat — WebGPU horse herd' },
  ]

  it('lists a page the moment it is in the table, with no list edited', () => {
    const strip = navigationStrip([...facts, ...HORSE], ROOT)
    const hrefs = linksOf(strip).map((link) => link.href)

    expect(hrefs).toContain('webgl_horse.html')
    expect(hrefs).toContain('webgpu_horse.html')
    expect(strip).toContain('horse herd')
    // Still the demo first: a new feature joins after it, never in front.
    expect(hrefs[0]).toBe(`${ROOT}.html`)
  })

  it('groups a feature as one label and a link per renderer, WebGL first', () => {
    const strip = navigationStrip(HORSE, 'webgl_horse')
    const links = linksOf(strip)

    expect(links.map((link) => link.text)).toEqual(['WebGL', 'WebGPU'])
    expect(strip.indexOf('horse herd')).toBeLessThan(strip.indexOf('webgl_horse.html'))
  })

  it('refuses a page whose title does not say what it is', () => {
    const untitled: PageFacts = { ...HORSE[0]!, title: 'horses' }

    expect(() => navigationStrip([untitled, HORSE[1]!], ROOT)).toThrow(/webgl_horse\.html/)
  })

  it('refuses a title that names the other renderer', () => {
    const lying: PageFacts = { ...HORSE[0]!, title: 'three-vat — WebGPU horse herd' }

    expect(() => navigationStrip([lying, HORSE[1]!], ROOT)).toThrow(/webgl_horse\.html.*WebGPU/)
  })

  it('refuses a pair whose titles disagree about what they show', () => {
    const odd: PageFacts = { ...HORSE[1]!, title: 'three-vat — WebGPU pony herd' }

    expect(() => navigationStrip([HORSE[0]!, odd], ROOT)).toThrow(/horse herd.*pony herd|pony herd.*horse herd/)
  })
})

describe("every page's title says which renderer it runs and what it shows", () => {
  // The convention the strip reads its labels from — restated here rather than
  // imported from the generator, so a title that drifts fails on the page that
  // drifted, by name, and not as a generator error inside the build.
  const TITLE = /^three-vat — (WebGL|WebGPU) (.+)$/

  it.each(facts.map((page) => [page.file, page]))('%s', (_file, page) => {
    const match = TITLE.exec(page.title)

    expect(match, `${page.file}: <title>${page.title}</title>`).not.toBeNull()
    expect(match![1]!.toLowerCase()).toBe(page.renderer)
  })

  it('gives both pages of a pair the same label', () => {
    const byFeature = new Map<string, Set<string>>()
    for (const page of facts) {
      const label = TITLE.exec(page.title)?.[2] ?? page.title
      byFeature.set(page.feature, new Set([...(byFeature.get(page.feature) ?? []), label]))
    }

    for (const [feature, labels] of byFeature) expect([...labels], feature).toHaveLength(1)
  })
})
