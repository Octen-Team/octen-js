import { defineConfig } from 'vitest/config';

// 真实调用测试：只通过 `npm run test:live` 运行，普通 `npm test` 已在 vitest.config.ts 里排除 test/live
export default defineConfig({
  test: {
    include: ['test/live/**/*.live.test.ts'],
    testTimeout: 60_000,
    // 逐条输出结论与耗时，便于核对没有 SKIP
    reporters: ['verbose'],
  },
});
