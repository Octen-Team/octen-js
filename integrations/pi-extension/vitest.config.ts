import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The host tests under test/host drive a real Pi install and run from their own script
    exclude: ['test/host/**', '**/node_modules/**'],
  },
});
