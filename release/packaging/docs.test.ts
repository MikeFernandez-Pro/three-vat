// `docs/` is the other half of ADR-0013: the README gets a beginner one crowd on
// screen, and everything a reader needs only once they have committed lives
// here. A folder is a worse place to put depth than a page, because a folder has
// no first sentence — a reader who follows a link from the README lands on a
// file listing and has to guess which of six names is theirs.
//
// So three things are pinned, each of which decays silently (#27):
//
//   1. **A front door exists, and stays one screen.** `docs/README.md` is what
//      GitHub renders for the folder; the budget is what keeps it a signpost
//      rather than a seventh page.
//   2. **It names every page.** A page nobody links is a page nobody finds, and
//      the next one to land here will be added by whoever is already writing it
//      — not by whoever remembers the index.
//   3. **Nothing in `docs/` is code.** A source file in a documentation folder
//      reads as something to import, and the dead prototype reference that used
//      to sit here was neither runnable nor the library. Git remembers it.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { root } from '../paths.js'
import { anchor, NOT_A_PAGE } from './pages.js'

const DOCS = root('docs')
const INDEX = join(DOCS, 'README.md')
const USAGE = join(DOCS, 'usage.md')

/**
 * One screen. The index's whole job is to hand a reader off in the first few
 * seconds, and a signpost that scrolls has stopped being one. It costs 20 lines
 * today; the headroom is there for a page or two to be added with the sentence
 * that says who it is for — not for the index to start explaining anything.
 */
const INDEX_LINE_BUDGET = 40

/** What the folder offers a reader: the pages beside the index, and the folders under it. */
function browsable(): { pages: string[]; folders: string[] } {
  const pages: string[] = []
  const folders: string[] = []

  for (const entry of readdirSync(DOCS)) {
    if (statSync(join(DOCS, entry)).isDirectory()) folders.push(entry)
    else if (entry.endsWith('.md')) pages.push(entry)
  }

  return { pages, folders }
}

/** Every file under `docs/`, at any depth — including the folders that hold no page. */
function everyFile(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? everyFile(path) : [path]
  })
}

describe('the ADR index', () => {
  // `docs/README.md` sends a reader to `adr/`, and what GitHub renders for a
  // folder is the README inside it. That index is the second front door, and it
  // decays the same silent way the first one does (#27): the next ADR is
  // written by whoever is arguing a decision, not by whoever remembers the
  // list. So the list is pinned, and so is each title — a hand-copied heading
  // is a second spelling of something that already has one, and the two drift
  // the first time a decision is renamed.
  const INDEX = join(DOCS, 'adr', 'README.md')
  const index = readFileSync(INDEX, 'utf8')

  /** Every ADR beside the index, as its filename and its own `# ` heading. */
  const records = readdirSync(join(DOCS, 'adr'))
    .filter((entry) => /^\d{4}-.*\.md$/.test(entry))
    .map((entry) => ({
      file: entry,
      title: readFileSync(join(DOCS, 'adr', entry), 'utf8').split('\n')[0]!.replace(/^#\s+/, '').trim(),
    }))

  /** The index's table rows — the list itself, not the prose that points into it. */
  const rows = index.split('\n').filter((line) => line.startsWith('| ['))

  it('names every decision in the folder', () => {
    expect(records.length, 'no ADRs found — the walk is looking in the wrong place').toBeGreaterThan(5)

    for (const { file } of records) {
      expect(
        rows.some((row) => row.includes(`(./${file})`)),
        `the ADR index does not list ./${file}`,
      ).toBe(true)
    }
  })

  it('calls each one what the record itself calls it', () => {
    for (const { file, title } of records) {
      const row = rows.find((line) => line.includes(`(./${file})`))
      expect(row, `the ADR index renames ${file}; its own heading is "${title}"`).toContain(title)
    }
  })
})

describe('the docs folder a reader lands in', () => {
  const index = readFileSync(INDEX, 'utf8')
  const { pages, folders } = browsable()

  it('opens on a front door that fits one screen', () => {
    const lines = index.split('\n')

    expect(lines[0], 'the index does not open on a heading').toMatch(/^# /)
    expect(
      lines.length,
      `the docs index runs to ${lines.length} lines; it is budgeted ${INDEX_LINE_BUDGET}. It is a signpost, not a page`,
    ).toBeLessThanOrEqual(INDEX_LINE_BUDGET)
  })

  it('names every page it sits beside, and says who each is for', () => {
    const entries = [...index.matchAll(/\[[^\]]+\]\(\.\/([^)\s]+)\)([^\n]*)/g)]
    const named = new Map(entries.map((match) => [match[1]!.replace(/\/$/, ''), match[2]!]))

    for (const page of pages) {
      if (page === 'README.md') continue
      expect(named.has(page), `the docs index does not name ./${page}`).toBe(true)
      // A bare list of filenames is the file listing a reader already had. The
      // index earns its line by saying who the page is for, on the same line.
      expect(
        named.get(page)!.replace(/[^\w]/g, ''),
        `the docs index links ./${page} but says nothing about who it is for`,
      ).not.toHaveLength(0)
    }

    // The same rule the link check reads, so the two suites cannot disagree
    // about what this folder holds.
    for (const folder of folders.filter((name) => !NOT_A_PAGE.has(name))) {
      expect(named.has(folder), `the docs index does not name ./${folder}/`).toBe(true)
    }
  })

  it('holds documentation and nothing to import, at any depth', () => {
    const code = everyFile(DOCS)
      .filter((path) => /\.(js|mjs|cjs|ts|tsx|jsx)$/.test(path))
      .map((path) => relative(root('.'), path))

    expect(
      code,
      'a source file is sitting in docs/ — a documentation folder is the one place dead code reads as an example',
    ).toEqual([])
  })
})

/** A page with its fenced code stripped — a `## ` inside a snippet is not a section. */
function prose(markdown: string): string {
  return markdown.replace(/^```[\s\S]*?^```/gm, '')
}

/** A `## ` section of a page, heading excluded, up to the next one. */
function section(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const body = markdown.split(new RegExp(`^## ${escaped}$`, 'm'))[1]
  expect(body, `docs/usage.md has no "## ${heading}" section`).toBeDefined()
  return body!.split(/^## /m)[0]!
}

/** A Markdown table's rows, each as its cells — `| a | b | c |` → `['a', 'b', 'c']`. */
function tableRows(markdown: string): string[][] {
  return markdown
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .map((line) =>
      line
        .slice(1, line.lastIndexOf('|'))
        .split('|')
        .map((cell) => cell.trim()),
    )
    .filter((cells) => !cells.every((cell) => /^-*$/.test(cell)))
}

describe('the usage guide', () => {
  const usage = readFileSync(USAGE, 'utf8')

  // The page is long by design — it is where the depth went when ADR-0013 made
  // the README a beginner's page — and its own contents list is the only thing
  // standing between a reader and a scroll. A section added without a line in
  // that list is a section nobody finds, and nothing else notices: the link
  // check beside this file follows the links that exist and cannot see the one
  // that was never written.
  it('lists every section it holds, in the order they appear', () => {
    // The list is the bullets above the first section, not every bullet on the
    // page: a section's own body is free to carry a link to another one, and a
    // check that counted those would fail on prose it has no opinion about.
    const [contents, ...body] = prose(usage).split(/^## /m)
    const headings = body.map((rest) => rest.split('\n')[0]!.trim())
    const listed = [...contents!.matchAll(/^- \[(.+)\]\(#([^)]+)\)$/gm)]

    expect(headings.length, 'no sections found — the walk is looking in the wrong place').toBeGreaterThan(5)
    expect(
      listed.map((match) => match[1]!),
      'the usage guide’s contents list and its sections disagree',
    ).toEqual(headings)
    expect(
      listed.map((match) => match[2]!),
      'a contents entry does not link the heading it names',
    ).toEqual(headings.map(anchor))
  })

  // FBX is a supported format (ADR-0031), and FBXLoader hands over a scene that
  // bakes correctly but wastefully: never indexed, so about five times the
  // vertices, and with Mixamo's empty `Take 001` in its clips. The baker does
  // neither fix, because vertex order is the caller's, so the guide is the only
  // place a reader learns both (#99).
  it('tells an FBX caller to run mergeVertices first and to drop Take 001', () => {
    const fbx = section(usage, 'Loading FBX')

    expect(fbx, 'the Loading FBX section does not name mergeVertices').toContain('mergeVertices')
    expect(fbx, 'the Loading FBX section does not name Mixamo’s empty clip').toContain('Take 001')
  })

  // ADR-0018 ships the rig encoding opt-in, which means a reader only reaches
  // it by being told it exists. Six things make the difference between a
  // section and an answer, and each is a thing the section was written to say
  // (#58): the option that selects it, what a row holds, what the encoding
  // refuses — both refusals, by the name the error uses — that `bakeNormals`
  // is accepted and ignored rather than refused, and where it can be seen
  // running, which is the pair of example pages ADR-0019 added for it.
  it('documents the rig encoding, its refusals and the example that runs it', () => {
    const rig = section(usage, "The rig encoding: `encoding: 'rig'`")

    expect(rig, 'the rig section never shows the option that selects it').toContain("encoding: 'rig'")
    expect(rig, 'the rig section does not say a row holds slots').toMatch(/one \*\*slot\*\* per bone/)
    expect(rig, 'the rig section does not name the morph refusal').toMatch(/morph target/)
    expect(rig, 'the rig section does not name the non-uniform scale refusal').toMatch(/non-uniform scale/)
    expect(rig, 'the rig section does not say what becomes of `bakeNormals`').toMatch(
      /`bakeNormals: false` is \*\*accepted and ignored\*\*/,
    )
    for (const page of ['webgl_soldier.html', 'webgpu_soldier.html']) {
      expect(rig, `the rig section does not link the example page ${page}`).toContain(page)
    }
  })

  // The trade-offs are now a comparison *inside* the library, and ADR-0018
  // rewrote them for one reason: the old line measured the wrong axis — a
  // count of fetches, where the prototype found the count is not what drives
  // the cost. So two things are pinned. The numbers are the ADR's own, read out
  // of its table row by row rather than trusted to a hand copy, because a
  // figure quoted in two places drifts the first time one is remeasured — and
  // read per column, because a figure under the wrong encoding is the one way
  // this copy can be wrong while carrying every character of the original. And
  // the cost is platform-dependent in the direction that matters, so a table
  // that names only the desktop is the reading ADR-0018 says nobody should
  // take.
  it('carries ADR-0018’s measurements, each under the encoding it was measured on', () => {
    const tradeOffs = section(usage, 'Trade-offs')
    const adr = readFileSync(join(DOCS, 'adr', '0018-the-rig-encoding-is-a-second-encoding-opt-in-for-now.md'), 'utf8')

    /** Every measurement in a cell: `25.2 MB`, `5 ms`, `0.65 ms`, `1.4×`. */
    const figures = (cell: string) => [...cell.matchAll(/\d+(?:\.\d+)?\s?(?:MB|kB|ms|s\b|×)/g)].map((m) => m[0]!)

    const measured = tableRows(adr)
      .map(([label, vertex, rig]) => ({ label: label!, vertex: figures(vertex ?? ''), rig: figures(rig ?? '') }))
      .filter((row) => row.vertex.length > 0 || row.rig.length > 0)
    const copied = new Map(tableRows(tradeOffs).map((cells) => [cells[0]!, cells]))

    expect(measured.length, 'no measurements found in ADR-0018 — its table moved').toBe(4)
    for (const { label, vertex, rig } of measured) {
      const row = copied.get(label)
      expect(row, `the trade-offs table has no "${label}" row; ADR-0018 measured one`).toBeDefined()
      for (const figure of vertex) {
        expect(row![1], `the trade-offs put ADR-0018's vertex-encoding ${figure} somewhere else on "${label}"`).toContain(
          figure,
        )
      }
      for (const figure of rig) {
        expect(row![2], `the trade-offs put ADR-0018's rig-encoding ${figure} somewhere else on "${label}"`).toContain(
          figure,
        )
      }
    }

    for (const platform of ['RTX 5080', 'iPhone 15 Pro Max']) {
      expect([...copied.keys()].join('\n'), `the trade-offs measure the encodings on no ${platform}`).toContain(platform)
    }
    expect(
      tradeOffs,
      'the trade-offs still frame the cost as a fetch count, which is the axis ADR-0018 measured and dropped',
    ).not.toMatch(/fetches per vertex/)
  })
})
