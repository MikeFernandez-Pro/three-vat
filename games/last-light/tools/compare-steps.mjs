// Run the CPU and GPU steps' comparison (compare-steps.ts) in headed Chrome,
// by hand, from games/last-light: `node tools/compare-steps.mjs`. COUNTS and
// SEEDS (comma lists) narrow it; it takes some minutes at 16,384 rats, most
// of them the CPU's. Files are not watched: an edit meanwhile does not restart it.
import { createServer } from 'vite'
import pw from '../../../node_modules/playwright-core/index.js'

const query = new URLSearchParams()
if (process.env.COUNTS) query.set('counts', process.env.COUNTS)
if (process.env.SEEDS) query.set('seeds', process.env.SEEDS)
const server = await createServer({ configFile: './vite.config.ts', root: process.cwd(), server: { port: 5198, watch: null } })
await server.listen()
// Headed, and never throttled as a covered window is.
const browser = await pw.chromium.launch({
  headless: false,
  channel: 'chrome',
  args: ['--enable-unsafe-webgpu', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
})
const page = await browser.newPage()
page.on('console', (message) => console.log(message.text()))
page.on('pageerror', (error) => console.error(String(error)))
try {
  await page.goto(`http://localhost:5198/tools/compare-steps.html?${query}`)
  await page.waitForFunction(() => window.done !== undefined, null, { timeout: 0, polling: 1000 })
} finally {
  await browser.close()
  await server.close()
}
