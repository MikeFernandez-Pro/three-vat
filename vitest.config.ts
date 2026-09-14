import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The baker core is pure CPU math (no WebGL), so tests run in plain Node.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
