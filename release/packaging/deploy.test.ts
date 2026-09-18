// What the demo has to get right to survive being served from a subpath.
//
// GitHub Pages puts this app at `/three-vat/`, not at a domain root (ADR-0011),
// and every root-absolute URL in it — an asset link, a page link, the model —
// 404s there. None of that shows up in `pnpm run dev`, which serves the app at
// the root: the only place a mistake surfaces is the live site, after a deploy.
// So the three URLs that matter are pinned here instead, read as values wherever
// there is a value to read.
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import viteConfig from '../../examples/vite.config.js'
import { MODEL_URL } from '../../examples/src/assets.js'
import { demo } from '../paths.js'

/** Every `href` a page points at, minus the ones that leave the site. */
function localHrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)]
    .map((m) => m[1]!)
    .filter((href) => !/^(https?:)?\/\//.test(href) && !href.startsWith('#'))
}

describe('the built app runs under a subpath', () => {
  it('builds with a relative base, so emitted asset URLs are relative', () => {
    // `base: '/'` (vite's default) emits `/assets/...` — correct at a domain
    // root, and a blank page on Pages. Read off the config object itself, so
    // this is the value vite will use and not a string that looks like it.
    const { base } = viteConfig as { base?: string }

    expect(base).toBeDefined()
    expect(base!.startsWith('/')).toBe(false)
  })

  it('links pages to each other relatively', () => {
    const pages = readdirSync(demo('.')).filter((file) => file.endsWith('.html'))
    expect(pages.length).toBeGreaterThan(0)

    for (const page of pages) {
      for (const href of localHrefs(readFileSync(demo(page), 'utf8'))) {
        expect(href, `${page} → ${href}`).not.toMatch(/^\//)
      }
    }
  })

  it('loads the model relatively', () => {
    // `/RobotExpressive.glb` would resolve to the domain root, above the app.
    expect(MODEL_URL.startsWith('/')).toBe(false)
  })
})
