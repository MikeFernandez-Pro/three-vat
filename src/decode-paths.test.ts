import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { BatchedMesh, MeshStandardMaterial } from 'three'
import type { Material } from 'three'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { createVATPlaybackTexture, PACK_TEXELS } from './instance-playback.js'
import {
  compileVATMaterial,
  isComponent,
  makeBatchedCarrier,
  makeVATFixture,
  makeFixtureCrowd,
  makeRigVATFixture,
  nodesIn,
  unwrap,
} from './test-utils.js'
import { createVATMesh as createTSLMesh, vatDecode } from './tsl.js'
import type { VAT } from './types.js'
import { createVATMesh as createWebGLMesh, createVATUniforms, patchVATMaterial } from './webgl.js'

// The two decode paths, compared as a pair. Two promises are made about them
// and neither is visible from inside either one:
//
//   1. The same user code runs on either renderer — one import line differs.
//   2. Neither subpath drags in the other renderer's code (ADR-0005).
//
// Both are structural. That the paths decode *pixel-identically* is a manual
// release gate — `node release/parity/check.mjs`, see docs/releasing.md — not
// something CI without a GPU can claim.

/**
 * One crowd per path, from one kind of bake — the comparison is between the
 * calls, not the inputs. The vertex fixture by default; the rig one is the
 * second encoding, compared the same way (ADR-0018).
 */
function bothPaths(fixture: () => VAT = makeVATFixture) {
  return {
    webgl: createWebGLMesh(fixture(), makeFixtureCrowd()),
    tsl: createTSLMesh(fixture(), makeFixtureCrowd()),
  }
}

/**
 * `time - crossfade.y`: the clock since the blend began, the one subtraction
 * the weight is made of on either path (ADR-0036).
 */
const subtractsBlendStart = (n: ReturnType<typeof nodesIn>[number]) =>
  n.type === 'OperatorNode' && n.op === '-' && isComponent(n.bNode, PACK_TEXELS.crossfade, 'y')

describe('the two paths render the same crowd', () => {
  it('writes the same instance playback from the same instances array', () => {
    const { webgl, tsl } = bothPaths()

    expect(tsl.playback.count).toBe(webgl.playback.count)
    expect(tsl.playback.texture.image.data).toEqual(webgl.playback.texture.image.data)
  })

  it('carries it the same way: five texels wide, one row per instance', () => {
    // The carrier is half the contract now (ADR-0016). A path that built a
    // differently shaped texture would still pass the byte comparison above
    // if the two happened to hold the same floats.
    const { webgl, tsl } = bothPaths()

    for (const crowd of [webgl, tsl]) {
      expect(crowd.playback.texture.image.width).toBe(5)
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

  it('reads the same five texels of the pack on either path, and branches on the crossfade', () => {
    // The crossfade is two (clip, playback) pairs and one duration between
    // them, and every term of it is a swizzle of one texel - so "both paths
    // blend identically" is, structurally, exactly this: the same components,
    // read by both, and the outgoing pair reached from the same duration. That
    // they then produce the same pixels stays the manual parity gate.
    const { mesh } = createWebGLMesh(makeVATFixture(), makeFixtureCrowd())
    const glsl = compileVATMaterial((mesh.material as Material[])[0]!).vertexShader

    const tsl = createTSLMesh(makeVATFixture(), makeFixtureCrowd())
    const decoded = nodesIn(vatDecode(makeVATFixture(), { playback: tsl.playback }).position)

    // The duration, which is what says there is a second band at all.
    expect(glsl, 'GLSL reads the crossfade duration').toContain('vatCrossfade.x')
    expect(
      decoded.some((n) => isComponent(n, PACK_TEXELS.crossfade, 'x')),
      'TSL reads the crossfade duration',
    ).toBe(true)

    // The outgoing band's own pair, component for component with the live one:
    // its band, its start time, its speed and its policy. The GLSL path reads
    // those components inside `vatBand`, off whichever pair it was handed, so
    // what says the outgoing pair goes through all eight of them is that it is
    // handed to that same function.
    expect(glsl, 'GLSL resolves the outgoing pair through the band resolver').toContain(
      'vatBand( vatOutClip, vatOutPlayback, vatNow )',
    )
    for (const texel of [PACK_TEXELS.outgoingClip, PACK_TEXELS.outgoingPlayback]) {
      for (const component of ['x', 'y', 'z', 'w'] as const) {
        expect(
          decoded.some((n) => isComponent(n, texel, component)),
          `TSL reads texel ${texel}.${component}`,
        ).toBe(true)
      }
    }

    // Both paths derive the weight from that one duration, and neither guards
    // the outgoing fetches of the vertex encoding with it any more: the GLSL
    // path selects the live pair at a weight of zero, as the TSL path always
    // did, because #72 measured the guard costing an idle crowd 10%.
    expect(glsl, 'GLSL branches on the crossfade duration').toContain('if ( vatCrossfade.x > 0.0 ) {')
    expect(
      decoded.some(
        (n) =>
          n.type === 'OperatorNode' &&
          n.op === '>' &&
          isComponent(n.aNode, PACK_TEXELS.crossfade, 'x') &&
          n.bNode?.type === 'ConstNode' &&
          n.bNode.value === 0,
      ),
      'TSL branches on the crossfade duration',
    ).toBe(true)

    // And both measure the weight from the blend start the crossfade texel
    // carries beside the duration, not from the live start time (ADR-0036).
    expect(glsl, 'GLSL measures the weight from the blend start').toContain('( vatNow - vatCrossfade.y ) / vatCrossfade.x')
    expect(decoded.some(subtractsBlendStart), 'TSL measures the weight from the blend start').toBe(true)
  })

  it('reads the pause from the same component on either path, as a min and not a branch', () => {
    // The pause (ADR-0041) is one value in the crossfade texel's `z`, and the
    // instance's clock is the smaller of it and the shared clock on both paths.
    // That the pause then holds the same pixels is the parity gate's.
    const { mesh } = createWebGLMesh(makeVATFixture(), makeFixtureCrowd())
    const glsl = compileVATMaterial((mesh.material as Material[])[0]!).vertexShader

    const tsl = createTSLMesh(makeVATFixture(), makeFixtureCrowd())
    const decoded = nodesIn(vatDecode(makeVATFixture(), { playback: tsl.playback }).position)

    expect(glsl, 'GLSL stops the clock').toContain('float vatNow = min( uVatTime, vatCrossfade.z );')
    expect(
      decoded.some(
        (n) => n.type === 'MathNode' && n.method === 'min' && isComponent(unwrap(n.bNode), PACK_TEXELS.crossfade, 'z'),
      ),
      'TSL stops the clock',
    ).toBe(true)
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

  it('resolves the logical index on a BatchedMesh on either path, and through no private field', () => {
    // The second carrier, as the one thing it changes: where the pack row
    // comes from. GLSL dereferences the drawn slot with three's own
    // `getIndirectIndex( gl_DrawID )`; TSL reads `batchIndirectIndex`, the
    // public `uint` varying `batch()` assigns — and neither path touches
    // `_indirectTexture`, which is ADR-0016's stop condition written as a test.
    const vat = makeVATFixture()
    const playback = createVATPlaybackTexture(makeFixtureCrowd())
    const batch = makeBatchedCarrier(vat)

    const glsl = compileVATMaterial(
      patchVATMaterial(new MeshStandardMaterial(), vat, createVATUniforms(), playback, batch),
    ).vertexShader
    const decoded = nodesIn(vatDecode(vat, { playback, carrier: batch }).position)

    // Both are public API — `getIndirectIndex` is a `batching_pars_vertex`
    // function, `vBatchIndirectId` the varying `batchIndirectIndex` names — so
    // reading either is the stop condition met rather than worked around.
    expect(glsl).toContain('vatSample( uVatPosTex, int( getIndirectIndex( gl_DrawID ) ) )')
    expect(decoded.some((n) => n.type === 'PropertyNode' && n.name === 'vBatchIndirectId')).toBe(true)
  })

  it('carries a crowd whose instances differ in policy, identically on both paths', () => {
    // The fixture crowd is an endless looper beside a rewinding one-shot, so
    // this compares packs that actually differ in the policy fields rather than
    // two rows of the same defaults.
    const { webgl, tsl } = bothPaths()
    const row = (crowd: typeof webgl, i: number) =>
      Array.from((crowd.playback.texture.image.data as Float32Array).slice(i * 20, (i + 1) * 20))

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
 * Everything a consumer's bundler would pull in through this entry point: the
 * entry plus every file it reaches by relative import, and every package those
 * import, with type-only imports left out because they erase.
 */
function bundled(entry: string): { files: string[]; packages: string[] } {
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
  return { files: [...seen].sort(), packages: [...packages].sort() }
}

const bundledPackages = (entry: string) => bundled(entry).packages

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
    // `loadVAT` reads a baked file through three's own GLTFLoader, already a
    // peer import, and a page that never calls it tree-shakes it away.
    expect(bundledPackages('index.ts')).toEqual(['three', 'three/examples/jsm/loaders/GLTFLoader.js'])
  })

  it('keeps the bake command out of every page-facing entry point (ADR-0034)', () => {
    // The command reaches for three's GLTFLoader, FBXLoader and meshopt
    // decoder, none of which a page that bakes its own asset should pay for
    // twice. The `bin` reaches the command, which is also proof the walk sees it.
    const command = resolve('src', 'cli.ts')
    for (const entry of ['index.ts', 'webgl.ts', 'tsl.ts']) expect(bundled(entry).files).not.toContain(command)
    expect(bundled('bin.ts').files).toContain(command)
  })

  it('keeps the baked file’s writer and three’s exporter out of every other page-facing entry point (ADR-0035)', () => {
    // The loader is core; the writer is `three-vat/write`'s and the command's.
    // Both reach it, which is also proof the walk sees it.
    const writer = resolve('src', 'write-vat.ts')
    const exporter = 'three/examples/jsm/exporters/GLTFExporter.js'
    for (const entry of ['index.ts', 'webgl.ts', 'tsl.ts']) {
      expect(bundled(entry).files).not.toContain(writer)
      expect(bundledPackages(entry)).not.toContain(exporter)
    }
    for (const entry of ['write.ts', 'bin.ts']) {
      expect(bundled(entry).files).toContain(writer)
      expect(bundledPackages(entry)).toContain(exporter)
    }
  })

  it('keeps the bake command, its loaders and the node-material system out of the writer’s entry point', () => {
    // A page that downloads what it baked pays for the exporter and nothing
    // else: not the command, not FBXLoader or the meshopt decoder.
    expect(bundled('write.ts').files).not.toContain(resolve('src', 'cli.ts'))
    expect(bundledPackages('write.ts')).toEqual(['three', 'three/examples/jsm/exporters/GLTFExporter.js'])
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

describe('the two paths render the same rig crowd (ADR-0018)', () => {
  // The first describe, for the second encoding. The comparison is the same
  // one: one bake, two calls, and every promise between them structural. What
  // a rig row holds is each path's own; that the two skin *pixel-identically*
  // stays the manual parity gate.
  const bothRigPaths = () => bothPaths(makeRigVATFixture)

  it('writes the same instance playback from the same instances array', () => {
    const { webgl, tsl } = bothRigPaths()

    expect(tsl.playback.count).toBe(webgl.playback.count)
    expect(tsl.playback.texture.image.data).toEqual(webgl.playback.texture.image.data)
    // And it is the very playback a vertex crowd of the same instances writes:
    // nothing above the sampling knows which encoding it is addressing.
    expect(tsl.playback.texture.image.data).toEqual(bothPaths().webgl.playback.texture.image.data)
  })

  it('draws the same instance count through the same number of materials', () => {
    const { webgl, tsl } = bothRigPaths()

    expect(tsl.mesh.count).toBe(webgl.mesh.count)
    expect((tsl.mesh.material as unknown[]).length).toBe((webgl.mesh.material as unknown[]).length)
  })

  it('culls against the same all-frames bounds', () => {
    const { webgl, tsl } = bothRigPaths()

    expect(tsl.mesh.geometry.boundingBox).toEqual(webgl.mesh.geometry.boundingBox)
  })

  it('renders the bake’s own geometry — skinIndex and skinWeight on it — on either path', () => {
    const vat = makeRigVATFixture()

    expect(createWebGLMesh(vat, makeFixtureCrowd()).mesh.geometry).toBe(vat.geometry)
    expect(createTSLMesh(vat, makeFixtureCrowd()).mesh.geometry).toBe(vat.geometry)
    expect(vat.geometry.getAttribute('skinIndex')).toBeDefined()
    expect(vat.geometry.getAttribute('skinWeight')).toBeDefined()
  })

  it('hands back a clock the render loop drives the same way', () => {
    const { webgl, tsl } = bothRigPaths()

    webgl.time.value = 2
    tsl.time.value = 2

    expect(tsl.time.value).toBe(webgl.time.value)
  })

  it('differs only where the renderer forces it: the WebGL shadow materials', () => {
    const { webgl, tsl } = bothRigPaths()

    expect(webgl.mesh.customDepthMaterial).toBeDefined()
    expect(webgl.mesh.customDistanceMaterial).toBeDefined()
    expect(tsl.mesh.customDepthMaterial).toBeUndefined()
    expect(tsl.mesh.customDistanceMaterial).toBeUndefined()
  })

  it('reads the same policy and crossfade components of the pack on either path', () => {
    // The rig decode's rows come from the same transcription of
    // `resolveVATFrame` as the vertex decode's, on both paths - so the same
    // swizzles, read by both, is what "the same playback contract" means
    // structurally, for the band an instance is leaving as for the one it is
    // playing.
    const { mesh } = createWebGLMesh(makeRigVATFixture(), makeFixtureCrowd())
    const glsl = compileVATMaterial((mesh.material as Material[])[0]!).vertexShader

    const tsl = createTSLMesh(makeRigVATFixture(), makeFixtureCrowd())
    const decoded = nodesIn(vatDecode(makeRigVATFixture(), { playback: tsl.playback }).position)

    for (const [texel, name] of [
      [PACK_TEXELS.clip, 'vatClip'],
      [PACK_TEXELS.playback, 'vatPlayback'],
    ] as const) {
      for (const component of ['x', 'y', 'z', 'w'] as const) {
        expect(glsl, `GLSL reads ${name}.${component}`).toContain(`${name}.${component}`)
        expect(decoded.some((n) => isComponent(n, texel, component)), `TSL reads texel ${texel}.${component}`).toBe(true)
      }
    }
    // And the band this instance is leaving, through the same resolver on the
    // GLSL path and off its own texels on the TSL one.
    expect(glsl).toContain('vatBand( vatOutClip, vatOutPlayback, vatNow )')
    for (const texel of [PACK_TEXELS.outgoingClip, PACK_TEXELS.outgoingPlayback]) {
      for (const component of ['x', 'y', 'z', 'w'] as const) {
        expect(decoded.some((n) => isComponent(n, texel, component)), `TSL reads texel ${texel}.${component}`).toBe(true)
      }
    }
    // The crossfade texel carries one value, and both paths derive the weight
    // from it with the same comparison. What each does with that weight is the
    // encoding's own: this one guards sixteen dependent fetches per vertex with
    // it and the vertex encoding guards nothing (#72, ADR-0025). Asserted for
    // the rig decode as it is for the vertex one, because the two share this
    // half and a shared half still has two readers.
    expect(glsl, 'GLSL branches on the crossfade duration').toContain('if ( vatCrossfade.x > 0.0 ) {')
    expect(
      decoded.some(
        (n) =>
          n.type === 'OperatorNode' &&
          n.op === '>' &&
          isComponent(n.aNode, PACK_TEXELS.crossfade, 'x') &&
          n.bNode?.type === 'ConstNode' &&
          n.bNode.value === 0,
      ),
      'TSL branches on the crossfade duration',
    ).toBe(true)

    // And both measure the weight from the blend start the crossfade texel
    // carries beside the duration, not from the live start time (ADR-0036).
    expect(glsl, 'GLSL measures the weight from the blend start').toContain('( vatNow - vatCrossfade.y ) / vatCrossfade.x')
    expect(decoded.some(subtractsBlendStart), 'TSL measures the weight from the blend start').toBe(true)
  })

  it('samples the rig texture and nothing of the vertex encoding, on either path', () => {
    const vat = makeRigVATFixture()
    const { mesh } = createWebGLMesh(vat, makeFixtureCrowd())
    const shader = compileVATMaterial((mesh.material as Material[])[0]!)

    const tsl = createTSLMesh(vat, makeFixtureCrowd())
    const decoded = nodesIn(vatDecode(vat, { playback: tsl.playback }).position)
    const textures = new Set(decoded.flatMap((n) => (n.type === 'TextureNode' ? [n.value] : [])))

    expect(shader.uniforms['uVatRigTex']?.value).toBe(vat.rigTexture)
    expect(shader.uniforms['uVatPosTex']).toBeUndefined()
    expect(textures.has(vat.rigTexture)).toBe(true)
    expect(textures.size).toBe(2) // the rig texture and the playback texture
  })

  it('keys the pack by the logical index on both carriers, on either path, through no private field', () => {
    const vat = makeRigVATFixture()
    const playback = createVATPlaybackTexture(makeFixtureCrowd())

    // InstancedMesh: gl_InstanceID against instanceIndex.
    const instanced = compileVATMaterial(
      (createWebGLMesh(vat, makeFixtureCrowd()).mesh.material as Material[])[0]!,
    ).vertexShader
    expect(instanced).toContain('vatSkinMatrix( gl_InstanceID )')
    const instancedDecode = nodesIn(vatDecode(vat, { playback }).position)
    expect(instancedDecode.some((n) => n.type === 'IndexNode' && n.scope === 'instance')).toBe(true)
    expect(instancedDecode.some((n) => n.type === 'PropertyNode' && n.name === 'vBatchIndirectId')).toBe(false)

    // BatchedMesh: getIndirectIndex( gl_DrawID ) against batchIndirectIndex.
    const batch = makeBatchedCarrier(vat)
    const batched = compileVATMaterial(
      patchVATMaterial(new MeshStandardMaterial(), vat, createVATUniforms(), playback, batch),
    ).vertexShader
    expect(batched).toContain('vatSkinMatrix( int( getIndirectIndex( gl_DrawID ) ) )')
    const batchedDecode = nodesIn(vatDecode(vat, { playback, carrier: batch }).position)
    expect(batchedDecode.some((n) => n.type === 'PropertyNode' && n.name === 'vBatchIndirectId')).toBe(true)
  })

  it('refuses the same batches on either path', () => {
    const vat = makeRigVATFixture()
    const empty = () => new BatchedMesh(2, vat.vertexCount, vat.vertexCount * 2, vat.materials[0])
    const playback = createVATPlaybackTexture(makeFixtureCrowd())

    expect(() => patchVATMaterial(new MeshStandardMaterial(), vat, createVATUniforms(), playback, empty())).toThrow(
      /holds no geometry/,
    )
    expect(() => vatDecode(vat, { playback, carrier: empty() })).toThrow(/holds no geometry/)
  })

  it('accepts the smooth-shaded lit pairing the vertex encoding refuses without a normal texture, on either path', () => {
    // A rig VAT has no normal texture and none missing (ADR-0018), so the one
    // refusal the two paths share for the vertex encoding must not fire here.
    const smoothAndLit = () => {
      const vat = makeRigVATFixture()
      expect((vat.materials[0] as MeshStandardMaterial).flatShading).toBe(false)
      return vat
    }

    expect(() => createWebGLMesh(smoothAndLit(), makeFixtureCrowd())).not.toThrow()
    expect(() => createTSLMesh(smoothAndLit(), makeFixtureCrowd())).not.toThrow()
  })
})
