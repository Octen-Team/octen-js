import { Octen, OctenAbortError, OctenAuthenticationError } from '@octen.ai/sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { octenPulseSearch } from '../src/tools/pulseSearch.js';
import { clientFor, jsonResponse, recordingFetch, run } from './helpers.js';
// Replies are the production envelope recorded in test/fixtures/pulse-search.json.
import pulseFixture from './fixtures/pulse-search.json';

const DEFAULT_DESCRIPTION =
  'Find the official page for a site, product or document, such as docs, help pages or a homepage. Returns the most likely URLs. Use it when the user wants a specific page rather than general information.';

describe('octenPulseSearch', () => {
  it('sends the tool defaults plus the model query', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(pulseFixture));
    const t = octenPulseSearch({ client: clientFor(fakeFetch) });
    await run(t, { query: 'github docs' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toMatch(/\/pulse-search$/);
    expect(calls[0]?.body).toEqual({ query: 'github docs', count: 5 });
  });

  it('lets developer defaults override the tool defaults', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(pulseFixture));
    const t = octenPulseSearch({ client: clientFor(fakeFetch), defaults: { count: 2 } });
    await run(t, { query: 'github docs' });
    expect(calls[0]?.body).toEqual({ query: 'github docs', count: 2 });
  });

  it('returns title and url only for lite results, with the envelope request_id', async () => {
    const { fakeFetch } = recordingFetch(() => jsonResponse(pulseFixture));
    const t = octenPulseSearch({ client: clientFor(fakeFetch) });
    const out = (await run(t, { query: 'github docs' })) as { request_id: string; results: unknown[] };
    expect(out.request_id).toBe(pulseFixture.request_id);
    expect(out.results).toEqual(pulseFixture.data.results.map((r) => ({ title: r.title, url: r.url })));
  });

  it('uses the default description and lets description override it', () => {
    const client = new Octen({ apiKey: 'test-key' });
    expect(octenPulseSearch({ client }).description).toBe(DEFAULT_DESCRIPTION);
    expect(octenPulseSearch({ client, description: 'Custom text' }).description).toBe('Custom text');
  });

  it('exposes only query to the model', () => {
    const t = octenPulseSearch({ client: new Octen({ apiKey: 'test-key' }) });
    const json = z.toJSONSchema(t.inputSchema as z.ZodType) as { properties: Record<string, unknown>; required?: string[] };
    expect(Object.keys(json.properties)).toEqual(['query']);
    expect(json.required).toEqual(['query']);
  });

  it('rejects with OctenAbortError when the signal is already aborted', async () => {
    const { fakeFetch } = recordingFetch(() => jsonResponse(pulseFixture));
    const t = octenPulseSearch({ client: clientFor(fakeFetch) });
    const controller = new AbortController();
    controller.abort();
    await expect(run(t, { query: 'q' }, controller.signal)).rejects.toBeInstanceOf(OctenAbortError);
  });

  it('propagates a 401 as OctenAuthenticationError with the reply request id', async () => {
    // The SDK reads the id from the x-request-id header first, then from the body's request_id.
    const { fakeFetch } = recordingFetch(() =>
      jsonResponse({ code: 401, msg: 'invalid api key', request_id: 'req-401-pulse' }, 401),
    );
    const t = octenPulseSearch({ client: clientFor(fakeFetch) });
    const err = await run(t, { query: 'q' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenAuthenticationError);
    expect((err as OctenAuthenticationError).requestId).toBe('req-401-pulse');
  });

  it('returns an empty list when data.results is null', async () => {
    const { fakeFetch } = recordingFetch(() =>
      jsonResponse({ ...pulseFixture, data: { query: 'q', results: null } }),
    );
    const t = octenPulseSearch({ client: clientFor(fakeFetch) });
    const out = await run(t, { query: 'q' });
    expect(out).toEqual({ request_id: pulseFixture.request_id, results: [] });
  });
  it('passes a non-empty meta.warning through and omits an empty or null one', async () => {
    // meta.warning is a nullable string on the response: src/schema/pulseSearch.ts; the fixture carries "".
    const cases: [unknown, string | undefined][] = [
      ['Lite results only.', 'Lite results only.'],
      [pulseFixture.meta.warning, undefined],
      [null, undefined],
    ];
    for (const [warning, want] of cases) {
      const { fakeFetch } = recordingFetch(() => jsonResponse({ ...pulseFixture, meta: { ...pulseFixture.meta, warning } }));
      const out = (await run(octenPulseSearch({ client: clientFor(fakeFetch) }), { query: 'q' })) as Record<string, unknown>;
      expect(out['warning']).toBe(want);
      expect('warning' in out).toBe(want !== undefined);
    }
  });

  it('rejects with an error naming data.results when it is not a list', async () => {
    const { fakeFetch } = recordingFetch(() => jsonResponse({ ...pulseFixture, data: { query: 'q', results: { title: 'x' } } }));
    await expect(run(octenPulseSearch({ client: clientFor(fakeFetch) }), { query: 'q' })).rejects.toThrow(/data\.results/);
  });
});
