// The giant trees, exported by justASimpleTree itself: its spooky trees as they were set, each the tree's own glb
// export ("tree" in its export menu) written to public/models/spookyTrees/ as it downloads, no other tool between.
// Their leaves are baked as justASimpleTree draws them, each card one cell of the leaf atlas.
//
//   node scripts/generators/giant_tree.mjs [justASimpleTree's dev server]
//
// Run from games/last-light, with justASimpleTree's dev server up (`pnpm dev` there, http://localhost:5173 by default).
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { launchChrome } from '../../../../release/browser.mjs'

/** What every tree shares, as justASimpleTree's panel reads it from the page's hash. */
const SPOOKY = {
  'Tree/theme': 'night',
  'Tree/species': 'spooky',
  'Tree/shape/spread': 0.49,
  'Tree/shape/roots': 0,
  'Tree/shape/leaves left': 0.49,
  'Tree/shape/base flare': 0.55,
  'Leaves/clumps/cards per clump': 35,
  'Leaves/cards/texture': 'pointed cluster',
}
/** The trees, chosen on 2026-10-26: the first one, and three more. */
const TREES = [
  { 'Tree/shape/seed': 6964 },
  { 'Tree/shape/seed': 1759 },
  { 'Tree/shape/seed': 4843, 'Tree/shape/leaves left': 0.56 },
  { 'Tree/shape/seed': 5197, 'Tree/shape/twist': 0.64, 'Tree/shape/leaves left': 0.56 },
]
/** How long a tree takes to grow in, ms, before it is exported as it stands. */
const SETTLE = 10000

const server = process.argv[2] ?? 'http://localhost:5173/'
const browser = await launchChrome(['chrome', 'msedge', 'chromium'])
mkdirSync('public/models/spookyTrees', { recursive: true })
for (const tree of TREES) {
  // A page of its own each, so the panel starts from the hash and nothing of the last tree.
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.goto(`${server}#${encodeURIComponent(JSON.stringify({ ...SPOOKY, ...tree }))}`)
  await page.waitForTimeout(SETTLE)
  const downloaded = page.waitForEvent('download', { timeout: 60000 })
  const clicked = await page.evaluate(() => {
    const item = [...document.querySelectorAll('.bar .menu button')].find((b) => b.textContent === 'tree')
    item?.click()
    return item !== undefined
  })
  if (!clicked) throw new Error('no "tree" in the export menu')
  const download = await downloaded
  const out = resolve('public/models/spookyTrees', download.suggestedFilename())
  await download.saveAs(out)
  await page.close()
  console.log(`${out}${errors.length ? `\n  page errors:\n  ${errors.join('\n  ')}` : ''}`)
}
await browser.close()
