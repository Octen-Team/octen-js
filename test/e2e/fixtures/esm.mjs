// 装包后的 ESM 消费者：默认导出 / 具名导出 / 真实请求 / 与 CJS 副本并存时 isOctenError 仍可用
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Octen, { Octen as Named, OctenValidationError, isOctenError } from '@octen.ai/sdk';

assert.equal(Octen, Named, 'default export and named export must be the same class');

const baseURL = process.env.OCTEN_FAKE_BASE_URL;
const client = new Octen({ apiKey: 'fake-e2e-key', baseURL, maxRetries: 0 });
const res = await client.search.search({ query: 'hello' });
assert.equal(res.request_id, 'fake-/search');
assert.equal(res.data.results[0].url, 'https://example.com');

// 同一进程里同时加载 CJS 副本：两份错误类不同，instanceof 失效，isOctenError 必须仍为 true（README 承诺）
const require = createRequire(import.meta.url);
const cjs = require('@octen.ai/sdk');
assert.notEqual(cjs.Octen, Octen, 'ESM and CJS builds are expected to be separate copies');
const cjsClient = new cjs.Octen({ apiKey: 'fake-e2e-key', baseURL, maxRetries: 0 });
const err = await cjsClient.search.search({ query: '' }).then(
  () => assert.fail('empty query must be rejected'),
  (e) => e,
);
assert.equal(isOctenError(err), true);
assert.equal(err instanceof OctenValidationError, false);
assert.equal(err.name, 'OctenValidationError');
console.log('esm ok', res.request_id);
