// Writes index.html: the filmed moods side by side, each its still at the spawn
// and its GIF a few metres on, with its note and what it changes. A click on a
// card plays its MP4 large; the heart keeps a pick (in the browser), and the
// header copies the picks. Opens straight from disk, no server.
//
//   node tools/look-trials/page.mjs
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GOOSE_THEMES } from '../../src/goosethemes.ts'

const here = dirname(fileURLToPath(import.meta.url))
const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const hex = (v) => `#${v.toString(16).padStart(6, '0')}`
const COLOUR = /color|colour|sky|ground|rim|eyes|lamp|body|core|hot|cold/i
/** One line a group: its values, a swatch before each colour. */
const flat = (value, key = '') =>
  typeof value === 'number' && COLOUR.test(key) && Number.isInteger(value) && value > 255
    ? `<i style="background:${hex(value)}"></i>${hex(value)}`
    : Array.isArray(value)
      ? value.map((v) => flat(v.tint ?? v, 'color')).join(' ')
      : value && typeof value === 'object'
        ? Object.entries(value).map(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? `${k} {${flat(v, k)}}` : `${k} ${flat(v, k)}`)).join(', ')
        : escape(value)
const params = (theme) => {
  const groups = { ...theme.look, ...(theme.eyes === undefined ? {} : { eyes: { color: theme.eyes } }), ...(theme.fireLamp === undefined ? {} : { fires: { lamp: theme.fireLamp } }) }
  const lines = Object.entries(groups).map(([group, value]) => `<div><b>${group}</b> ${flat(value, group)}</div>`)
  return lines.join('') || '<div>nothing: the page as it is</div>'
}

const cards = Object.entries(GOOSE_THEMES)
  .filter(([name]) => existsSync(join(here, 'videos', `${name}.mp4`)))
  .map(
    ([name, t]) => `
    <figure data-name="${escape(name)}">
      <div class="shots" data-video="videos/${name}.mp4">
        <img src="videos/${name}.png" alt="${escape(t.title)} at the spawn" loading="lazy" />
        <img src="videos/${name}.gif" alt="${escape(t.title)} walking" loading="lazy" />
      </div>
      <figcaption>
        <h2>${escape(name.slice(0, 2))} · ${escape(t.title)}<button class="pick" title="pick">♡</button></h2>
        <p>${escape(t.note)}</p>
        <details><summary>what it changes</summary><div class="params">${params(t)}</div></details>
        <code>#goose?theme=${escape(name)}</code>
      </figcaption>
    </figure>`,
  )
  .join('')

writeFileSync(
  join(here, 'index.html'),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Last Light: goose looks</title>
<style>
  body { margin: 0; background: #0b0b0c; color: #ddd; font: 14px system-ui, sans-serif; }
  header { position: sticky; top: 0; z-index: 2; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; padding: 10px 16px; background: #0b0b0ce6; border-bottom: 1px solid #222; }
  header h1 { font-size: 16px; margin: 0 12px 0 0; }
  button, select { background: #222; color: #ddd; border: 1px solid #333; border-radius: 6px; padding: 5px 10px; font: inherit; cursor: pointer; }
  main { display: grid; grid-template-columns: repeat(var(--cols, 2), 1fr); gap: 14px; padding: 14px; }
  body.only-picks figure:not(.picked) { display: none; }
  body.stills .shots img:last-child, body.gifs .shots img:first-child { display: none; }
  body.stills .shots, body.gifs .shots { grid-template-columns: 1fr; }
  figure { margin: 0; background: #131315; border-radius: 10px; overflow: hidden; outline: 2px solid transparent; }
  figure.picked { outline-color: #f2c46d; }
  .shots { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; cursor: zoom-in; background: #000; }
  .shots img { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; }
  figcaption { padding: 10px 12px 12px; }
  h2 { display: flex; justify-content: space-between; align-items: center; font-size: 15px; margin: 0 0 4px; color: #f2c46d; }
  .pick { border: 0; background: none; font-size: 20px; padding: 0 4px; color: #f2c46d; }
  p { margin: 0 0 8px; line-height: 1.4; }
  details summary { cursor: pointer; color: #888; font-size: 12px; }
  .params { margin-top: 6px; font: 11px ui-monospace, monospace; color: #999; line-height: 1.5; }
  .params b { color: #bbb; font-weight: 600; }
  .params i { display: inline-block; width: 9px; height: 9px; margin-right: 3px; border-radius: 2px; vertical-align: -1px; }
  code { display: inline-block; margin-top: 6px; font-size: 11px; color: #7fb6ff; }
  .zoom { position: fixed; inset: 0; z-index: 5; display: grid; place-items: center; background: #000e; cursor: zoom-out; }
  .zoom video { width: min(96vw, 170vh); }
</style>
</head>
<body>
<header>
  <h1>Last Light: goose looks</h1>
  <label>show <select id="show"><option value="both">still + gif</option><option value="stills">stills</option><option value="gifs">gifs</option></select></label>
  <label>columns <select id="cols"><option>1</option><option selected>2</option><option>3</option><option>4</option></select></label>
  <label><input type="checkbox" id="only" /> picks only</label>
  <button id="copy">Copy my picks</button>
  <span style="opacity:.6">click a card: its video, large · ♡: pick · live: pnpm --dir games/last-light dev, then /?theme=…#goose</span>
</header>
<main>${cards}
</main>
<script>
  const KEY = 'last-light.goose-look-picks'
  const picks = new Set(JSON.parse(localStorage.getItem(KEY) || '[]'))
  const figures = [...document.querySelectorAll('figure')]
  const paint = () => figures.forEach((f) => {
    const on = picks.has(f.dataset.name)
    f.classList.toggle('picked', on)
    f.querySelector('.pick').textContent = on ? '♥' : '♡'
  })
  figures.forEach((f) => (f.querySelector('.pick').onclick = () => {
    picks.has(f.dataset.name) ? picks.delete(f.dataset.name) : picks.add(f.dataset.name)
    localStorage.setItem(KEY, JSON.stringify([...picks]))
    paint()
  }))
  paint()
  document.getElementById('show').onchange = (e) => (document.body.className = document.body.className.replace(/\\b(both|stills|gifs)\\b/g, '').trim() + ' ' + e.target.value)
  document.getElementById('cols').onchange = (e) => document.querySelector('main').style.setProperty('--cols', e.target.value)
  document.getElementById('only').onchange = (e) => document.body.classList.toggle('only-picks', e.target.checked)
  document.getElementById('copy').onclick = () => navigator.clipboard.writeText([...picks].sort().join(', ') || '(none)')
  document.querySelectorAll('.shots').forEach((shots) => (shots.onclick = () => {
    const zoom = document.createElement('div')
    zoom.className = 'zoom'
    const video = Object.assign(document.createElement('video'), { src: shots.dataset.video, muted: true, loop: true, autoplay: true, playsInline: true })
    zoom.append(video)
    zoom.onclick = () => zoom.remove()
    document.body.append(zoom)
  }))
</script>
</body>
</html>
`,
)
console.log('index.html written')
