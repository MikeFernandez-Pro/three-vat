import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The baker core is pure CPU math (no WebGL), so tests run in plain Node.
    // So does the release suite beside it: the packaging checks read the tree as
    // text, and the parity gate's comparator and verdict are pure — the half of
    // that gate which needs a GPU is a page a human opens (`pnpm parity`), never
    // a test. The release suite lives with the library because a release is what
    // this package cuts; it reaches into the demo, and the demo never reaches
    // back (ADR-0011 amendment).
    environment: 'node',
    include: ['src/**/*.test.ts', 'release/**/*.test.ts'],
  },
})
