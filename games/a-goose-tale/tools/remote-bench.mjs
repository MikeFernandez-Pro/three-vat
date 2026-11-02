// The built game for a phone that isn't on this network: `npx vite build`, then
// `node tools/remote-bench.mjs`, then `cloudflared tunnel --url http://localhost:4330`
// for an https address to send. Unlike the dev server, which can write the route
// and the sounds, this serves dist/ and takes the bench's rows, and nothing else,
// so it can face the internet while the tunnel is up. The rows go to
// _phone/remote-<day>.jsonl, one line of JSON a row, as `?bench` posts them.
import { createReadStream, appendFileSync, mkdirSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const logs = resolve(root, '_phone')
const PORT = 4330
/** The most a row can be, bytes: a row is small, and anyone with the address can post. */
const ROW_LIMIT = 64 * 1024
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ktx2': 'image/ktx2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

function keepRow(request, response) {
  let body = ''
  let tooLong = false
  request.setEncoding('utf8')
  request.on('data', (chunk) => {
    body += chunk
    if (body.length > ROW_LIMIT) {
      tooLong = true
      body = ''
    }
  })
  request.on('end', () => {
    try {
      if (tooLong) throw new Error('too long')
      const parsed = JSON.parse(body)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not a row')
      const at = new Date().toISOString()
      mkdirSync(logs, { recursive: true })
      appendFileSync(resolve(logs, `remote-${at.slice(0, 10)}.jsonl`), `${JSON.stringify({ at, ...parsed })}\n`)
      response.end('kept')
    } catch {
      response.statusCode = 400
      response.end('not a row')
    }
  })
}

function sendFile(pathname, request, response) {
  const decoded = decodeURIComponent(pathname)
  const asked = resolve(dist, `.${decoded.endsWith('/') ? `${decoded}index.html` : decoded}`)
  const stat = (asked === dist || asked.startsWith(dist + sep)) && statSync(asked, { throwIfNoEntry: false })
  if (!stat || !stat.isFile()) {
    response.statusCode = 404
    response.end('not found')
    return
  }
  response.setHeader('Content-Type', TYPES[extname(asked).toLowerCase()] ?? 'application/octet-stream')
  response.setHeader('Content-Length', stat.size)
  // Each load a cold one, for the load's time to be read.
  response.setHeader('Cache-Control', 'no-store')
  if (request.method === 'HEAD') response.end()
  else createReadStream(asked).pipe(response)
}

createServer((request, response) => {
  try {
    const { pathname } = new URL(request.url ?? '/', 'http://localhost')
    if (request.method === 'POST' && pathname === '/phone-log') keepRow(request, response)
    else if (request.method === 'GET' || request.method === 'HEAD') sendFile(pathname, request, response)
    else {
      response.statusCode = 405
      response.end()
    }
  } catch {
    response.statusCode = 400
    response.end()
  }
}).listen(PORT, 'localhost', () => console.log(`dist/ on http://localhost:${PORT}, rows to _phone/`))
