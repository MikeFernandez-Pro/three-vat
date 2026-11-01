// The goose game's sound panel, a small one of its own at the screen's left edge: the mix's volume, and a folder for
// each sound (goosesounds.ts) with its volume, speed and pitch, if heard from a place how far off at full level and
// where silent, muted or not, played, looped and stopped, put back as
// saved; and in it a folder of its takes, each to hear alone and to keep or discard, a discarded take never played.
// Save writes the mix over src/goosesounds.json through the dev server (tools/goosesounds-plugin.ts), the mix the
// game starts from next load; with no dev server, a build, it downloads the file instead.
// Speed and pitch are one thing in Web Audio: a take played faster is higher, and pitched up is shorter.
// Beside it, on the dev server only, the takes panel: every take ElevenLabs gave for each title, as it came, to hear
// and to ban; saved, the sounds are made again without the banned (tools/goosesounds-plugin.ts, _sfx/build.py).
import { GOOSE_SOUNDS, savedTune, takesOf, type GooseSound, type GooseSounds } from './goosesounds'
import banned from './goosebans.json'
import { ALL_LAYERS, MUSIC_LAYERS, type GooseMusic } from './goosemusic'

/** How far down it starts, px: under the readouts. */
const TOP = 44

const STYLE = `
.sp { position: fixed; top: ${TOP}px; left: 0; z-index: 1000; width: 232px; max-height: calc(100vh - ${TOP + 60}px);
  overflow: auto; background: #15151bf0; color: #d8d8de; font: 11px/1.25 system-ui, sans-serif; border-radius: 0 6px 6px 0;
  box-shadow: 0 2px 10px #0008; user-select: none; scrollbar-width: thin }
.sp button { font: inherit; color: inherit; background: #2a2a33; border: 0; border-radius: 3px; padding: 1px 5px; cursor: pointer; line-height: 16px }
.sp button:hover { background: #3a3a46 }
.sp button.on { background: #7a3a3a }
.sp-head { position: sticky; top: 0; display: flex; gap: 3px; align-items: center; padding: 4px 5px; background: #1d1d25; z-index: 1 }
.sp-head b { flex: 1; cursor: pointer; font-weight: 600 }
.sp-note { color: #8fd08f; padding: 0 4px }
.sp-row { display: grid; grid-template-columns: 38px 1fr 34px; gap: 4px; align-items: center; padding: 1px 6px }
.sp-row input[type=range] { width: 100%; height: 12px; margin: 0; accent-color: #9a8cff }
.sp-row span:last-child { text-align: right; font-variant-numeric: tabular-nums; cursor: pointer }
.sp details { border-top: 1px solid #ffffff0d }
.sp summary { display: flex; gap: 3px; align-items: center; padding: 2px 5px; cursor: pointer; list-style: none }
.sp summary::-webkit-details-marker { display: none }
.sp summary::before { content: '▸'; width: 8px; color: #888 }
.sp details[open] > summary::before { content: '▾' }
.sp summary .sp-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.sp summary .sp-count { color: #888; font-variant-numeric: tabular-nums }
.sp .sp-body { padding: 2px 0 4px 8px }
.sp .sp-line { display: flex; gap: 3px; align-items: center; padding: 1px 6px }
.sp .sp-line label { flex: 1; display: flex; gap: 3px; align-items: center }
.sp .sp-take { display: flex; gap: 3px; align-items: center; padding: 1px 6px }
.sp .sp-take span { flex: 1 }
.sp .sp-take.out span { color: #777; text-decoration: line-through }
.sp.shut > :not(.sp-head) { display: none }
.sp.sp-takes { left: 236px; width: 200px }
`
/** The style, once for both panels. */
function styled() {
  if (document.getElementById('sp-style')) return
  const style = document.createElement('style')
  style.id = 'sp-style'
  style.textContent = STYLE
  document.head.append(style)
}

/** A button labelled `text`, doing `act`, its click kept from toggling a folder it sits in. */
function button(text: string, title: string, act: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.textContent = text
  b.title = title
  b.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    act()
  })
  return b
}

/** A slider row: its label, from `min` to `max`, reading and setting `get`/`set`; a double-click on its value puts back `home`. */
function slider(label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, home: () => number) {
  const row = document.createElement('div')
  row.className = 'sp-row'
  const name = document.createElement('span')
  name.textContent = label
  const input = document.createElement('input')
  Object.assign(input, { type: 'range', min: String(min), max: String(max), step: String(step) })
  const value = document.createElement('span')
  value.title = 'double-click: as saved'
  const show = () => {
    input.value = String(get())
    value.textContent = get().toFixed(step < 0.1 ? 2 : 1)
  }
  input.addEventListener('input', () => {
    set(Number(input.value))
    show()
  })
  value.addEventListener('dblclick', () => {
    set(home())
    show()
  })
  row.append(name, input, value)
  show()
  return { row, show }
}

export function mountSoundPanel(sounds: GooseSounds, music?: GooseMusic): void {
  styled()
  const panel = document.createElement('div')
  panel.className = 'sp shut'
  // The game's keys stay the game's: a slider keeps the arrows it is focused with.
  panel.addEventListener('keydown', (event) => event.target instanceof HTMLInputElement && event.stopPropagation())

  // Its head: the title, which shuts and opens it; save, put back as saved, stop all, mute all.
  const head = document.createElement('div')
  head.className = 'sp-head'
  const title = document.createElement('b')
  title.textContent = 'sounds'
  title.addEventListener('click', () => panel.classList.toggle('shut'))
  const note = document.createElement('span')
  note.className = 'sp-note'
  const told = (text: string) => {
    note.textContent = text
    setTimeout(() => note.textContent === text && (note.textContent = ''), 1800)
  }
  const mute = button('mute', 'mute all (M)', () => (sounds.muted = !sounds.muted))
  const shows: (() => void)[] = []
  const showAll = () => shows.forEach((show) => show())
  head.append(
    title,
    note,
    button('save', 'save the mix to src/goosesounds.json', () => void save(sounds, told)),
    button('⟲', 'put everything back as saved', () => {
      sounds.revert()
      showAll()
    }),
    button('■', 'stop all', () => GOOSE_SOUNDS.forEach((sound) => sounds.stop(sound))),
    mute,
  )
  // M mutes from the game too: the button follows.
  setInterval(() => mute.classList.toggle('on', sounds.muted), 250)
  const mix = slider('mix', 0, 2, 0.01, () => sounds.volume, (v) => (sounds.volume = v), () => 1)
  shows.push(mix.show)
  panel.append(head, mix.row)
  if (music) panel.append(musicFolder(music, shows))
  for (const sound of GOOSE_SOUNDS) panel.append(soundFolder(sounds, sound, shows))
  document.body.append(panel)
}

/**
 * The music's folder: its level, live only (tell its VOLUME in goosemusic.ts what it should be), and the top layer
 * heard, -1 as her goslings bring it.
 */
function musicFolder(music: GooseMusic, shows: (() => void)[]): HTMLDetailsElement {
  const folder = document.createElement('details')
  const line = document.createElement('summary')
  const name = document.createElement('span')
  name.className = 'sp-name'
  name.textContent = 'music'
  const count = document.createElement('span')
  count.className = 'sp-count'
  line.append(name, count)
  const body = document.createElement('div')
  body.className = 'sp-body'
  const home = music.volume
  const level = slider('volume', 0, 2, 0.01, () => music.volume, (v) => (music.volume = v), () => home)
  const layers = slider('layers', -1, ALL_LAYERS, 1, () => music.layers ?? -1, (v) => (music.layers = v < 0 ? undefined : v), () => -1)
  const said = () => (count.textContent = music.layers === undefined ? 'as found' : MUSIC_LAYERS[music.layers]!)
  layers.row.addEventListener('input', said)
  layers.row.addEventListener('dblclick', said)
  said()
  shows.push(level.show, layers.show)
  body.append(level.row, layers.row)
  folder.append(line, body)
  return folder
}

/** A sound's folder: in its line, play, stop and mute; in it, its tune and the folder of its takes. */
function soundFolder(sounds: GooseSounds, sound: GooseSound, shows: (() => void)[]): HTMLDetailsElement {
  const tune = sounds.tunes[sound]
  const folder = document.createElement('details')
  const line = document.createElement('summary')
  const name = document.createElement('span')
  name.className = 'sp-name'
  name.textContent = sound.replace(/_/g, ' ')
  const count = document.createElement('span')
  count.className = 'sp-count'
  const mute = button('M', 'mute this sound', () => {
    tune.muted = !tune.muted
    show()
  })
  line.append(name, count, button('▶', 'play', () => sounds.preview(sound)), button('■', 'stop', () => sounds.stop(sound)), mute)

  const body = document.createElement('div')
  body.className = 'sp-body'
  const saved = () => savedTune(sound)
  const rows = [
    slider('vol', 0, 3, 0.01, () => tune.volume, (v) => (tune.volume = v), () => saved().volume),
    slider('speed', 0.25, 3, 0.01, () => tune.speed, (v) => (tune.speed = v), () => saved().speed),
    slider('pitch', -24, 24, 0.1, () => tune.pitch, (v) => (tune.pitch = v), () => saved().pitch),
    // A sound heard from a place: how far off it is heard at full level, m, and where it falls silent, the one kept
    // a little short of the other.
    ...(tune.full === undefined
      ? []
      : [
          slider('full', 0, 60, 0.1, () => tune.full!, (v) => (tune.full = Math.min(v, tune.silent! - 0.5)), () => saved().full!),
          slider('silent', 0.5, 120, 0.5, () => tune.silent!, (v) => (tune.silent = Math.max(v, tune.full! + 0.5)), () => saved().silent!),
        ]),
  ]
  const loopLine = document.createElement('div')
  loopLine.className = 'sp-line'
  const loopLabel = document.createElement('label')
  const loop = document.createElement('input')
  loop.type = 'checkbox'
  loop.addEventListener('change', () => (tune.loop = loop.checked))
  loopLabel.append(loop, 'loop when played')
  loopLine.append(
    loopLabel,
    button('reset', 'this sound as saved', () => {
      sounds.stop(sound)
      Object.assign(tune, savedTune(sound))
      show()
    }),
  )

  // Its takes, each heard alone, kept or discarded.
  const takes = document.createElement('details')
  const takesLine = document.createElement('summary')
  const takesName = document.createElement('span')
  takesName.className = 'sp-name'
  takesLine.append(takesName)
  takes.append(takesLine)
  const names = takesOf(sound)
  const takeRows = names.map((k) => {
    const row = document.createElement('div')
    row.className = 'sp-take'
    const label = document.createElement('span')
    label.textContent = `take ${k}`
    const keep = button('', '', () => {
      tune.discarded = tune.discarded.includes(k) ? tune.discarded.filter((j) => j !== k) : [...tune.discarded, k]
      show()
    })
    row.append(label, button('▶', `play take ${k}`, () => sounds.preview(sound, k)), keep)
    takes.append(row)
    return { row, keep, k }
  })

  function show() {
    rows.forEach((r) => r.show())
    loop.checked = tune.loop
    mute.classList.toggle('on', tune.muted)
    const total = names.length
    const kept = names.filter((k) => !tune.discarded.includes(k)).length
    count.textContent = total > 1 ? `${kept}/${total}` : ''
    takesName.textContent = `takes (${kept} of ${total} kept)`
    takeRows.forEach(({ row, keep, k }) => {
      const out = tune.discarded.includes(k)
      row.classList.toggle('out', out)
      keep.textContent = out ? 'keep' : 'discard'
      keep.title = out ? 'play this take in the game again' : 'never play this take in the game'
    })
  }
  shows.push(show)
  body.append(...rows.map((r) => r.row), loopLine, takes)
  folder.append(line, body)
  show()
  return folder
}

/** The mix written over src/goosesounds.json by the dev server; with none, downloaded as that file. */
async function save(sounds: GooseSounds, told: (text: string) => void) {
  const json = JSON.stringify(sounds.mix(), null, 2) + '\n'
  const response = await fetch('/goose-sounds', { method: 'POST', body: json }).catch(() => undefined)
  if (response?.ok) return told('saved')
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  link.download = 'goosesounds.json'
  link.click()
  URL.revokeObjectURL(link.href)
  told('downloaded')
}


/** Each title ElevenLabs made takes for, by its name in _sfx/src, what was asked for, and its takes' numbers downloaded. */
const ALL = [1, 2, 3, 4]
const TITLES = [
  ['call', 'lost gosling peep', ALL],
  ['honk', 'startled honk', ALL],
  ['wings', 'wing flaps', ALL],
  ['hiss', 'angry hiss', ALL],
  ['query', 'soft questioning honk', ALL],
  ['mutter', 'soft muttering', ALL],
  ['steps', 'footsteps', ALL],
  ['paddle', 'swimming', ALL],
  ['rats', 'rat swarm', ALL],
  ['squeak', 'rat squeak', ALL],
  ['thunder', 'lightning strike', [2, 4]],
  ['ignite', 'torch catching fire', ALL],
  ['winch', 'well winch', [3]],
  ['padlock', 'padlock and cage door', [3]],
  ['moan', 'ghostly moan', [1, 2, 3]],
  ['chitter', 'rat chitter and scratch (1 #2, 2 #4, 3 the second #2)', [1, 2, 3]],
  ['fight', 'angry rat fighting', [1, 2, 4]],
] as const

/** The takes panel: each title's takes as ElevenLabs gave them, each played as it came and banned or let back. */
export function mountTakesPanel(): void {
  styled()
  const bans: Record<string, number[]> = structuredClone(banned as Record<string, number[]>)
  const panel = document.createElement('div')
  panel.className = 'sp sp-takes shut'
  const head = document.createElement('div')
  head.className = 'sp-head'
  const title = document.createElement('b')
  title.textContent = 'takes'
  title.title = 'every take ElevenLabs gave, as it came'
  title.addEventListener('click', () => panel.classList.toggle('shut'))
  const note = document.createElement('span')
  note.className = 'sp-note'
  // One take heard at a time.
  let heard: HTMLAudioElement | undefined
  const hear = (name: string) => {
    heard?.pause()
    heard = new Audio(`/goose-raw/${name}.wav`)
    void heard.play()
  }
  const save = button('save & rebuild', 'ban these takes and make the sounds again without them', async () => {
    note.textContent = 'building…'
    const response = await fetch('/goose-bans', { method: 'POST', body: JSON.stringify(bans, null, 2) }).catch(() => undefined)
    note.textContent = response ? await response.text() : 'no dev server'
  })
  head.append(title, note, save, button('■', 'stop', () => heard?.pause()))
  panel.append(head)
  for (const [name, asked, numbers] of TITLES) {
    const folder = document.createElement('details')
    const line = document.createElement('summary')
    const label = document.createElement('span')
    label.className = 'sp-name'
    label.textContent = name
    label.title = asked
    const count = document.createElement('span')
    count.className = 'sp-count'
    line.append(label, count)
    folder.append(line)
    const rows = numbers.map((k) => {
      const row = document.createElement('div')
      row.className = 'sp-take'
      const text = document.createElement('span')
      text.textContent = `#${k}`
      const ban = button('', '', () => {
        const now = bans[name] ?? []
        bans[name] = now.includes(k) ? now.filter((b) => b !== k) : [...now, k].sort()
        show()
      })
      row.append(text, button('▶', `play take #${k} as it came`, () => hear(`${name}_${k}`)), ban)
      folder.append(row)
      return { row, ban, k }
    })
    function show() {
      const out = bans[name] ?? []
      count.textContent = `${numbers.filter((k) => !out.includes(k)).length}/${numbers.length}`
      rows.forEach(({ row, ban, k }) => {
        row.classList.toggle('out', out.includes(k))
        ban.textContent = out.includes(k) ? 'unban' : 'ban'
        ban.classList.toggle('on', out.includes(k))
      })
    }
    show()
    panel.append(folder)
  }
  document.body.append(panel)
}
