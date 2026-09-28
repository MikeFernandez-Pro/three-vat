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
// The list is by feature, in sections, with a renderer switch where the filter
// was (ADR-0037, superseding ADR-0020's flat list): one entry per feature, both
// of its pages behind it, filed under the section its pages declare in their
// own heads. The switch decides which page of the pair is framed.
//
// This replaces `navigation.test.ts`, and asserts against the same seam the
// navigation strip had — a pure function from the page table to markup, plus
// the served HTML. A page appears the moment it is in the table, a title that
// does not say what it shows is refused, and the two pages of a pair agree
// about what they show and where they are filed.
//
// Whether the gallery *fits* at phone width is a browser question, checked by
// eye at 400 px and not here. What is checked here is the half that decays
// silently: the shell listing itself, a page joining the folder and not the
// sidebar, an example quietly growing chrome it needs the shell for.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SECTIONS, gallerySidebar, withGallery, withGalleryLink } from '../../examples/gallery.mjs'
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

/** The features the table holds, each once. */
const features = [...new Set(facts.map((page) => page.feature))].sort()

/** Every sidebar in a page. One is the contract; the count is what the first test pins. */
function sidebarsOf(html: string): string[] {
  return [...html.matchAll(/<nav id="examples"[\s\S]*?<\/nav>/g)].map((m) => m[0])
}

/** One sidebar entry: a feature, and the two pages behind it. */
interface Entry {
  href: string
  feature: string
  webgl: string
  webgpu: string
  current: boolean
  text: string
}

/** The sidebar's entries, in the order a reader meets them. */
function entriesOf(sidebar: string): Entry[] {
  return [...sidebar.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: /href="([^"]*)"/.exec(m[1]!)?.[1] ?? '',
    feature: /data-feature="([^"]*)"/.exec(m[1]!)?.[1] ?? '',
    webgl: /data-webgl="([^"]*)"/.exec(m[1]!)?.[1] ?? '',
    webgpu: /data-webgpu="([^"]*)"/.exec(m[1]!)?.[1] ?? '',
    current: m[1]!.includes('aria-current="page"'),
    text: m[2]!.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
  }))
}

/** The sections, in order, each with the features listed under it. */
function sectionsOf(sidebar: string): { name: string; heading: string; features: string[] }[] {
  return [...sidebar.matchAll(/<section data-section="([^"]*)">([\s\S]*?)<\/section>/g)].map((m) => ({
    name: m[1]!.replace(/&amp;/g, '&'),
    heading: (/<h2>([\s\S]*?)<\/h2>/.exec(m[2]!)?.[1] ?? '').replace(/&amp;/g, '&'),
    features: entriesOf(m[2]!).map((entry) => entry.feature),
  }))
}

/** What the renderer switch offers, in the order it offers it. */
function switchOptions(sidebar: string): { renderer: string; label: string; pressed: boolean }[] {
  const block = /<div id="renderer"[\s\S]*?<\/div>/.exec(sidebar)?.[0] ?? ''
  return [...block.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map((m) => ({
    renderer: /data-renderer="([^"]*)"/.exec(m[1]!)?.[1] ?? '',
    label: m[2]!,
    pressed: m[1]!.includes('aria-pressed="true"'),
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

  it('lists every feature once, not every page', () => {
    const entries = entriesOf(sidebarsOf(shell)[0]!)

    // One entry per *feature* (ADR-0037): the list is half as long as the
    // table, and a visitor picks what, not how.
    expect(entries.map((entry) => entry.feature).sort()).toEqual(features)
  })

  it('puts both pages of a feature behind its one entry', () => {
    const entries = entriesOf(sidebarsOf(shell)[0]!)

    expect(entries.flatMap((entry) => [entry.webgl, entry.webgpu]).sort()).toEqual([...pageNames].sort())
    for (const entry of entries) {
      expect(pageFacts(entry.webgl).renderer, entry.feature).toBe('webgl')
      expect(pageFacts(entry.webgpu).renderer, entry.feature).toBe('webgpu')
      // The href is a real page, so the entry still goes somewhere with no
      // script: the WebGL one, the path that runs everywhere.
      expect(entry.href).toBe(`${entry.webgl}.html`)
    }
  })

  it("files each feature under the section its pages declare, in the shell's order", () => {
    const sections = sectionsOf(sidebarsOf(shell)[0]!)

    expect(sections.map((section) => section.name)).toEqual(
      SECTIONS.filter((name: string) => facts.some((page) => page.section === name)),
    )
    for (const section of sections) {
      expect(section.heading).toBe(section.name)
      for (const feature of section.features) {
        for (const page of facts.filter((fact) => fact.feature === feature)) {
          expect(page.section, page.file).toBe(section.name)
        }
      }
    }
  })

  it("names each entry from its pages' own title", () => {
    for (const entry of entriesOf(sidebarsOf(shell)[0]!)) {
      const page = facts.find((fact) => fact.name === entry.webgl)!
      // `three-vat — WebGL crowd` → `crowd`: what the feature is, with the
      // renderer left to the switch.
      expect(entry.text, entry.feature).toBe(page.title.replace(/^three-vat — (WebGL|WebGPU) /, ''))
    }
  })

  it('does not list itself as an example of itself', () => {
    const entries = entriesOf(sidebarsOf(shell)[0]!)

    expect(entries.flatMap((entry) => [entry.webgl, entry.webgpu])).not.toContain(shellPage)
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
    const current = entriesOf(sidebarsOf(shell)[0]!).filter((entry) => entry.current)

    expect(current.map((entry) => entry.webgl)).toEqual([defaultPage])
    expect(pageNames, `${defaultPage} is not a page`).toContain(defaultPage)
  })

  it('offers a switch between the two renderers, and nothing else', () => {
    const options = switchOptions(sidebarsOf(shell)[0]!)
    const renderers = [...new Set(facts.map((page) => page.renderer))].sort()

    // No "all": every entry is both renderers, so there is nothing to narrow —
    // the switch only picks which of the two is framed. WebGL pressed, as the
    // path that works in every browser.
    expect(options.map((option) => option.renderer)).toEqual(renderers)
    expect(options.filter((option) => option.pressed).map((option) => option.renderer)).toEqual(['webgl'])
  })

  it('remembers the switch', () => {
    // A visitor browsing features stays on their renderer, across visits too.
    expect(shell).toContain('localStorage')
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
    { name: 'webgl_horse', file: 'webgl_horse.html', entry: 'webgl_horse.ts', renderer: 'webgl', feature: 'horse', title: 'three-vat — WebGL horse herd', section: 'Baking' },
    { name: 'webgpu_horse', file: 'webgpu_horse.html', entry: 'webgpu_horse.ts', renderer: 'webgpu', feature: 'horse', title: 'three-vat — WebGPU horse herd', section: 'Baking' },
  ]

  /** The same, as a second feature filed somewhere else. */
  const PONY: PageFacts[] = HORSE.map((page) => ({
    ...page,
    name: page.name.replace('horse', 'pony'),
    file: page.file.replace('horse', 'pony'),
    entry: page.entry.replace('horse', 'pony'),
    feature: 'pony',
    title: page.title.replace('horse', 'pony'),
    section: 'Start here',
  }))

  it('lists a feature the moment its pages are in the table, with no list edited', () => {
    const sidebar = gallerySidebar([...facts, ...HORSE], defaultPage)
    const horse = entriesOf(sidebar).find((entry) => entry.feature === 'horse')

    expect(horse).toMatchObject({ href: 'webgl_horse.html', webgl: 'webgl_horse', webgpu: 'webgpu_horse', text: 'horse herd' })
    expect(sectionsOf(sidebar).find((section) => section.name === 'Baking')?.features).toContain('horse')
  })

  it("lists the sections in the shell's order, whatever order the pages come in", () => {
    expect(sectionsOf(gallerySidebar([...HORSE, ...PONY], null)).map((section) => section.name)).toEqual([
      'Start here',
      'Baking',
    ])
  })

  it("marks the framed page's feature, whichever renderer is framed", () => {
    const sidebar = gallerySidebar([...HORSE, ...PONY], 'webgpu_horse')

    expect(entriesOf(sidebar).filter((entry) => entry.current).map((entry) => entry.feature)).toEqual(['horse'])
  })

  it('marks nothing when nothing is framed', () => {
    expect(entriesOf(gallerySidebar(HORSE, null)).filter((entry) => entry.current)).toEqual([])
  })

  it('refuses a page that declares no section', () => {
    const lost: PageFacts = { ...HORSE[0]!, section: '' }

    expect(() => gallerySidebar([lost, HORSE[1]!], null)).toThrow(/webgl_horse\.html.*section/)
  })

  it('refuses a section the shell does not have', () => {
    // The sections are the shell's grouping: a page that invented one would
    // land under a heading nobody ordered.
    const stray: PageFacts[] = HORSE.map((page) => ({ ...page, section: 'Horses' }))

    expect(() => gallerySidebar(stray, null)).toThrow(/Horses/)
  })

  it('refuses a pair whose pages declare different sections', () => {
    const split: PageFacts = { ...HORSE[1]!, section: 'Playback' }

    expect(() => gallerySidebar([HORSE[0]!, split], null)).toThrow(/horse.*(Baking.*Playback|Playback.*Baking)/)
  })

  it('refuses a feature with a page on one renderer only', () => {
    // An entry is both pages; with one missing, the switch would frame nothing.
    expect(() => gallerySidebar([HORSE[0]!], null)).toThrow(/horse.*WebGPU/)
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
    // One entry names both pages, so they have to be one example on two paths
    // — which is the claim the parity gate rests on.
    const odd: PageFacts = { ...HORSE[1]!, title: 'three-vat — WebGPU pony herd' }

    expect(() => gallerySidebar([HORSE[0]!, odd], null)).toThrow(/horse herd.*pony herd|pony herd.*horse herd/)
  })
})

describe('every page declares its section in its own head', () => {
  it.each(facts.map((page) => [page.file, page]))('%s', (_file, page) => {
    // Read off the page's own HTML by the page table, so adding an example is
    // still adding a file (ADR-0037).
    expect(SECTIONS).toContain(page.section)
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
    const title = /<(\w+) id="title">[\s\S]*?<\/\1>/.exec(html)
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
