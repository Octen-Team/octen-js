import { Octen, OctenAbortError, OctenAuthenticationError } from '@octen.ai/sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { octenNewsSearch } from '../src/tools/newsSearch.js';
import { clientFor, jsonResponse, modelJsonSchema, recordingFetch, run, validateInput } from './helpers.js';
// Replies are the production envelope recorded in test/fixtures/news-search.json.
import newsFixture from './fixtures/news-search.json';

const DEFAULT_DESCRIPTION =
  'Search recent news. Returns ranked articles with excerpts and publish time, plus storylines that group related coverage. Use it for current events and news monitoring.';

type Out = {
  request_id: string;
  results: Record<string, unknown>[];
  subjects: { name?: string; summary?: string; time_latest?: string; top_news?: { title?: string; url?: string } }[];
};

describe('octenNewsSearch', () => {
  it('sends the tool defaults plus the model query', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(newsFixture));
    const t = octenNewsSearch({ client: clientFor(fakeFetch) });
    await run(t, { query: 'EU AI Act enforcement' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toMatch(/\/news-search$/);
    expect(calls[0]?.body).toEqual({
      query: 'EU AI Act enforcement',
      count: 5,
      highlight: { enable: true, max_tokens: 300 },
    });
  });

  it('merges tool defaults, developer defaults and model input in that order', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(newsFixture));
    const t = octenNewsSearch({
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

  it('trims results and subjects and carries the envelope request_id', async () => {
    const { fakeFetch } = recordingFetch(() => jsonResponse(newsFixture));
    const t = octenNewsSearch({ client: clientFor(fakeFetch) });
    const out = (await run(t, { query: 'q' })) as Out;
    expect(out.request_id).toBe(newsFixture.request_id);
    expect(out.results).toHaveLength(newsFixture.data.results.length);
    const source = newsFixture.data.results[0]!;
    expect(out.results[0]).toEqual({
      title: source.title,
      url: source.url,
      highlight: source.highlight,
      time_published: source.time_published,
    });
    expect(out.subjects).toHaveLength(newsFixture.data.subjects.length);
    const subject = newsFixture.data.subjects[0]!;
    // time_start, sub_news and everything else on a subject or its top_news are dropped
    expect(out.subjects[0]).toEqual({
      name: subject.name,
      summary: subject.summary,
      time_latest: subject.time_latest,
      top_news: { title: subject.top_news.title, url: subject.top_news.url },
    });
  });

  it('omits empty values at every level of a subject and drops a subject left empty', async () => {
    const { fakeFetch } = recordingFetch(() =>
      jsonResponse({
        ...newsFixture,
        data: {
          results: [],
          subjects: [
            { name: 'a', summary: '', time_latest: null, top_news: { title: '', url: 'https://example.com/a', highlight: 'x' } },
            { name: 'b', top_news: { title: '', url: null } },
            { top_news: null },
            { name: 'c', top_news: { title: 't' } },
          ],
        },
      }),
    );
    const t = octenNewsSearch({ client: clientFor(fakeFetch) });
    const out = (await run(t, { query: 'q' })) as Out;
    expect(out.subjects).toEqual([
      { name: 'a', top_news: { url: 'https://example.com/a' } },
      { name: 'b' },
      { name: 'c', top_news: { title: 't' } },
    ]);
  });

  it('skips a null subject', async () => {
    const { fakeFetch } = recordingFetch(() =>
      jsonResponse({ ...newsFixture, data: { results: [], subjects: [null, { name: 'a' }] } }),
    );
    const t = octenNewsSearch({ client: clientFor(fakeFetch) });
    const out = (await run(t, { query: 'q' })) as Out;
    expect(out.subjects).toEqual([{ name: 'a' }]);
  });

  it('uses the default description and lets description override it', () => {
    const client = new Octen({ apiKey: 'test-key' });
    expect(octenNewsSearch({ client }).description).toBe(DEFAULT_DESCRIPTION);
    expect(octenNewsSearch({ client, description: 'Custom text' }).description).toBe('Custom text');
  });

  it('exposes query and time_range to the model by default', () => {
    const t = octenNewsSearch({ client: new Octen({ apiKey: 'test-key' }) });
    const json = z.toJSONSchema(t.inputSchema as z.ZodType) as { properties: Record<string, unknown>; required?: string[] };
    expect(Object.keys(json.properties).sort()).toEqual(['query', 'time_range']);
    expect(json.required).toEqual(['query']);
  });

  it('removes time_range from the input schema when the developer pins it', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(newsFixture));
    const t = octenNewsSearch({ client: clientFor(fakeFetch), defaults: { time_range: 'month' } });
    const json = z.toJSONSchema(t.inputSchema as z.ZodType) as { properties: Record<string, unknown> };
    expect(Object.keys(json.properties)).toEqual(['query']);
    // a model value is still ignored if one slips through
    await run(t, { query: 'q', time_range: 'day' });
    expect((calls[0]?.body as { time_range?: string }).time_range).toBe('month');
  });

  it('rejects with OctenAbortError when the signal is already aborted', async () => {
    const { fakeFetch } = recordingFetch(() => jsonResponse(newsFixture));
    const t = octenNewsSearch({ client: clientFor(fakeFetch) });
    const controller = new AbortController();
    controller.abort();
    await expect(run(t, { query: 'q' }, controller.signal)).rejects.toBeInstanceOf(OctenAbortError);
  });

  it('propagates a 401 as OctenAuthenticationError with the reply request id', async () => {
    const { fakeFetch } = recordingFetch(() =>
      jsonResponse({ code: 401, msg: 'invalid api key', request_id: 'req-401-news' }, 401),
    );
    const t = octenNewsSearch({ client: clientFor(fakeFetch) });
    const err = await run(t, { query: 'q' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenAuthenticationError);
    expect((err as OctenAuthenticationError).requestId).toBe('req-401-news');
  });

  it('returns empty arrays when results and subjects are null', async () => {
    const { fakeFetch } = recordingFetch(() =>
      jsonResponse({ ...newsFixture, data: { query: 'q', results: null, subjects: null } }),
    );
    const t = octenNewsSearch({ client: clientFor(fakeFetch) });
    expect(await run(t, { query: 'q' })).toEqual({ request_id: newsFixture.request_id, results: [], subjects: [] });
  });

  it('returns an empty subjects list when data.subjects is missing', async () => {
    const { fakeFetch } = recordingFetch(() => jsonResponse({ ...newsFixture, data: { query: 'q', results: [] } }));
    const t = octenNewsSearch({ client: clientFor(fakeFetch) });
    expect(await run(t, { query: 'q' })).toEqual({ request_id: newsFixture.request_id, results: [], subjects: [] });
  });
  it('passes a non-empty meta.warning through and omits an empty or null one', async () => {
    // meta.warning is a nullable string on the response: src/schema/newsSearch.ts; the fixture carries "".
    const cases: [unknown, string | undefined][] = [
      ['Storylines unavailable.', 'Storylines unavailable.'],
      [newsFixture.meta.warning, undefined],
      [null, undefined],
    ];
    for (const [warning, want] of cases) {
      const { fakeFetch } = recordingFetch(() => jsonResponse({ ...newsFixture, meta: { ...newsFixture.meta, warning } }));
      const out = (await run(octenNewsSearch({ client: clientFor(fakeFetch) }), { query: 'q' })) as Record<string, unknown>;
      expect(out['warning']).toBe(want);
      expect('warning' in out).toBe(want !== undefined);
    }
  });

  it.each([
    ['data.results', { results: 'x', subjects: [] }],
    ['data.subjects', { results: [], subjects: { name: 'a' } }],
  ])('rejects with an error naming %s when it is not a list', async (label, data) => {
    const { fakeFetch } = recordingFetch(() => jsonResponse({ ...newsFixture, data }));
    const err = await run(octenNewsSearch({ client: clientFor(fakeFetch) }), { query: 'q' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain(label);
  });

  it('drops non-object subjects and subjects with no non-empty field', async () => {
    const { fakeFetch } = recordingFetch(() =>
      jsonResponse({
        ...newsFixture,
        data: { results: [], subjects: ['x', 7, ['y'], { name: '', top_news: { title: '' } }, { top_news: 'z' }, { name: 'a' }] },
      }),
    );
    const out = (await run(octenNewsSearch({ client: clientFor(fakeFetch) }), { query: 'q' })) as Out;
    expect(out.subjects).toEqual([{ name: 'a' }]);
  });

  // Strict-mode providers send null for an optional field the model leaves out.
  it('accepts time_range null or missing and rejects an unknown value, as the AI SDK validates it', async () => {
    const t = octenNewsSearch({ client: new Octen({ apiKey: 'test-key' }) });
    expect(await validateInput(t, { query: 'q', time_range: null })).toBe(true);
    expect(await validateInput(t, { query: 'q' })).toBe(true);
    expect(await validateInput(t, { query: 'q', time_range: 'w' })).toBe(false);
    expect((await modelJsonSchema(t)).required).toEqual(['query']);
  });
  // The tool default has enable: true, so a body without it proves the developer object replaced it whole.
  it('replaces the highlight default whole when the developer object omits a key the default has', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(newsFixture));
    await run(octenNewsSearch({ client: clientFor(fakeFetch), defaults: { highlight: { max_tokens: 600 } } }), { query: 'q' });
    expect((calls[0]?.body as { highlight?: unknown }).highlight).toEqual({ max_tokens: 600 });
  });
});
