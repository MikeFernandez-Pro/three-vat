// The goose game's sound mix, saved from its sound panel (src/soundpanel.ts): the dev server takes the mix the page
// posts to /goose-sounds and writes it over src/goosesounds.json, which the game's sounds start from
// (src/goosesounds.ts), so a saved mix is the one heard on the next load; saving reloads nothing, the page already
// playing the mix it saved. Nothing ships: a build has no such address, and the panel downloads the file instead.
// For the takes panel, it also serves the ElevenLabs takes as they came (_sfx/src, at /goose-raw/), and takes the takes
// banned it posts to /goose-bans: written over src/goosebans.json, and the sounds made again from what is left by
// _sfx/build.py, whose new src/goosetakes.json reloads the page.
import { execFile } from 'node:child_process'
import { createReadStream, existsSync, writeFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const FILE = resolve(HERE, '../src/goosesounds.json')
const BANS = resolve(HERE, '../src/goosebans.json')
const SFX = resolve(HERE, '../_sfx')

/** Whether `mix` has the mix's shape: a volume, and for each sound by name its volume, speed and pitch, muted or not, and the takes it leaves out. */
function isMix(mix: unknown): boolean {
  if (typeof mix !== 'object' || mix === null) return false
  const { volume, sounds } = mix as { volume: unknown; sounds: unknown }
  if (!Number.isFinite(volume) || typeof sounds !== 'object' || sounds === null) return false
  return Object.values(sounds).every((tune: unknown) => {
    if (typeof tune !== 'object' || tune === null) return false
    const { volume, speed, pitch, muted, discarded } = tune as Record<string, unknown>
    return [volume, speed, pitch].every(Number.isFinite) && typeof muted === 'boolean' && Array.isArray(discarded) && discarded.every((take) => typeof take === 'string')
  })
}

/** Whether `bans` has the bans' shape: for each title, the numbers of its takes banned. */
const isBans = (bans: unknown) =>
  typeof bans === 'object' && bans !== null && Object.values(bans).every((takes) => Array.isArray(takes) && takes.every(Number.isInteger))

/** The body of a POST, read whole and parsed as JSON; undefined if it is not JSON. */
function posted(request: IncomingMessage, then: (body: unknown) => void) {
  let body = ''
  request.setEncoding('utf8')
  request.on('data', (chunk: string) => (body += chunk))
  request.on('end', () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      parsed = undefined
    }
    then(parsed)
  })
}

export function gooseSounds(): Plugin {
  return {
    name: 'last-light-goose-sounds',
    apply: 'serve',
    handleHotUpdate({ file }) {
      if (resolve(file) === FILE) return []
    },
    configureServer(server) {
      server.middlewares.use('/goose-sounds', (request, response) => {
        if (request.method !== 'POST') {
          response.statusCode = 405
          response.end()
          return
        }
        posted(request, (mix) => {
          if (!isMix(mix)) {
            response.statusCode = 400
            response.end('not a sound mix')
            return
          }
          writeFileSync(FILE, JSON.stringify(mix, null, 2) + '\n')
          response.end('saved')
        })
      })
      // A take as ElevenLabs gave it, by its name in _sfx/src: 'honk_2.wav'.
      server.middlewares.use('/goose-raw', (request, response) => {
        const name = /^\/([a-z]+_\d)\.wav$/.exec(request.url ?? '')?.[1]
        const path = name && resolve(SFX, 'src', `${name}.wav`)
        if (!path || !existsSync(path)) {
          response.statusCode = 404
          response.end()
          return
        }
        response.setHeader('Content-Type', 'audio/wav')
        createReadStream(path).pipe(response)
      })
      server.middlewares.use('/goose-bans', (request, response) => {
        if (request.method !== 'POST') {
          response.statusCode = 405
          response.end()
          return
        }
        posted(request, (bans) => {
          if (!isBans(bans)) {
            response.statusCode = 400
            response.end('not bans')
            return
          }
          writeFileSync(BANS, JSON.stringify(bans, null, 2) + '\n')
          if (!existsSync(resolve(SFX, 'build.py'))) return void response.end('saved; no _sfx/build.py to make the sounds again')
          execFile('python', ['build.py'], { cwd: SFX }, (error, _stdout, stderr) => {
            if (error) {
              response.statusCode = 500
              response.end(`saved, but the build failed: ${stderr.trim().split('\n').pop()}`)
              return
            }
            response.end('rebuilt')
          })
        })
      })
    },
  }
}
