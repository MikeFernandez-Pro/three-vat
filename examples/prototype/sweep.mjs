// PROTOTYPE — throwaway. `node examples/prototype/sweep.mjs [url]`
//
// Drives the page's own sweep in a real Chrome and prints the report to
// stdout, so a run can be piped into an issue comment instead of copied out of
// a textarea. The page is the same either way — this only clicks the button.
//
// Headed, and that is not an oversight: headless Chrome falls back to a
// software rasteriser often enough that a frame time off it means nothing.
// Start the dev server first (`pnpm --filter three-vat-example dev`).
import { chromium } from 'playwright-core'

const URL_ = process.argv[2] ?? 'http://localhost:5173/prototype/'
const browser = await chromium.launch({ channel: 'chrome', headless: false })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (error) => console.error('[pageerror]', error.message))

await page.goto(URL_, { waitUntil: 'load', timeout: 60_000 })
await page.waitForFunction(() => document.getElementById('status')?.textContent?.includes('ready'), null, {
  timeout: 180_000,
})
await page.click('#sweep')
await page.waitForFunction(() => document.getElementById('status')?.textContent?.startsWith('done'), null, {
  timeout: 300_000,
})
console.log(await page.$eval('#report', (e) => e.value))
await browser.close()
