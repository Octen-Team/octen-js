import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // 真实调用（计费）只走 npm run test:live
    exclude: ['test/live/**', '**/node_modules/**'],
  },
});
