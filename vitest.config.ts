import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // 真实调用（计费）只走 npm run test:live；针对 dist/ 的端到端只走 npm run test:e2e
    exclude: ['test/live/**', 'test/e2e/**', '**/node_modules/**'],
  },
});
