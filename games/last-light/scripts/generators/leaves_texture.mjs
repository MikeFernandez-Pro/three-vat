// The dead trees' leaf texture, painted by justASimpleTree's own code: its pointed cluster, a 2 x 2 atlas of
// 256-pixel cells, white leaves on black, as the tree the giant one was made with wore it (spooky, night theme,
// seed 6964; the atlas has its own seed, the same for every tree). Its painters are read from the justASimpleTree
// checkout beside this one and run in a page, for the canvas they paint on.
//
//   node scripts/generators/leaves_texture.mjs [path to justASimpleTree]
//
// Run from games/last-light; writes public/textures/leaves/pointed-cluster.png.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const tree = resolve(process.argv[2] ?? '../../../justASimpleTree')
const read = (file) => readFileSync(resolve(tree, file), 'utf8').replaceAll('\r\n', '\n')
const foliage = read('foliage.js')
const wood = read('wood.js')

/** A top-level function's source, from its `function` to the brace closing it at the start of a line. */
function source(text, name) {
  const start = text.search(new RegExp(`^(export )?function ${name}\\(`, 'm'))
  if (start < 0) throw new Error(`no function ${name}`)
  const end = text.indexOf('\n}\n', start)
  return text.slice(start, end + 2).replace(/^export /, '')
}

// The atlas as justASimpleTree paints it, its canvas kept rather than wrapped in a texture.
const painters = [source(wood, 'mulberry32'), source(foliage, 'pointed'), source(foliage, 'cluster'), source(foliage, 'paintAtlas').replace('return new THREE.CanvasTexture(canvas)', 'return canvas')]
// The cluster's own call, from its LEAVES table.
const call = /'pointed cluster': \(ctx, random\) => (cluster\(ctx, random, pointed, [^)]*\))/.exec(foliage)?.[1]
const seed = /function paintLeaves\(name\) \{\s*return paintAtlas\((\d+), LEAVES\[name\]\)/.exec(foliage)?.[1]
if (!call || !seed) throw new Error('the pointed cluster or its seed moved in foliage.js')

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage()
const url = await page.evaluate(`(() => { ${painters.join('\n')}\n return paintAtlas(${seed}, (ctx, random) => ${call}).toDataURL('image/png') })()`)
await browser.close()

mkdirSync('public/textures/leaves', { recursive: true })
writeFileSync('public/textures/leaves/pointed-cluster.png', Buffer.from(url.split(',')[1], 'base64'))
console.log(`pointed cluster: ${call}, atlas seed ${seed}`)
