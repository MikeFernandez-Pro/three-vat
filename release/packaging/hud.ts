// What a page's HUD says, read off its HTML. Two suites read it: the HUD pair
// contract beside this file, and the baked-file check, which holds the file
// pages' API line to the command it runs.

/**
 * The HUD a page declares: that `<div>` and its children, and nothing after it.
 * Bounded by counting `<div>`s rather than cut at the next closing tag, because
 * the HUD nests — and because what follows it on the WebGPU page is the
 * no-WebGPU notice, which is legitimately that page's alone.
 */
export function hudMarkup(html: string): string {
  // The opening tag may carry more than its id: the drop pages open theirs
  // with the state their script keeps on it (`data-state="baking"`).
  const start = html.search(/<div id="hud"[\s>]/)
  if (start === -1) return ''
  let depth = 0
  for (const tag of html.slice(start).matchAll(/<\/?div/g)) {
    depth += tag[0].startsWith('</') ? -1 : 1
    if (depth === 0) return html.slice(start, start + tag.index! + tag[0].length)
  }
  return html.slice(start)
}

/**
 * The page's API line: the three-vat calls, or the CLI command, its recipe
 * teaches, as a visitor reads it — the text of the HUD's `#api`, tags dropped,
 * entities read back and whitespace collapsed. Empty when the page has none.
 */
export function apiLine(html: string): string {
  const inner = /<p id="api"[^>]*>([\s\S]*?)<\/p>/.exec(hudMarkup(html))?.[1] ?? ''
  return inner
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}
