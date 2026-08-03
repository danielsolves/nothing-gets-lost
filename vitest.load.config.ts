// vitest.load.config.ts
// The soak run, on demand: `npx vitest run --config vitest.load.config.ts`.
// It needs its own config because the default one excludes test/load, and an
// exclude wins over a path filter — so `vitest run test/load` alone finds nothing.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/load/**/*.test.ts'],
    // A soak run is allowed to be slow: 10,000 events times four targets is
    // 40,000 deliveries, each one a real round trip to a real Postgres. The
    // measured duration is written into docs/load-test-result.txt.
    testTimeout: 2_400_000,
    hookTimeout: 300_000,
  },
});
