// The studio's look (CONTEXT.md, ADR-0037's amendment), settled before a page
// draws: one script, stamped first into the head of every example and of the
// shell as they are served, marks <html> with the look. The stamp and the
// script are examples/look.mjs; the vite hook that stamps every page with it
// is examples/vite.config.ts.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LOOK_KEY, lookScript, withLook } from '../../examples/look.mjs'
import config from '../../examples/vite.config.js'
import { pageNames, pagePath, shellPage } from '../../examples/pages.mjs'

/** Run the stamped script against a stored choice and a system preference, and read the mark it leaves. */
function lookAfter(stored: string | null, systemDark: boolean, { storageThrows = false } = {}) {
  const html = { dataset: {} as Record<string, string> }
  const localStorage = {
    getItem: (key: string) => {
      if (storageThrows) throw new Error('storage is blocked')
      return key === LOOK_KEY ? stored : null
    },
  }
  const matchMedia = (query: string) => ({ matches: query === '(prefers-color-scheme: dark)' && systemDark })
  new Function('document', 'localStorage', 'matchMedia', lookScript)({ documentElement: html }, localStorage, matchMedia)
  return html.dataset.look
}

describe('the look script', () => {
  it('follows the system with nothing stored', () => {
    expect(lookAfter(null, false)).toBe('light')
    expect(lookAfter(null, true)).toBe('dark')
  })

  it('takes a stored choice over the system', () => {
    expect(lookAfter('light', true)).toBe('light')
    expect(lookAfter('dark', false)).toBe('dark')
  })

  it('follows the system for a stored value it does not know, and where storage is blocked', () => {
    expect(lookAfter('sepia', true)).toBe('dark')
    expect(lookAfter(null, true, { storageThrows: true })).toBe('dark')
  })
})

describe('the stamp', () => {
  const page = '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <link rel="stylesheet" href="./src/theme.css" />\n  </head>\n  <body></body>\n</html>'

  it('puts the script first in the head, before the stylesheet the mark styles', () => {
    const stamped = withLook(page)
    const script = stamped.indexOf('data-three-vat="look"')
    expect(script).toBeGreaterThan(stamped.indexOf('<head>'))
    expect(script).toBeLessThan(stamped.indexOf('<meta'))
    expect(stamped).toContain(lookScript)
  })

  it('refuses a page with no head, and one already carrying the script', () => {
    expect(() => withLook('<html><body></body></html>')).toThrow(/head/)
    expect(() => withLook(withLook(page))).toThrow(/already/)
  })
})

describe("the gallery's switch", () => {
  const shell = readFileSync(pagePath(shellPage), 'utf8')

  it('offers light and dark', () => {
    const offered = [...shell.matchAll(/<button type="button" data-look="(\w+)">/g)].map((m) => m[1])
    expect(offered).toEqual(['light', 'dark'])
  })

  it('stores a pick under the key the look script reads', () => {
    expect(shell).toContain(`const LOOK_KEY = '${LOOK_KEY}'`)
  })
})

describe('every page served', () => {
  const plugin = config.plugins!.flat().find((p) => p && typeof p === 'object' && 'name' in p && p.name === 'three-vat:gallery') as unknown as {
    transformIndexHtml: (html: string, ctx: { filename: string }) => string
  }

  it.each([shellPage, ...pageNames])('%s carries the look script, so it opens in its look on its own and in the gallery', (name) => {
    const filename = pagePath(name)
    const served = plugin.transformIndexHtml(readFileSync(filename, 'utf8'), { filename })
    expect(served).toContain(lookScript)
  })
})
