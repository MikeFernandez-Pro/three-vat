// PROTOTYPE — throwaway. Answers one question (see README.md here), then dies.
//
// Its own vite root rather than a page in `examples/`: every `*.html` beside
// the demo is a demo (examples/pages.mjs globs the folder), so a prototype page
// dropped there would join the release build and the guards on it. Same reason
// `release/parity/index.html` lives outside that folder.
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  root: here('.'),
  // The demo's RobotExpressive.glb, borrowed rather than copied.
  publicDir: here('../examples/public'),
  resolve: {
    alias: {
      // The library, through its public specifiers, aliased to source — exactly
      // as examples/vite.config.ts does it.
      'three-vat/webgl': here('../src/webgl.ts'),
      'three-vat': here('../src/index.ts'),
      // Vendored by hand into ./vendor (see README.md here): the pnpm store in
      // this workspace refuses to add to node_modules without a full recreate,
      // and a throwaway must not ask for that.
      '@three.ez/instanced-mesh': here('vendor/instanced-mesh/build/index.js'),
      'bvh.js': here('vendor/bvh.js/build/index.js'),
    },
    dedupe: ['three'],
  },
  server: { fs: { allow: [here('..')] } },
})
