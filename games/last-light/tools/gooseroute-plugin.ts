// The goose game's route, saved from its 2D page (goose2d.html): the dev
// server takes the route the page posts to /goose-route and writes it over
// src/gooseroute.json, which both the 2D page and `#goose` read, so a saved
// route is the one the 3D page plays on its next load. Nothing ships: a build
// has no such address.
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const FILE = resolve(fileURLToPath(new URL('.', import.meta.url)), '../src/gooseroute.json')

/** Whether `route` has the route's shape: a start, a list of braziers, each a point with a reach and, if it has one, a gosling, a pond, and, if laid by hand, the road's points. */
function isRoute(route: unknown): boolean {
  const point = (p: unknown) => typeof p === 'object' && p !== null && Number.isFinite((p as { x: unknown }).x) && Number.isFinite((p as { z: unknown }).z)
  if (typeof route !== 'object' || route === null) return false
  const { start, braziers, pond, road } = route as { start: unknown; braziers: unknown; pond: unknown; road?: unknown }
  return point(start) && point(pond) && (road === undefined || (Array.isArray(road) && road.every(point))) && Array.isArray(braziers) && braziers.every((b) => point(b) && ((b as { gosling?: unknown }).gosling === undefined || point((b as { gosling: unknown }).gosling)) && Number.isFinite((b as { reach: unknown }).reach))
}

export function gooseRoute(): Plugin {
  return {
    name: 'last-light-goose-route',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/goose-route', (request, response) => {
        if (request.method !== 'POST') {
          response.statusCode = 405
          response.end()
          return
        }
        let body = ''
        request.setEncoding('utf8')
        request.on('data', (chunk: string) => (body += chunk))
        request.on('end', () => {
          let route: unknown
          try {
            route = JSON.parse(body)
          } catch {
            route = undefined
          }
          if (!isRoute(route)) {
            response.statusCode = 400
            response.end('not a route')
            return
          }
          writeFileSync(FILE, JSON.stringify(route, null, 2) + '\n')
          response.end('saved')
        })
      })
    },
  }
}
