// The script table is part of the release, because it is the first thing a
// newcomer reads about how to run this repository (#25).
//
// Two commands are meant to be the whole onboarding — `pnpm i`, then
// `pnpm run dev` — and that promise survives only as long as `pnpm run` stays a
// short list of obvious verbs. It drifts back the easy way: a release step needs
// a name, a CI job wants a one-liner, and thirteen entries are there again with
// the useful ones buried. So the table is pinned here, in the release suite,
// beside the other checks on what this package ships.
//
// The rule, not just the list: every command is one of the verbs a person types
// (`dev`, `test`, `build`, `typecheck`), optionally qualified. Release and CI
// machinery has no name here at all — it lives in `scripts/`, in `release/`, or
// in the workflow that calls it, and `docs/releasing.md` says how to run it.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { root } from '../paths.js'

const pkg = JSON.parse(readFileSync(root('package.json'), 'utf8')) as {
  scripts: Record<string, string>
}

/**
 * npm lifecycle hooks are not commands anyone types, and `pnpm run` lists them
 * under their own heading — they are not part of the person-facing list.
 */
const LIFECYCLE = new Set(['prepublishOnly'])

const commands = Object.entries(pkg.scripts).filter(([name]) => !LIFECYCLE.has(name))
const names = commands.map(([name]) => name)

/** The verbs a person types. Everything else is machinery with somewhere else to live. */
const VERBS = ['dev', 'test', 'build', 'typecheck']

/**
 * What the list may grow to. The verbs themselves plus a qualified form or two
 * — thirteen entries is what this replaced, and the number is here so growing
 * past it is a decision someone makes rather than one that accumulates.
 */
const MOST_COMMANDS = 6

describe('the script table', () => {
  it('offers the two commands a newcomer types, and `dev` opens the demo', () => {
    // `pnpm i` is pnpm's; `pnpm run dev` is ours, and it has to reach the demo
    // package rather than watch-build the library, which is what it used to do.
    expect(pkg.scripts.dev).toBeDefined()
    expect(pkg.scripts.dev).toContain('three-vat-example')
    expect(pkg.scripts.dev).toMatch(/\bdev\b/)
  })

  it('names the library build `build`, and its watch build after a build', () => {
    expect(pkg.scripts.build).toBe('tsup')

    const watch = names.filter((name) => pkg.scripts[name]!.includes('--watch') && pkg.scripts[name]!.includes('tsup'))
    expect(watch).toHaveLength(1)
    // The old name was `dev`, which said nothing about building anything.
    expect(watch[0]).toMatch(/^build/)
  })

  it('runs every suite under `test`', () => {
    // The library's own suite and the release suite share one vitest project
    // (vitest.config.ts includes both); the demo is a separate package with a
    // separate run, and `pnpm test` has to carry it or CI is the only place the
    // three ever run together.
    expect(pkg.scripts.test).toContain('vitest run')
    expect(pkg.scripts.test).toContain('three-vat-example')

    const vitestConfig = readFileSync(root('vitest.config.ts'), 'utf8')
    expect(vitestConfig).toContain('src/**/*.test.ts')
    expect(vitestConfig).toContain('release/**/*.test.ts')
  })

  it('typechecks all three tsconfigs under one `typecheck`', () => {
    expect(pkg.scripts.typecheck).toContain('release/tsconfig.json')
    expect(pkg.scripts.typecheck).toContain('three-vat-example')
  })

  it('is a short list of person-facing verbs, with no release or CI machinery in it', () => {
    expect(names.length).toBeLessThanOrEqual(MOST_COMMANDS)

    for (const name of names) {
      expect(VERBS, `\`pnpm run ${name}\` is not one of the verbs a person types`).toContain(name.split(':')[0])
    }
  })
})

describe('what CI runs', () => {
  const ci = readFileSync(root('.github/workflows/ci.yml'), 'utf8')
  const pages = readFileSync(root('.github/workflows/pages.yml'), 'utf8')

  it('still covers everything it covered before the table shrank', () => {
    // The commands changed names; the coverage may not. Fetching the skinned
    // asset, all three typechecks, all three suites, and the library build were
    // eight steps and are now four — but a step that quietly stopped running
    // would show up as a green CI over untested code.
    expect(ci).toContain('node scripts/fetch-test-assets.mjs')
    expect(ci).toMatch(/- run: pnpm typecheck$/m)
    expect(ci).toMatch(/- run: pnpm test$/m)
    expect(ci).toMatch(/- run: pnpm build$/m)
  })

  it('builds the demo for Pages through the demo package', () => {
    expect(pages).toContain('pnpm --filter three-vat-example build')
  })
})

describe('what the README tells a newcomer to type', () => {
  it('names those two commands, and names them first', () => {
    // The table is only worth shrinking if the front page says so: the point of
    // #25 is that the first two commands in the README are the whole setup.
    const readme = readFileSync(root('README.md'), 'utf8')
    const shell = [...readme.matchAll(/```bash\n([\s\S]*?)```/g)].map((match) => match[1]!)
    const development = shell.find((block) => /^pnpm /m.test(block))

    expect(development, 'the README has no block of pnpm commands').toBeDefined()
    const typed = development!
      .split('\n')
      .map((line) => line.replace(/\s*#.*$/, '').trim())
      .filter(Boolean)

    expect(typed.slice(0, 2)).toEqual(['pnpm i', 'pnpm run dev'])
  })
})

/** Every text file worth reading for a `pnpm <script>` mention. */
function textFiles(): string[] {
  const skip = new Set(['node_modules', 'dist', '.git', '.claude', 'test-assets', 'media'])
  const found: string[] = []

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry)) continue
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.(md|ts|tsx|mjs|js|json|yml|yaml|html)$/.test(entry)) found.push(path)
    }
  }

  walk(root('.'))
  // Two exemptions. Release notes describe the repository as it was at each
  // version, so renaming a script does not make an old entry wrong; and this
  // file has to name commands that do not exist, to say what it is looking for.
  return found.filter((path) => !path.endsWith('CHANGELOG.md') && !path.endsWith('scripts.test.ts'))
}

/** pnpm's own subcommands, which are not this package's to define. */
const PNPM_BUILTINS = new Set(['install', 'i', 'add', 'remove', 'publish', 'exec', 'dlx', 'why', 'update', 'up', 'link', 'store', 'audit', 'list', 'ls', 'pack', 'run'])

/**
 * A `pnpm <name>` written as something to type: inside backticks, at the head of
 * a line (a shell block, or a workflow's `- run:`), or qualified with a colon
 * anywhere at all — `pnpm test:examples` mid-sentence is a command however it is
 * punctuated, where a bare word is not: prose that says "the whole pnpm
 * workspace" is talking about pnpm, not naming a command.
 */
const MENTIONS = [
  /`pnpm (?:run )?([a-z][a-z0-9:-]*)[^`]*`/g,
  /^\s*(?:-\s*run:\s*)?pnpm (?:run )?([a-z][a-z0-9:-]*)/gm,
  /pnpm (?:run )?([a-z][a-z0-9-]*:[a-z0-9:-]+)/g,
]

describe('what the repository tells you to type', () => {
  it('never names a script that does not exist', () => {
    // The table above only stays short if the renames land everywhere that
    // taught someone the old name — docs, comments, workflows, the README.
    const defined = new Set(Object.keys(pkg.scripts))
    const dangling: string[] = []

    for (const path of textFiles()) {
      const text = readFileSync(path, 'utf8')
      for (const mention of MENTIONS) {
        for (const match of text.matchAll(mention)) {
          const name = match[1]!
          if (PNPM_BUILTINS.has(name) || defined.has(name)) continue
          dangling.push(`${relative(root('.'), path)} → pnpm ${name}`)
        }
      }
    }

    expect(dangling).toEqual([])
  })
})
