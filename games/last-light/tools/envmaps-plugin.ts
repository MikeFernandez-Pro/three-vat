// The environment maps three's own examples use, for the panel to try (src/envmaps.ts): the dev server
// serves `examples/textures` of the three.js checkout beside this repo at /envmaps/, and lists what in it
// can light a scene at /envmaps/index.json: each equirectangular image, and each cube folder with its six
// faces. Nothing is copied into the game, and nothing ships: a build, or a machine without the checkout,
// lists none.
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

/** Where three's example textures are: the three.js checkout three folders up, beside the three-vat one. */
const TEXTURES = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../three.js/examples/textures')

/** One map, as the page loads it: its name, how it is read, and its files under /envmaps/, a cube's in px nx py ny pz nz order. */
export interface EnvMapEntry {
  name: string
  kind: 'hdr' | 'ultrahdr' | 'image' | 'cube' | 'cubehdr'
  files: string[]
}

const TYPES: Record<string, string> = { '.hdr': 'application/octet-stream', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json' }

/** A cube folder's six faces, in three's order, under whichever naming the folder uses; none if it has no full set. */
function faces(files: string[]): string[] | undefined {
  const namings = [
    ['px', 'nx', 'py', 'ny', 'pz', 'nz'],
    ['posx', 'negx', 'posy', 'negy', 'posz', 'negz'],
  ]
  for (const naming of namings) {
    const found = naming.map((face) => files.find((file) => file.replace(extname(file), '').split(/[-_]/).pop() === face))
    if (found.every((file) => file !== undefined)) return found as string[]
  }
  return undefined
}

function list(): EnvMapEntry[] {
  if (!existsSync(TEXTURES)) return []
  const entries: EnvMapEntry[] = []
  for (const file of readdirSync(join(TEXTURES, 'equirectangular')).sort()) {
    const kind = file.endsWith('.hdr.jpg') ? 'ultrahdr' : file.endsWith('.hdr') ? 'hdr' : file.endsWith('.jpg') ? 'image' : undefined
    if (kind) entries.push({ name: file, kind, files: [`equirectangular/${file}`] })
  }
  for (const folder of readdirSync(join(TEXTURES, 'cube')).sort()) {
    const path = join(TEXTURES, 'cube', folder)
    if (!statSync(path).isDirectory()) continue
    const six = faces(readdirSync(path))
    if (six) entries.push({ name: `cube/${folder}`, kind: six[0]!.endsWith('.hdr') ? 'cubehdr' : 'cube', files: six.map((face) => `cube/${folder}/${face}`) })
  }
  return entries
}

export function envMaps(): Plugin {
  return {
    name: 'last-light-envmaps',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/envmaps', (request, response) => {
        const path = decodeURIComponent((request.url ?? '/').split('?')[0]!)
        if (path === '/index.json') {
          response.setHeader('Content-Type', TYPES['.json']!)
          response.end(JSON.stringify(list()))
          return
        }
        const file = resolve(TEXTURES, `.${path}`)
        if (!file.startsWith(TEXTURES + sep) || !existsSync(file) || !statSync(file).isFile()) {
          response.statusCode = 404
          response.end()
          return
        }
        response.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
        createReadStream(file).pipe(response)
      })
    },
  }
}
