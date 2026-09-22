// The navigation strip: the way from any page to every other, the demo first.
//
// Every page carries it and none of them writes it down (ADR-0019). It is
// generated from the page table — `pages.mjs`, the same glob vite builds from —
// and stamped into each page as it is served, by the `transformIndexHtml` hook
// in `vite.config.ts`, in dev and in the build alike. So a page added to the
// folder appears on every page with no list edited, which is the whole reason
// it is generated: a hand-written link per example on the root would be the
// landing-page menu ADR-0012 deleted, growing back one anchor at a time.
//
// It is *not* a landing page. The deployed root is still the WebGL demo, and
// the strip rides each page's HUD column under the title — where the pair
// links used to be — so it scrolls with the column and never meets the texture
// panel on the right (ADR-0011 amendment).
//
// The strip is laid out by feature rather than by page: one label, then a link
// per renderer, because "which feature" is the choice a visitor can make and
// "which renderer" is a second, smaller one they make inside it. The label is
// read off the pages' own `<title>`s, which by convention say
// `three-vat — <Renderer> <what it shows>`; the two pages of a pair must agree
// about what they show, and a title that does not follow the convention fails
// the build by name rather than shipping a strip with a hole in it.
//
// Plain JavaScript beside the page table, for the same reason the table is:
// vite's config imports it, and so does the release suite.
import { pageFacts, pageNames, rootPage } from './pages.mjs'

/** @typedef {import('./pages.mjs').PageFacts} PageFacts */
/** @typedef {import('./pages.mjs').Renderer} Renderer */

/** What a title has to say, and where the label sits in it. */
const TITLE = /^three-vat — (WebGL|WebGPU) (.+)$/

/** The order a pair's links come in: the path that works everywhere, first. */
const RENDERERS = /** @type {Renderer[]} */ (['webgl', 'webgpu'])
/** @type {Record<Renderer, string>} */
const RENDERER_LABEL = { webgl: 'WebGL', webgpu: 'WebGPU' }

/** The strip's own style, stamped into the page's `<head>` beside its markup. */
const STYLE = `
    <style data-three-vat="navigation-strip">
      /* The navigation strip (nav.mjs): every page, the demo first. It rides
         the HUD column under the title and wraps by feature, so at phone
         width it stacks rather than scrolls. */
      #navigation { display: flex; flex-wrap: wrap; column-gap: 16px; row-gap: 2px; margin-top: 5px; font-size: 11px; line-height: 1.5; }
      #navigation .label { opacity: 0.7; margin-right: 6px; }
      #navigation .pair { white-space: nowrap; }
      #navigation a { color: inherit; text-decoration: none; opacity: 0.75; }
      #navigation a:hover { opacity: 1; text-decoration: underline; }
      #navigation a[aria-current="page"] { opacity: 1; font-weight: bold; text-decoration: underline; }
      @media (max-width: 600px) { #navigation { font-size: 10px; } }
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
 * What a page's title says: its renderer, and the label the strip shows for it.
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
 * The strip's markup for a given page table, with `current` marked.
 *
 * Pure: the table is a parameter so the guard on this can hand it a page nobody
 * has built and see it listed. Features come in the order the table first names
 * them, except that the feature the root shows — the demo — comes first
 * whatever its file is called.
 *
 * @param {PageFacts[]} pages
 * @param {string} current The name of the page the strip is on.
 * @returns {string}
 */
export function navigationStrip(pages, current) {
  /** @type {Map<string, { label: string, file: string, links: Partial<Record<Renderer, PageFacts>> }>} */
  const features = new Map()

  for (const page of pages) {
    const { renderer, label } = readTitle(page)
    const feature = features.get(page.feature)
    if (feature === undefined) {
      features.set(page.feature, { label, file: page.file, links: { [renderer]: page } })
    } else {
      if (feature.label !== label) {
        throw new Error(
          `the ${page.feature} pages disagree about what they show: "${feature.label}" (${feature.file}) vs "${label}" (${page.file})`,
        )
      }
      feature.links[renderer] = page
    }
  }

  const root = pages.find((page) => page.name === rootPage)
  const ordered = [...features.entries()].sort(([a], [b]) => {
    if (root && a === root.feature) return -1
    if (root && b === root.feature) return 1
    return 0
  })

  const items = ordered.map(([, { label, links }]) => {
    const anchors = RENDERERS.flatMap((renderer) => {
      const page = links[renderer]
      if (!page) return []
      const mark = page.name === current ? ' aria-current="page"' : ''
      return [`<a href="${escapeHtml(page.file)}"${mark}>${RENDERER_LABEL[renderer]}</a>`]
    })
    return `<span class="feature"><span class="label">${escapeHtml(label)}</span><span class="pair">${anchors.join(' · ')}</span></span>`
  })

  return `<nav id="navigation" aria-label="pages">\n        ${items.join('\n        ')}\n      </nav>`
}

/**
 * A page's HTML with the strip stamped in — the page as a visitor receives it.
 *
 * The markup follows the HUD's title; the style goes in the head. Both are
 * refused rather than skipped when there is nowhere to put them, and a page
 * that already carries a strip is refused too: the strip is generated or it
 * is nothing.
 *
 * @param {string} html The page's source, as written.
 * @param {string} name The page's name, `webgpu_crowd`.
 * @returns {string}
 */
export function withNavigationStrip(html, name) {
  if (html.includes('id="navigation"')) {
    throw new Error(`${name}.html already carries a navigation strip — the strip is generated from the page table, never written into a page`)
  }
  const title = /<div id="title">[\s\S]*?<\/div>/.exec(html)
  if (!title) throw new Error(`${name}.html has no HUD title for the navigation strip to follow`)
  if (!html.includes('</head>')) throw new Error(`${name}.html has no <head> for the navigation strip's style`)

  const strip = navigationStrip(pageNames.map((page) => pageFacts(page)), name)
  const at = title.index + title[0].length

  return html
    .slice(0, at)
    .concat('\n      ', strip, html.slice(at))
    .replace('</head>', `${STYLE}  </head>`)
}
