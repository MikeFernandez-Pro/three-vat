// `vitest/config` re-exports vite's `defineConfig` with the `test` block typed,
// so one config serves the dev server, the build and the swarm's tests.
import { defineConfig } from 'vitest/config'

// Outside the workspace (ADR-0044): `three-vat` is a link to the repo root, so
// it means the library's last local build, dist/, and never its source.
export default defineConfig({
  base: './',
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
})
