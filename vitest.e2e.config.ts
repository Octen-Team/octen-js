import { defineConfig } from 'vitest/config';

// End-to-end tests against the dist/ build output: run only via npm run test:e2e (build first); not part of the default npm test
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e.test.ts'],
    testTimeout: 30_000,
    reporters: ['verbose'],
  },
});
