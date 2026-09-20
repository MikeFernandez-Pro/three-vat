// What each page actually downloads (#17).
//
// `bundles.test.ts` beside this file reads the TypeScript import graph, which is
// the one thing a bundler does not ship. It cannot see chunking: rollup puts a
// module two entries share into a chunk they both import, so a page can reach
// exactly the right subpaths and still be handed the other page's renderer
// through a neighbour. That is precisely what shipped — the WebGPU page reached
// only `three-vat/tsl`, and downloaded 740 kB of `WebGLRenderer` and the GLSL
// shader library anyway, because the addons around its renderer (OrbitControls,
// GLTFLoader, the two environments) import bare `three` and the WebGL page does
// too.
//
// So this guard reads the build. It runs the demo's real build script and walks
// the chunks each page loads — the entry, everything it statically imports, and
// everything behind its dynamic imports, because a WebGPU visitor does fetch
// the page the door imports on demand.
//
// Fingerprints rather than class names: minification renames bindings, but
// nothing rewrites a string literal, and each renderer's implementation carries
// text the other's never does. `#include <common>` is the classic GLSL shader
// library's chunk system; `fn main` is WGSL. Both are asserted present on their
// own page as well as absent from the other, so a fingerprint that stopped
// matching fails loudly instead of passing everything.
import crypto from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildDemos } from '../../examples/build.mjs'
import { root } from '../paths.js'
import { demoPages, rendererOf } from './demos.js'
import type { Renderer } from './demos.js'

/**
 * Whether the node running this can build the demo at all.
 *
 * This is the one suite in the library's own run that invokes vite, and vite 7
 * needs node 20.19 or newer — it calls `crypto.hash`, added there — where this
 * package's `engines` promises consumers a bare `>=20`. A 20.0 could therefore
 * satisfy the promise and still not build the demo, and the demo's build
 * tooling has never been held to the floor: ci.yml says as much, and the Pages
 * workflow pins 22.
 *
 * So on a node without the builtin this guard steps aside rather than reporting
 * a payload regression that is really a missing builtin. Feature-detected rather
 * than version-matched, because the capability is the thing that decides it.
 * Both CI legs resolve to a node that has it today, so the guard runs on every
 * push and pull request, which is where it has to hold — and `docs/releasing.md`
 * has a release run on a current node besides.
 */
const CAN_BUILD = typeof crypto.hash === 'function'

const FINGERPRINTS: Record<Renderer, string[]> = {
  /** three.js's classic renderer: its error prefix, and the GLSL chunk system. */
  webgl: ['THREE.WebGLRenderer', '#include <common>'],
  /** The node renderer: its error prefix, and the WGSL its node builder emits. */
  webgpu: ['THREE.WebGPURenderer', 'fn main'],
}

/** Every `.js` a built page pulls in itself — its entry, and anything preloaded beside it. */
function entryScripts(outDir: string, html: string): string[] {
  const page = readFileSync(join(outDir, html), 'utf8')
  return [...page.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map((match) => resolve(outDir, match[1]!))
}

/**
 * Every chunk reachable from a built page, static and dynamic alike.
 *
 * Rollup writes both as a bare relative specifier next to the importer, so one
 * pattern finds both — and over-matching (a string in app code that looks like
 * a chunk name) can only widen the set this guard checks, never narrow it.
 */
function reachableChunks(outDir: string, html: string): string[] {
  const seen = new Set<string>()
  const queue = entryScripts(outDir, html)

  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    const code = readFileSync(file, 'utf8')
    for (const match of code.matchAll(/["'](\.\/[\w.-]+\.js)["']/g)) {
      queue.push(resolve(dirname(file), match[1]!))
    }
  }

  return [...seen]
}

describe.skipIf(!CAN_BUILD)('what a visitor to each page downloads', () => {
  let outDir = ''

  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), 'three-vat-payload-'))
    await buildDemos(outDir)
  }, 300_000)

  afterAll(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true })
  })

  it('is built by the script the demo package actually runs', () => {
    // This suite builds by calling `buildDemos` directly, which is only the
    // real build for as long as `pnpm --filter three-vat-example build` calls
    // the same script. A `build` that went back to a bare `vite build` would
    // put every page through one rollup build again, and this guard would keep
    // passing — it would still be building them one at a time. (That `vite
    // build` now refuses to run without `DEMO_PAGE` is the other half of the
    // same rule; this is the half that notices the script itself changing.)
    const pkg = JSON.parse(readFileSync(root('examples/package.json'), 'utf8')) as { scripts: Record<string, string> }

    expect(pkg.scripts.build).toContain('build.mjs')
  })

  it.each(demoPages().map((page) => [page.html, rendererOf(page.entry)]))('%s ships one renderer', (html, own) => {
    // `index.html` carries no `<renderer>_` prefix; its entry module does, and
    // that is what names it (ADR-0011, as amended). A page whose entry names no
    // renderer at all has nothing to be checked against, and `bundles.test.ts`
    // already fails it.
    expect(own, `${html} names no renderer`).not.toBeNull()

    const payload = reachableChunks(outDir, html as string)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n')

    for (const fingerprint of FINGERPRINTS[own as Renderer]) {
      expect(payload, `${html} should contain ${fingerprint}`).toContain(fingerprint)
    }

    const other: Renderer = own === 'webgl' ? 'webgpu' : 'webgl'
    for (const fingerprint of FINGERPRINTS[other]) {
      expect(payload, `${html} downloads the ${other} renderer (${fingerprint})`).not.toContain(fingerprint)
    }
  })
})

// Guards the guard's one weakness: it is allowed to step aside, so something has
// to notice if it steps aside everywhere. The skip is only honest while CI still
// runs a node that can build the demo — drop the newer leg from the matrix and
// this suite would go quietly dark on every leg, which is exactly the shape of
// failure #17 was.
describe('the matrix this guard rides on', () => {
  it('still runs a node that can build the demo', () => {
    const ci = readFileSync(root('.github/workflows/ci.yml'), 'utf8')
    const matrix = /^\s*node:\s*\[([^\]]+)\]/m.exec(ci)?.[1]

    expect(matrix, 'no `node:` matrix found in ci.yml').toBeDefined()
    const versions = matrix!.split(',').map((entry) => Number(entry.trim()))

    // vite 7's floor is node 20.19; a major of 20 or more clears it, and the
    // matrix pins majors.
    expect(Math.max(...versions), `ci.yml runs node ${matrix} — none new enough to build the demo`).toBeGreaterThanOrEqual(20)
  })
})
