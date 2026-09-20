// PROTOTYPE — throwaway. Runs the page headlessly and prints the one number
// that settles the question, per mode, from two camera angles.
//
// Launch recipe lifted from release/hero/capture.mjs (swiftshader, channel
// fallback) — it is already known to render this project's WebGL in CI.
import { chromium } from 'playwright-core'

const URL = process.argv[2] ?? 'http://localhost:5199/'
const CHANNELS = ['chrome', 'msedge', 'chromium']

async function launch() {
  const tried = []
  for (const channel of CHANNELS) {
    try {
      return await chromium.launch({
        channel: channel === 'chromium' ? undefined : channel,
        args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
      })
    } catch (error) {
      tried.push(`${channel}: ${String(error).split('\n')[0]}`)
    }
  }
  throw new Error(`no browser\n${tried.join('\n')}`)
}

const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } })
page.on('console', (m) => {
  if (m.type() === 'error') console.log('  [page error]', m.text())
})
page.on('pageerror', (e) => console.log('  [page throw]', String(e).split('\n')[0]))

await page.goto(URL, { waitUntil: 'load' })
await page.waitForFunction(() => globalThis.__probe !== undefined, null, { timeout: 60_000 })

for (const mode of ['plain', 'ez-culled', 'ez-unculled']) {
  await page.click(`#modes button[data-mode="${mode}"]`)

  for (const view of ['front', 'turned']) {
    if (view === 'turned') {
      // Orbit the camera so a good part of the crowd leaves the frustum.
      await page.mouse.move(550, 350)
      await page.mouse.down()
      await page.mouse.move(880, 300, { steps: 12 })
      await page.mouse.up()
    }
    // Let the render loop run: culling happens in onBeforeRender.
    await page.waitForTimeout(600)
    const probe = await page.evaluate(() => globalThis.__probe())
    console.log(`\n--- ${mode} / ${view} ---`)
    console.log(JSON.stringify(probe, null, 1))
    await page.screenshot({ path: `shot-${mode}-${view}.png` })
  }
  await page.reload({ waitUntil: 'load' })
  await page.waitForFunction(() => globalThis.__probe !== undefined, null, { timeout: 60_000 })
}

await browser.close()
