import { Octen, OctenAbortError, OctenAuthenticationError } from '@octen.ai/sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { octenWebSearch } from '../src/tools/webSearch.js';
import { clientFor, jsonResponse, recordingFetch, run } from './helpers.js';
// Replies are the production envelope recorded in test/fixtures/search.json.
import searchFixture from './fixtures/search.json';

const DEFAULT_DESCRIPTION =
  'Search the web for current information. Returns ranked pages with title, URL, a query-relevant excerpt and publish time. Use it when the answer depends on recent events or on facts you are unsure about.';

describe('octenWebSearch', () => {
  it('sends the tool defaults plus the model query', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(searchFixture));
    const t = octenWebSearch({ client: clientFor(fakeFetch) });
    await run(t, { query: 'solid-state battery breakthroughs' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toMatch(/\/search$/);
    expect(calls[0]?.body).toEqual({
      query: 'solid-state battery breakthroughs',
      count: 5,
      highlight: { enable: true, max_tokens: 300 },
    });
  });

  it('merges tool defaults, developer defaults and model input in that order', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(searchFixture));
    const t = octenWebSearch({
      client: clientFor(fakeFetch),
      defaults: { count: 10, highlight: { enable: true, max_tokens: 100 } },
    });
    await run(t, { query: 'q', time_range: 'week' });
    expect(calls[0]?.body).toEqual({
      query: 'q',
      count: 10,
      // highlight is replaced as a whole, not deep-merged
      highlight: { enable: true, max_tokens: 100 },
      time_range: 'week',
    });
  });

  it('trims results and carries the envelope request_id', async () => {
    const { fakeFetch } = recordingFetch(() => jsonResponse(searchFixture));
    const t = octenWebSearch({ client: clientFor(fakeFetch) });
    const out = (await run(t, { query: 'q' })) as { request_id: string; results: Record<string, unknown>[] };
    expect(out.request_id).toBe(searchFixture.request_id);
    expect(out.results).toHaveLength(searchFixture.data.results.length);
    const first = out.results[0]!;
    const source = searchFixture.data.results[0]!;
    expect(first).toEqual({
      title: source.title,
      url: source.url,
      highlight: source.highlight,
      time_published: source.time_published,
    });
    // authors, favicon, time_last_crawled and the empty full_content are dropped
    expect(Object.keys(first)).not.toContain('full_content');
    expect(Object.keys(first)).not.toContain('favicon');
  });

  it('uses the default description and lets description override it', () => {
    const client = new Octen({ apiKey: 'test-key' });
    expect(octenWebSearch({ client }).description).toBe(DEFAULT_DESCRIPTION);
    expect(octenWebSearch({ client, description: 'Custom text' }).description).toBe('Custom text');
  });

  it('exposes query and time_range to the model by default', () => {
    const t = octenWebSearch({ client: new Octen({ apiKey: 'test-key' }) });
    const json = z.toJSONSchema(t.inputSchema as z.ZodType) as { properties: Record<string, unknown>; required?: string[] };
    expect(Object.keys(json.properties).sort()).toEqual(['query', 'time_range']);
    expect(json.required).toEqual(['query']);
  });

  it('removes time_range from the input schema when the developer pins it', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(searchFixture));
    const t = octenWebSearch({ client: clientFor(fakeFetch), defaults: { time_range: 'month' } });
    const json = z.toJSONSchema(t.inputSchema as z.ZodType) as { properties: Record<string, unknown> };
    expect(Object.keys(json.properties)).toEqual(['query']);
    // a model value is still ignored if one slips through
    await run(t, { query: 'q', time_range: 'day' });
    expect((calls[0]?.body as { time_range?: string }).time_range).toBe('month');
  });

  it('rejects with OctenAbortError when the signal is already aborted', async () => {
    const { fakeFetch } = recordingFetch(() => jsonResponse(searchFixture));
    const t = octenWebSearch({ client: clientFor(fakeFetch) });
    const controller = new AbortController();
    controller.abort();
    await expect(run(t, { query: 'q' }, controller.signal)).rejects.toBeInstanceOf(OctenAbortError);
  });

  it('propagates a 401 as OctenAuthenticationError with the reply request id', async () => {
    // The SDK reads the id from the x-request-id header first, then from the body's request_id.
    const { fakeFetch } = recordingFetch(() =>
      jsonResponse({ code: 401, msg: 'invalid api key', request_id: 'req-401-web' }, 401),
    );
    const t = octenWebSearch({ client: clientFor(fakeFetch) });
    const err = await run(t, { query: 'q' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenAuthenticationError);
    expect((err as OctenAuthenticationError).requestId).toBe('req-401-web');
  });

  it('returns an empty list when data.results is null', async () => {
    const { fakeFetch } = recordingFetch(() =>
      jsonResponse({ ...searchFixture, data: { query: 'q', results: null } }),
    );
    const t = octenWebSearch({ client: clientFor(fakeFetch) });
    const out = await run(t, { query: 'q' });
    expect(out).toEqual({ request_id: searchFixture.request_id, results: [] });
  });
});
