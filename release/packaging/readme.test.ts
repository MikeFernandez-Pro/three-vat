// The README is the npm package page — the one shipped artifact a stranger
// reads before they read any code — and ADR-0013 makes it a beginner's page
// rather than a reference manual. That decision does not fail loudly when it is
// broken; it erodes one paragraph at a time, and the page is back to 371 lines
// serving two readers before anyone notices (#18, #26).
//
// So three things are pinned here, all of which a human review misses reliably:
//
//   1. **The visible budget.** Only what a reader scrolls past counts —
//      everything inside a `<details>` is a question they chose to ask, which
//      is exactly what makes collapsing the right answer to a short one.
//   2. **The fifteen-line rule**, which is the half of ADR-0013 the budget
//      cannot see: collapsing a section makes its growth invisible, so a
//      collapsed answer has a ceiling of its own and anything with a code block
//      in it has to point at the `docs/` page that carries the long version.
//   3. **Every link.** Markdown link rot is silent, and the README's whole
//      shape now depends on links out to `docs/` carrying the depth. A broken
//      one is a dead end on the page that can least afford one.
//
// The link check covers every Markdown page this repository publishes, not just
// the README: the depth lives in `docs/` now, and the one link this rewrite
// actually broke was in `CHANGELOG.md`, pointing at a README section that had
// moved. Half a funnel is not worth checking.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { root } from '../paths.js'
import { publishedPages } from './pages.js'

const README = root('README.md')

/**
 * Roughly 120 lines, the figure ADR-0013 agreed. A budget, not a target: the
 * page costs about 90 today, and the headroom is there for one section to grow
 * an answer — not for the reference manual to grow back a paragraph at a time.
 */
const VISIBLE_LINE_BUDGET = 120

/**
 * ADR-0013's fifteen-line rule, with the slack the word "about" buys it. A
 * collapsed section is invisible to the budget above, so this is what stops a
 * `<details>` becoming the reference manual's new address.
 */
const COLLAPSED_LINE_BUDGET = 20

/** The deployed demo — the link a reader is meant to take before reading on. */
const DEMO = 'https://mikefernandez-pro.github.io/three-vat/'

/**
 * Raw file content on `main`. npm rewrites a relative link to
 * `github.com/…/blob/HEAD/…` — a *page*, which is right for a link and renders
 * nothing as an image (#26), so anything embedded has to be spelled this way.
 */
const RAW = 'https://raw.githubusercontent.com/MikeFernandez-Pro/three-vat/main/'

/**
 * What a reader scrolls past: every line outside a `<details>`, plus the
 * `<summary>` that advertises each collapsed one. The body of a collapsed
 * section is free — that is the trade ADR-0013 makes, and it is only sound if
 * the measure honours it. Verified against npm's own README viewer, which
 * renders `<details>` as a real collapsible element (#26), so this is the page
 * on both front doors and not just on GitHub.
 */
function visibleLines(markdown: string): string[] {
  const visible: string[] = []
  let collapsed = false

  for (const line of markdown.split('\n')) {
    if (/^\s*<details>/.test(line)) collapsed = true
    else if (/^\s*<\/details>/.test(line)) collapsed = false
    else if (!collapsed || /<summary>/.test(line)) visible.push(line)
  }

  return visible
}

/** Each collapsed section, as its summary line and the body under it. */
function collapsedSections(markdown: string): { summary: string; body: string[] }[] {
  const sections: { summary: string; body: string[] }[] = []
  let open: { summary: string; body: string[] } | null = null

  for (const line of markdown.split('\n')) {
    if (/^\s*<details>/.test(line)) open = { summary: '', body: [] }
    else if (/^\s*<\/details>/.test(line)) {
      if (open) sections.push(open)
      open = null
    } else if (open && /<summary>/.test(line)) open.summary = line.replace(/<\/?[^>]+>/g, '').trim()
    else if (open && line.trim()) open.body.push(line)
  }

  return sections
}

describe('the README a beginner reads', () => {
  const readme = readFileSync(README, 'utf8')

  it('stays inside its visible-line budget', () => {
    const visible = visibleLines(readme)

    expect(
      visible.length,
      `the README shows ${visible.length} lines; ADR-0013 budgets ${VISIBLE_LINE_BUDGET}. Collapse an answer, or move it to docs/`,
    ).toBeLessThanOrEqual(VISIBLE_LINE_BUDGET)
  })

  it('keeps every collapsed answer short, and sends the long ones to docs/', () => {
    const sections = collapsedSections(readme)
    expect(sections.length).toBeGreaterThan(0)

    for (const { summary, body } of sections) {
      expect(
        body.length,
        `the collapsed section "${summary}" runs to ${body.length} lines; ADR-0013's rule is about fifteen`,
      ).toBeLessThanOrEqual(COLLAPSED_LINE_BUDGET)

      // "Anything needing a code block *and* an explanation moves to `docs/`
      // and is linked" — so a collapsed section that shows code is a summary of
      // a page, and has to name the page. Without this the rule reads as "keep
      // it short", and short-and-nowhere-to-go is the worse failure.
      if (body.some((line) => line.startsWith('```'))) {
        expect(
          body.join('\n'),
          `the collapsed section "${summary}" carries a code block but links to no docs/ page`,
        ).toMatch(/\]\(\.\/docs\//)
      }
    }
  })

  it('opens on the hero image, before anything a reader has to read', () => {
    // User story 1: a moving image within a second, without reading. The
    // capture script keeps it honest (ADR-0012); this keeps it first, and on
    // the raw URL that is the only one npm renders as an image.
    const lines = readme.split('\n').filter((line) => line.trim())

    expect(lines[0]).toMatch(/^# /)
    expect(lines[1], 'the first thing below the title is not the hero image').toMatch(/^!\[/)
    expect(/!\[[^\]]*\]\(([^)\s]+)/.exec(readme)?.[1]).toMatch(RAW)
  })

  it('offers the live demo as a link a reader meets before install', () => {
    // User story 2: **one prominent** link, above the fold — a bare URL in
    // prose, or one buried below the first snippet, is not the same promise.
    const firstScreen = visibleLines(readme).slice(0, 20).join('\n')
    const links = [...firstScreen.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)].map((match) => match[1]!)

    expect(links, 'no live-demo link in the README first screen').toContain(DEMO)
    expect(links.filter((link) => link.startsWith(DEMO)), 'more than one demo link competing up top').toHaveLength(1)
  })
})

/** A GitHub heading's anchor: lower-cased, punctuation dropped, spaces hyphenated. */
function anchor(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

/** Every anchor a page offers: one per heading. */
function anchors(markdown: string): Set<string> {
  return new Set([...markdown.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => anchor(match[1]!)))
}

/**
 * Every target a page points at — Markdown links and raw HTML `src`/`href`
 * alike, since `<details>` bodies are HTML and the badges are `<img>`.
 */
function targets(markdown: string): string[] {
  return [
    ...[...markdown.matchAll(/\[[^\]]*\]\(([^)\s]+)/g)].map((match) => match[1]!),
    ...[...markdown.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]!),
  ]
}

describe('every link a reader can follow', () => {
  it('resolves to a file that exists, or to a heading on the page', () => {
    // Relative links and in-page anchors only: an external URL is someone
    // else's to keep alive, and CI has no network. The exception is a raw
    // GitHub URL into this repository — it names a path in this tree, so it is
    // checkable here, and the hero image is exactly that.
    const checked = publishedPages()
    expect(checked.map((page) => relative(root('.'), page))).toContain('README.md')
    expect(checked.length, 'the page walk found almost nothing — it is looking in the wrong place').toBeGreaterThan(5)

    const broken: string[] = []
    let followed = 0

    for (const page of checked) {
      const markdown = readFileSync(page, 'utf8')
      const own = anchors(markdown)

      for (const target of targets(markdown)) {
        const where = `${relative(root('.'), page)} → ${target}`

        if (target.startsWith(RAW)) {
          followed++
          if (!existsSync(root(target.slice(RAW.length)))) broken.push(where)
          continue
        }
        if (/^(https?:)?\/\//.test(target)) continue

        followed++
        if (target.startsWith('#')) {
          if (!own.has(target.slice(1))) broken.push(where)
          continue
        }

        const [path, fragment] = target.split('#')
        const file = resolve(dirname(page), path!)
        if (!existsSync(file)) {
          broken.push(where)
          continue
        }
        // A link into another page's section is as breakable as the page
        // itself, and breaks more quietly — a heading gets reworded and the
        // link still lands, just at the top.
        if (fragment && file.endsWith('.md') && !anchors(readFileSync(file, 'utf8')).has(fragment)) {
          broken.push(where)
        }
      }
    }

    expect(broken).toEqual([])
    // A check that followed nothing is a check that passes for the wrong
    // reason: the two regexes above are the only thing between this suite and
    // a silent no-op.
    expect(followed, 'no local link was followed at all').toBeGreaterThan(20)
  })
})
