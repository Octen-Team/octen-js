import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Real calls (billed) run only via npm run test:live; end-to-end tests against dist/ run only via npm run test:e2e
    exclude: ['test/live/**', 'test/e2e/**', '**/node_modules/**'],
  },
});
