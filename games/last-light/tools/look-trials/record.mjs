// Films each mood in src/goosethemes.ts on the goose page: at the spawn, the
// torch lit (F), a still, then a few metres forward (W), recorded off the
// canvas in the page (MediaRecorder) and turned into an MP4 and a small GIF.
//
//   node tools/look-trials/record.mjs [names...] [--walk 2.2]
//   node tools/look-trials/page.mjs                       (index.html)
import { execFileSync } from 'node:child_process'
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openGame } from '../page.mjs'
import { GOOSE_THEMES as THEMES } from '../../src/goosethemes.ts'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(name)
  return i < 0 ? fallback : args.splice(i, 2)[1]
}
/** How long she walks forward, s; how long the take holds still before and after. */
const walk = Number(flag('--walk', 2.2))
const hold = 0.6
/** How long the page settles after loading, ms: the rats come in round her lit torch, which she starts with. */
const SETTLE = 8000
const names = args.length ? args : Object.keys(THEMES)
const out = join(here, 'videos')
mkdirSync(out, { recursive: true })
const ffmpeg = (...a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a])

const game = await openGame('')
const { page } = game
try {
  for (const name of names) {
    const errors = game.errors.length
    console.log(`${name}: loading`)
    await page.goto(game.url(`?nopanel&theme=${name}#goose`))
    await page.waitForSelector('canvas', { timeout: 120_000 })
    // Only the scene: the readouts and the hints are the page's, not the look's.
    await page.addStyleTag({ content: 'body > :not(canvas) { visibility: hidden !important }' })
    await page.waitForTimeout(SETTLE)
    await page.screenshot({ path: join(out, `${name}.png`) })
    console.log(`${name}: recording`)
    const record = page.evaluate(async (seconds) => {
      const canvas = document.querySelector('canvas')
      const recorder = new MediaRecorder(canvas.captureStream(60), { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 24e6 })
      const chunks = []
      recorder.ondataavailable = (e) => chunks.push(e.data)
      const stopped = new Promise((resolve) => (recorder.onstop = resolve))
      recorder.start(500)
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
      recorder.stop()
      await stopped
      const blob = new Blob(chunks, { type: 'video/webm' })
      return new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.readAsDataURL(blob)
      })
    }, walk + 2 * hold)
    await page.waitForTimeout(hold * 1000)
    await page.keyboard.down('KeyW')
    await page.waitForTimeout(walk * 1000)
    await page.keyboard.up('KeyW')
    const dataUrl = await record
    const webm = join(out, `${name}.webm`)
    writeFileSync(webm, Buffer.from(dataUrl.split(',')[1], 'base64'))
    ffmpeg('-i', webm, '-vf', 'fps=60', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(out, `${name}.mp4`))
    ffmpeg('-i', webm, '-vf', 'fps=12,scale=400:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', join(out, `${name}.gif`))
    unlinkSync(webm)
    const fresh = game.errors.slice(errors)
    console.log(`${name}: done${fresh.length ? `, ${fresh.length} error(s): ${fresh[0].slice(0, 200)}` : ''}`)
  }
} finally {
  await game.close()
}
