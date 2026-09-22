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
// The sidebar lists **flat** — one entry per page, named from the page's own
// `<title>` — as three.js lists its own, rather than one entry per feature with
// a link per renderer. That a pair is held to the parity gate is an argument
// `docs/releasing.md` makes; it is not a shape the sidebar has to carry. The
// renderer filter above it is the second, smaller choice, made once for the
// whole list instead of once per row.
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

/** The renderers the filter offers, in the order it offers them: the path that works everywhere, first. */
const RENDERERS = /** @type {Renderer[]} */ (['webgl', 'webgpu'])
/** @type {Record<Renderer, string>} */
const RENDERER_LABEL = { webgl: 'WebGL', webgpu: 'WebGPU' }

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
      /* The way back to the gallery (gallery.mjs). It rides the HUD column
         under the title, where the navigation strip used to, so it scrolls with
         the column and never meets the texture panel on the right. */
      #gallery-link { display: inline-block; margin-top: 5px; font-size: 11px; line-height: 1.5; color: inherit; text-decoration: none; opacity: 0.75; }
      #gallery-link:hover { opacity: 1; text-decoration: underline; }
      @media (max-width: 600px) { #gallery-link { font-size: 10px; } }
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
 * Refuse a page table whose pairs disagree about what they show.
 *
 * Nothing in a flat sidebar groups a pair, so this is the one place the claim
 * still has somewhere to be made at build time: the two pages of a feature are
 * one example on two decode paths, which is what the parity gate rests on, and
 * a pair that named itself two things would be the first place that stopped
 * being true. Checked here rather than left to the release suite alone so it
 * fails the build, by name, rather than shipping and going red later.
 *
 * @param {PageFacts[]} pages
 * @returns {void}
 */
function assertPairsAgree(pages) {
  /** @type {Map<string, { label: string, file: string }>} */
  const byFeature = new Map()

  for (const page of pages) {
    const { label } = readTitle(page)
    const seen = byFeature.get(page.feature)
    if (seen === undefined) byFeature.set(page.feature, { label, file: page.file })
    else if (seen.label !== label) {
      throw new Error(
        `the ${page.feature} pages disagree about what they show: "${seen.label}" (${seen.file}) vs "${label}" (${page.file})`,
      )
    }
  }
}

/**
 * The gallery's sidebar for a given page table, with `current` marked.
 *
 * Pure: the table is a parameter so the guard on this can hand it a page nobody
 * has built and see it listed. Pages come in the order the table names them,
 * which is the glob's — alphabetical, so a feature's two pages sit apart under
 * their renderers rather than as a pair, which is what listing flat means.
 * Refuses a table whose pairs disagree ({@link assertPairsAgree}) before it
 * draws anything.
 *
 * @param {PageFacts[]} pages
 * @param {string | null} current The name of the page framed right now, if any.
 * @returns {string}
 */
export function gallerySidebar(pages, current) {
  assertPairsAgree(pages)

  const items = pages.map((page) => {
    const { renderer, label } = readTitle(page)
    const mark = page.name === current ? ' aria-current="page"' : ''
    return (
      `<li data-renderer="${renderer}">` +
      `<a href="${escapeHtml(page.file)}" data-page="${escapeHtml(page.name)}"${mark}>` +
      `<span class="renderer">${RENDERER_LABEL[renderer]}</span> ${escapeHtml(label)}</a></li>`
    )
  })

  // The filter's options are the renderers and nothing else, plus the "all"
  // that is the absence of a filter rather than a third renderer — so it can
  // never drift into offering something no page is.
  const filters = [
    '<button type="button" data-renderer="" aria-pressed="true">All</button>',
    ...RENDERERS.map(
      (renderer) => `<button type="button" data-renderer="${renderer}" aria-pressed="false">${RENDERER_LABEL[renderer]}</button>`,
    ),
  ]

  return (
    '<nav id="examples" aria-label="examples">\n' +
    `        <div id="filter" role="group" aria-label="renderer">\n          ${filters.join('\n          ')}\n        </div>\n` +
    `        <ul>\n          ${items.join('\n          ')}\n        </ul>\n      </nav>`
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
  const title = /<div id="title">[\s\S]*?<\/div>/.exec(html)
  if (!title) throw new Error(`${name}.html has no HUD title for the gallery link to follow`)
  if (!html.includes('</head>')) throw new Error(`${name}.html has no <head> for the gallery link's style`)

  const link = `<a id="gallery-link" href="${SHELL}" target="_top">← all examples</a>`
  const at = title.index + title[0].length

  return html
    .slice(0, at)
    .concat('\n      ', link, html.slice(at))
    .replace('</head>', `${LINK_STYLE}  </head>`)
}
