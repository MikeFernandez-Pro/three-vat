// The game's pages in headed Chrome, for a probe, a bench or a load check:
// one place for the dev server, the browser and its switches, which every
// throwaway driver was writing again, each on its own guess at the port.
//
//   node tools/page.mjs '#goose'            load it, wait, print the errors
//   node tools/page.mjs sewers-3d.html 15000
//
// From a script: `const game = await openGame('#goose')`, then `game.page`,
// `game.errors`, `game.url('other.html')`, and `await game.close()`.
// Plain JavaScript, so a script runs it under bare `node`. Like the game's own
// dev server it reads the library's last build, dist/, and the baked rat in
// public/models/; it builds and bakes neither.
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'vite'
import { launchChrome } from '../../../release/browser.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// A window behind another throttles to a frame a second, and a bench then
// reads 1 fps: the renderer runs as if in front.
const SWITCHES = ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding']

/**
 * The page at `path` under a dev server of its own, off the game's 4321, so a
 * server already up there, or a second driver, is no matter.
 *
 * @param {string} [path] A page and its query or hash, `#goose`, `sewers-3d.html?x=1`.
 * @param {{ width: number, height: number }} [viewport]
 */
export async function openGame(path = '', viewport = { width: 1280, height: 720 }) {
  const server = await createServer({
    root,
    configFile: resolve(root, 'vite.config.ts'),
    logLevel: 'error',
    server: { port: 4400, strictPort: false, open: false },
  })
  await server.listen()
  const base = server.resolvedUrls.local[0]
  const url = (to) => new URL(to, base).href
  const browser = await launchChrome(['chrome', 'msedge', 'chromium'], SWITCHES)
  const page = await browser.newPage({ viewport })
  const errors = []
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.goto(url(path))
  return {
    page,
    errors,
    url,
    async close() {
      await browser.close()
      await server.close()
    },
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , path = '', wait = '8000'] = process.argv
  const game = await openGame(path)
  await game.page.waitForTimeout(Number(wait))
  await game.close()
  console.log(`${game.url(path)}: ${game.errors.length} error(s)`)
  for (const error of game.errors) console.log(`  ${error.slice(0, 400)}`)
  process.exitCode = game.errors.length ? 1 : 0
}
