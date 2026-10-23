// PROTOTYPE (throwaway): inlines the swarm twice into flow-field.html, as it is
// and with its straight line at the holder swapped for the page's flow field.
// Run from anywhere: node games/last-light/prototype/flow-field.build.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '..', 'src')
const require = createRequire(createRequire(join(here, '..', 'package.json')).resolve('vite'))
const esbuild = require('esbuild')

/** Replace `from` in `text` once, or fail: the swarm moved on and the patch needs redoing. */
const once = (text, from, to) => {
  const at = text.indexOf(from)
  if (at < 0 || text.indexOf(from, at + 1) >= 0) throw new Error(`patch point not found once: ${from}`)
  return text.replace(from, () => to)
}

let swarm = readFileSync(join(src, 'swarm.ts'), 'utf8')
swarm = once(
  swarm,
  `      const ix = hx / H
      const iz = hz / H`,
  `      let ix = hx / H
      let iz = hz / H
      // PROTOTYPE: out of the light's clear sight, the way to it is the page's flow field, and so is how far it is.
      let P = H
      const FLOW = (globalThis as any).FLOW
      if (FLOW && FLOW.at(x, z)) {
        ix = FLOW.dx
        iz = FLOW.dz
        P = FLOW.d
      }`,
)
swarm = once(swarm, `} else if (H > notice) {`, `} else if (P > notice) {`)

const bundle = async (contents, name) => {
  const out = await esbuild.build({
    stdin: { contents, resolveDir: src, sourcefile: `${name}.ts`, loader: 'ts' },
    bundle: true,
    format: 'iife',
    globalName: name,
    target: 'es2020',
    write: false,
    logLevel: 'warning',
  })
  return out.outputFiles[0].text
}

const current = await bundle(`export * from './swarm'\nexport { gameTuning } from './gameplay'\nexport { WALL_THICKNESS } from './walls'`, 'Current')
const flow = await bundle(swarm, 'Flow')
const page = readFileSync(join(here, 'flow-field.src.html'), 'utf8')
  .replace('/*@@CURRENT@@*/', () => current)
  .replace('/*@@FLOW@@*/', () => flow)
writeFileSync(join(here, 'flow-field.html'), page)
console.log('wrote prototype/flow-field.html')
