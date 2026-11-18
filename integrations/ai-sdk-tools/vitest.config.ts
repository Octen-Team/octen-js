import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Billed live calls and the model matrix run only through their own scripts
    exclude: ['test/live/**', 'test/matrix/**', '**/node_modules/**'],
  },
});
