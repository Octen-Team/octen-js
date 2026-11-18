import { Octen, OctenAbortError, OctenAuthenticationError } from '@octen.ai/sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { octenBroadSearch } from '../src/tools/broadSearch.js';
import { clientFor, jsonResponse, recordingFetch, run } from './helpers.js';
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
});
