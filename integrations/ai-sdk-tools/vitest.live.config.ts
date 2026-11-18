import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/live/**/*.test.ts'],
    setupFiles: ['test/live/setup.ts'],
    // Production calls can be slow; each test also sets its own timeout.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Sequential, so the request count stays predictable.
    fileParallelism: false,
  },
});
