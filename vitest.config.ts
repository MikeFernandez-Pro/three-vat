import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The baker core is pure CPU math (no WebGL), so tests run in plain Node.
    // So does the release suite beside it: the packaging checks read the tree as
    // text, and the parity gate's comparator and verdict are pure — the half of
    // that gate which needs a GPU is a page a human opens (it is run with
    // `node release/parity/check.mjs`), never a test. The release suite lives
    // with the library because a release is what this package cuts; it reaches
    // into the demo, and the demo never reaches back (ADR-0011 amendment).
    //
    // `scripts/` is here for the same reason and was missing for too long: the
    // publish command runs once per version, by hand, so the run that would
    // catch a bug in it is the run that needed it to work. Its pure half is
    // pinned like the gate's is.
    environment: 'node',
    include: ['src/**/*.test.ts', 'release/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
})
