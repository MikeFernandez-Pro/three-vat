import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { MeshStandardMaterial } from 'three'
import type { Material } from 'three'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { PACK_TEXELS } from './instance-playback.js'
import { compileVATMaterial, isComponent, makeVATFixture, makeFixtureCrowd, nodesIn } from './test-utils.js'
import { createVATMesh as createTSLMesh, vatDecode } from './tsl.js'
import { createVATMesh as createWebGLMesh } from './webgl.js'

// The two decode paths, compared as a pair. Two promises are made about them
// and neither is visible from inside either one:
//
//   1. The same user code runs on either renderer — one import line differs.
//   2. Neither subpath drags in the other renderer's code (ADR-0005).
//
// Both are structural. That the paths decode *pixel-identically* is a manual
// release gate — `node release/parity/check.mjs`, see docs/releasing.md — not
// something CI without a GPU can claim.

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

    expect(tsl.playback.count).toBe(webgl.playback.count)
    expect(tsl.playback.texture.image.data).toEqual(webgl.playback.texture.image.data)
  })

  it('carries it the same way: three texels wide, one row per instance', () => {
    // The carrier is half the contract now (ADR-0016). A path that built a
    // differently shaped texture would still pass the byte comparison above
    // if the two happened to hold the same floats.
    const { webgl, tsl } = bothPaths()

    for (const crowd of [webgl, tsl]) {
      expect(crowd.playback.texture.image.width).toBe(3)
      expect(crowd.playback.texture.image.height).toBe(crowd.mesh.count)
      expect(crowd.playback.texture.type).toBe(webgl.playback.texture.type)
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

  it('renders the bake’s own geometry on either path', () => {
    // Neither path clones any more: the clone existed for the playback
    // attributes (ADR-0016), and a clone on one path only would be a second
    // difference between them.
    const vat = makeVATFixture()

    expect(createWebGLMesh(vat, makeFixtureCrowd()).mesh.geometry).toBe(vat.geometry)
    expect(createTSLMesh(vat, makeFixtureCrowd()).mesh.geometry).toBe(vat.geometry)
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

describe('the loop modes reach both decode paths', () => {
  // `resolveVATFrame` (src/instance-playback.ts) is the one definition of what
  // a loop mode means, and each path transcribes it. What cannot be checked
  // from inside either transcription is that they read the *same* components of
  // the same pack — the swizzles are the whole of what they must agree on, and
  // a wrong one is silent. That the two then produce the same pixels stays the
  // manual parity gate.
  const POLICY = [
    ['y', 'loop mode'],
    ['z', 'repetitions'],
    ['w', 'end mode'],
  ] as const

  it('reads the same three policy components of the playback texel on either path', () => {
    const { mesh } = createWebGLMesh(makeVATFixture(), makeFixtureCrowd())
    const glsl = compileVATMaterial((mesh.material as Material[])[0]!).vertexShader

    const tsl = createTSLMesh(makeVATFixture(), makeFixtureCrowd())
    const decoded = nodesIn(vatDecode(makeVATFixture(), { playback: tsl.playback }).position)

    for (const [component, what] of POLICY) {
      expect(glsl, `GLSL reads the ${what}`).toContain(`vatPlayback.${component}`)
      expect(
        decoded.some((n) => isComponent(n, PACK_TEXELS.playback, component)),
        `TSL reads the ${what}`,
      ).toBe(true)
    }
  })

  it('reads the same four components of the fade texel on either path', () => {
    // The pose-freeze fade is one frozen row and one wall-clock weight, and
    // every term of it is a swizzle of one texel — so "both paths honour the
    // fade identically" is, structurally, exactly this: the same four
    // components, read by both. That they then produce the same pixels stays
    // the manual parity gate.
    const { mesh } = createWebGLMesh(makeVATFixture(), makeFixtureCrowd())
    const glsl = compileVATMaterial((mesh.material as Material[])[0]!).vertexShader

    const tsl = createTSLMesh(makeVATFixture(), makeFixtureCrowd())
    const decoded = nodesIn(vatDecode(makeVATFixture(), { playback: tsl.playback }).position)

    for (const [component, what] of [
      ['x', 'outgoing clip start row'],
      ['y', 'outgoing clip frames'],
      ['z', 'frozen phase'],
      ['w', 'fade duration'],
    ] as const) {
      expect(glsl, `GLSL reads the ${what}`).toContain(`vatFade.${component}`)
      expect(
        decoded.some((n) => isComponent(n, PACK_TEXELS.fade, component)),
        `TSL reads the ${what}`,
      ).toBe(true)
    }
  })

  it('keys the pack by the logical instance index on either path', () => {
    // The carrier change itself (ADR-0016), as the two paths spell it:
    // `gl_InstanceID` in GLSL, `instanceIndex` in TSL. Neither reads an
    // instanced attribute any more, because the drawn slot stops being the
    // instance the moment a renderer culls or sorts per instance.
    const { mesh } = createWebGLMesh(makeVATFixture(), makeFixtureCrowd())
    const glsl = compileVATMaterial((mesh.material as Material[])[0]!).vertexShader

    const tsl = createTSLMesh(makeVATFixture(), makeFixtureCrowd())
    const decoded = nodesIn(vatDecode(makeVATFixture(), { playback: tsl.playback }).position)

    expect(glsl).toContain('gl_InstanceID')
    expect(glsl).not.toContain('attribute vec4 aVat')
    expect(decoded.some((n) => n.type === 'IndexNode' && n.scope === 'instance')).toBe(true)
    expect(decoded.some((n) => n.type === 'AttributeNode')).toBe(false)
  })

  it('carries a crowd whose instances differ in policy, identically on both paths', () => {
    // The fixture crowd is an endless looper beside a rewinding one-shot, so
    // this compares packs that actually differ in the policy fields rather than
    // two rows of the same defaults.
    const { webgl, tsl } = bothPaths()
    const row = (crowd: typeof webgl, i: number) =>
      Array.from((crowd.playback.texture.image.data as Float32Array).slice(i * 12, (i + 1) * 12))

    expect(row(webgl, 1)).not.toEqual(row(webgl, 0))
    expect([row(tsl, 0), row(tsl, 1)]).toEqual([row(webgl, 0), row(webgl, 1)])
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

describe('a VAT baked without normals, on both paths', () => {
  // `bakeNormals: false` adds no encoding, so there is nothing here for the
  // pixel-diff gate to disagree about — but the two paths must *accept and
  // refuse the same pairings*, which is structural and belongs in CI.
  const normalless = () => makeVATFixture({ bakeNormals: false })

  it('renders the same crowd on either path', () => {
    const webgl = createWebGLMesh(normalless(), makeFixtureCrowd())
    const tsl = createTSLMesh(normalless(), makeFixtureCrowd())

    expect(tsl.mesh.count).toBe(webgl.mesh.count)
    expect(tsl.playback.texture.image.data).toEqual(webgl.playback.texture.image.data)
  })

  it('refuses the same pairing on either path', () => {
    // One rule, read by both (`src/baked-normals.ts`), so a crowd that is
    // refused on WebGL cannot quietly render wrong on WebGPU.
    const smoothAndLit = () => {
      const vat = normalless()
      ;(vat.materials[0] as MeshStandardMaterial).flatShading = false
      return vat
    }

    expect(() => createWebGLMesh(smoothAndLit(), makeFixtureCrowd())).toThrow(/bakeNormals: false/)
    expect(() => createTSLMesh(smoothAndLit(), makeFixtureCrowd())).toThrow(/bakeNormals: false/)
  })
})
