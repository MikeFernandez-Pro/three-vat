// What each page's bundle is allowed to contain (ADR-0011, ADR-0005).
//
// The pages duplicate renderer setup on purpose; the promise that buys is that
// a page pulls in *one* decode path and the shared modules pull in neither.
// Both are properties of the import graph, so they are read off the graph —
// the library pins its own subpath isolation the same way
// (src/decode-paths.test.ts).
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { pageNames, pagePath } from '../../examples/pages.mjs'
import { demo, here } from '../paths.js'
import { demoPages, rendererOf } from './demos.js'

/** Renderer-agnostic by contract: crowd layout, GUI defaults, asset loading,
 *  and the four the pages' readouts are built from — the texture panel and the
 *  facts it reads off a bake, the roster a spawning crowd keeps and the ledger
 *  that draws it. */
const SHARED = [
  'crowd.ts',
  'params.ts',
  'assets.ts',
  'texture-panel.ts',
  'vat-facts.ts',
  // And the two the batched pages' readouts are built from: what a page has to
  // remember about rows the library deliberately does not (ADR-0022), and the
  // grid that draws them.
  'spawning.ts',
  'row-ledger.ts',
]

/** Every value import a bundler would follow; type-only imports erase. */
function importsOf(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ESNext, true)
  const found: string[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (node.importClause?.isTypeOnly !== true) found.push(node.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.isTypeOnly) found.push(node.moduleSpecifier.text)
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0]
      if (arg && ts.isStringLiteral(arg)) found.push(arg.text)
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return found
}

/** Every package an entry reaches, through the whole graph of relative imports. */
function bundledPackages(entry: string): string[] {
  const seen = new Set<string>()
  const packages = new Set<string>()

  const walk = (file: string) => {
    if (seen.has(file)) return
    seen.add(file)
    for (const specifier of importsOf(file)) {
      if (specifier.startsWith('.')) walk(resolve(dirname(file), specifier.replace(/\.js$/, '.ts')))
      else packages.add(specifier)
    }
  }

  walk(entry)
  return [...packages].sort()
}

/**
 * The decode path each renderer is allowed to reach: GLSL on the WebGL page,
 * TSL on the WebGPU one (ADR-0004, ADR-0005). `null` for a name that claims no
 * renderer at all.
 *
 * Which page is which — and the glob that finds them — is `demos.ts`, shared
 * with the guard that reads the same pages' built chunks.
 */
const DECODE_PATH = { webgl: 'three-vat/webgl', webgpu: 'three-vat/tsl' } as const

function decodePathFor(name: string): string | null {
  const claimed = rendererOf(name)
  return claimed ? DECODE_PATH[claimed] : null
}

describe('shared modules are renderer-agnostic', () => {
  it.each(SHARED)('%s imports neither decode path', (file) => {
    const packages = bundledPackages(demo(`src/${file}`))

    expect(packages).not.toContain('three-vat/webgl')
    expect(packages).not.toContain('three-vat/tsl')
  })
})

describe('a page bundles one decode path', () => {
  it('finds an entry module behind every page', () => {
    // Guards the guard: a glob that matched nothing — or an HTML file whose
    // script tag moved — would let every assertion below pass while pinning
    // nothing at all.
    const found = demoPages()
    expect(found.length).toBeGreaterThan(0)
    for (const { html, entry } of found) expect(entry, html).toMatch(/\.ts$/)
  })

  it.each(demoPages().map((p) => [p.html, p.entry]))('%s pulls in its own renderer only', (html, entry) => {
    // The `<renderer>_` prefix is load-bearing (ADR-0011): it says which decode
    // path the page is allowed to reach. It lives on both the page's file and
    // its entry module, and a page that named one renderer while running the
    // other would be the mistake worth catching — so the two are read
    // separately and required to agree.
    //
    // Every page carries the prefix now: the demo was the one page without one
    // and it is gone, an example like the rest (ADR-0020), so there is no case
    // to excuse here. An entry naming no renderer at all is allowed neither
    // path, so a page that forgot to say which one it is fails here rather than
    // quietly bundling both.
    const own = decodePathFor(entry)
    expect(decodePathFor(html), `${html} vs ${entry}`).toBe(own)

    const packages = bundledPackages(demo(`src/${entry}`))

    for (const subpath of ['three-vat/webgl', 'three-vat/tsl']) {
      if (subpath === own) expect(packages).toContain(subpath)
      else expect(packages).not.toContain(subpath)
    }
  })
})

// The one page in this repository that is allowed to reach both decode paths,
// and the reason it is not in the demo folder at all. `release/parity/index.html`
// asserts in a comment that living outside `examples/` keeps every glob above
// honest; this is that comment, asserted (the house rule vite.config.ts states).
describe('the parity gate is not a demo page', () => {
  it('reaches both decode paths — which is exactly what a demo page may not do', () => {
    const packages = bundledPackages(here('parity/run.ts'))

    expect(packages).toContain('three-vat/webgl')
    expect(packages).toContain('three-vat/tsl')
  })

  it('lives outside the demo folder, so the demo glob never sees it', () => {
    expect(existsSync(here('parity/index.html'))).toBe(true)
    expect(existsSync(demo('parity/index.html'))).toBe(false)

    // The same glob vite builds its entries from.
    expect(demoPages().map((p) => p.html)).not.toContain('parity.html')
  })

  it('is not a build entry, so it never reaches the deployed site', () => {
    // `pages.mjs` is the list vite builds from — one entry of it per build
    // (#17) — so it is the list the gate has to be absent from.
    expect(pageNames.length).toBeGreaterThan(0)
    for (const name of pageNames) {
      expect(`${name} ${pagePath(name)}`).not.toMatch(/parity/)
    }
  })
})
