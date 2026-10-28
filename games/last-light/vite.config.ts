// `vitest/config` re-exports vite's `defineConfig` with the `test` block typed,
// so one config serves the dev server, the build and the swarm's tests.
import { defineConfig } from 'vitest/config'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { envMaps } from './tools/envmaps-plugin'
import { gooseRoute } from './tools/gooseroute-plugin'
import { gooseSounds } from './tools/goosesounds-plugin'

// Outside the workspace (ADR-0044): `three-vat` is a link to the repo root, so
// it means the library's last local build, dist/, and never its source.
export default defineConfig(({ mode }) => ({
  base: './',
  // `pnpm --dir games/last-light phone`: served over https to the network with a self-signed
  // certificate, since a phone gets WebGPU only in a secure context, and a
  // LAN address over http is not one. The browser warns once. Cast: vitest 2
  // types this config against vite 5, the plugin is typed against vite 7.
  // The dev server also serves three's example environment maps to the panel (tools/envmaps-plugin.ts), and saves
  // the goose game's route from its 2D page (tools/gooseroute-plugin.ts) and its sound mix from the sound panel
  // (tools/goosesounds-plugin.ts).
  plugins: [envMaps() as never, gooseRoute() as never, gooseSounds() as never, ...(mode === 'phone' ? [basicSsl() as never] : [])],
  // Another project's dev server holds 5173 on this machine, and vite answers
  // any path with its index: a game moved to 5174 looked like the other page.
  // One port, and a refusal to start rather than a quiet move to the next.
  server: { port: 4321, strictPort: true },
  resolve: {
    // dist/ sits under the repo root and would find the root's own three; one
    // copy, this folder's, or the decode's nodes and the scene's disagree.
    dedupe: ['three'],
  },
  build: {
    // Top-level await in the entry: the renderer and the rat are awaited.
    target: 'es2022',
    // three's WebGPU build alone is most of a megabyte. Known, and not a
    // warning worth reading on every build.
    chunkSizeWarningLimit: 2048,
  },
  test: {
    // The swarm has no renderer and no DOM: it runs in plain Node.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}))
