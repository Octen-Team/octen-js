import { Octen, OctenAbortError, OctenAuthenticationError } from '@octen.ai/sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { octenPulseSearch } from '../src/tools/pulseSearch.js';
import { octenWebSearch } from '../src/tools/webSearch.js';
import pulseFixture from './fixtures/pulse-search.json';
import searchFixture from './fixtures/search.json';

const DEFAULT_DESCRIPTION =
  'Find the official page for a site, product or document, such as docs, help pages or a homepage. Returns the most likely URLs. Use it when the user wants a specific page rather than general information.';

type Recorded = { url: string; body: unknown };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// The replies are production envelopes recorded in test/fixtures (search.json, pulse-search.json).
function recordingFetch(reply: (url: string) => Response | Promise<Response>) {
  const calls: Recorded[] = [];
  const fakeFetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return await reply(url);
  }) as typeof fetch;
  return { fakeFetch, calls };
}

function clientFor(fakeFetch: typeof fetch): Octen {
  return new Octen({ apiKey: 'test-key', fetch: fakeFetch, maxRetries: 0 });
}

function run(t: { execute?: unknown }, input: unknown, abortSignal?: AbortSignal) {
  const execute = t.execute as (input: unknown, options: unknown) => Promise<unknown>;
  return execute(input, { toolCallId: 't1', messages: [], abortSignal, context: undefined });
}

// Resolves once the request's signal aborts, like a real fetch would.
function hangUntilAborted(init: RequestInit | undefined): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    const fail = () => reject(signal?.reason ?? new DOMException('aborted', 'AbortError'));
    if (signal?.aborted === true) fail();
    else signal?.addEventListener('abort', fail, { once: true });
  });
}

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

  it('keeps a concurrent call to another tool on the same client alive when one call is aborted', async () => {
    const { fakeFetch } = recordingFetch(async (url) =>
      url.endsWith('/pulse-search') ? jsonResponse(pulseFixture) : jsonResponse(searchFixture),
    );
    // Pulse hangs until aborted; Web answers normally.
    const hanging = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      String(input).endsWith('/pulse-search') ? await hangUntilAborted(init) : await fakeFetch(input, init)) as typeof fetch;
    const client = clientFor(hanging);
    const pulse = octenPulseSearch({ client });
    const web = octenWebSearch({ client });
    const controller = new AbortController();
    const aborted = run(pulse, { query: 'q' }, controller.signal).catch((e: unknown) => e);
    const other = run(web, { query: 'q' });
    controller.abort();
    expect(await aborted).toBeInstanceOf(OctenAbortError);
    expect(await other).toMatchObject({ request_id: searchFixture.request_id });
  });
});
