// What the deployed site has to get right to survive being served from a
// subpath.
//
// GitHub Pages puts this app at `/three-vat/`, not at a domain root (ADR-0011),
// and every root-absolute URL in it — an asset link, a page link, the model —
// 404s there. None of that shows up in `pnpm run dev`, which serves the app at
// the root: the only place a mistake surfaces is the live site, after a deploy.
// So the three URLs that matter are pinned here instead, read as values wherever
// there is a value to read.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import viteConfig from '../../examples/vite.config.js'
import { withGallery, withGalleryLink } from '../../examples/gallery.mjs'
import { buildPages, pagePath, shellPage } from '../../examples/pages.mjs'
import { MODEL_URL, SOLDIER_URL } from '../../examples/src/assets.js'
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
    // Every page as served, the gallery's shell included — the sidebar and the
    // way home stamped in (gallery.mjs) — since that is where a page's links
    // come from now, and a sidebar that linked from the domain root would 404
    // on Pages exactly like a hand-written anchor would.
    expect(buildPages.length).toBeGreaterThan(1)

    for (const name of buildPages) {
      const source = readFileSync(pagePath(name), 'utf8')
      const html = name === shellPage ? withGallery(source) : withGalleryLink(source, name)
      for (const href of localHrefs(html)) {
        expect(href, `${name}.html → ${href}`).not.toMatch(/^\//)
      }
    }
  })

  it('loads the models relatively', () => {
    // `/RobotExpressive.glb` would resolve to the domain root, above the app —
    // and so would the Soldier example's own model (ADR-0019).
    expect(MODEL_URL.startsWith('/')).toBe(false)
    expect(SOLDIER_URL.startsWith('/')).toBe(false)
  })

  it('ships every model it loads', () => {
    // A relative URL is only half the promise: the file has to be in `public/`
    // for the build to copy it beside the pages. Soldier was fetched on demand
    // for the test suite until an example needed it on the deployed site.
    for (const url of [MODEL_URL, SOLDIER_URL]) expect(existsSync(demo(`public/${url}`)), url).toBe(true)
  })
})
