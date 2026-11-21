import { Octen, OctenAbortError, OctenAuthenticationError, OctenRateLimitError } from '@octen.ai/sdk';
import { describe, expect, it } from 'vitest';
import { octenWebSearchPremier } from '../src/tools/webSearchPremier.js';
import { clientFor, jsonResponse, modelJsonSchema, recordingFetch, run, validateInput } from './helpers.js';
// Replies are the production envelope recorded in test/fixtures/search-premier.json.
import premierFixture from './fixtures/search-premier.json';

const DEFAULT_DESCRIPTION =
  'Search the web with deeper retrieval and reranking, so the page that holds the answer ranks higher. Returns ranked pages with title, URL, a query-relevant excerpt and publish time. Use it for a specific fact, a niche document or a page that is hard to find; for low-latency lookups, prefer a standard web search.';

const TOOL_DEFAULT_BODY = { count: 5, highlight: { enable: true, max_tokens: 300 } };

// Every request field of /search-premier except query and time_range, with a value from the API reference.
const DEVELOPER_SETTINGS = {
  result_type: 'dynamic',
  count: 3,
  include_domains: ['example.com'],
  exclude_domains: ['example.org'],
  include_text: ['battery'],
  exclude_text: ['rumor'],
  time_basis: 'published',
  start_time: '2026-01-01T00:00:00Z',
  end_time: '2026-11-01T00:00:00Z',
  language: ['en'],
  highlight: { enable: true, max_tokens: 600 },
  full_content: { enable: true, max_tokens: 1000 },
  format: 'markdown',
  safesearch: 'off',
  include_images: true,
} as const;

describe('octenWebSearchPremier', () => {
  it('sends the tool defaults plus the model query to /search-premier', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(premierFixture));
    await run(octenWebSearchPremier({ client: clientFor(fakeFetch) }), { query: 'solid-state battery breakthroughs' });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!.url).pathname).toBe('/search-premier');
    // No full_content, result_type, safesearch or other field the developer did not set.
    expect(calls[0]?.body).toEqual({ query: 'solid-state battery breakthroughs', ...TOOL_DEFAULT_BODY });
  });

  it('sends every developer setting and the model time_range', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(premierFixture));
    const t = octenWebSearchPremier({ client: clientFor(fakeFetch), defaults: DEVELOPER_SETTINGS });
    await run(t, { query: 'q', time_range: 'week' });
    expect(calls[0]?.body).toEqual({ query: 'q', time_range: 'week', ...DEVELOPER_SETTINGS });
  });

  it('exposes only query and time_range to the model', async () => {
    const t = octenWebSearchPremier({ client: new Octen({ apiKey: 'test-key' }) });
    const json = await modelJsonSchema(t);
    expect(Object.keys(json.properties ?? {}).sort()).toEqual(['query', 'time_range']);
    expect(json.required).toEqual(['query']);
  });

  // A non-strict provider can send keys outside the schema; none of them may reach the request.
  it('drops cost and filter fields the model sends outside its schema', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(premierFixture));
    await run(octenWebSearchPremier({ client: clientFor(fakeFetch) }), { query: 'q', ...DEVELOPER_SETTINGS, count: 100 });
    expect(calls[0]?.body).toEqual({ query: 'q', ...TOOL_DEFAULT_BODY });
  });

  it('removes time_range from the input schema when the developer pins it, and ignores a model value', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(premierFixture));
    const t = octenWebSearchPremier({ client: clientFor(fakeFetch), defaults: { time_range: 'month' } });
    expect(Object.keys((await modelJsonSchema(t)).properties ?? {})).toEqual(['query']);
    await run(t, { query: 'q', time_range: 'day' });
    expect((calls[0]?.body as { time_range?: string }).time_range).toBe('month');
  });

  it('ignores a query placed in defaults', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(premierFixture));
    const defaults = { query: 'from defaults' } as unknown as Record<string, never>;
    await run(octenWebSearchPremier({ client: clientFor(fakeFetch), defaults }), { query: 'from model' });
    expect((calls[0]?.body as { query?: string }).query).toBe('from model');
  });

  it('accepts time_range null or missing and rejects an unknown value, as the AI SDK validates it', async () => {
    const t = octenWebSearchPremier({ client: new Octen({ apiKey: 'test-key' }) });
    expect(await validateInput(t, { query: 'q', time_range: null })).toBe(true);
    expect(await validateInput(t, { query: 'q' })).toBe(true);
    expect(await validateInput(t, { query: 'q', time_range: 'year' })).toBe(true);
    expect(await validateInput(t, { query: 'q', time_range: 'w' })).toBe(false);
  });

  it('sends no time_range when the model sends null', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(premierFixture));
    await run(octenWebSearchPremier({ client: clientFor(fakeFetch) }), { query: 'q', time_range: null });
    expect(calls[0]?.body).toEqual({ query: 'q', ...TOOL_DEFAULT_BODY });
  });

  it('trims results and carries the envelope request_id', async () => {
    const { fakeFetch } = recordingFetch(() => jsonResponse(premierFixture));
    const out = (await run(octenWebSearchPremier({ client: clientFor(fakeFetch) }), { query: 'q' })) as {
      request_id: string;
      results: Record<string, unknown>[];
    };
    expect(out.request_id).toBe(premierFixture.request_id);
    expect(out.results).toHaveLength(premierFixture.data.results.length);
    const source = premierFixture.data.results[0]!;
    // authors, favicon, time_last_crawled and the empty full_content are dropped
    expect(out.results[0]).toEqual({
      title: source.title,
      url: source.url,
      highlight: source.highlight,
      time_published: source.time_published,
    });
    expect(Object.keys(out)).toEqual(['request_id', 'results']);
  });

  it('keeps full_content when the API returns it', async () => {
    const source = premierFixture.data.results[0]!;
    const reply = { ...premierFixture, data: { ...premierFixture.data, results: [{ ...source, full_content: 'Full text.' }] } };
    const { fakeFetch } = recordingFetch(() => jsonResponse(reply));
    const out = (await run(octenWebSearchPremier({ client: clientFor(fakeFetch) }), { query: 'q' })) as {
      results: Record<string, unknown>[];
    };
    expect(out.results[0]?.['full_content']).toBe('Full text.');
  });

  it('passes a non-empty meta.warning through and omits an empty one', async () => {
    const warned = { ...premierFixture, meta: { ...premierFixture.meta, warning: 'Results may be incomplete.' } };
    const { fakeFetch } = recordingFetch(() => jsonResponse(warned));
    const out = (await run(octenWebSearchPremier({ client: clientFor(fakeFetch) }), { query: 'q' })) as Record<string, unknown>;
    expect(out['warning']).toBe('Results may be incomplete.');
    const plain = recordingFetch(() => jsonResponse({ ...premierFixture, meta: { ...premierFixture.meta, warning: '' } }));
    const quiet = (await run(octenWebSearchPremier({ client: clientFor(plain.fakeFetch) }), { query: 'q' })) as Record<string, unknown>;
    expect('warning' in quiet).toBe(false);
  });

  it('returns an empty list when data.results is null and throws when it is not a list', async () => {
    const empty = recordingFetch(() => jsonResponse({ ...premierFixture, data: { query: 'q', results: null } }));
    expect(await run(octenWebSearchPremier({ client: clientFor(empty.fakeFetch) }), { query: 'q' })).toEqual({
      request_id: premierFixture.request_id,
      results: [],
    });
    const bad = recordingFetch(() => jsonResponse({ ...premierFixture, data: { query: 'q', results: 'oops' } }));
    await expect(run(octenWebSearchPremier({ client: clientFor(bad.fakeFetch) }), { query: 'q' })).rejects.toThrow(
      /data\.results/,
    );
  });

  it('uses the default description and lets description override it', () => {
    const client = new Octen({ apiKey: 'test-key' });
    expect(octenWebSearchPremier({ client }).description).toBe(DEFAULT_DESCRIPTION);
    expect(octenWebSearchPremier({ client, description: 'Custom text' }).description).toBe('Custom text');
  });

  it('rejects with OctenAbortError when the signal is already aborted', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(premierFixture));
    const controller = new AbortController();
    controller.abort();
    await expect(run(octenWebSearchPremier({ client: clientFor(fakeFetch) }), { query: 'q' }, controller.signal)).rejects.toBeInstanceOf(
      OctenAbortError,
    );
    expect(calls).toHaveLength(0);
  });

  // Errors propagate unchanged, as for the other tools; the AI SDK decides how the model sees them.
  it('propagates a 401 as OctenAuthenticationError and a 429 as OctenRateLimitError', async () => {
    const auth = recordingFetch(() => jsonResponse({ code: 401, msg: 'invalid api key', request_id: 'req-401-premier' }, 401));
    const authErr = await run(octenWebSearchPremier({ client: clientFor(auth.fakeFetch) }), { query: 'q' }).catch((e: unknown) => e);
    expect(authErr).toBeInstanceOf(OctenAuthenticationError);
    expect((authErr as OctenAuthenticationError).requestId).toBe('req-401-premier');
    // Body as returned by production on 2026-11-21 for a rate-limited /search-premier call.
    const limited = recordingFetch(() =>
      jsonResponse({ code: 429, msg: 'Exceeding the rate limit.', request_id: 'req-429-premier' }, 429),
    );
    const limitErr = await run(octenWebSearchPremier({ client: clientFor(limited.fakeFetch) }), { query: 'q' }).catch(
      (e: unknown) => e,
    );
    expect(limitErr).toBeInstanceOf(OctenRateLimitError);
    expect(limited.calls).toHaveLength(1);
  });
});
