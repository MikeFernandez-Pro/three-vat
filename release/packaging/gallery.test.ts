// The gallery: the deployed root lists every example and frames the one you
// pick, and no page writes that list down (ADR-0020, #62).
//
// The sidebar is generated from the page table — `pages.mjs`, the same glob
// vite builds from — and stamped into the shell as it is served, in dev and in
// the build alike, so a page added to the folder appears with no list edited.
// Read here off the shell *as served*, through the same function the vite
// plugin calls, because the source file deliberately holds no list: a guard
// that read the source would be asserting the absence of the thing.
//
// This replaces `navigation.test.ts`, and asserts against the same seam the
// navigation strip had — a pure function from the page table to markup, plus
// the served HTML. The guards it carried are carried across in spirit rather
// than in shape: a page appears the moment it is in the table, a title that
// does not say what it shows is refused, and the two pages of a pair agree
// about what they show. What is gone with the strip is "every page lists every
// other": the list lives in one place now, which is the point.
//
// Whether the gallery *fits* at phone width is a browser question, checked by
// eye at 400 px and not here. What is checked here is the half that decays
// silently: the shell listing itself, a page joining the folder and not the
// sidebar, an example quietly growing chrome it needs the shell for.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { gallerySidebar, withGallery, withGalleryLink } from '../../examples/gallery.mjs'
import { buildPages, defaultPage, pageFacts, pageNames, pagePath, shellPage } from '../../examples/pages.mjs'
import type { PageFacts } from '../../examples/pages.mjs'
import { demo } from '../paths.js'

/** The shell as a visitor receives it: the authored page with the sidebar stamped in. */
const shell = withGallery(readFileSync(pagePath(shellPage), 'utf8'))

/** Every example as a visitor receives it: the source file with the way home stamped in. */
const served: [string, string][] = pageNames.map((name: string) => [
  name,
  withGalleryLink(readFileSync(pagePath(name), 'utf8'), name),
])

const facts: PageFacts[] = pageNames.map((name: string) => pageFacts(name))

/** Every sidebar in a page. One is the contract; the count is what the first test pins. */
function sidebarsOf(html: string): string[] {
  return [...html.matchAll(/<nav id="examples"[\s\S]*?<\/nav>/g)].map((m) => m[0])
}

/** The sidebar's entries, in the order a reader meets them. */
function entriesOf(sidebar: string): { href: string; page: string; current: boolean; text: string }[] {
  return [...sidebar.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: /href="([^"]*)"/.exec(m[1]!)?.[1] ?? '',
    page: /data-page="([^"]*)"/.exec(m[1]!)?.[1] ?? '',
    current: m[1]!.includes('aria-current="page"'),
    text: m[2]!.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
  }))
}

/** The renderer each entry is filed under, read off the row it sits in. */
function renderersOf(sidebar: string): string[] {
  return [...sidebar.matchAll(/<li data-renderer="([^"]*)"/g)].map((m) => m[1]!)
}

/** What the renderer filter offers, in the order it offers it. */
function filterOptions(sidebar: string): { renderer: string; label: string }[] {
  const block = /<div id="filter"[\s\S]*?<\/div>/.exec(sidebar)?.[0] ?? ''
  return [...block.matchAll(/<button[^>]*data-renderer="([^"]*)"[^>]*>([^<]*)<\/button>/g)].map((m) => ({
    renderer: m[1]!,
    label: m[2]!,
  }))
}

describe('the shell is the gallery', () => {
  it('finds more than one example to list', () => {
    // Guards the guard: a glob that matched nothing would pass everything below.
    expect(served.length).toBeGreaterThan(1)
  })

  it('carries exactly one sidebar', () => {
    expect(sidebarsOf(shell)).toHaveLength(1)
  })

  it('lists every page in the page table, flat, one entry per page', () => {
    const [sidebar] = sidebarsOf(shell)
    const entries = entriesOf(sidebar!)

    // Flat, not grouped: one entry per *page*, not one per feature with a link
    // per renderer (ADR-0020). So the count is the table's count exactly.
    expect(entries.map((entry) => entry.page).sort()).toEqual([...pageNames].sort())
    expect(entries.map((entry) => entry.href).sort()).toEqual(pageNames.map((n: string) => `${n}.html`).sort())
  })

  it('names each entry from the page it lists, off that page’s own title', () => {
    const [sidebar] = sidebarsOf(shell)

    for (const entry of entriesOf(sidebar!)) {
      const page = facts.find((fact) => fact.name === entry.page)!
      // `three-vat — WebGL robot crowd` → `WebGL robot crowd`: the renderer and
      // what it shows, which is what a flat list has to say to tell a pair
      // apart.
      expect(entry.text, entry.page).toBe(page.title.replace(/^three-vat — /, ''))
    }
  })

  it('does not list itself as an example of itself', () => {
    const [sidebar] = sidebarsOf(shell)
    const entries = entriesOf(sidebar!)

    expect(entries.map((entry) => entry.page)).not.toContain(shellPage)
    expect(entries.map((entry) => entry.href)).not.toContain(`${shellPage}.html`)
  })

  it('frames an example, and says in its URL which one', () => {
    // The iframe is what makes the sidebar persistent, and the hash is what
    // makes a link into the gallery shareable. Both are the shell's own — it is
    // an authored page — so what is pinned here is that they are there at all.
    expect(shell).toMatch(/<iframe\b[^>]*\bid="frame"/)
    expect(shell, 'the shell does not read the framed example out of its URL').toContain('location.hash')
  })

  it('opens on the example the page table nominates', () => {
    const [sidebar] = sidebarsOf(shell)
    const current = entriesOf(sidebar!).filter((entry) => entry.current)

    expect(current.map((entry) => entry.page)).toEqual([defaultPage])
    expect(pageNames, `${defaultPage} is not a page`).toContain(defaultPage)
  })

  it('offers a filter covering both renderers and nothing else', () => {
    const [sidebar] = sidebarsOf(shell)
    const options = filterOptions(sidebar!)
    const renderers = [...new Set(facts.map((page) => page.renderer))].sort()

    // "All" is the absence of a filter, not a third renderer — so what is left
    // when it is dropped has to be exactly the renderers the pages are.
    expect(options[0]!.renderer).toBe('')
    expect(options.slice(1).map((option) => option.renderer)).toEqual(renderers)
    // And every row is filed under one of them, or the filter would hide a page
    // no button brings back.
    expect([...new Set(renderersOf(sidebar!))].sort()).toEqual(renderers)
  })

  it('links relatively, so the deployed site works under its base path', () => {
    for (const { href } of entriesOf(sidebarsOf(shell)[0]!)) {
      expect(href).toMatch(/^[a-z0-9_]+\.html$/)
    }
  })

  it('refuses a shell that writes its own list', () => {
    // The sidebar is generated or it is nothing: a shell that wrote its own
    // would be the menu growing back one anchor at a time.
    expect(() => withGallery(shell)).toThrow(/page table/)
  })
})

describe('the sidebar is generated from the page table', () => {
  /** A feature nobody has built, as two pages that follow the conventions. */
  const HORSE: PageFacts[] = [
    { name: 'webgl_horse', file: 'webgl_horse.html', entry: 'webgl_horse.ts', renderer: 'webgl', feature: 'horse', title: 'three-vat — WebGL horse herd' },
    { name: 'webgpu_horse', file: 'webgpu_horse.html', entry: 'webgpu_horse.ts', renderer: 'webgpu', feature: 'horse', title: 'three-vat — WebGPU horse herd' },
  ]

  it('lists a page the moment it is in the table, with no list edited', () => {
    const sidebar = gallerySidebar([...facts, ...HORSE], defaultPage)
    const entries = entriesOf(sidebar)

    expect(entries.map((entry) => entry.href)).toContain('webgl_horse.html')
    expect(entries.map((entry) => entry.href)).toContain('webgpu_horse.html')
    expect(entries.map((entry) => entry.text)).toContain('WebGL horse herd')
    expect(entries.map((entry) => entry.text)).toContain('WebGPU horse herd')
  })

  it('marks the framed page, and only it', () => {
    const sidebar = gallerySidebar(HORSE, 'webgpu_horse')

    expect(entriesOf(sidebar).filter((entry) => entry.current).map((entry) => entry.page)).toEqual(['webgpu_horse'])
  })

  it('marks nothing when nothing is framed', () => {
    expect(entriesOf(gallerySidebar(HORSE, null)).filter((entry) => entry.current)).toEqual([])
  })

  it('refuses a page whose title does not say what it is', () => {
    const untitled: PageFacts = { ...HORSE[0]!, title: 'horses' }

    expect(() => gallerySidebar([untitled, HORSE[1]!], null)).toThrow(/webgl_horse\.html/)
  })

  it('refuses a title that names the other renderer', () => {
    const lying: PageFacts = { ...HORSE[0]!, title: 'three-vat — WebGPU horse herd' }

    expect(() => gallerySidebar([lying, HORSE[1]!], null)).toThrow(/webgl_horse\.html.*WebGPU/)
  })

  it('refuses a pair whose titles disagree about what they show', () => {
    // Nothing in a flat list groups a pair, and they are still one example on
    // two paths — which is the claim the parity gate rests on.
    const odd: PageFacts = { ...HORSE[1]!, title: 'three-vat — WebGPU pony herd' }

    expect(() => gallerySidebar([HORSE[0]!, odd], null)).toThrow(/horse herd.*pony herd|pony herd.*horse herd/)
  })
})

describe('the shell is outside the page table, and still built and served', () => {
  it('is the one *.html in the examples folder the table excludes', () => {
    expect(existsSync(pagePath(shellPage))).toBe(true)
    expect(pageNames).not.toContain(shellPage)
    // By name, one line in the glob — so every other file in the folder is a
    // page, and a second exclusion has to be argued rather than accumulated.
    expect([...buildPages].sort()).toEqual([shellPage, ...pageNames].sort())
  })

  it('is what the build loops over, so the deployed site has a root', () => {
    // `build.mjs` builds `buildPages`, not `pageNames`: a build over the table
    // alone would ship every example and no gallery. Read off the script,
    // because that mistake is invisible until a deploy.
    const script = readFileSync(demo('build.mjs'), 'utf8')

    expect(script).toContain('buildPages')
    expect(script, 'build.mjs loops over the page table, which the shell is not in').not.toMatch(
      /for \(const name of pageNames\)/,
    )
  })
})

describe('every example stands on its own, and carries one way back', () => {
  it.each(served)('%s carries exactly one link back to the gallery', (_name, html) => {
    const links = [...html.matchAll(/<a\b[^>]*id="gallery-link"[^>]*>/g)]

    expect(links).toHaveLength(1)
    expect(links[0]![0]).toContain(`href="${shellPage}.html"`)
    // Inside the iframe the link has to leave the frame, or the gallery ends up
    // framing itself.
    expect(links[0]![0]).toContain('target="_top"')
  })

  it.each(served)('%s rides the HUD column, under the title', (name, html) => {
    const title = /<div id="title">[\s\S]*?<\/div>/.exec(html)
    const after = title ? html.slice(title.index! + title[0].length).trimStart() : ''

    expect(title, `${name} has no title`).not.toBeNull()
    expect(after.startsWith('<a id="gallery-link"'), `${name}: the link follows the title`).toBe(true)
  })

  it.each(served)('%s carries no sidebar of its own', (_name, html) => {
    // The gallery frames a page, it does not own one: an example that carried
    // the list would be the strip growing back, and a page inside the iframe
    // would show it twice.
    expect(sidebarsOf(html)).toEqual([])
  })

  it('refuses a page without a HUD title to ride', () => {
    expect(() => withGalleryLink('<!doctype html><html><head></head><body></body></html>', 'webgl_horse')).toThrow(
      /title/,
    )
  })

  it('refuses a page that hand-writes the link', () => {
    const [, html] = served[0]!

    expect(() => withGalleryLink(html, 'webgl_horse')).toThrow(/already/)
  })
})

describe('the navigation strip is gone', () => {
  it('has no module left behind beside its successor', () => {
    // Replaced, not deprecated: two generators of page chrome is two answers to
    // where the list lives, and the dead one is the one a future page copies.
    expect(existsSync(demo('nav.mjs'))).toBe(false)
  })

  it.each([['index', shell], ...served])('%s carries no strip', (_name, html) => {
    expect(html).not.toContain('id="navigation"')
  })
})

describe("every page's title says which renderer it runs and what it shows", () => {
  // The convention the sidebar reads its entries from — restated here rather
  // than imported from the generator, so a title that drifts fails on the page
  // that drifted, by name, and not as a generator error inside the build.
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
