import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { PLAYBACK_ATTRIBUTES } from './instance-playback.js'
import { makeVATFixture, makeFixtureCrowd } from './test-utils.js'
import { createVATMesh as createTSLMesh } from './tsl.js'
import { createVATMesh as createWebGLMesh } from './webgl.js'

// The two decode paths, compared as a pair. Two promises are made about them
// and neither is visible from inside either one:
//
//   1. The same user code runs on either renderer — one import line differs.
//   2. Neither subpath drags in the other renderer's code (ADR-0005).
//
// Both are structural. That the paths decode *pixel-identically* is a manual
// release gate — `pnpm parity`, see docs/releasing.md — not something CI without
// a GPU can claim.

const PLAYBACK = Object.values(PLAYBACK_ATTRIBUTES)

/** One crowd per path, from one bake — the comparison is between the calls, not the inputs. */
function bothPaths() {
  return {
    webgl: createWebGLMesh(makeVATFixture(), makeFixtureCrowd()),
    tsl: createTSLMesh(makeVATFixture(), makeFixtureCrowd()),
  }
}

describe('the two paths render the same crowd', () => {
  it('writes the same instance playback from the same instances array', () => {
    const { webgl, tsl } = bothPaths()

    for (const name of PLAYBACK) {
      expect(tsl.mesh.geometry.getAttribute(name).array, name).toEqual(webgl.mesh.geometry.getAttribute(name).array)
    }
  })

  it('draws the same instance count through the same number of materials', () => {
    const { webgl, tsl } = bothPaths()

    expect(tsl.mesh.count).toBe(webgl.mesh.count)
    expect((tsl.mesh.material as unknown[]).length).toBe((webgl.mesh.material as unknown[]).length)
  })

  it('culls against the same all-frames bounds', () => {
    const { webgl, tsl } = bothPaths()

    expect(tsl.mesh.geometry.boundingBox).toEqual(webgl.mesh.geometry.boundingBox)
  })

  it('hands back a clock the render loop drives the same way', () => {
    const { webgl, tsl } = bothPaths()

    webgl.time.value = 2
    tsl.time.value = 2

    expect(tsl.time.value).toBe(webgl.time.value)
  })

  it('differs only where the renderer forces it: the WebGL shadow materials', () => {
    // The asymmetry the calls absorb, asserted as the *only* one: WebGL needs
    // patched shadow materials, TSL's position node already feeds the depth
    // pass. A user switching renderers writes neither line.
    const { webgl, tsl } = bothPaths()

    expect(webgl.mesh.customDepthMaterial).toBeDefined()
    expect(tsl.mesh.customDistanceMaterial).toBeUndefined()
    expect(tsl.mesh.customDepthMaterial).toBeUndefined()
  })
})

/**
 * Every module specifier a file imports for its *value*, in every form that
 * survives to a bundle: plain, side-effect (`import 'x'`), re-export and
 * dynamic. Parsed rather than matched, because the shapes this has to catch are
 * exactly the ones a regex misses — and a test that fails open here would pin
 * nothing while claiming to pin ADR-0005.
 */
function importsIn(text: string, fileName = 'inline.ts'): { specifier: string; typeOnly: boolean }[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.ESNext, true)
  const found: { specifier: string; typeOnly: boolean }[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      // No import clause at all is `import 'x'` — a side effect, and very much bundled.
      found.push({ specifier: node.moduleSpecifier.text, typeOnly: node.importClause?.isTypeOnly === true })
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push({ specifier: node.moduleSpecifier.text, typeOnly: node.isTypeOnly })
    } else if (node.kind === ts.SyntaxKind.CallExpression) {
      const call = node as ts.CallExpression
      const arg = call.arguments[0]
      if (call.expression.kind === ts.SyntaxKind.ImportKeyword && arg && ts.isStringLiteral(arg)) {
        found.push({ specifier: arg.text, typeOnly: false })
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return found
}

const importsOf = (file: string) => importsIn(readFileSync(file, 'utf8'), file)

/**
 * Every package a consumer's bundler would pull in through this entry point:
 * the entry plus everything it reaches by relative import, with type-only
 * imports left out because they erase.
 */
function bundledPackages(entry: string): string[] {
  const seen = new Set<string>()
  const packages = new Set<string>()

  const walk = (file: string) => {
    if (seen.has(file)) return
    seen.add(file)
    for (const { specifier, typeOnly } of importsOf(file)) {
      if (typeOnly) continue
      if (specifier.startsWith('.')) walk(resolve(dirname(file), specifier.replace(/\.js$/, '.ts')))
      else packages.add(specifier)
    }
  }

  // Resolved against src/ rather than this module's own directory: the shimmed
  // sliver of Node here has no `import.meta.dirname`, and vitest runs from the
  // repo root.
  walk(resolve('src', entry))
  return [...packages].sort()
}

describe('subpath isolation (ADR-0005)', () => {
  it('sees every import shape that would reach a bundle', () => {
    // The guard on the guard. Each form below lands in a bundle, and a walker
    // blind to any one of them would pass the tests underneath while the
    // isolation they claim to pin had already regressed — a side-effect
    // `import 'three/webgpu'` being the one a regex misses.
    const source = [
      "import 'three/webgpu'",
      "import { attribute } from 'three/tsl'",
      "import type { Node } from 'three/webgpu'",
      "export { vatNodes } from './tsl.js'",
      "const lazy = await import('three/webgpu')",
    ].join('\n')

    const bundled = importsIn(source).filter((i) => !i.typeOnly)
    expect(bundled.map((i) => i.specifier)).toEqual([
      'three/webgpu',
      'three/tsl',
      './tsl.js',
      'three/webgpu',
    ])
    expect(importsIn(source).filter((i) => i.typeOnly).map((i) => i.specifier)).toEqual(['three/webgpu'])
  })

  it('keeps the node-material system out of the WebGL path', () => {
    // The whole reason the package has subpaths: importing `three/tsl` or
    // `three/webgpu` drags in the node-material system, and a WebGL consumer
    // must never pay for it.
    expect(bundledPackages('webgl.ts')).toEqual(['three'])
  })

  it('keeps it out of the core entry point too', () => {
    expect(bundledPackages('index.ts')).toEqual(['three'])
  })

  it('keeps the GLSL patch out of the TSL path', () => {
    // `three/webgpu` is imported for types only, so it is absent here — which
    // is also proof the walker distinguishes the two.
    expect(bundledPackages('tsl.ts')).toEqual(['three', 'three/tsl'])
  })
})
