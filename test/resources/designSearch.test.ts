import { describe, expect, test } from 'vitest';
import { OctenValidationError } from '../../src/core/errors';
import type { HttpCore, RequestOptions } from '../../src/core/http';
import { DesignSearchResource } from '../../src/resources/designSearch';
import { BASE, makeFetch } from './helpers';

// Fields and limits: testdata/openapi.json, DesignSearchRequest / DesignImageOptions / DesignWebSearchOptions.
async function rejectWith(send: () => Promise<unknown>, fetchImpl: unknown, field: string) {
  const err = await send().catch((e: unknown) => e);
  expect(err).toBeInstanceOf(OctenValidationError);
  expect((err as OctenValidationError).field).toBe(field);
  expect(fetchImpl).not.toHaveBeenCalled();
}

describe('DesignSearchResource.search', () => {
  test('sends every field unchanged to /design-search', async () => {
    const { core, calls } = makeFetch();
    const params = {
      query: 'pricing page with three tiers',
      images: {
        enable: false,
        count: 12,
        design_facts: false,
        snippet: { enable: false, max_tokens: 800 },
        group_id: 'web_page_abc',
      },
      web_search: {
        enable: false,
        count: 9,
        highlight: { enable: false, max_tokens: 200 },
        full_content: { enable: true, max_tokens: 900 },
        include_domains: ['stripe.com'],
        exclude_domains: ['example.com'],
        language: ['en', 'ja'],
        time_basis: 'crawled',
        time_range: 'w',
        start_time: '2025-01-01T00:00:00Z',
        end_time: '2025-02-01T00:00:00Z',
      },
    } as const;
    await new DesignSearchResource(core).search(params);
    expect(calls).toEqual([{ url: `${BASE}/design-search`, body: params }]);
  });

  test('adds no defaults: a query-only call sends only the query', async () => {
    const { core, calls } = makeFetch();
    await new DesignSearchResource(core).search({ query: 'hero section', images: undefined });
    expect(calls[0]?.body).toEqual({ query: 'hero section' });
  });

  test('a group lookup needs no query', async () => {
    const { core, calls } = makeFetch();
    await new DesignSearchResource(core).search({ images: { group_id: 'deck_123', count: 2 } });
    expect(calls[0]?.body).toEqual({ images: { group_id: 'deck_123', count: 2 } });
  });

  test('a blank query is sent as is when a group_id is set', async () => {
    const { core, calls } = makeFetch();
    await new DesignSearchResource(core).search({ query: '', images: { group_id: 'deck_123' } });
    expect(calls[0]?.body).toEqual({ query: '', images: { group_id: 'deck_123' } });
  });

  test.each([
    ['no query and no group_id', {}],
    ['an empty query', { query: '' }],
    ['a blank query', { query: ' \n ' }],
    ['a blank query and an empty group_id', { query: ' ', images: { group_id: '' } }],
    ['no query and a blank group_id', { images: { group_id: '   ', count: 2 } }],
    ['no query and images without group_id', { images: { count: 2 } }],
    ['a non-string query', { query: 5 }],
    ['a non-string query even with a group_id', { query: 5, images: { group_id: 'deck_123' } }],
    ['a non-string group_id as the only input', { images: { group_id: 7 } }],
    ['params that are not an object', null],
  ])('%s throws OctenValidationError(query) without sending', async (_name, params) => {
    const { core, fetchImpl } = makeFetch();
    await rejectWith(() => new DesignSearchResource(core).search(params as never), fetchImpl, 'query');
  });

  test.each([
    [{ count: 5 }, 'count'],
    [{ images: { snippet: { enable: true, format: 'html' } } }, 'images.snippet.format'],
    [{ web_search: { safesearch: 'off' } }, 'web_search.safesearch'],
    [{ web_search: { highlight: { num_highlights: 1 } } }, 'web_search.highlight.num_highlights'],
  ])('rejects the undocumented field %j', async (extra, field) => {
    const { core, fetchImpl } = makeFetch();
    await rejectWith(
      () => new DesignSearchResource(core).search({ query: 'q', ...extra } as never),
      fetchImpl,
      field,
    );
  });

  test('rejects values JSON cannot carry', async () => {
    const { core, fetchImpl } = makeFetch();
    await rejectWith(
      () => new DesignSearchResource(core).search({ query: 'q', web_search: { include_domains: [undefined as never] } }),
      fetchImpl,
      'web_search.include_domains[0]',
    );
  });

  test('returns the response untouched, including groups, free-form design values and undocumented keys', async () => {
    const body = {
      code: 0,
      msg: 'success',
      request_id: 'req_1',
      data: {
        query: 'q',
        images: [
          {
            type: 'slide',
            url: 'https://img.example.com/1.png',
            group: { group_id: 'deck_1', type: 'deck', position: 1, total: 4, master: {} },
            design_facts: { colors: ['#000'], fonts: { heading: 'Inter' } },
            snippet: { format: 'html', code: '<div></div>' },
          },
          { type: 'app_screen', url: 'https://img.example.com/2.png' },
        ],
        results: [{ title: 't', url: 'https://stripe.com/pricing' }],
        specs: { anything: true },
      },
      meta: { usage: { num_search_queries: 1 }, warning: null },
    };
    const { core } = makeFetch(body);
    const res = await new DesignSearchResource(core).search({ query: 'q' });
    expect(res).toEqual(body);
    expect(res.data?.images?.[0]?.group?.position).toBe(1);
    expect(res.data?.images?.[1]?.group).toBeUndefined();
    expect(res.data?.images?.[1]?.source_page).toBeUndefined();
    expect(res.data?.specs).toEqual({ anything: true });
  });

  test('passes RequestOptions through and adds no timeout of its own', async () => {
    const posts: unknown[][] = [];
    const core = { post: async (...args: unknown[]) => (posts.push(args), { request_id: 'r' }) } as unknown as HttpCore;
    const r: RequestOptions = { timeout: 1234 };
    await new DesignSearchResource(core).search({ query: 'q' }, r);
    await new DesignSearchResource(core).search({ query: 'q' });
    expect(posts[0]?.[2]).toBe(r);
    expect(posts[1]?.[2]).toBeUndefined();
  });
});

// Type level only; never executed. If an @ts-expect-error stops erroring, typecheck fails.
export function typeLevelChecks(design: DesignSearchResource) {
  // @ts-expect-error web_search takes no safesearch
  void design.search({ query: 'q', web_search: { safesearch: 'off' } });
  // @ts-expect-error time_basis is auto, published or crawled
  void design.search({ query: 'q', web_search: { time_basis: 'indexed' } });
  // query is optional at the type level; the group_id rule is checked at runtime
  void design.search({ images: { group_id: 'deck_1' } });
}
