import {
  Octen,
  OctenAbortError,
  OctenAPIError,
  OctenAuthenticationError,
  OctenPermissionDeniedError,
  OctenRateLimitError,
  OctenValidationError,
} from '@octen.ai/sdk';
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
    expect((err as Error).message).toMatch(/server says no/);
    expect(rec.calls).toHaveLength(1);
  });

  it('leaves 401 and 403 as the SDK raised them, with no image advice', async () => {
    const cases: [number, unknown][] = [
      [401, OctenAuthenticationError],
      [403, OctenPermissionDeniedError],
    ];
    for (const [status, cls] of cases) {
      const rec = recordingFetch(() => jsonResponse({ code: status, msg: 'denied', request_id: `req-${status}` }, status));
      const err = await run(octenImageSearch({ client: clientFor(rec.fakeFetch) }), { image_url: IMG }).catch((e: unknown) => e);
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
