import { describe, expect, it } from 'vitest';
import Octen, { OctenAPIError, OctenBadRequestError, OctenValidationError } from '../../src/index';

// 线上参数矩阵与反例。打生产 https://api.octen.ai 并计费：只有 OCTEN_LIVE=1 且有 OCTEN_API_KEY 才运行，否则整组 skip。
// 取值范围出处：testdata/openapi.json（公开 OpenAPI 快照）；place max_reviews 出处 testdata/known_diffs.json。
// 原则：反例断言为结构化 4xx 的具体错误类，绝不是 5xx；与预期不符就让测试红并记成发现，不放宽断言。
const apiKey = process.env.OCTEN_API_KEY ?? '';
const enabled = process.env.OCTEN_LIVE === '1' && apiKey !== '';
const client = () => (enabled ? new Octen({ apiKey }) : (undefined as never as Octen));

type Hit = { request_id?: string | undefined };

// 成功用例：记录 request_id（不是密钥）与耗时，供测试记录核对
async function succeed<T extends Hit>(name: string, run: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  const res = await run();
  const ms = Math.round(performance.now() - t0);
  console.log(`[live-matrix] OK ${name} request_id=${res.request_id} elapsed_ms=${ms}`);
  expect(typeof res.request_id).toBe('string');
  expect(res.request_id).not.toBe('');
  return res;
}

// 反例：必须是 400/422 的 OctenBadRequestError；无论通过与否都把观测值打出来
async function rejectsAs4xx(name: string, run: () => Promise<unknown>): Promise<OctenBadRequestError> {
  const t0 = performance.now();
  const err = await run().then(
    () => undefined,
    (e: unknown) => e,
  );
  const ms = Math.round(performance.now() - t0);
  if (err instanceof OctenAPIError) {
    console.log(
      `[live-matrix] NEG ${name} -> ${err.constructor.name} status=${err.status} code=${err.code} request_id=${err.requestId} msg=${JSON.stringify(err.message).slice(0, 160)} elapsed_ms=${ms}`,
    );
  } else {
    console.log(`[live-matrix] NEG ${name} -> ${err === undefined ? 'RESOLVED (no error)' : String(err)} elapsed_ms=${ms}`);
  }
  expect(err, `${name}: expected a rejection`).toBeDefined();
  expect(err).toBeInstanceOf(OctenBadRequestError);
  expect([400, 422]).toContain((err as OctenBadRequestError).status);
  return err as OctenBadRequestError;
}

const hostOf = (u: string | undefined) => new URL(u ?? 'http://invalid.invalid').hostname;
const onDomain = (u: string | undefined, d: string) => hostOf(u) === d || hostOf(u).endsWith(`.${d}`);

describe.skipIf(!enabled)('live matrix: success cases (billed, minimal counts)', () => {
  describe('search', () => {
    it('count: 1 -> at most 1 result', async () => {
      const res = await succeed('search count=1', () => client().search.search({ query: 'octen search api', count: 1 }));
      expect(res.data?.results?.length ?? 0).toBeGreaterThanOrEqual(1);
      expect(res.data?.results?.length ?? 0).toBeLessThanOrEqual(1);
    });

    it('include_domains: every result is on the included domain', async () => {
      const res = await succeed('search include_domains=wikipedia.org', () =>
        client().search.search({ query: 'solid-state battery', count: 2, include_domains: ['wikipedia.org'] }),
      );
      const results = res.data?.results ?? [];
      expect(results.length).toBeGreaterThanOrEqual(1);
      for (const r of results) expect(onDomain(r.url, 'wikipedia.org'), r.url).toBe(true);
    });

    it('exclude_domains: no result on the excluded domain (with an unfiltered control)', async () => {
      const control = await succeed('search exclude_domains control (no filter)', () =>
        client().search.search({ query: 'wikipedia', count: 5 }),
      );
      const controlHasWiki = (control.data?.results ?? []).some((r) => onDomain(r.url, 'wikipedia.org'));
      console.log(`[live-matrix] exclude_domains control_has_wikipedia=${controlHasWiki}`);
      const res = await succeed('search exclude_domains=wikipedia.org', () =>
        client().search.search({ query: 'wikipedia', count: 5, exclude_domains: ['wikipedia.org'] }),
      );
      expect(res.data?.results?.length ?? 0).toBeGreaterThanOrEqual(1);
      for (const r of res.data?.results ?? []) expect(onDomain(r.url, 'wikipedia.org'), r.url).toBe(false);
    });

    it.each(['week', 'm'] as const)('time_range: %s', async (time_range) => {
      await succeed(`search time_range=${time_range}`, () =>
        client().search.search({ query: 'technology news', count: 1, time_range }),
      );
    });

    it('language: [en]', async () => {
      await succeed('search language=en', () => client().search.search({ query: 'octen search api', count: 1, language: ['en'] }));
    });

    it('highlight: enable with max_tokens 100 -> result carries a highlight', async () => {
      const res = await succeed('search highlight', () =>
        client().search.search({ query: 'octen search api', count: 1, highlight: { enable: true, max_tokens: 100 } }),
      );
      expect(res.data?.results?.[0]?.highlight ?? '').not.toBe('');
    });

    it('full_content: enable with max_tokens 100 -> result carries full_content', async () => {
      const res = await succeed('search full_content', () =>
        client().search.search({ query: 'octen search api', count: 1, full_content: { enable: true, max_tokens: 100 } }),
      );
      expect(res.data?.results?.[0]?.full_content ?? '').not.toBe('');
    });

    it.each(['markdown', 'text'] as const)('format: %s', async (format) => {
      await succeed(`search format=${format}`, () =>
        client().search.search({ query: 'octen search api', count: 1, full_content: { enable: true, max_tokens: 100 }, format }),
      );
    });

    it.each(['off', 'strict'] as const)('safesearch: %s', async (safesearch) => {
      await succeed(`search safesearch=${safesearch}`, () =>
        client().search.search({ query: 'octen search api', count: 1, safesearch }),
      );
    });

    it('include_images: true', async () => {
      const res = await succeed('search include_images=true', () =>
        client().search.search({ query: 'golden gate bridge', count: 1, include_images: true }),
      );
      const r = res.data?.results?.[0];
      console.log(`[live-matrix] include_images images=${r?.images?.length ?? 0} cover_image=${r?.cover_image?.url !== undefined}`);
    });
  });

  describe('broadSearch', () => {
    it('max_queries: 1 with search_options -> at most 1 sub-query', async () => {
      const res = await succeed('broadSearch max_queries=1 search_options', () =>
        client().search.broadSearch({
          query: 'history of web search engines',
          max_queries: 1,
          search_options: { count: 1, language: ['en'], time_range: 'year' },
        }),
      );
      expect(res.data?.queries?.length ?? 0).toBeLessThanOrEqual(1);
      expect(res.data?.search_results?.length ?? 0).toBeLessThanOrEqual(1);
      for (const g of res.data?.search_results ?? []) expect(g.results?.length ?? 0).toBeLessThanOrEqual(1);
    });

    it('max_queries: 2 -> at most 2 sub-queries', async () => {
      const res = await succeed('broadSearch max_queries=2', () =>
        client().search.broadSearch({ query: 'compare electric vehicle battery chemistries', max_queries: 2, search_options: { count: 1 } }),
      );
      expect(res.data?.queries?.length ?? 0).toBeLessThanOrEqual(2);
    });
  });

  describe('newsSearch', () => {
    it('subjects: enable with count 1 and max_sub_news 1', async () => {
      const res = await succeed('newsSearch subjects', () =>
        client().search.newsSearch({ query: 'artificial intelligence', count: 2, subjects: { enable: true, count: 1, max_sub_news: 1 } }),
      );
      const subjects = res.data?.subjects ?? [];
      console.log(`[live-matrix] newsSearch subjects=${subjects.length}`);
      expect(subjects.length).toBeLessThanOrEqual(1);
      for (const s of subjects) expect(s.sub_news?.length ?? 0).toBeLessThanOrEqual(1);
    });
  });

  describe('businessSearch', () => {
    it('entities: enable with count 1, max_activities 1, max_news 1', async () => {
      const res = await succeed('businessSearch entities', () =>
        client().search.businessSearch({ query: 'Apple Inc', count: 1, entities: { enable: true, count: 1, max_activities: 1, max_news: 1 } }),
      );
      const entities = res.data?.entities ?? [];
      console.log(`[live-matrix] businessSearch entities=${entities.length} types=${entities.map((e) => e.type).join(',')}`);
      expect(entities.length).toBeLessThanOrEqual(1);
      for (const e of entities) {
        expect(e.activities?.length ?? 0).toBeLessThanOrEqual(1);
        expect(e.news?.length ?? 0).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('pulseSearch', () => {
    it.each(['lite', 'standard'] as const)('mode: %s', async (mode) => {
      const res = await succeed(`pulseSearch mode=${mode}`, () =>
        client().search.pulseSearch({ query: 'octen search api', mode, count: 1 }),
      );
      // billed_mode：openapi 写明 standard 在拿不到页面详情时按 lite 计费，所以只对 lite 断言相等
      console.log(`[live-matrix] pulseSearch mode=${mode} billed_mode=${res.meta?.usage?.billed_mode}`);
      if (mode === 'lite') expect(res.meta?.usage?.billed_mode).toBe('lite');
      expect(res.data?.results?.length ?? 0).toBeLessThanOrEqual(1);
    });
  });

  describe('placeSearch', () => {
    it('coordinates + radius + places.count + places.max_reviews -> places within the radius', async () => {
      const res = await succeed('placeSearch coordinates radius count max_reviews', () =>
        client().placeSearch.search({
          query: 'coffee shop',
          latitude: 47.6062,
          longitude: -122.3321,
          radius: 2000,
          places: { count: 1, max_reviews: 1 },
          web_search: { enable: false },
        }),
      );
      const places = res.data?.places ?? [];
      console.log(`[live-matrix] placeSearch places=${places.length} distance=${places[0]?.distance} attribute_keys=${Object.keys(places[0]?.attributes ?? {}).join(',')}`);
      expect(places.length).toBeGreaterThanOrEqual(1);
      expect(places.length).toBeLessThanOrEqual(1);
      expect(places[0]?.distance ?? 0).toBeLessThanOrEqual(2000);
    });

    it('user_location', async () => {
      const res = await succeed('placeSearch user_location', () =>
        client().placeSearch.search({
          query: 'coffee shop near me',
          user_location: { type: 'approximate', city: 'Seattle', region: 'Washington', country: 'US', timezone: 'America/Los_Angeles' },
          places: { count: 1 },
          web_search: { enable: false },
        }),
      );
      console.log(`[live-matrix] placeSearch user_location places=${res.data?.places?.length ?? 0} location=${JSON.stringify(res.data?.location)}`);
    });

    it('web_search: enable with count 1 -> at most 1 web result', async () => {
      const res = await succeed('placeSearch web_search', () =>
        client().placeSearch.search({
          query: 'coffee shop in Seattle',
          places: { count: 1 },
          web_search: { enable: true, count: 1, highlight: { enable: true, max_tokens: 100 } },
        }),
      );
      const web = res.data?.results ?? [];
      console.log(`[live-matrix] placeSearch web_search results=${web.length}`);
      expect(web.length).toBeGreaterThanOrEqual(1);
      expect(web.length).toBeLessThanOrEqual(1);
    });
  });
});

describe.skipIf(!enabled)('live matrix: negative cases (must be structured 4xx, never 5xx)', () => {
  const q = { query: 'octen' };
  // 非法值绕过 TypeScript 类型检查，模拟 JS 调用方或类型被转换掉的写法
  const bad = <T>(v: unknown) => v as T;
  const cases: Array<[string, () => Promise<unknown>]> = [
    ['search count=0', () => client().search.search({ ...q, count: 0 })],
    ['search count=101', () => client().search.search({ ...q, count: 101 })],
    ['search count=-1', () => client().search.search({ ...q, count: -1 })],
    ['search time_range=decade', () => client().search.search({ ...q, time_range: bad<'day'>('decade') })],
    ['search safesearch=maybe', () => client().search.search({ ...q, safesearch: bad<'off'>('maybe') })],
    ['search format=html', () => client().search.search({ ...q, format: bad<'text'>('html') })],
    ['search result_type=fancy', () => client().search.search({ ...q, result_type: bad<'standard'>('fancy') })],
    ['search language=[xx]', () => client().search.search({ ...q, language: bad<['en']>(['xx']) })],
    ['search highlight.max_tokens=50 (min 100)', () => client().search.search({ ...q, highlight: { enable: true, max_tokens: 50 } })],
    ['search query of 501 chars (max 500)', () => client().search.search({ query: 'a'.repeat(501) })],
    ['broadSearch max_queries=0', () => client().search.broadSearch({ ...q, max_queries: 0 })],
    ['broadSearch max_queries=31', () => client().search.broadSearch({ ...q, max_queries: 31 })],
    ['broadSearch search_options.count=0', () => client().search.broadSearch({ ...q, max_queries: 1, search_options: { count: 0 } })],
    ['newsSearch count=0', () => client().search.newsSearch({ ...q, count: 0 })],
    ['newsSearch count=101', () => client().search.newsSearch({ ...q, count: 101 })],
    ['newsSearch time_range=decade', () => client().search.newsSearch({ ...q, time_range: bad<'day'>('decade') })],
    ['newsSearch subjects.count=6', () => client().search.newsSearch({ ...q, subjects: { enable: true, count: 6 } })],
    ['businessSearch count=0', () => client().search.businessSearch({ ...q, count: 0 })],
    ['businessSearch entities.count=21', () => client().search.businessSearch({ ...q, entities: { enable: true, count: 21 } })],
    ['pulseSearch mode=turbo', () => client().search.pulseSearch({ ...q, mode: bad<'lite'>('turbo') })],
    ['pulseSearch count=11', () => client().search.pulseSearch({ ...q, count: 11 })],
    ['pulseSearch count=0', () => client().search.pulseSearch({ ...q, count: 0 })],
    ['placeSearch radius without coordinates', () => client().placeSearch.search({ ...q, radius: 1000 })],
    ['placeSearch latitude without longitude', () => client().placeSearch.search({ ...q, latitude: 47.6 })],
    ['placeSearch latitude=91', () => client().placeSearch.search({ ...q, latitude: 91, longitude: 0 })],
    ['placeSearch radius=50001', () => client().placeSearch.search({ ...q, latitude: 47.6, longitude: -122.3, radius: 50001 })],
    ['placeSearch user_location.type=exact', () => client().placeSearch.search({ ...q, user_location: { type: bad<'approximate'>('exact') } })],
    ['placeSearch places.count=21', () => client().placeSearch.search({ ...q, places: { count: 21 } })],
  ];

  it.each(cases)('%s -> OctenBadRequestError', async (name, run) => {
    await rejectsAs4xx(name, run);
  });

  describe('local validation: rejected before any request is sent', () => {
    function counted() {
      let calls = 0;
      const countingFetch: typeof fetch = (input, init) => {
        calls += 1;
        return globalThis.fetch(input, init);
      };
      return { c: new Octen({ apiKey, fetch: countingFetch }), calls: () => calls };
    }

    const empties: Array<[string, (c: Octen) => Promise<unknown>]> = [
      ['search', (c) => c.search.search({ query: '' })],
      ['broadSearch', (c) => c.search.broadSearch({ query: '' })],
      ['newsSearch', (c) => c.search.newsSearch({ query: '' })],
      ['businessSearch', (c) => c.search.businessSearch({ query: '' })],
      ['pulseSearch', (c) => c.search.pulseSearch({ query: '' })],
      ['placeSearch', (c) => c.placeSearch.search({ query: '' })],
    ];

    it.each(empties)('%s with an empty query -> OctenValidationError, 0 requests', async (name, run) => {
      const { c, calls } = counted();
      const err = await run(c).then(
        () => undefined,
        (e: unknown) => e,
      );
      console.log(`[live-matrix] LOCAL ${name} empty query -> ${(err as Error | undefined)?.name} field=${(err as OctenValidationError | undefined)?.field} requests=${calls()}`);
      expect(err).toBeInstanceOf(OctenValidationError);
      expect((err as OctenValidationError).field).toBe('query');
      expect(calls()).toBe(0);
    });

    it('unknown key (cuont) and nested typo (highlight.max_token) -> OctenValidationError, 0 requests', async () => {
      const { c, calls } = counted();
      const e1 = await c.search.search(bad<{ query: string }>({ query: 'q', cuont: 1 })).then(
        () => undefined,
        (e: unknown) => e,
      );
      const e2 = await c.search.search(bad<{ query: string }>({ query: 'q', highlight: { max_token: 1 } })).then(
        () => undefined,
        (e: unknown) => e,
      );
      console.log(`[live-matrix] LOCAL unknown keys -> ${(e1 as Error).name} field=${(e1 as OctenValidationError).field}; ${(e2 as Error).name} field=${(e2 as OctenValidationError).field}; requests=${calls()}`);
      expect(e1).toBeInstanceOf(OctenValidationError);
      expect((e1 as OctenValidationError).field).toBe('cuont');
      expect(e2).toBeInstanceOf(OctenValidationError);
      expect((e2 as OctenValidationError).field).toBe('highlight.max_token');
      expect(calls()).toBe(0);
    });
  });
});
