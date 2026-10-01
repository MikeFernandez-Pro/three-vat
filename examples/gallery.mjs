// The gallery: the sidebar that lists every example, and the link back to it
// that every example carries.
//
// The deployed root is a shell — `index.html`, the one `*.html` here the page
// table excludes — with a sidebar down one side and the example you picked in
// an iframe beside it (ADR-0020). The sidebar is generated from the page table
// (`pages.mjs`, the same glob vite builds from) and stamped into the shell as
// it is served, by the `transformIndexHtml` hook in `vite.config.ts`, in dev
// and in the build alike. So a page added to the folder appears in the gallery
// with no list edited, which is the whole reason it is generated: a
// hand-written link per example would be a menu growing back one anchor at a
// time.
//
// This replaces the per-page navigation strip ADR-0019 built, and it is the
// same seam: a pure function from the page table to markup, plus a stamper that
// puts it on a page. What changed is where the list lives. A list of every page
// carried *on* every page is a gallery drawn badly, N times; drawn once, in a
// shell, it can afford a filter and a persistent sidebar, and a visitor keeps
// their place while they browse.
//
// The iframe **frames** a page, it does not own one. An example must work
// opened at its own address, where there is no shell around it — which is what
// keeps ADR-0011 intact and what every build guard goes on relying on. So the
// only thing stamped onto an example is one link back here.
//
// The sidebar lists **by feature, in sections** (ADR-0037, superseding
// ADR-0020's flat list): one entry per feature, named from its pages' shared
// `<title>`, filed under the section both pages declare in their own heads, and
// holding both pages behind it. Which of the two is framed is the renderer
// switch above the list, made once for the whole gallery and remembered by the
// shell — a visitor picks *what*, and the switch says *how*.
//
// The titles are still read by convention — `three-vat — <Renderer> <what it
// shows>` — and a title that does not follow it fails the build by name rather
// than shipping a gallery with a hole in it, exactly as the strip did.
//
// Plain JavaScript beside the page table, for the same reason the table is:
// vite's config imports it, and so does the release suite.
import { defaultPage, pageFacts, pageNames } from './pages.mjs'

/** @typedef {import('./pages.mjs').PageFacts} PageFacts */
/** @typedef {import('./pages.mjs').Renderer} Renderer */

/** What a title has to say, and where the label sits in it. */
const TITLE = /^three-vat — (WebGL|WebGPU) (.+)$/

/** The renderers the switch offers, in the order it offers them: the path that works everywhere, first. */
const RENDERERS = /** @type {Renderer[]} */ (['webgl', 'webgpu'])
/** @type {Record<Renderer, string>} */
const RENDERER_LABEL = { webgl: 'WebGL', webgpu: 'WebGPU' }

/**
 * The gallery's sections, in the order the sidebar lists them (ADR-0037). The
 * shell's grouping, declared by each page in its own head and never a level in
 * a file name — so a page is filed by editing the page, and a section nobody
 * ordered here is refused rather than appended.
 */
export const SECTIONS = ['Start here', 'Baking', 'Playback', 'Rendering', 'Your assets']

/** The shell's file, and so the href every example points home at. */
const SHELL = 'index.html'

/** The slot the authored shell leaves for the generated sidebar. */
const SLOT = '<nav id="examples" aria-label="examples"></nav>'

/**
 * The back-link's own style, stamped into an example's `<head>` beside its
 * markup — because the example knows nothing about the gallery and should not
 * have to carry styling for a link it does not write.
 */
const LINK_STYLE = `
    <style data-three-vat="gallery-link">
      /* The way back to the gallery (gallery.mjs): on the title's line, the way
         three's own link opens an example's first line (ADR-0024). */
      #gallery-link { margin-left: 8px; }
      @media (max-width: 600px) { #gallery-link { margin-left: 6px; } }
    </style>
`

/**
 * Text, made safe to sit inside HTML.
 *
 * @param {string} text
 * @returns {string}
 */
const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * What a page's title says: its renderer, and the label the gallery shows for it.
 *
 * @param {PageFacts} page
 * @returns {{ renderer: Renderer, label: string }}
 */
function readTitle(page) {
  const match = TITLE.exec(page.title)
  if (!match) {
    throw new Error(
      `${page.file}: <title>${page.title}</title> does not say which renderer it runs and what it shows — ` +
        'expected "three-vat — WebGL <what it shows>" or "three-vat — WebGPU <what it shows>"',
    )
  }
  const renderer = /** @type {Renderer} */ (match[1].toLowerCase())
  if (renderer !== page.renderer) {
    throw new Error(
      `${page.file} runs ${page.entry || 'no entry module'}, but its title says ${match[1]} — the two have to agree`,
    )
  }
  return { renderer, label: match[2] }
}

/**
 * The table, as the features the sidebar lists: one per feature, in the
 * shell's section order, each holding both of its pages.
 *
 * Refuses, by name and before anything is drawn, every table the sidebar could
 * not draw honestly: a page that declares no section or one the shell does not
 * have, a feature with a page on one renderer only (its entry would frame
 * nothing when switched), and a pair whose two pages disagree about what they
 * show or where they are filed. The two pages of a feature are one example on
 * two decode paths, which is what the parity gate rests on, and a pair that
 * named itself two things would be the first place that stopped being true.
 *
 * @param {PageFacts[]} pages
 * @returns {{ section: string, features: { feature: string, label: string, pages: Record<Renderer, PageFacts> }[] }[]}
 */
function featuresBySection(pages) {
  /** @type {Map<string, { feature: string, label: string, section: string, pages: Partial<Record<Renderer, PageFacts>> }>} */
  const byFeature = new Map()

  for (const page of pages) {
    const { renderer, label } = readTitle(page)
    if (!page.section) {
      throw new Error(
        `${page.file} declares no gallery section — add <meta name="three-vat:section" content="…"> to its head, ` +
          `one of: ${SECTIONS.join(', ')}`,
      )
    }
    if (!SECTIONS.includes(page.section)) {
      throw new Error(`${page.file} files itself under "${page.section}", which is not a section of the gallery (${SECTIONS.join(', ')})`)
    }

    const seen = byFeature.get(page.feature)
    if (seen === undefined) {
      byFeature.set(page.feature, { feature: page.feature, label, section: page.section, pages: { [renderer]: page } })
      continue
    }
    const other = Object.values(seen.pages)[0]
    if (seen.label !== label) {
      throw new Error(
        `the ${page.feature} pages disagree about what they show: "${seen.label}" (${other?.file}) vs "${label}" (${page.file})`,
      )
    }
    if (seen.section !== page.section) {
      throw new Error(
        `the ${page.feature} pages disagree about where they are filed: "${seen.section}" (${other?.file}) vs "${page.section}" (${page.file})`,
      )
    }
    seen.pages[renderer] = page
  }

  for (const { feature, pages: pair } of byFeature.values()) {
    for (const renderer of RENDERERS) {
      if (!pair[renderer]) {
        throw new Error(`the ${feature} feature has no ${RENDERER_LABEL[renderer]} page — every entry is a pair, one page per renderer`)
      }
    }
  }

  return SECTIONS.map((section) => ({
    section,
    features: [...byFeature.values()]
      .filter((feature) => feature.section === section)
      .map(({ feature, label, pages: pair }) => ({ feature, label, pages: /** @type {Record<Renderer, PageFacts>} */ (pair) })),
  })).filter(({ features }) => features.length > 0)
}

/**
 * The gallery's sidebar for a given page table, with `current` marked.
 *
 * Pure: the table is a parameter so the guard on this can hand it a page nobody
 * has built and see it listed. Sections come in {@link SECTIONS}' order and
 * features within one in the table's, which is the glob's — alphabetical. Each
 * entry carries both of its pages; its `href` is the WebGL one, so the entry
 * goes somewhere with no script at all, and the shell's switch reads
 * `data-webgl` / `data-webgpu` to frame the one the visitor chose.
 *
 * @param {PageFacts[]} pages
 * @param {string | null} current The name of the page framed right now, if any.
 * @returns {string}
 */
export function gallerySidebar(pages, current) {
  const sections = featuresBySection(pages)

  const blocks = sections.map(({ section, features }) => {
    const items = features.map(({ feature, label, pages: pair }) => {
      const mark = RENDERERS.some((renderer) => pair[renderer].name === current) ? ' aria-current="page"' : ''
      const names = RENDERERS.map((renderer) => ` data-${renderer}="${escapeHtml(pair[renderer].name)}"`).join('')
      return (
        `<li><a href="${escapeHtml(pair.webgl.file)}" data-feature="${escapeHtml(feature)}"${names}${mark}>` +
        `${escapeHtml(label)}</a></li>`
      )
    })
    return (
      `<section data-section="${escapeHtml(section)}">\n` +
      `          <h2>${escapeHtml(section)}</h2>\n` +
      `          <ul>\n            ${items.join('\n            ')}\n          </ul>\n        </section>`
    )
  })

  // The switch offers the renderers and nothing else: every entry is both, so
  // there is nothing to narrow and no "all". WebGL comes pressed, the path that
  // works in every browser; the shell's script puts back what a visitor chose.
  const buttons = RENDERERS.map(
    (renderer, i) =>
      `<button type="button" data-renderer="${renderer}" aria-pressed="${i === 0}">${RENDERER_LABEL[renderer]}</button>`,
  )

  return (
    '<nav id="examples" aria-label="examples">\n' +
    `        <div id="renderer" role="group" aria-label="renderer">\n          ${buttons.join('\n          ')}\n        </div>\n` +
    `        ${blocks.join('\n        ')}\n      </nav>`
  )
}

/**
 * The shell's HTML with the sidebar stamped in — the gallery as a visitor
 * receives it.
 *
 * The shell is authored (it is a page, with a layout and a script of its own)
 * and leaves one empty slot for the list it must not write. A shell that had
 * written its own is refused: the sidebar is generated or it is nothing.
 *
 * The default example is marked current here rather than chosen in the shell's
 * script, so which page the gallery opens on is the page table's answer and is
 * given once.
 *
 * @param {string} html The shell's source, as written.
 * @returns {string}
 */
export function withGallery(html) {
  if (!html.includes(SLOT)) {
    throw new Error(
      `${SHELL} has no empty <nav id="examples" aria-label="examples"></nav> for the generated sidebar — ` +
        'the list comes from the page table, never from the shell',
    )
  }
  if (!pageNames.includes(defaultPage)) {
    // The shell opens on whichever entry came marked, so a default naming a
    // page nobody built would deploy a gallery framing nothing at all — the one
    // failure here that is invisible until someone loads the site.
    throw new Error(
      `the gallery opens on ${defaultPage}, which is not a page (${pageNames.join(', ')}) — ` +
        'defaultPage in pages.mjs names the example the shell frames first',
    )
  }

  return html.replace(SLOT, gallerySidebar(pageNames.map((page) => pageFacts(page)), defaultPage))
}

/**
 * An example's HTML with the way back to the gallery stamped in — the page as a
 * visitor receives it.
 *
 * One link, following the HUD's title; the style goes in the head. Both are
 * refused rather than skipped when there is nowhere to put them, and a page
 * that already carries the link is refused too, for the reason the shell may
 * not write its own list: the chrome is stamped or it is nothing.
 *
 * `target="_top"` because the page is usually inside the gallery's iframe, and
 * a gallery framed inside its own gallery is not a place anyone meant to go.
 * Opened at its own address there is no top frame but this one, and the
 * attribute costs nothing.
 *
 * @param {string} html The page's source, as written.
 * @param {string} name The page's name, `webgpu_crowd`.
 * @returns {string}
 */
export function withGalleryLink(html, name) {
  if (html.includes('id="gallery-link"')) {
    throw new Error(
      `${name}.html already carries a link back to the gallery — that link is stamped in as the page is served, never written into a page`,
    )
  }
  const title = /<(\w+) id="title">[\s\S]*?<\/\1>/.exec(html)
  if (!title) throw new Error(`${name}.html has no HUD title for the gallery link to follow`)
  if (!html.includes('</head>')) throw new Error(`${name}.html has no <head> for the gallery link's style`)

  const link = `<a id="gallery-link" href="${SHELL}" target="_top">← all examples</a>`
  const at = title.index + title[0].length

  return html
    .slice(0, at)
    .concat('\n      ', link, html.slice(at))
    .replace('</head>', `${LINK_STYLE}  </head>`)
}
