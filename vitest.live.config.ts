import { defineConfig } from 'vitest/config';

// Live-call tests: run only via `npm run test:live`; plain `npm test` already excludes test/live in vitest.config.ts
export default defineConfig({
  test: {
    include: ['test/live/**/*.live.test.ts'],
    testTimeout: 60_000,
    // Print each result and elapsed time so it is easy to verify nothing was skipped
    reporters: ['verbose'],
  },
});
