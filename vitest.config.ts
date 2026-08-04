// vitest.config.ts
// The default run is the one a contributor waits for, so the soak test is not in
// it: 5,000 events take over a minute. CI runs it as its own job (see ci.yml), and
// anyone can run it on demand with `npx vitest run test/load`.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'test/load/**'],
  },
});
