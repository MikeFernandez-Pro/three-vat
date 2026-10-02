// The studio's look, light or dark (CONTEXT.md, ADR-0037's amendment), settled
// before a page draws.
//
// One script, stamped first into the head of every example and of the shell
// as they are served, by the same `transformIndexHtml` hook that stamps the
// gallery (vite.config.ts), in dev and in the build alike. It marks <html>
// with `data-look`, which the theme's tokens hang off (src/theme.css) and the
// palette reads once as it loads (src/palette.ts). Inline and first, so the
// mark is down before the stylesheet applies and before any module runs: a
// dark room never sees a light page flash.
//
// The visitor's system picks the look; the gallery's switch overrides it,
// stored under `LOOK_KEY`, so an example opened at its own address wears the
// look it wears inside the shell.
//
// Plain JavaScript beside the gallery, for the same reason gallery.mjs is:
// vite's config imports it, and so does the release suite.

/** Where the gallery's switch stores a visitor's choice: `light`, `dark`, or nothing to follow the system. */
export const LOOK_KEY = 'three-vat:look'

/**
 * The script's body. Storage can be blocked (a sandboxed frame, a strict
 * privacy setting), and then the system decides.
 */
export const lookScript =
  `let look = null; try { look = localStorage.getItem('${LOOK_KEY}') } catch {} ` +
  `if (look !== 'light' && look !== 'dark') look = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; ` +
  `document.documentElement.dataset.look = look`

/** Stamp the look script into a page, first in its head. @param {string} html */
export function withLook(html) {
  if (html.includes('data-three-vat="look"')) {
    throw new Error('this page already carries the look script — it is stamped in as the page is served, never written into a page')
  }
  const head = /<head[^>]*>/.exec(html)
  if (!head) throw new Error('this page has no <head> for the look script')
  const at = head.index + head[0].length
  return html.slice(0, at).concat(`\n    <script data-three-vat="look">{ ${lookScript} }</script>`, html.slice(at))
}
