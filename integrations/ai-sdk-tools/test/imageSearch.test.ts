import {
  Octen,
  OctenAbortError,
  OctenAPIError,
  OctenAuthenticationError,
  OctenBadRequestError,
  OctenConnectionError,
  OctenPermissionDeniedError,
  OctenRateLimitError,
  OctenServerError,
  OctenTimeoutError,
  OctenValidationError,
} from '@octen.ai/sdk';
import { inspect } from 'node:util';
import { asSchema } from 'ai';
import { describe, expect, it } from 'vitest';
import { octenImageSearch } from '../src/tools/imageSearch.js';
import type { OctenImageSearchOptions } from '../src/tools/imageSearch.js';
import { clientFor, hangUntilAborted, jsonResponse, modelJsonSchema, recordingFetch, run, validateInput } from './helpers.js';
// Replies are the production envelope recorded in test/fixtures/image-search.json.
import imageFixture from './fixtures/image-search.json';

const IMG = 'https://upload.wikimedia.org/wikipedia/commons/0/0c/GoldenGateBridge-001.jpg';
// Bounds from docs.octen.ai/api-reference/image-search: count 1 to 10, up to 10 domains each, safesearch off or strict.
const ALL_OPTIONS = { count: 7, safesearch: 'off', includeDomains: ['wikimedia.org'], excludeDomains: ['pinterest.com'] } as const;
const ALL_OPTIONS_WIRE = { count: 7, safesearch: 'off', include_domains: ['wikimedia.org'], exclude_domains: ['pinterest.com'] };

function build(options: OctenImageSearchOptions = {}) {
  const rec = recordingFetch(() => jsonResponse(imageFixture));
  const t = octenImageSearch({ ...options, client: clientFor(rec.fakeFetch) } as OctenImageSearchOptions);
  return { t, calls: rec.calls };
}

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

async function rejection(value: unknown, options: OctenImageSearchOptions = {}): Promise<{ success: boolean; message: string }> {
  const t = octenImageSearch({ client: new Octen({ apiKey: 'test-key' }), ...options } as OctenImageSearchOptions);
  const result = await asSchema(t.inputSchema as Parameters<typeof asSchema>[0]).validate?.(value);
  return { success: result?.success === true, message: result?.success === false ? String(result.error.message) : '' };
}

describe('octenImageSearch request', () => {
  it('sends a text query as the single text input to /image-search', async () => {
    const { t, calls } = build();
    await run(t, { query: 'golden gate bridge at sunset' });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!.url).pathname).toBe('/image-search');
    expect(calls[0]?.body).toEqual({ inputs: [{ type: 'text', data: 'golden gate bridge at sunset' }] });
  });

  it('sends an image URL as the single image input', async () => {
    const { t, calls } = build();
    await run(t, { image_url: IMG, query: null });
    expect(calls[0]?.body).toEqual({ inputs: [{ type: 'image', url: IMG }] });
  });

  it('sends the model domain filters under the API names', async () => {
    const { t, calls } = build();
    await run(t, { query: 'q', include_domains: ['unsplash.com'], exclude_domains: ['pinterest.com', 'shutterstock.com'] });
    expect(calls[0]?.body).toEqual({
      inputs: [{ type: 'text', data: 'q' }],
      include_domains: ['unsplash.com'],
      exclude_domains: ['pinterest.com', 'shutterstock.com'],
    });
  });

  it('sends every developer option under the API names', async () => {
    const { t, calls } = build(ALL_OPTIONS);
    await run(t, { query: 'q' });
    expect(calls[0]?.body).toEqual({ inputs: [{ type: 'text', data: 'q' }], ...ALL_OPTIONS_WIRE });
  });

  it('keeps the developer domain lists when the model sends its own', async () => {
    const { t, calls } = build({ includeDomains: ['wikimedia.org'] });
    await run(t, { query: 'q', include_domains: ['unsplash.com'], exclude_domains: ['pinterest.com'] });
    expect(calls[0]?.body).toEqual({
      inputs: [{ type: 'text', data: 'q' }],
      exclude_domains: ['pinterest.com'],
      include_domains: ['wikimedia.org'],
    });
  });

  // A non-strict provider can send keys outside the schema; none of them may reach the request.
  it('drops developer-only fields the model sends outside its schema', async () => {
    const { t, calls } = build();
    await run(t, { ...ALL_OPTIONS, query: 'q', count: 10, safesearch: 'off', inputs: [{ type: 'image', data: 'AAAA' }], image_data: 'AAAA' });
    expect(calls[0]?.body).toEqual({ inputs: [{ type: 'text', data: 'q' }] });
  });

  it('omits options set to undefined, null model filters and an empty model list', async () => {
    const options = Object.fromEntries(Object.keys(ALL_OPTIONS).map((k) => [k, undefined])) as OctenImageSearchOptions;
    const { t, calls } = build(options);
    await run(t, { query: 'q', image_url: null, include_domains: null, exclude_domains: [] });
    expect(calls[0]?.body).toEqual({ inputs: [{ type: 'text', data: 'q' }] });
  });

  it('copies the developer domain lists when the tool is built', async () => {
    const domains = ['wikimedia.org'];
    const { t, calls } = build({ includeDomains: domains });
    domains.push('example.com');
    await run(t, { query: 'q' });
    expect(calls[0]?.body).toEqual({ inputs: [{ type: 'text', data: 'q' }], include_domains: ['wikimedia.org'] });
  });
});

describe('octenImageSearch exactly one input', () => {
  it('refuses both inputs without a request, naming both', async () => {
    const { t, calls } = build();
    const err = await run(t, { query: 'bridge', image_url: IMG }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toBe('image_url');
    expect((err as Error).message).toBe(
      'Pass exactly one of `query` or `image_url`, not both: this search takes a single input. No request was made.',
    );
    expect(calls).toHaveLength(0);
  });

  it('refuses neither input, or blank ones, without a request', async () => {
    const { t, calls } = build();
    for (const input of [{}, { query: null, image_url: null }, { query: '  ' }, { image_url: '' }]) {
      const err = await run(t, input).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(OctenValidationError);
      expect((err as OctenValidationError).field).toBe('query');
      expect((err as Error).message).toBe(
        'Pass one of `query` (text describing the images) or `image_url` (a public http(s) URL of an image, to find similar images). No request was made.',
      );
    }
    expect(calls).toHaveLength(0);
  });

  it('refuses an image_url that is not an http(s) URL, such as base64 data, without a request', async () => {
    const { t, calls } = build();
    for (const url of ['data:image/png;base64,iVBORw0KGgo=', 'iVBORw0KGgo=', 'ftp://example.com/a.png']) {
      const err = await run(t, { image_url: url }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(OctenValidationError);
      expect((err as Error).message).toMatch(/image_url must be a public http\(s\) URL/);
    }
    expect(calls).toHaveLength(0);
  });

  it('rejects both or neither in the input check the AI SDK runs, with the same advice for the model', async () => {
    const both = await rejection({ query: 'bridge', image_url: IMG });
    expect(both.success).toBe(false);
    expect(both.message).toMatch(/exactly one of `query` or `image_url`, not both/);
    const neither = await rejection({ query: null });
    expect(neither.success).toBe(false);
    expect(neither.message).toMatch(/Pass one of `query`/);
    expect((await rejection({ image_url: 'data:image/png;base64,AAAA' })).message).toMatch(/http\(s\) URL/);
  });

  it('accepts one input of the allowed shape, as the AI SDK validates the input', async () => {
    const t = octenImageSearch({ client: new Octen({ apiKey: 'test-key' }) });
    expect(await validateInput(t, { query: 'q' })).toBe(true);
    expect(await validateInput(t, { query: 'q'.repeat(500) })).toBe(true);
    expect(await validateInput(t, { query: '\u{1F600}'.repeat(500) })).toBe(true);
    expect(await validateInput(t, { query: 'q'.repeat(501) })).toBe(false);
    expect(await validateInput(t, { image_url: IMG, query: null })).toBe(true);
    expect(await validateInput(t, { image_url: 'HTTP://EXAMPLE.COM/A.PNG' })).toBe(true);
    expect(await validateInput(t, { query: 'q', include_domains: Array.from({ length: 10 }, (_, i) => `d${i}.com`) })).toBe(true);
    expect(await validateInput(t, { query: 'q', include_domains: Array.from({ length: 11 }, (_, i) => `d${i}.com`) })).toBe(false);
    expect(await validateInput(t, { query: 'q', exclude_domains: [''] })).toBe(false);
  });
});

describe('octenImageSearch model input', () => {
  it('exposes query, image_url and the two domain filters, none required', async () => {
    const json = await modelJsonSchema(octenImageSearch({ client: new Octen({ apiKey: 'test-key' }) }));
    expect(Object.keys(json.properties ?? {}).sort()).toEqual(['exclude_domains', 'image_url', 'include_domains', 'query']);
    expect(json.required ?? []).toEqual([]);
    expect(json.properties?.['query']).toMatchObject({ anyOf: [{ type: 'string', minLength: 1, maxLength: 500 }, { type: 'null' }] });
    expect(json.properties?.['include_domains']).toMatchObject({
      anyOf: [{ type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 10 }, { type: 'null' }],
    });
  });

  it('removes a domain filter the developer pinned, and never exposes count or safesearch', async () => {
    const json = await modelJsonSchema(octenImageSearch({ client: new Octen({ apiKey: 'test-key' }), ...ALL_OPTIONS }));
    expect(Object.keys(json.properties ?? {}).sort()).toEqual(['image_url', 'query']);
    const onlyExclude = await modelJsonSchema(octenImageSearch({ client: new Octen({ apiKey: 'test-key' }), excludeDomains: ['a.com'] }));
    expect(Object.keys(onlyExclude.properties ?? {}).sort()).toEqual(['image_url', 'include_domains', 'query']);
  });
});

describe('octenImageSearch construction', () => {
  const client = new Octen({ apiKey: 'test-key' });
  const ten = Array.from({ length: 10 }, (_, i) => `d${i}.com`);
  const VALID: [string, OctenImageSearchOptions][] = [
    ['count 1', { count: 1 }],
    ['count 10', { count: 10 }],
    ['safesearch strict', { safesearch: 'strict' }],
    ['10 include domains', { includeDomains: ten }],
    ['1 exclude domain', { excludeDomains: ['a.com'] }],
    ['every option', ALL_OPTIONS as unknown as OctenImageSearchOptions],
  ];
  it.each(VALID)('accepts %s', (_name, options) => {
    expect(() => octenImageSearch({ client, ...options } as OctenImageSearchOptions)).not.toThrow();
  });

  const INVALID: [string, string, Record<string, unknown>][] = [
    ['count 0', 'count', { count: 0 }],
    ['count 11', 'count', { count: 11 }],
    ['count 2.5', 'count', { count: 2.5 }],
    ['count "5"', 'count', { count: '5' }],
    ['safesearch moderate', 'safesearch', { safesearch: 'moderate' }],
    ['includeDomains 11 items', 'includeDomains', { includeDomains: [...ten, 'x.com'] }],
    ['includeDomains []', 'includeDomains', { includeDomains: [] }],
    ['includeDomains string', 'includeDomains', { includeDomains: 'a.com' }],
    ['excludeDomains blank item', 'excludeDomains[0]', { excludeDomains: [' '] }],
    ['excludeDomains null', 'excludeDomains', { excludeDomains: null }],
  ];
  it.each(INVALID)('rejects %s with OctenValidationError(%s)', (_name, field, options) => {
    const err = thrown(() => octenImageSearch({ client, ...options } as unknown as OctenImageSearchOptions));
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toBe(field);
  });

  it('ignores changes to the options object after the tool is built', async () => {
    const rec = recordingFetch(() => jsonResponse(imageFixture));
    const options: Record<string, unknown> = { client: clientFor(rec.fakeFetch), count: 3 };
    const t = octenImageSearch(options as OctenImageSearchOptions);
    Object.assign(options, { count: 99, safesearch: 'off', includeDomains: ['a.com'], description: 'changed' });
    expect(Object.keys((await modelJsonSchema(t)).properties ?? {})).toContain('include_domains');
    await run(t, { query: 'q' });
    expect(rec.calls[0]?.body).toEqual({ inputs: [{ type: 'text', data: 'q' }], count: 3 });
  });

  it('rejects client together with a client option, like the other tools', () => {
    const err = thrown(() => octenImageSearch({ client, timeout: 1000 } as unknown as OctenImageSearchOptions));
    expect((err as OctenValidationError).field).toBe('timeout');
  });
});

describe('octenImageSearch result', () => {
  it('keeps the citation and display fields of each image, request_id, and drops empty values', async () => {
    const { t } = build();
    const out = (await run(t, { query: 'golden gate bridge at sunset' })) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(['request_id', 'results']);
    expect(out['request_id']).toBe(imageFixture.request_id);
    const [first, second] = imageFixture.data.results;
    const results = out['results'] as Record<string, unknown>[];
    expect(results).toHaveLength(3);
    // The first recorded result has description "", which is left out.
    expect(results[0]).toEqual({
      title: first!.title,
      url: first!.url,
      source_page: first!.source_page,
      width: first!.width,
      height: first!.height,
      thumbnail: first!.thumbnail,
    });
    expect(results[1]).toEqual(second);
  });

  it('passes a non-empty warning through, drops empty items and non-finite sizes', async () => {
    const rec = recordingFetch(() =>
      jsonResponse({
        request_id: 'r1',
        data: { results: [{ title: '', url: null }, 'x', { url: IMG, width: 0, height: null, description: 'd' }] },
        meta: { warning: 'partial results' },
      }),
    );
    const out = await run(octenImageSearch({ client: clientFor(rec.fakeFetch) }), { query: 'q' });
    expect(out).toEqual({ request_id: 'r1', warning: 'partial results', results: [{ url: IMG, width: 0, description: 'd' }] });
  });

  it('returns an empty list when data.results is missing and throws when it is not a list', async () => {
    const empty = recordingFetch(() => jsonResponse({ request_id: 'r2', data: {} }));
    expect(await run(octenImageSearch({ client: clientFor(empty.fakeFetch) }), { query: 'q' })).toEqual({ request_id: 'r2', results: [] });
    const bad = recordingFetch(() => jsonResponse({ request_id: 'r3', data: { results: {} } }));
    await expect(run(octenImageSearch({ client: clientFor(bad.fakeFetch) }), { query: 'q' })).rejects.toThrow(/data\.results/);
  });
});

describe('octenImageSearch description', () => {
  const client = new Octen({ apiKey: 'test-key' });

  it('tells the model to pass exactly one input', () => {
    expect(octenImageSearch({ client }).description).toMatch(/exactly one of `query`.*or `image_url`/);
  });

  it('lets description replace the default', () => {
    expect(octenImageSearch({ client, description: 'Custom text' }).description).toBe('Custom text');
  });
});

describe('octenImageSearch errors and cancellation', () => {
  it('rejects with OctenAbortError when the signal is already aborted, without a request', async () => {
    const { t, calls } = build();
    const controller = new AbortController();
    controller.abort();
    await expect(run(t, { query: 'q' }, controller.signal)).rejects.toBeInstanceOf(OctenAbortError);
    expect(calls).toHaveLength(0);
  });

  it('forwards the abort signal to the in-flight request', async () => {
    const rec = recordingFetch((_url, init) => hangUntilAborted(init));
    const controller = new AbortController();
    const pending = run(octenImageSearch({ client: clientFor(rec.fakeFetch) }), { query: 'q' }, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(OctenAbortError);
    expect(rec.calls).toHaveLength(1);
  });

  // Errors propagate unchanged, as for the other tools; the AI SDK decides how the model sees them.
  it('propagates 401 and 429 as the SDK error classes', async () => {
    const cases: [number, unknown][] = [
      [401, OctenAuthenticationError],
      [429, OctenRateLimitError],
    ];
    for (const [status, cls] of cases) {
      const rec = recordingFetch(() => jsonResponse({ code: status, msg: 'm', request_id: `req-${status}-image` }, status));
      const err = await run(octenImageSearch({ client: clientFor(rec.fakeFetch) }), { query: 'q' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(cls as new () => Error);
      expect((err as OctenAuthenticationError).requestId).toBe(`req-${status}-image`);
    }
  });
});

describe('octenImageSearch review fixes', () => {
  // Each URL parses as no host, fails to parse, or uses another scheme; none may reach the API.
  // The two port cases are rejected by the WHATWG URL parser, which the check relies on.
  const BAD_URLS = [
    'https://',
    'https://:443/x.png',
    'https://[example.com/x.jpg',
    'file:///x.png',
    'https://example.com:abc/x.png',
    'https://example.com:70000/x.png',
  ];

  it.each(BAD_URLS)('refuses image_url %s without a request, in execute and in the input check', async (url) => {
    const { t, calls } = build();
    const err = await run(t, { image_url: url }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toBe('image_url');
    expect((err as Error).message).toMatch(/image_url must be a public http\(s\) URL of an image, with a host name/);
    expect(calls).toHaveLength(0);
    expect((await rejection({ image_url: url })).message).toMatch(/with a host name/);
  });

  it('still sends an http(s) URL with a host, port, path and query string', async () => {
    const { t, calls } = build();
    const url = 'https://images.example.com:8443/a/b.jpg?w=200';
    await run(t, { image_url: url });
    expect(calls[0]?.body).toEqual({ inputs: [{ type: 'image', url }] });
  });

  const guidance: [number, RegExp][] = [
    [413, /too large.*smaller image/s],
    [415, /format is not supported.*JPEG, PNG, WEBP/s],
  ];
  it.each(guidance)('turns HTTP %i into an OctenAPIError whose message tells the model to try another image', async (status, text) => {
    const rec = recordingFetch(() => jsonResponse({ code: status, msg: 'server says no', request_id: `req-${status}` }, status));
    const err = await run(octenImageSearch({ client: clientFor(rec.fakeFetch) }), { image_url: IMG }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenAPIError);
    expect((err as OctenAPIError).status).toBe(status);
    expect((err as OctenAPIError).requestId).toBe(`req-${status}`);
    expect((err as Error).message).toMatch(text);
    // An image-URL call never repeats upstream text, which could carry a copy of a signed URL.
    expect((err as Error).message).not.toMatch(/server says no/);
    expect(rec.calls).toHaveLength(1);
  });

  // A text-query call; an image-URL call drops the upstream text (see the round 5 tests).
  it('leaves 401 and 403 on a text query as the SDK raised them, with no image advice', async () => {
    const cases: [number, unknown][] = [
      [401, OctenAuthenticationError],
      [403, OctenPermissionDeniedError],
    ];
    for (const [status, cls] of cases) {
      const rec = recordingFetch(() => jsonResponse({ code: status, msg: 'denied', request_id: `req-${status}` }, status));
      const err = await run(octenImageSearch({ client: clientFor(rec.fakeFetch) }), { query: 'q' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(cls as new () => Error);
      expect((err as Error).message).toBe('denied');
    }
  });

  it.each([
    ['maxResults', { maxResults: 3 }],
    ['defaults', { defaults: { count: 3 } }],
    ['include_domains', { include_domains: ['a.com'] }],
  ])('rejects the unknown option %s at construction', (field, options) => {
    const err = thrown(() => octenImageSearch({ client: new Octen({ apiKey: 'test-key' }), ...options } as unknown as OctenImageSearchOptions));
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toBe(field);
  });

  it('rejects a sparse domain list at construction', () => {
    const sparse: string[] = [];
    sparse[0] = 'a.com';
    sparse[2] = 'b.com';
    const err = thrown(() => octenImageSearch({ client: new Octen({ apiKey: 'test-key' }), excludeDomains: sparse }));
    expect((err as OctenValidationError).field).toBe('excludeDomains[1]');
  });
});

describe('octenImageSearch review round 3', () => {
  const SIGNED = 'https://cdn.example.com/a.png?sig=SECRET-TOKEN%2Bx&se=2026-11-22';

  it.each([413, 415])('keeps every echo of the submitted image URL out of the HTTP %i message and body', async (status) => {
    // A truncated and a normalized copy, which string replacement of the exact URL would miss.
    const echo = `cannot use ${SIGNED.slice(0, 40)} (${new URL(SIGNED).href.toUpperCase()})`;
    const rec = recordingFetch(() => jsonResponse({ code: status, msg: echo, request_id: `req-${status}`, detail: { url: SIGNED } }, status));
    const err = (await run(octenImageSearch({ client: clientFor(rec.fakeFetch) }), { image_url: SIGNED }).catch((e: unknown) => e)) as OctenAPIError;
    expect(err).toBeInstanceOf(OctenAPIError);
    expect(err.status).toBe(status);
    expect(err.requestId).toBe(`req-${status}`);
    expect(err.message).toMatch(/Try a smaller image|supported format|Try an image/);
    expect(err.message).toBe(`${err.message.split(' (HTTP')[0]} (HTTP ${status}, request req-${status})`);
    const exposed = `${err.message} ${JSON.stringify(err.body) ?? ''}`.toLowerCase();
    expect(exposed).not.toContain('secret-to');
    expect(exposed).not.toContain('cdn.example.com');
    expect(exposed).not.toContain('cannot use');
  });

  it('keeps the upstream message and body for a text query call', async () => {
    const rec = recordingFetch(() => jsonResponse({ code: 413, msg: 'query too large', request_id: 'r' }, 413));
    const err = (await run(octenImageSearch({ client: clientFor(rec.fakeFetch) }), { query: 'q' }).catch((e: unknown) => e)) as OctenAPIError;
    expect(err.message).toMatch(/Try a smaller image.*query too large/s);
    expect(err.body).toEqual({ code: 413, msg: 'query too large', request_id: 'r' });
  });

  it.each(['\u0000https://example.com/a.png', 'https://example.com/a\u0001.png', 'https://example.com/a.png\u007f', 'https:///example.com/a.png', 'http://?x=1'])(
    'refuses the image URL %j with a control character or an empty authority, without a request',
    async (url) => {
      const { t, calls } = build();
      const err = await run(t, { image_url: url }).catch((e: unknown) => e);
      expect((err as OctenValidationError).field).toBe('image_url');
      expect(calls).toHaveLength(0);
      expect((await rejection({ image_url: url })).success).toBe(false);
    },
  );

  it.each(['https:example.com/a.png', 'http:/example.com/a.png', 'https://exa mple.com/photo.png', ' https://example.com/a.png', 'https://example.com/a.png\n'])(
    'refuses %j without a request',
    async (url) => {
      const { t, calls } = build();
      const err = await run(t, { image_url: url }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(OctenValidationError);
      expect((err as OctenValidationError).field).toBe('image_url');
      expect(calls).toHaveLength(0);
      expect((await rejection({ image_url: url })).success).toBe(false);
    },
  );

  it('sends exactly the URL string it validated, without normalizing it', async () => {
    const { t, calls } = build();
    const url = 'HTTPS://Example.COM/a/../b.png?sig=a%2Bb%3D&x=1#frag';
    await run(t, { image_url: url });
    expect(calls[0]?.body).toEqual({ inputs: [{ type: 'image', url }] });
  });
});

describe('octenImageSearch review round 5', () => {
  const SIGNED = 'https://cdn.example.com/a.png?sig=SECRET-TOKEN&se=1';

  it.each([
    [403, OctenPermissionDeniedError],
    [401, OctenAuthenticationError],
    [429, OctenRateLimitError],
    [400, OctenBadRequestError],
    [500, OctenServerError],
  ])('rethrows HTTP %i on an image-URL call as the same class with no upstream text', async (status, cls) => {
    const rec = recordingFetch(() => jsonResponse({ code: status, msg: `refused ${SIGNED}`, request_id: `req-${status}` }, status));
    const err = (await run(octenImageSearch({ client: clientFor(rec.fakeFetch) }), { image_url: SIGNED }).catch((e: unknown) => e)) as OctenAPIError;
    expect(err).toBeInstanceOf(cls as unknown as new () => Error);
    expect(err.status).toBe(status);
    expect(err.requestId).toBe(`req-${status}`);
    expect(err.body).toBeNull();
    expect((err as Error & { cause?: unknown }).cause).toBeUndefined();
    const shown = `${String(err)} ${err.stack ?? ''} ${JSON.stringify(err)} ${inspect(err, { depth: 5 })}`;
    expect(shown).not.toContain('SECRET-TOKEN');
    expect(shown).not.toContain('refused');
  });

  it('keeps retryAfter on a sanitized rate-limit error', async () => {
    const rec = recordingFetch(() => new Response(JSON.stringify({ code: 429, msg: SIGNED, request_id: 'r' }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '120' } }));
    const err = (await run(octenImageSearch({ client: clientFor(rec.fakeFetch) }), { image_url: SIGNED }).catch((e: unknown) => e)) as OctenRateLimitError;
    expect(err).toBeInstanceOf(OctenRateLimitError);
    expect(err.retryAfter).toBe(120);
  });

  it('leaves errors on a text-query call unchanged', async () => {
    const rec = recordingFetch(() => jsonResponse({ code: 403, msg: 'denied for q', request_id: 'r' }, 403));
    const err = (await run(octenImageSearch({ client: clientFor(rec.fakeFetch) }), { query: 'q' }).catch((e: unknown) => e)) as OctenAPIError;
    expect(err).toBeInstanceOf(OctenPermissionDeniedError);
    expect(err.message).toBe('denied for q');
  });

  it('decides URL handling from the request it built, not from the input object afterwards', async () => {
    const input: Record<string, unknown> = { image_url: SIGNED };
    const rec = recordingFetch(() => {
      input['query'] = 'now a text query';
      return jsonResponse({ code: 403, msg: `refused ${SIGNED}`, request_id: 'r' }, 403);
    });
    const err = (await run(octenImageSearch({ client: clientFor(rec.fakeFetch) }), input).catch((e: unknown) => e)) as Error;
    expect(err.message).not.toContain('SECRET-TOKEN');
    expect(rec.calls[0]?.body).toEqual({ inputs: [{ type: 'image', url: SIGNED }] });
  });

  it.each(['https://\\example.com/a.png', 'https://example.com\\@evil.com/a.png', 'https://exa`mple.com/a.png', 'https://"example.com"/a.png'])(
    'refuses %j, whose authority has a character an authority cannot hold, without a request',
    async (url) => {
      const { t, calls } = build();
      const err = await run(t, { image_url: url }).catch((e: unknown) => e);
      expect((err as OctenValidationError).field).toBe('image_url');
      expect(calls).toHaveLength(0);
      expect((await rejection({ image_url: url })).success).toBe(false);
    },
  );

  it('still accepts userinfo, ports and IPv6 hosts', async () => {
    const { t, calls } = build();
    for (const url of ['https://user:pa%20ss@example.com:8443/a.png', 'http://[2001:db8::1]/a.png', 'https://sub-1.example.co.uk/a.png']) {
      await run(t, { image_url: url });
    }
    expect(calls).toHaveLength(3);
  });
});

describe('octenImageSearch review round 6', () => {
  const SIGNED = 'https://cdn.example.com/a.png?sig=SECRET-TOKEN&se=1';
  const shown = (err: unknown) =>
    `${String(err)} ${(err as Error).stack ?? ''} ${JSON.stringify(err)} ${inspect(err, { depth: 8 })}`;

  it('rethrows a connection error on an image-URL call as the same class, with a fixed message and no cause', async () => {
    const leaky = (async (_url: unknown, init?: RequestInit) => {
      throw new TypeError(`socket closed while sending ${String(init?.body)}`, { cause: new Error(`payload ${SIGNED}`) });
    }) as typeof fetch;
    const err = await run(octenImageSearch({ client: clientFor(leaky) }), { image_url: SIGNED }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenConnectionError);
    expect((err as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(shown(err)).not.toContain('SECRET-TOKEN');
    expect(shown(err)).not.toContain('socket closed');
  });

  it('rethrows a client timeout on an image-URL call as the same class with no cause', async () => {
    const rec = recordingFetch((_url, init) => hangUntilAborted(init));
    const t = octenImageSearch({ client: new Octen({ apiKey: 'test-key', fetch: rec.fakeFetch, maxRetries: 0, timeout: 20 }) });
    const err = await run(t, { image_url: SIGNED }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenTimeoutError);
    expect((err as Error & { cause?: unknown }).cause).toBeUndefined();
  });

  it('keeps a caller abort as before, and a connection error on a text query unchanged', async () => {
    const controller = new AbortController();
    controller.abort();
    const { t } = build();
    await expect(run(t, { image_url: SIGNED }, controller.signal)).rejects.toBeInstanceOf(OctenAbortError);
    const leaky = (async () => {
      throw new TypeError('socket closed');
    }) as typeof fetch;
    const err = (await run(octenImageSearch({ client: clientFor(leaky) }), { query: 'q' }).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(OctenConnectionError);
    expect(err.message).toMatch(/socket closed/);
  });

  it.each([
    ['a 501-character query', { query: 'q'.repeat(501) }, 'query'],
    ['11 include domains', { query: 'q', include_domains: Array.from({ length: 11 }, (_, i) => `d${i}.com`) }, 'include_domains'],
    ['an empty exclude domain', { query: 'q', exclude_domains: [''] }, 'exclude_domains'],
    ['a non-string image_url', { image_url: 42 }, 'image_url'],
  ])('refuses %s in a direct execute call without a request', async (_name, input, field) => {
    const { t, calls } = build();
    const err = await run(t, input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toBe(field);
    expect((err as Error).message).toMatch(/No request was made\.$/);
    expect(calls).toHaveLength(0);
  });
});
