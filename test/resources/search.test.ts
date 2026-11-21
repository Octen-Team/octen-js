import { describe, expect, test, vi } from 'vitest';
import { OctenValidationError } from '../../src/core/errors';
import type { HttpCore, RequestOptions } from '../../src/core/http';
import { SearchResource } from '../../src/resources/search';
import { BASE, makeFetch } from './helpers';

type Row = {
  method: 'search' | 'broadSearch' | 'newsSearch' | 'businessSearch' | 'pulseSearch' | 'searchPremier';
  path: string;
  // Invalid fields: one at top level, one nested (undocumented fields)
  badTop: Record<string, unknown>;
  badNested: Record<string, unknown>;
};

const rows: Row[] = [
  {
    method: 'search',
    path: '/search',
    badTop: { topic: 'news' },
    badNested: { highlight: { enable: true, num_highlights: 2 } },
  },
  {
    method: 'broadSearch',
    path: '/broad-search',
    badTop: { country: 'US' },
    badNested: { search_options: { topic: 'news' } },
  },
  {
    method: 'newsSearch',
    path: '/news-search',
    badTop: { search_type: 'x' },
    badNested: { subjects: { enable: true, bogus: 1 } },
  },
  {
    method: 'businessSearch',
    path: '/business-search',
    badTop: { country: 'US' },
    badNested: { entities: { enable: true, bogus: 1 } },
  },
  {
    method: 'pulseSearch',
    path: '/pulse-search',
    badTop: { country: 'US' },
    badNested: { highlight: { enable: true, bogus: 1 } },
  },
  {
    method: 'searchPremier',
    path: '/search-premier',
    badTop: { topic: 'news' },
    badNested: { full_content: { enable: true, num_tokens: 2 } },
  },
];

// Use call-style invocation to get around the differing params types of each method: the tests deliberately pass values outside the types
function call(res: SearchResource, method: Row['method'], params: unknown, r?: RequestOptions): Promise<unknown> {
  return (res[method] as (p: unknown, r?: RequestOptions) => Promise<unknown>).call(res, params, r);
}

describe.each(rows)('SearchResource.$method', (row) => {
  test(`POSTs to ${row.path} with undefined keys stripped and the query untrimmed`, async () => {
    const { core, calls } = makeFetch();
    await call(new SearchResource(core), row.method, { query: '  octen  ', count: undefined });
    expect(calls).toEqual([{ url: `${BASE}${row.path}`, body: { query: '  octen  ' } }]);
  });

  test.each([[''], ['   '], ['\n\t ']])('blank query %j throws OctenValidationError(query) without sending', async (query) => {
    const { core, fetchImpl } = makeFetch();
    const err = await call(new SearchResource(core), row.method, { query }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toBe('query');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test.each([[{}], [{ query: undefined }], [{ query: 5 }], [null]])('invalid params %j throws on query', async (params) => {
    const { core, fetchImpl } = makeFetch();
    const err = await call(new SearchResource(core), row.method, params).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toBe('query');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('rejects a top-level unknown field without sending', async () => {
    const { core, fetchImpl } = makeFetch();
    const key = Object.keys(row.badTop)[0] as string;
    const err = await call(new SearchResource(core), row.method, { query: 'q', ...row.badTop }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toBe(key);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('rejects a nested unknown field without sending', async () => {
    const { core, fetchImpl } = makeFetch();
    const err = await call(new SearchResource(core), row.method, { query: 'q', ...row.badNested }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('keeps unknown fields in the response, at any depth', async () => {
    const body = {
      code: 0,
      request_id: 'req_1',
      new_top: { a: 1 },
      data: { query: 'q', new_in_data: true, results: [{ title: 't', brand_new: 'x' }] },
    };
    const { core } = makeFetch(body);
    expect(await call(new SearchResource(core), row.method, { query: 'q' })).toEqual(body);
  });
});

describe('SearchResource request options', () => {
  function spyCore() {
    const post = vi.fn(async (..._args: unknown[]) => ({ request_id: 'r' }));
    return { core: { post } as unknown as HttpCore, post };
  }

  test.each(['search', 'newsSearch', 'businessSearch', 'pulseSearch', 'searchPremier'] as const)(
    '%s passes RequestOptions through unchanged',
    async (method) => {
      const { core, post } = spyCore();
      const r: RequestOptions = { timeout: 1234, signal: new AbortController().signal, headers: { 'x-a': 'b' } };
      await call(new SearchResource(core), method, { query: 'q' }, r);
      expect(post).toHaveBeenCalledTimes(1);
      expect(post.mock.calls[0]?.[2]).toBe(r);
    },
  );

  test.each(['search', 'newsSearch', 'businessSearch', 'pulseSearch', 'searchPremier'] as const)(
    '%s adds no timeout of its own (client default applies)',
    async (method) => {
      const { core, post } = spyCore();
      await call(new SearchResource(core), method, { query: 'q' });
      expect((post.mock.calls[0] as unknown[])[2]).toBeUndefined();
    },
  );

  test('broadSearch defaults to a 120000 ms timeout', async () => {
    const { core, post } = spyCore();
    await new SearchResource(core).broadSearch({ query: 'q' });
    expect(post.mock.calls[0]?.[2]).toEqual({ timeout: 120000 });
  });

  test('broadSearch keeps the other options and lets a per-request timeout override the default', async () => {
    const { core, post } = spyCore();
    const signal = new AbortController().signal;
    await new SearchResource(core).broadSearch({ query: 'q' }, { timeout: 5000, signal, headers: { 'x-a': 'b' } });
    expect(post.mock.calls[0]?.[2]).toEqual({ timeout: 5000, signal, headers: { 'x-a': 'b' } });
  });

  test('broadSearch treats an explicit undefined timeout as unset', async () => {
    const { core, post } = spyCore();
    await new SearchResource(core).broadSearch({ query: 'q' }, { timeout: undefined } as unknown as RequestOptions);
    expect(post.mock.calls[0]?.[2]).toEqual({ timeout: 120000 });
  });

  test('broadSearch with an explicit client timeout adds no timeout of its own', async () => {
    const { core, post } = spyCore();
    await new SearchResource(core, true).broadSearch({ query: 'q' });
    expect((post.mock.calls[0] as unknown[])[2]).toBeUndefined();
  });

  test('broadSearch: a per-request timeout still wins over an explicit client timeout', async () => {
    const { core, post } = spyCore();
    await new SearchResource(core, true).broadSearch({ query: 'q' }, { timeout: 5000 });
    expect(post.mock.calls[0]?.[2]).toEqual({ timeout: 5000 });
  });

  test('broadSearch does not mutate the caller options object', async () => {
    const { core } = spyCore();
    const r: RequestOptions = { headers: { 'x-a': 'b' } };
    await new SearchResource(core).broadSearch({ query: 'q' }, r);
    expect(r).toEqual({ headers: { 'x-a': 'b' } });
  });
});

describe('SearchResource.businessSearch entities', () => {
  test('an entity with an unknown type is returned as the original object', async () => {
    const unknownEntity = { type: 'organization_group', name: 'X', extra: { nested: [1, 2] } };
    const body = {
      code: 0,
      request_id: 'req_1',
      data: {
        query: 'q',
        entities: [{ type: 'company', name: 'Acme', surprise: 1 }, unknownEntity, { type: 'person', name: 'Bob' }],
      },
    };
    const { core } = makeFetch(body);
    const res = await new SearchResource(core).businessSearch({ query: 'q' });
    expect(res.data?.entities).toEqual(body.data.entities);
    expect(res.data?.entities?.[1]).toEqual(unknownEntity);
    // Type level: after narrowing by type, variant fields are directly accessible (verified by compiling)
    for (const e of res.data?.entities ?? []) {
      if (e.type === 'company') void e.metrics?.stock?.price;
      else if (e.type === 'person') void e.career?.[0]?.organization;
    }
  });
});

// Every documented SearchRequest field with a distinct non-default value (testdata/openapi.json, SearchRequest).
const fullSearchParams = {
  query: 'eu ai act',
  result_type: 'dynamic',
  count: 7,
  include_domains: ['europa.eu'],
  exclude_domains: ['example.com'],
  include_text: ['compliance'],
  exclude_text: ['draft'],
  time_basis: 'published',
  time_range: 'year',
  start_time: '2025-01-01T00:00:00Z',
  end_time: '2025-12-31T00:00:00Z',
  language: ['en', 'de'],
  highlight: { enable: false, max_tokens: 300 },
  full_content: { enable: true, max_tokens: 1500 },
  format: 'markdown',
  safesearch: 'off',
  include_images: true,
} as const;

describe('SearchResource.searchPremier', () => {
  test('sends every SearchRequest field unchanged to /search-premier', async () => {
    const { core, calls } = makeFetch();
    await new SearchResource(core).searchPremier(fullSearchParams);
    expect(calls).toEqual([{ url: `${BASE}/search-premier`, body: fullSearchParams }]);
  });

  test('adds no defaults: a query-only call sends only the query', async () => {
    const { core, calls } = makeFetch();
    await new SearchResource(core).searchPremier({ query: 'q' });
    expect(calls[0]?.body).toEqual({ query: 'q' });
  });

  test('search keeps sending the same body to /search', async () => {
    const { core, calls } = makeFetch();
    await new SearchResource(core).search(fullSearchParams);
    await new SearchResource(core).search({ query: 'q' });
    expect(calls).toEqual([
      { url: `${BASE}/search`, body: fullSearchParams },
      { url: `${BASE}/search`, body: { query: 'q' } },
    ]);
  });

  test('returns the response untouched, including a null warning and missing data', async () => {
    const body = { code: 0, request_id: 'req_1', meta: { result_type: 'dynamic', warning: null } };
    const { core } = makeFetch(body);
    const res = await new SearchResource(core).searchPremier({ query: 'q', result_type: 'dynamic' });
    expect(res).toEqual(body);
    expect(res.data).toBeUndefined();
    expect(res.meta?.result_type).toBe('dynamic');
  });
});

describe('SearchResource request-side validation details', () => {
  test('nested unknown field path is dotted', async () => {
    const { core } = makeFetch();
    const err = await new SearchResource(core)
      .search({ query: 'q', highlight: { enable: true, num_highlights: 2 } } as never)
      .catch((e: unknown) => e);
    expect((err as OctenValidationError).field).toBe('highlight.num_highlights');
  });

  test('broadSearch rejects the unpublished search_options.query', async () => {
    const { core } = makeFetch();
    const err = await new SearchResource(core)
      .broadSearch({ query: 'q', search_options: { query: 'x' } } as never)
      .catch((e: unknown) => e);
    expect((err as OctenValidationError).field).toBe('search_options.query');
  });
});

// Type level: undocumented fields are rejected at compile time (if @ts-expect-error stops erroring, typecheck fails). The function is never executed.
export function typeLevelChecks(res: SearchResource) {
  // @ts-expect-error topic is not in the public spec
  void res.search({ query: 'q', topic: 'news' });
  // @ts-expect-error include_videos is not in the public spec
  void res.broadSearch({ query: 'q', search_options: { include_videos: true } });
  // @ts-expect-error num_highlights is not in the public spec
  void res.search({ query: 'q', highlight: { num_highlights: 1 } });
  // @ts-expect-error searchPremier takes no topic
  void res.searchPremier({ query: 'q', topic: 'news' });
  // @ts-expect-error result_type is standard or dynamic
  void res.searchPremier({ query: 'q', result_type: 'deep' });
}

// JSON.stringify would turn these into null and send them; the path format matches checkUnknownFields.
describe('A2: values JSON cannot carry are rejected before sending', () => {
  test.each([
    ['search', { query: 'q', count: Number.NaN }, 'count'],
    ['search', { query: 'q', highlight: { enable: true, max_tokens: Number.POSITIVE_INFINITY } }, 'highlight.max_tokens'],
    ['search', { query: 'q', include_domains: ['a.com', undefined] }, 'include_domains[1]'],
    ['broadSearch', { query: 'q', search_options: { count: Number.NEGATIVE_INFINITY } }, 'search_options.count'],
    ['newsSearch', { query: 'q', include_domains: [undefined] }, 'include_domains[0]'],
  ] as const)('%s %j -> OctenValidationError(%s)', async (method, params, field) => {
    const { core, fetchImpl } = makeFetch();
    const err = await call(new SearchResource(core), method, params).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toBe(field);
    expect(fetchImpl).toHaveBeenCalledTimes(0);
  });
});
