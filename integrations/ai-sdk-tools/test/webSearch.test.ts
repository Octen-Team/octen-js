import { Octen, OctenAbortError, OctenAuthenticationError } from '@octen.ai/sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { octenWebSearch } from '../src/tools/webSearch.js';
import { clientFor, jsonResponse, modelJsonSchema, recordingFetch, run, validateInput } from './helpers.js';
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

  it('skips a null item in data.results instead of throwing', async () => {
    const source = searchFixture.data.results[0]!;
    const { fakeFetch } = recordingFetch(() =>
      jsonResponse({ ...searchFixture, data: { query: 'q', results: [null, source] } }),
    );
    const t = octenWebSearch({ client: clientFor(fakeFetch) });
    const out = (await run(t, { query: 'q' })) as { results: Record<string, unknown>[] };
    expect(out.results).toHaveLength(1);
    expect(out.results[0]?.['url']).toBe(source.url);
  });

  it('returns an empty list when data.results is null', async () => {
    const { fakeFetch } = recordingFetch(() =>
      jsonResponse({ ...searchFixture, data: { query: 'q', results: null } }),
    );
    const t = octenWebSearch({ client: clientFor(fakeFetch) });
    const out = await run(t, { query: 'q' });
    expect(out).toEqual({ request_id: searchFixture.request_id, results: [] });
  });
  it('passes a non-empty meta.warning through to the model', async () => {
    // meta.warning is a nullable string on the response: src/schema/search.ts, SearchResponseDesc.
    const { fakeFetch } = recordingFetch(() =>
      jsonResponse({ ...searchFixture, meta: { ...searchFixture.meta, warning: 'Results may be incomplete.' } }),
    );
    const out = (await run(octenWebSearch({ client: clientFor(fakeFetch) }), { query: 'q' })) as Record<string, unknown>;
    expect(out['warning']).toBe('Results may be incomplete.');
  });

  it('omits warning when meta.warning is empty or null', async () => {
    // The recorded fixture carries "warning": "".
    for (const meta of [searchFixture.meta, { ...searchFixture.meta, warning: null }, {}]) {
      const { fakeFetch } = recordingFetch(() => jsonResponse({ ...searchFixture, meta }));
      const out = (await run(octenWebSearch({ client: clientFor(fakeFetch) }), { query: 'q' })) as Record<string, unknown>;
      expect('warning' in out).toBe(false);
    }
  });

  it('rejects with an error naming data.results when it is not a list', async () => {
    const { fakeFetch } = recordingFetch(() => jsonResponse({ ...searchFixture, data: { query: 'q', results: 'oops' } }));
    await expect(run(octenWebSearch({ client: clientFor(fakeFetch) }), { query: 'q' })).rejects.toThrow(/data\.results/);
  });

  it('drops a result with no non-empty model field', async () => {
    const source = searchFixture.data.results[0]!;
    const { fakeFetch } = recordingFetch(() =>
      jsonResponse({ ...searchFixture, data: { query: 'q', results: [{ favicon: 'f', full_content: '' }, source] } }),
    );
    const out = (await run(octenWebSearch({ client: clientFor(fakeFetch) }), { query: 'q' })) as { results: unknown[] };
    expect(out.results).toEqual([
      { title: source.title, url: source.url, highlight: source.highlight, time_published: source.time_published },
    ]);
  });

  // Strict-mode providers send null for an optional field the model leaves out.
  it('accepts time_range null or missing and rejects an unknown value, as the AI SDK validates it', async () => {
    const t = octenWebSearch({ client: new Octen({ apiKey: 'test-key' }) });
    expect(await validateInput(t, { query: 'q', time_range: null })).toBe(true);
    expect(await validateInput(t, { query: 'q' })).toBe(true);
    expect(await validateInput(t, { query: 'q', time_range: 'week' })).toBe(true);
    expect(await validateInput(t, { query: 'q', time_range: 'w' })).toBe(false);
    expect((await modelJsonSchema(t)).required).toEqual(['query']);
  });

  it('sends no time_range when the model sends null', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(searchFixture));
    await run(octenWebSearch({ client: clientFor(fakeFetch) }), { query: 'q', time_range: null });
    expect(calls[0]?.body).toEqual({ query: 'q', count: 5, highlight: { enable: true, max_tokens: 300 } });
  });
  // The tool default has enable: true, so a body without it proves the developer object replaced it whole.
  it('replaces the highlight default whole when the developer object omits a key the default has', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(searchFixture));
    await run(octenWebSearch({ client: clientFor(fakeFetch), defaults: { highlight: { max_tokens: 600 } } }), { query: 'q' });
    expect((calls[0]?.body as { highlight?: unknown }).highlight).toEqual({ max_tokens: 600 });
  });
});

describe('octenWebSearch result_type', () => {
  // Contract: Web Search takes result_type at the top level of the body; it is a developer option, never a model input.
  it('sends a developer result_type at the top level next to the tool defaults', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(searchFixture));
    await run(octenWebSearch({ client: clientFor(fakeFetch), defaults: { result_type: 'dynamic' } }), { query: 'q' });
    expect(calls[0]?.body).toEqual({ query: 'q', count: 5, highlight: { enable: true, max_tokens: 300 }, result_type: 'dynamic' });
  });

  it('does not offer result_type to the model and ignores one the model sends', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(searchFixture));
    const t = octenWebSearch({ client: clientFor(fakeFetch) });
    expect(Object.keys((await modelJsonSchema(t)).properties ?? {}).sort()).toEqual(['query', 'time_range']);
    await run(t, { query: 'q', result_type: 'dynamic' });
    // Unset means absent: the API default applies.
    expect(calls[0]?.body).not.toHaveProperty('result_type');
    const pinned = octenWebSearch({ client: clientFor(fakeFetch), defaults: { result_type: 'standard' } });
    await run(pinned, { query: 'q', result_type: 'dynamic' });
    expect((calls[1]?.body as { result_type?: string }).result_type).toBe('standard');
  });

  // dynamic may return fewer results than count, each with a highlight longer than the tool's max_tokens (API reference,
  // WebSearchOptions.result_type and WebSearchHighlightOptions.max_tokens), so none of that may raise or be cut by the tool.
  it('returns a single result with a long highlight, and an empty list, without error', async () => {
    const source = searchFixture.data.results[0]!;
    const long = 'long highlight '.repeat(400);
    const reply = (results: unknown[]) => () => jsonResponse({ ...searchFixture, meta: { ...searchFixture.meta, result_type: 'dynamic' }, data: { query: 'q', results } });
    const options = { defaults: { result_type: 'dynamic' } } as const;

    const one = recordingFetch(reply([{ ...source, highlight: long }]));
    const out = (await run(octenWebSearch({ client: clientFor(one.fakeFetch), ...options }), { query: 'q' })) as { results: { highlight?: string }[] };
    expect(out.results).toHaveLength(1);
    expect(out.results[0]?.highlight).toBe(long);

    const none = recordingFetch(reply([]));
    expect(await run(octenWebSearch({ client: clientFor(none.fakeFetch), ...options }), { query: 'q' })).toEqual({
      request_id: searchFixture.request_id,
      results: [],
    });
  });
});
