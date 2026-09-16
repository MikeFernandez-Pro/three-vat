// What each page's bundle is allowed to contain (ADR-0011, ADR-0005).
//
// The pages duplicate renderer setup on purpose; the promise that buys is that
// a page pulls in *one* decode path and the shared modules pull in neither.
// Both are properties of the import graph, so they are read off the graph —
// the library pins its own subpath isolation the same way
// (src/decode-paths.test.ts).
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/** Renderer-agnostic by contract: crowd layout, GUI defaults, asset loading. */
const SHARED = ['crowd.ts', 'params.ts', 'assets.ts', 'pages.ts', 'vat-debug.ts']

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

  walk(resolve('src', entry))
  return [...packages].sort()
}

/**
 * Every page, discovered exactly the way vite discovers its build entries and
 * the landing page discovers its list: by globbing `*.html`. Following the
 * page's own `<script src>` rather than a naming pattern is what keeps this
 * guard true of pages that do not exist yet — a third demo is covered the
 * moment its file lands, with nothing here to update.
 */
function pages(): { html: string; entry: string }[] {
  return readdirSync(resolve('.'))
    .filter((file) => file.endsWith('.html'))
    .sort()
    .map((html) => {
      const src = /<script[^>]*\bsrc="\/src\/([^"]+)"/.exec(readFileSync(resolve(html), 'utf8'))?.[1]
      return { html, entry: src ?? '' }
    })
}

describe('shared modules are renderer-agnostic', () => {
  it.each(SHARED)('%s imports neither decode path', (file) => {
    const packages = bundledPackages(file)

    expect(packages).not.toContain('three-vat/webgl')
    expect(packages).not.toContain('three-vat/tsl')
  })
})

describe('a page bundles one decode path', () => {
  it('finds an entry module behind every page', () => {
    // Guards the guard: a glob that matched nothing — or an HTML file whose
    // script tag moved — would let every assertion below pass while pinning
    // nothing at all.
    const found = pages()
    expect(found.length).toBeGreaterThan(0)
    for (const { html, entry } of found) expect(entry, html).toMatch(/\.ts$/)
  })

  it.each(pages().map((p) => [p.html, p.entry]))('%s pulls in its own renderer only', (html, entry) => {
    // The `<renderer>_` prefix is load-bearing (ADR-0011): it says which decode
    // path the page is allowed to reach. The landing page names no renderer, so
    // it is allowed neither.
    const own = html.startsWith('webgpu_') ? 'three-vat/tsl' : html.startsWith('webgl_') ? 'three-vat/webgl' : null
    const packages = bundledPackages(entry)

    for (const subpath of ['three-vat/webgl', 'three-vat/tsl']) {
      if (subpath === own) expect(packages).toContain(subpath)
      else expect(packages).not.toContain(subpath)
    }
  })
})
