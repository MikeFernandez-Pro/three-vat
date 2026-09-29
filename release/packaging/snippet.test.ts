// The drop pages hand a visitor code to paste (ADR-0032), and a snippet is
// only worth pasting if it compiles against the `three-vat` they install. So
// every snippet the drop module can write — each format, encoding, option,
// clip selection and renderer, from the bake or from the baked file — is
// type-checked here through the TypeScript compiler API, as a visitor's own
// module would be: through the package's
// public specifiers and nothing else, under `strict`. A renamed option, a moved
// export or a changed signature fails this suite rather than a visitor's paste.
//
// Checked twice over: as TypeScript, which holds the types, and as JavaScript
// under `checkJs`, which holds the other half of the promise — a snippet with
// no TypeScript-only syntax in it, so it pastes into a `.js` file too.
//
// The specifiers are the package's own `exports`, each resolved to the source
// its `.d.ts` is emitted from, as every other check in this suite resolves
// them (release/tsconfig.json): a check against the last build would pass on
// types the next release no longer has.
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { BAKE_DEFAULTS, snippetOf, type SnippetInput } from '../../examples/src/drop.js'
import { root } from '../paths.js'

/**
 * What a visitor's page already has before the snippet runs: a scene to add
 * the crowd to. Declared, not written, because the snippet says where it goes
 * and every page builds its own.
 */
const AMBIENT = 'declare const scene: import("three").Scene\n'

/**
 * The specifiers a visitor can import, read off the package's own `exports`,
 * each mapped to the source its published `.d.ts` is emitted from
 * (`./dist/webgl.d.ts` from `src/webgl.ts`). So a subpath renamed or dropped
 * from `exports` fails the snippets that import it.
 */
const PUBLIC_SPECIFIERS: Record<string, string[]> = Object.fromEntries(
  Object.entries(
    (JSON.parse(readFileSync(root('package.json'), 'utf8')) as { exports: Record<string, { types: string }> }).exports,
  ).map(([subpath, { types }]) => [
    `three-vat${subpath.slice(1)}`,
    [types.replace(/^\.\/dist\/(.+)\.d\.ts$/, 'src/$1.ts')],
  ]),
)

/**
 * Every diagnostic the compiler raises over these snippets, each as
 * `<file>(<line>): <message>` — empty when every one compiles. One program for
 * the lot: loading three's types is the cost, and it is paid once.
 */
function typeCheckSnippets(snippets: readonly string[]): string[] {
  const virtual = new Map<string, string>([[root('snippets/ambient.d.ts'), AMBIENT]])
  snippets.forEach((code, i) => {
    virtual.set(root(`snippets/snippet-${i}.ts`), code)
    virtual.set(root(`snippets/snippet-${i}.js`), code)
  })
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    strict: true,
    noEmit: true,
    allowJs: true,
    checkJs: true,
    skipLibCheck: true,
    types: [],
    baseUrl: root('.'),
    paths: PUBLIC_SPECIFIERS,
  }
  const host = ts.createCompilerHost(options)
  const normal = (file: string) => ts.sys.resolvePath(file).replace(/\\/g, '/').toLowerCase()
  const lookup = new Map([...virtual].map(([file, text]) => [normal(file), text]))
  const { fileExists, readFile, getSourceFile } = host
  host.fileExists = (file) => lookup.has(normal(file)) || fileExists.call(host, file)
  host.readFile = (file) => lookup.get(normal(file)) ?? readFile.call(host, file)
  host.getSourceFile = (file, language, ...rest) => {
    const text = lookup.get(normal(file))
    return text === undefined ? getSourceFile.call(host, file, language, ...rest) : ts.createSourceFile(file, text, language)
  }
  const program = ts.createProgram([...virtual.keys()], options, host)
  // Only the snippets' own diagnostics: the library's are its own typecheck's.
  return [...virtual.keys()].flatMap((file) =>
    ts.getPreEmitDiagnostics(program, program.getSourceFile(file)).map((d) => {
      const where = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : '?'
      const name = file.split(/[\\/]/).pop()!
      const i = Number(/snippet-(\d+)/.exec(name)?.[1])
      const line = Number.isNaN(i) || where === '?' ? '' : ` \`${snippets[i]!.split('\n')[where - 1]}\``
      return `${name}(${where}):${line} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`
    }),
  )
}

describe("the drop pages' snippets, held to the public API", () => {
  const clipSets: SnippetInput['clips'][] = [
    [
      { name: 'Idle', checked: true },
      { name: 'Walk', checked: true },
    ],
    [
      { name: 'Take 001', checked: false },
      { name: 'mixamo.com', checked: true },
    ],
    [
      { name: 'it\'s \\ "odd"', checked: true },
      { name: 'x', checked: false },
    ],
    [{ name: 'Idle', checked: false }],
    [],
  ]
  const sources: Pick<SnippetInput, 'asset' | 'format' | 'choices'>[] = [
    { asset: 'Soldier.glb', format: 'gltf', choices: {} },
    { asset: 'robot/scene.gltf', format: 'gltf', choices: {} },
    { asset: 'Samba Dancing.fbx', format: 'fbx', choices: { mergeVertices: true } },
    { asset: 'Samba Dancing.fbx', format: 'fbx', choices: { mergeVertices: false } },
  ]
  const bakes: SnippetInput['bake'][] = []
  for (const encoding of ['auto', 'delta', 'rig'] as const)
    for (const fps of [BAKE_DEFAULTS.fps, 24])
      for (const mergeFlatMaterials of [false, true]) bakes.push({ fps, encoding, mergeFlatMaterials })
  const renderers = ['webgl', 'webgpu'] as const

  const snippets: string[] = []
  for (const source of sources)
    for (const bake of bakes)
      for (const clips of clipSets)
        for (const renderer of renderers)
          for (const from of ['bake', 'file'] as const) snippets.push(snippetOf({ ...source, bake, clips, renderer, from }))

  it('reaches every shape a snippet takes', () => {
    // Guards the matrix: each line the drop module writes only sometimes is
    // written somewhere in it, so each is type-checked below.
    for (const shape of [
      'GLTFLoader',
      'FBXLoader',
      'mergeVertices(o.geometry)',
      "from 'three-vat/webgl'",
      "from 'three-vat/tsl'",
      'bakeVAT(root, clips)\n',
      'bakeVAT(root, [])',
      "bakeVAT(root, clips, { fps: 24, encoding: 'rig', mergeFlatMaterials: true })",
      "encoding: 'delta'",
      '.includes(clip.name)',
      String.raw`'it\'s \\ "odd"'`,
      'startFrame: 0, frames: 1',
      "await loadVAT('/Soldier.vat.glb')",
    ]) {
      expect(snippets.some((code) => code.includes(shape)), shape).toBe(true)
    }
  })

  it("resolves the package's four published entry points, each to its source", () => {
    expect(PUBLIC_SPECIFIERS).toEqual({
      'three-vat': ['src/index.ts'],
      'three-vat/webgl': ['src/webgl.ts'],
      'three-vat/tsl': ['src/tsl.ts'],
      'three-vat/write': ['src/write.ts'],
    })
  })

  it('type-checks every snippet, as TypeScript and as checked JavaScript', () => {
    expect(typeCheckSnippets(snippets)).toEqual([])
  }, 120_000)

  it('fails a snippet the public API does not type', () => {
    // Guards the guard: a checker that resolved nothing, or checked nothing,
    // would pass the whole matrix too.
    const wrong = snippets[0]!.replace('bakeVAT(root, clips)', "bakeVAT(root, clips, { encodings: 'rig' })")
    expect(wrong).not.toBe(snippets[0])
    const failures = typeCheckSnippets([wrong])
    // The option named, in the TypeScript and in the JavaScript check alike;
    // what follows from the call it broke is the compiler's to add.
    for (const extension of ['ts', 'js']) {
      expect(failures.find((f) => f.startsWith(`snippet-0.${extension}(`))).toContain("'encodings' does not exist")
    }
  }, 120_000)
})
