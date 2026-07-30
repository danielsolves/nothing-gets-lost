// vitest.load.config.ts
// The soak run, on demand: `npx vitest run --config vitest.load.config.ts`.
// It needs its own config because the default one excludes test/load, and an
// exclude wins over a path filter — so `vitest run test/load` alone finds nothing.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/load/**/*.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 180_000,
  },
});
