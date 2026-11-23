import { Octen, OctenAbortError, OctenAuthenticationError } from '@octen.ai/sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { octenBroadSearch } from '../src/tools/broadSearch.js';
import { clientFor, jsonResponse, modelJsonSchema, recordingFetch, run } from './helpers.js';
// Replies are the production envelope recorded in test/fixtures/broad-search.json.
import broadFixture from './fixtures/broad-search.json';

const DEFAULT_DESCRIPTION =
  'Search the web broadly for a multi-part or comparative question. Splits the question into sub-queries, searches them in parallel and returns results grouped per sub-query. Use it for comparisons, surveys and questions with several angles.';

describe('octenBroadSearch', () => {
  it('sends the tool defaults plus the model query', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(broadFixture));
    const t = octenBroadSearch({ client: clientFor(fakeFetch) });
    await run(t, { query: 'compare cloud GPU pricing across providers' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toMatch(/\/broad-search$/);
    // count and max_queries are left to the API defaults
    expect(calls[0]?.body).toEqual({
      query: 'compare cloud GPU pricing across providers',
      search_options: { highlight: { enable: true, max_tokens: 300 } },
    });
  });

  it('merges developer defaults over tool defaults and replaces search_options as a whole', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(broadFixture));
    const t = octenBroadSearch({
      client: clientFor(fakeFetch),
      defaults: { max_queries: 2, search_options: { time_range: 'week' } },
    });
    await run(t, { query: 'q' });
    expect(calls[0]?.body).toEqual({
      query: 'q',
      max_queries: 2,
      // the tool's highlight default is gone: search_options is a top-level replace
      search_options: { time_range: 'week' },
    });
  });

  it('trims sub-query groups and carries the envelope request_id', async () => {
    const { fakeFetch } = recordingFetch(() => jsonResponse(broadFixture));
    const t = octenBroadSearch({ client: clientFor(fakeFetch) });
    const out = (await run(t, { query: 'q' })) as {
      request_id: string;
      queries: string[];
      search_results: { query?: string; results: Record<string, unknown>[] }[];
    };
    expect(out.request_id).toBe(broadFixture.request_id);
    expect(out.queries).toEqual(broadFixture.data.queries);
    expect(out.search_results).toHaveLength(broadFixture.data.search_results.length);
    const group = out.search_results[0]!;
    const source = broadFixture.data.search_results[0]!;
    expect(group.query).toBe(source.query);
    expect(Object.keys(group).sort()).toEqual(['query', 'results']);
    expect(group.results).toHaveLength(source.results.length);
    expect(group.results[0]).toEqual({
      title: source.results[0]!.title,
      url: source.results[0]!.url,
      highlight: source.results[0]!.highlight,
      time_published: source.results[0]!.time_published,
    });
    // authors, favicon, time_last_crawled, latency and the empty full_content are dropped
    expect(Object.keys(group.results[0]!)).not.toContain('full_content');
    expect(Object.keys(group.results[0]!)).not.toContain('favicon');
  });

  it('omits the group query when it is missing and returns an empty result list for a null group', async () => {
    const { fakeFetch } = recordingFetch(() =>
      jsonResponse({
        ...broadFixture,
        data: {
          queries: ['a'],
          search_results: [{ results: broadFixture.data.search_results[0]!.results.slice(0, 1) }, { query: 'b', results: null }],
        },
      }),
    );
    const t = octenBroadSearch({ client: clientFor(fakeFetch) });
    const out = (await run(t, { query: 'q' })) as { search_results: Record<string, unknown>[] };
    expect(Object.keys(out.search_results[0]!)).toEqual(['results']);
    expect(out.search_results[1]).toEqual({ query: 'b', results: [] });
  });

  it('skips a null entry in search_results', async () => {
    const { fakeFetch } = recordingFetch(() =>
      jsonResponse({ ...broadFixture, data: { queries: ['a'], search_results: [null, { query: 'b', results: [] }] } }),
    );
    const t = octenBroadSearch({ client: clientFor(fakeFetch) });
    const out = (await run(t, { query: 'q' })) as { search_results: Record<string, unknown>[] };
    expect(out.search_results).toEqual([{ query: 'b', results: [] }]);
  });

  it('uses the default description and lets description override it', () => {
    const client = new Octen({ apiKey: 'test-key' });
    expect(octenBroadSearch({ client }).description).toBe(DEFAULT_DESCRIPTION);
    expect(octenBroadSearch({ client, description: 'Custom text' }).description).toBe('Custom text');
  });

  it('exposes only query to the model', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(broadFixture));
    const t = octenBroadSearch({ client: clientFor(fakeFetch) });
    const json = z.toJSONSchema(t.inputSchema as z.ZodType) as { properties: Record<string, unknown>; required?: string[] };
    expect(Object.keys(json.properties)).toEqual(['query']);
    expect(json.required).toEqual(['query']);
    // a stray model-supplied field never reaches the request
    await run(t, { query: 'q', time_range: 'day', max_queries: 9 });
    expect(Object.keys(calls[0]?.body as object).sort()).toEqual(['query', 'search_options']);
  });

  it('rejects with OctenAbortError when the signal is already aborted', async () => {
    const { fakeFetch } = recordingFetch(() => jsonResponse(broadFixture));
    const t = octenBroadSearch({ client: clientFor(fakeFetch) });
    const controller = new AbortController();
    controller.abort();
    await expect(run(t, { query: 'q' }, controller.signal)).rejects.toBeInstanceOf(OctenAbortError);
  });

  it('propagates a 401 as OctenAuthenticationError with the reply request id', async () => {
    const { fakeFetch } = recordingFetch(() =>
      jsonResponse({ code: 401, msg: 'invalid api key', request_id: 'req-401-broad' }, 401),
    );
    const t = octenBroadSearch({ client: clientFor(fakeFetch) });
    const err = await run(t, { query: 'q' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenAuthenticationError);
    expect((err as OctenAuthenticationError).requestId).toBe('req-401-broad');
  });

  it('returns empty arrays when search_results is null or queries is missing', async () => {
    const { fakeFetch } = recordingFetch(() =>
      jsonResponse({ ...broadFixture, data: { query: 'q', search_results: null } }),
    );
    const t = octenBroadSearch({ client: clientFor(fakeFetch) });
    expect(await run(t, { query: 'q' })).toEqual({ request_id: broadFixture.request_id, queries: [], search_results: [] });
  });

  it('returns empty arrays when data itself is missing', async () => {
    const { fakeFetch } = recordingFetch(() => jsonResponse({ request_id: 'r1', code: 0 }));
    const t = octenBroadSearch({ client: clientFor(fakeFetch) });
    expect(await run(t, { query: 'q' })).toEqual({ request_id: 'r1', queries: [], search_results: [] });
  });
  it('passes a non-empty meta.warning through and omits an empty or null one', async () => {
    // meta.warning is a nullable string on the response: src/schema/broadSearch.ts (the fixture has no warning key).
    const cases: [unknown, string | undefined][] = [
      ['One sub-query failed.', 'One sub-query failed.'],
      ['', undefined],
      [null, undefined],
    ];
    for (const [warning, want] of cases) {
      const { fakeFetch } = recordingFetch(() => jsonResponse({ ...broadFixture, meta: { ...broadFixture.meta, warning } }));
      const out = (await run(octenBroadSearch({ client: clientFor(fakeFetch) }), { query: 'q' })) as Record<string, unknown>;
      expect(out['warning']).toBe(want);
      expect('warning' in out).toBe(want !== undefined);
    }
    const { fakeFetch } = recordingFetch(() => jsonResponse(broadFixture));
    expect('warning' in ((await run(octenBroadSearch({ client: clientFor(fakeFetch) }), { query: 'q' })) as object)).toBe(false);
  });

  it.each([
    ['data.queries', { queries: 'a', search_results: [] }],
    ['data.search_results', { queries: [], search_results: { query: 'a' } }],
    ['data.search_results[].results', { queries: [], search_results: [{ query: 'a', results: 'x' }] }],
  ])('rejects with an error naming %s when it is not a list', async (label, data) => {
    const { fakeFetch } = recordingFetch(() => jsonResponse({ ...broadFixture, data }));
    const err = await run(octenBroadSearch({ client: clientFor(fakeFetch) }), { query: 'q' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain(label);
  });

  it('keeps only non-empty string queries and object groups', async () => {
    const { fakeFetch } = recordingFetch(() =>
      jsonResponse({
        ...broadFixture,
        data: { queries: ['a', '', null, 3, 'b'], search_results: ['x', 7, ['y'], { query: 'b', results: [] }] },
      }),
    );
    const out = await run(octenBroadSearch({ client: clientFor(fakeFetch) }), { query: 'q' });
    expect(out).toEqual({
      request_id: broadFixture.request_id,
      queries: ['a', 'b'],
      search_results: [{ query: 'b', results: [] }],
    });
  });
});

describe('octenBroadSearch result_type', () => {
  // Contract: Broad Search takes result_type inside search_options, never at the top level, and only the developer sets it.
  it('sends a developer result_type inside search_options and keeps the highlight the developer writes there', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(broadFixture));
    const t = octenBroadSearch({
      client: clientFor(fakeFetch),
      defaults: { search_options: { result_type: 'dynamic', highlight: { enable: true, max_tokens: 300 } } },
    });
    await run(t, { query: 'q' });
    expect(calls[0]?.body).toEqual({
      query: 'q',
      search_options: { result_type: 'dynamic', highlight: { enable: true, max_tokens: 300 } },
    });
    expect(calls[0]?.body).not.toHaveProperty('result_type');
  });

  // search_options is replaced whole, so a developer object without highlight also drops the tool's highlight default.
  it('replaces the highlight default when search_options holds only result_type', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(broadFixture));
    await run(octenBroadSearch({ client: clientFor(fakeFetch), defaults: { search_options: { result_type: 'dynamic' } } }), { query: 'q' });
    expect(calls[0]?.body).toEqual({ query: 'q', search_options: { result_type: 'dynamic' } });
  });

  it('does not offer result_type to the model and ignores one the model sends', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(broadFixture));
    const t = octenBroadSearch({ client: clientFor(fakeFetch) });
    expect(Object.keys((await modelJsonSchema(t)).properties ?? {})).toEqual(['query']);
    await run(t, { query: 'q', result_type: 'dynamic', search_options: { result_type: 'dynamic' } });
    // Unset means absent: the API default applies.
    expect(calls[0]?.body).toEqual({ query: 'q', search_options: { highlight: { enable: true, max_tokens: 300 } } });
  });

  // dynamic may return fewer results than count, each with a highlight longer than the tool's max_tokens (API reference,
  // WebSearchOptions.result_type and WebSearchHighlightOptions.max_tokens), so none of that may raise or be cut by the tool.
  it('returns a single result with a long highlight, and an empty group, without error', async () => {
    const source = broadFixture.data.search_results[0]!.results[0]!;
    const long = 'long highlight '.repeat(400);
    const reply = (search_results: unknown[]) => () =>
      jsonResponse({ ...broadFixture, data: { query: 'q', queries: ['q'], search_results } });
    const defaults = { search_options: { result_type: 'dynamic', highlight: { enable: true } } } as const;

    const one = recordingFetch(reply([{ query: 'q', results: [{ ...source, highlight: long }] }]));
    const out = (await run(octenBroadSearch({ client: clientFor(one.fakeFetch), defaults }), { query: 'q' })) as {
      search_results: { results: { highlight?: string }[] }[];
    };
    expect(out.search_results).toHaveLength(1);
    expect(out.search_results[0]?.results).toHaveLength(1);
    expect(out.search_results[0]?.results[0]?.highlight).toBe(long);

    const none = recordingFetch(reply([{ query: 'q', results: [] }]));
    const empty = (await run(octenBroadSearch({ client: clientFor(none.fakeFetch), defaults }), { query: 'q' })) as {
      search_results: unknown[];
    };
    expect(empty.search_results).toEqual([{ query: 'q', results: [] }]);
  });
});
