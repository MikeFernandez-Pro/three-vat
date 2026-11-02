// What a phone measures, kept on this machine: the dev server takes each row
// the page's `?bench` posts to /phone-log (src/phonebench.ts) and adds it to a
// file of the day's in _phone/, one line of JSON a row, as it comes, so a phone
// that kills the tab loses only the row it was on. Nothing ships: a build has
// no such address.
import { appendFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '../_phone')

export function phoneLog(): Plugin {
  return {
    name: 'a-goose-tale-phone-log',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/phone-log', (request, response) => {
        if (request.method !== 'POST') {
          response.statusCode = 405
          response.end()
          return
        }
        let body = ''
        request.setEncoding('utf8')
        request.on('data', (chunk: string) => (body += chunk))
        request.on('end', () => {
          try {
            const row = JSON.stringify({ at: new Date().toISOString(), ...(JSON.parse(body) as object) })
            mkdirSync(DIR, { recursive: true })
            appendFileSync(resolve(DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`), `${row}\n`)
            response.end('kept')
          } catch {
            response.statusCode = 400
            response.end('not a row')
          }
        })
      })
    },
  }
}
