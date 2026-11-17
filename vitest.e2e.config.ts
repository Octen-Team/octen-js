import { defineConfig } from 'vitest/config';

// 针对构建产物 dist/ 的端到端测试：只通过 npm run test:e2e 运行（需先 npm run build），不进默认 npm test
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e.test.ts'],
    testTimeout: 30_000,
    reporters: ['verbose'],
  },
});
