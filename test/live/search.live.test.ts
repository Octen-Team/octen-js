import { describe, expect, it } from 'vitest';
import Octen, { OctenAuthenticationError, OctenBadRequestError, OctenTimeoutError } from '../../src/index';

// 打生产 https://api.octen.ai 并计费：只有 OCTEN_LIVE=1 且有 OCTEN_API_KEY 才运行，否则整组 skip。
const apiKey = process.env.OCTEN_API_KEY ?? '';
const enabled = process.env.OCTEN_LIVE === '1' && apiKey !== '';

function expectOk(res: { request_id?: string | undefined; data?: unknown }, name: string) {
  expect(typeof res.request_id).toBe('string');
  expect(res.request_id).not.toBe('');
  expect(res.data).toBeDefined();
  // request_id 不是密钥，打到 stdout 供测试记录核对
  console.log(`[live] ${name} request_id=${res.request_id}`);
}

describe.skipIf(!enabled)('live: production API', () => {
  const client = () => new Octen({ apiKey });

  it('search', async () => {
    const res = await client().search.search({ query: 'octen search api', count: 1 });
    expectOk(res, 'search');
  });

  it('broadSearch', async () => {
    const res = await client().search.broadSearch({ query: 'history of web search engines', max_queries: 1 });
    expectOk(res, 'broadSearch');
  });

  it('newsSearch', async () => {
    const res = await client().search.newsSearch({ query: 'artificial intelligence', count: 1 });
    expectOk(res, 'newsSearch');
  });

  it('businessSearch', async () => {
    const res = await client().search.businessSearch({ query: 'Apple Inc', count: 1 });
    expectOk(res, 'businessSearch');
  });

  it('pulseSearch', async () => {
    const res = await client().search.pulseSearch({ query: 'octen search api', count: 1 });
    expectOk(res, 'pulseSearch');
  });

  it('placeSearch', async () => {
    const res = await client().placeSearch.search({
      query: 'coffee shop in Seattle',
      places: { count: 1 },
      web_search: { enable: false },
    });
    expectOk(res, 'placeSearch');
  });

  it('wrong API key -> OctenAuthenticationError', async () => {
    const bad = new Octen({ apiKey: 'octen-invalid-key-for-live-test' });
    await expect(bad.search.search({ query: 'octen', count: 1 })).rejects.toBeInstanceOf(OctenAuthenticationError);
  });

  it('count 1000 -> OctenBadRequestError', async () => {
    await expect(client().search.search({ query: 'octen', count: 1000 })).rejects.toBeInstanceOf(
      OctenBadRequestError,
    );
  });

  // 服务端处理该请求约 1.5 s：500 ms 超时发生在请求已发出之后，SDK 不得重试（否则重复计费）
  it('broadSearch client timeout after send -> OctenTimeoutError, fetch called exactly once', async () => {
    let calls = 0;
    let sentAt = '';
    const countingFetch: typeof fetch = (input, init) => {
      calls += 1;
      if (calls === 1) sentAt = new Date().toISOString();
      return globalThis.fetch(input, init);
    };
    const c = new Octen({ apiKey, fetch: countingFetch });
    await expect(
      c.search.broadSearch({ query: 'history of web search engines', max_queries: 10 }, { timeout: 500 }),
    ).rejects.toBeInstanceOf(OctenTimeoutError);
    console.log(`[live] broadSearch-timeout request_sent_at=${sentAt} fetch_calls=${calls}`);
    expect(calls).toBe(1);
  });
});
