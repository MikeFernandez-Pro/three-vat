import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

// The dev server behind `node release/parity/check.mjs`. It exists only so the
// gate's page can be opened in a real browser (parity/check.mjs); nothing here
// is ever built or deployed — the gate is a release step, not a page a stranger
// visits.
//
// The release suite's *tests* do not read this file: they run in the library's
// own vitest project at the repository root, because they are release checks and
// a release is what the root package cuts.
export default defineConfig({
  // Import the library through its public specifiers, exactly as a consumer
  // would, aliased to the TypeScript source — so the gate compares the two
  // decode paths as they stand in this tree, not as a stale `dist/` has them.
  // `dedupe` keeps a single copy of three across the alias.
  resolve: {
    alias: {
      'three-vat/webgl': here('../src/webgl.ts'),
      'three-vat/tsl': here('../src/tsl.ts'),
      'three-vat': here('../src/index.ts'),
    },
    dedupe: ['three'],
  },
  // The gate bakes the demo's robot, because the point is that the two paths
  // agree on the model a reader has actually seen. The demo owns the file; this
  // serves it from there rather than keeping a second copy, which is the same
  // one-way reach the imports make (ADR-0011 amendment).
  publicDir: here('../examples/public'),
})
