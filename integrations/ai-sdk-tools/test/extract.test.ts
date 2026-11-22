import {
  Octen,
  OctenAbortError,
  OctenAuthenticationError,
  OctenBadRequestError,
  OctenRateLimitError,
  OctenValidationError,
} from '@octen.ai/sdk';
import { asSchema } from 'ai';
import { describe, expect, it } from 'vitest';
import { octenExtract } from '../src/tools/extract.js';
import type { OctenExtractOptions } from '../src/tools/extract.js';
import { clientFor, hangUntilAborted, jsonResponse, modelJsonSchema, recordingFetch, run, validateInput } from './helpers.js';
// Replies are the production envelope recorded in test/fixtures/extract.json.
import extractFixture from './fixtures/extract.json';

const A = 'https://example.com/a';
const B = 'https://example.com/b';
const urlsOf = (n: number) => Array.from({ length: n }, (_, i) => `https://example.com/${i}`);

// Every developer option with a value inside the bounds of the API reference (docs.octen.ai/api-reference/extract).
const ALL_OPTIONS = {
  mode: 'advanced',
  format: 'text',
  maxAgeSeconds: 600,
  urlTimeout: 45,
  includeImages: true,
  includeVideos: true,
  includeAudio: true,
  includeLinks: { scope: 'prefer_external', maxLinks: 3 },
} as const;
const ALL_OPTIONS_WIRE = {
  mode: 'advanced',
  format: 'text',
  max_age_seconds: 600,
  timeout: 45,
  include_images: true,
  include_videos: true,
  include_audio: true,
  include_links: { scope: 'prefer_external', max_links: 3 },
};

function build(options: OctenExtractOptions = {}) {
  const rec = recordingFetch(() => jsonResponse(extractFixture));
  const t = octenExtract({ ...options, client: clientFor(rec.fakeFetch) } as OctenExtractOptions);
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

async function rejection(value: unknown): Promise<{ success: boolean; message: string }> {
  const t = octenExtract({ client: new Octen({ apiKey: 'test-key' }), maxUrls: 3 });
  const result = await asSchema(t.inputSchema as Parameters<typeof asSchema>[0]).validate?.(value);
  return { success: result?.success === true, message: result?.success === false ? String(result.error.message) : '' };
}

describe('octenExtract request', () => {
  it('sends only the model urls to /extract when no option is set', async () => {
    const { t, calls } = build();
    await run(t, { urls: [A, B] });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!.url).pathname).toBe('/extract');
    expect(calls[0]?.body).toEqual({ urls: [A, B] });
  });

  it('sends the model query and every developer option under the API names', async () => {
    const { t, calls } = build(ALL_OPTIONS);
    await run(t, { urls: [A], query: 'pricing' });
    expect(calls[0]?.body).toEqual({ urls: [A], query: 'pricing', ...ALL_OPTIONS_WIRE });
  });

  it('sends includeLinks {} as include_links {} so the server defaults apply', async () => {
    const { t, calls } = build({ includeLinks: {} });
    await run(t, { urls: [A] });
    expect(calls[0]?.body).toEqual({ urls: [A], include_links: {} });
  });

  it('sends mode auto and false booleans as given', async () => {
    const { t, calls } = build({ mode: 'auto', includeImages: false, includeVideos: false, includeAudio: false });
    await run(t, { urls: [A] });
    expect(calls[0]?.body).toEqual({ urls: [A], mode: 'auto', include_images: false, include_videos: false, include_audio: false });
  });

  it('omits options set to undefined and a query sent as null', async () => {
    const options = Object.fromEntries(Object.keys(ALL_OPTIONS).map((k) => [k, undefined])) as OctenExtractOptions;
    const { t, calls } = build({ ...options, includeLinks: { scope: undefined, maxLinks: 5 } } as unknown as OctenExtractOptions);
    await run(t, { urls: [A], query: null });
    expect(calls[0]?.body).toEqual({ urls: [A], include_links: { max_links: 5 } });
  });

  // A non-strict provider can send keys outside the schema; none of them may reach the request.
  it('drops developer-only fields the model sends outside its schema', async () => {
    const { t, calls } = build({ maxUrls: 2 });
    await run(t, { urls: [A], ...ALL_OPTIONS_WIRE, ...ALL_OPTIONS, max_urls: 20 });
    expect(calls[0]?.body).toEqual({ urls: [A] });
  });

  it('keeps the developer value when the model sends the same field', async () => {
    const { t, calls } = build({ format: 'markdown', urlTimeout: 10 });
    await run(t, { urls: [A], format: 'text', timeout: 60 });
    expect(calls[0]?.body).toEqual({ urls: [A], format: 'markdown', timeout: 10 });
  });

  it('copies includeLinks when the tool is built, so later changes to the object do not leak in', async () => {
    const links: { scope?: 'prefer_internal' | 'prefer_external'; maxLinks?: number } = { maxLinks: 3 };
    const { t, calls } = build({ includeLinks: links });
    links.maxLinks = 900;
    links.scope = 'prefer_external';
    await run(t, { urls: [A] });
    expect(calls[0]?.body).toEqual({ urls: [A], include_links: { max_links: 3 } });
  });
});

describe('octenExtract model input', () => {
  it('exposes only urls and query to the model', async () => {
    const json = await modelJsonSchema(octenExtract({ client: new Octen({ apiKey: 'test-key' }), ...ALL_OPTIONS }));
    expect(Object.keys(json.properties ?? {}).sort()).toEqual(['query', 'urls']);
    expect(json.required).toEqual(['urls']);
  });

  it('states the URL limits in the JSON schema, with maxItems from maxUrls', async () => {
    const urls = async (options: OctenExtractOptions) =>
      (await modelJsonSchema(octenExtract({ client: new Octen({ apiKey: 'test-key' }), ...options } as OctenExtractOptions)))
        .properties?.['urls'] as Record<string, unknown>;
    expect(await urls({})).toMatchObject({ type: 'array', minItems: 1, maxItems: 5, items: { type: 'string', minLength: 1, maxLength: 2048 } });
    expect((await urls({ maxUrls: 12 }))['maxItems']).toBe(12);
    const json = await modelJsonSchema(octenExtract({ client: new Octen({ apiKey: 'test-key' }) }));
    expect(json.properties?.['query']).toMatchObject({
      anyOf: [{ type: 'string', minLength: 1, maxLength: 500 }, { type: 'null' }],
    });
  });

  it('accepts 1 to maxUrls URLs and rejects 0 or more, as the AI SDK validates the input', async () => {
    const t = octenExtract({ client: new Octen({ apiKey: 'test-key' }), maxUrls: 3 });
    expect(await validateInput(t, { urls: urlsOf(1) })).toBe(true);
    expect(await validateInput(t, { urls: urlsOf(3) })).toBe(true);
    expect(await validateInput(t, { urls: urlsOf(4) })).toBe(false);
    expect(await validateInput(t, { urls: [] })).toBe(false);
    expect(await validateInput(t, {})).toBe(false);
  });

  it('tells the model the cap and to split the list when it sends too many URLs', async () => {
    const result = await rejection({ urls: urlsOf(4) });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/at most 3 URLs/);
    expect(result.message).toMatch(/split/);
  });

  it('accepts URLs of 1 to 2048 characters and a query of 1 to 500 characters, null or missing', async () => {
    const t = octenExtract({ client: new Octen({ apiKey: 'test-key' }) });
    const url = (n: number) => `https://e.com/${'a'.repeat(n - 14)}`;
    expect(await validateInput(t, { urls: [url(2048)] })).toBe(true);
    expect(await validateInput(t, { urls: [url(2049)] })).toBe(false);
    expect(await validateInput(t, { urls: [''] })).toBe(false);
    expect(await validateInput(t, { urls: [A], query: 'q' })).toBe(true);
    expect(await validateInput(t, { urls: [A], query: 'q'.repeat(500) })).toBe(true);
    expect(await validateInput(t, { urls: [A], query: 'q'.repeat(501) })).toBe(false);
    expect(await validateInput(t, { urls: [A], query: '' })).toBe(false);
    expect(await validateInput(t, { urls: [A], query: null })).toBe(true);
  });

  // JSON Schema maxLength and the SDK's own URL check count code points, so an emoji counts once, not twice.
  it('counts URL and query length in code points, like the JSON schema and the SDK', async () => {
    const t = octenExtract({ client: new Octen({ apiKey: 'test-key' }) });
    const emojiUrl = (n: number) => `https://e.com/${'\u{1F600}'.repeat(n - 14)}`;
    expect(emojiUrl(2048).length).toBe(4082);
    expect(await validateInput(t, { urls: [emojiUrl(2048)] })).toBe(true);
    expect(await validateInput(t, { urls: [emojiUrl(2049)] })).toBe(false);
    expect(await validateInput(t, { urls: [A], query: '\u{1F600}'.repeat(500) })).toBe(true);
    expect(await validateInput(t, { urls: [A], query: '\u{1F600}'.repeat(501) })).toBe(false);
  });

  it('sends a URL of 2048 code points that the SDK accepts', async () => {
    const { t, calls } = build();
    const url = `https://e.com/${'\u{1F600}'.repeat(2034)}`;
    await run(t, { urls: [url] });
    expect(calls[0]?.body).toEqual({ urls: [url] });
  });

  it('refuses more URLs than maxUrls without a request, naming the count, the cap and the split', async () => {
    const { t, calls } = build({ maxUrls: 2 });
    const err = await run(t, { urls: urlsOf(3) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toBe('urls');
    expect((err as Error).message).toBe(
      'Too many URLs: got 3, but this tool reads at most 2 per call. No request was made; split them into several calls of at most 2 URLs each.',
    );
    expect(calls).toHaveLength(0);
    await run(t, { urls: urlsOf(2) });
    expect(calls).toHaveLength(1);
  });

  it('refuses the default cap of 5 at 6 URLs', async () => {
    const { t, calls } = build();
    await expect(run(t, { urls: urlsOf(6) })).rejects.toThrow(/got 6, but this tool reads at most 5 per call/);
    expect(calls).toHaveLength(0);
  });

  it('refuses an empty or missing list without a request', async () => {
    const { t, calls } = build();
    for (const input of [{ urls: [] }, {}]) {
      const err = await run(t, input).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(OctenValidationError);
      expect((err as Error).message).toBe('No URLs given: pass 1 to 5 URLs. No request was made.');
    }
    expect(calls).toHaveLength(0);
  });
});

describe('octenExtract construction', () => {
  const client = new Octen({ apiKey: 'test-key' });
  const VALID: [string, OctenExtractOptions][] = [
    ['maxUrls 1', { maxUrls: 1 }],
    ['maxUrls 20', { maxUrls: 20 }],
    ['maxAgeSeconds 300', { maxAgeSeconds: 300 }],
    ['maxAgeSeconds 31536000', { maxAgeSeconds: 31_536_000 }],
    ['urlTimeout 1', { urlTimeout: 1 }],
    ['urlTimeout 60', { urlTimeout: 60 }],
    ['includeLinks maxLinks 1', { includeLinks: { maxLinks: 1 } }],
    ['includeLinks maxLinks 1000', { includeLinks: { maxLinks: 1000 } }],
    ['includeLinks scope prefer_internal', { includeLinks: { scope: 'prefer_internal' } }],
    ['includeLinks {}', { includeLinks: {} }],
    ['every option', ALL_OPTIONS],
  ];
  it.each(VALID)('accepts %s', (_name, options) => {
    expect(() => octenExtract({ client, ...options } as OctenExtractOptions)).not.toThrow();
  });

  const INVALID: [string, string, Record<string, unknown>][] = [
    ['maxUrls 0', 'maxUrls', { maxUrls: 0 }],
    ['maxUrls 21', 'maxUrls', { maxUrls: 21 }],
    ['maxUrls 2.5', 'maxUrls', { maxUrls: 2.5 }],
    ['maxUrls "5"', 'maxUrls', { maxUrls: '5' }],
    ['maxUrls null', 'maxUrls', { maxUrls: null }],
    ['mode fast', 'mode', { mode: 'fast' }],
    ['format html', 'format', { format: 'html' }],
    ['maxAgeSeconds 299', 'maxAgeSeconds', { maxAgeSeconds: 299 }],
    ['maxAgeSeconds 31536001', 'maxAgeSeconds', { maxAgeSeconds: 31_536_001 }],
    ['maxAgeSeconds 300.5', 'maxAgeSeconds', { maxAgeSeconds: 300.5 }],
    ['urlTimeout 0', 'urlTimeout', { urlTimeout: 0 }],
    ['urlTimeout 61', 'urlTimeout', { urlTimeout: 61 }],
    ['urlTimeout NaN', 'urlTimeout', { urlTimeout: Number.NaN }],
    ['includeImages "yes"', 'includeImages', { includeImages: 'yes' }],
    ['includeVideos 1', 'includeVideos', { includeVideos: 1 }],
    ['includeAudio null', 'includeAudio', { includeAudio: null }],
    ['includeLinks true', 'includeLinks', { includeLinks: true }],
    ['includeLinks []', 'includeLinks', { includeLinks: [] }],
    ['includeLinks maxLinks 0', 'includeLinks.maxLinks', { includeLinks: { maxLinks: 0 } }],
    ['includeLinks maxLinks 1001', 'includeLinks.maxLinks', { includeLinks: { maxLinks: 1001 } }],
    ['includeLinks maxLinks 1.5', 'includeLinks.maxLinks', { includeLinks: { maxLinks: 1.5 } }],
    ['includeLinks scope internal', 'includeLinks.scope', { includeLinks: { scope: 'internal' } }],
    ['includeLinks max_links', 'includeLinks.max_links', { includeLinks: { max_links: 3 } }],
  ];
  it.each(INVALID)('rejects %s with OctenValidationError(%s)', (_name, field, options) => {
    const err = thrown(() => octenExtract({ client, ...options } as unknown as OctenExtractOptions));
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toBe(field);
  });

  // Construction validates one snapshot, which the schema, the cap and the request all use afterwards.
  it('ignores changes to the options object after the tool is built', async () => {
    const rec = recordingFetch(() => jsonResponse(extractFixture));
    const links: Record<string, unknown> = { maxLinks: 3 };
    const options: Record<string, unknown> = { client: clientFor(rec.fakeFetch), maxUrls: 2, mode: 'standard', urlTimeout: 10, includeLinks: links };
    const t = octenExtract(options as OctenExtractOptions);
    Object.assign(options, { maxUrls: 20, mode: 'fast', urlTimeout: 999, format: 'html', description: 'changed' });
    Object.assign(links, { maxLinks: 5000, max_links: 1 });
    expect(((await modelJsonSchema(t)).properties?.['urls'] as { maxItems?: number }).maxItems).toBe(2);
    expect(t.description).toMatch(/at most 2 URLs per call/);
    expect(await validateInput(t, { urls: urlsOf(3) })).toBe(false);
    await expect(run(t, { urls: urlsOf(3) })).rejects.toThrow(/at most 2 per call/);
    await run(t, { urls: [A] });
    expect(rec.calls.map((c) => c.body)).toEqual([{ urls: [A], mode: 'standard', timeout: 10, include_links: { max_links: 3 } }]);
  });

  it('reads each option once, so a getter cannot pass validation with one value and send another', async () => {
    const rec = recordingFetch(() => jsonResponse(extractFixture));
    const reads: Record<string, number> = {};
    const counted = <T extends object>(target: T, prefix: string): T =>
      new Proxy(target, {
        get(obj, key, receiver) {
          if (typeof key === 'string') reads[prefix + key] = (reads[prefix + key] ?? 0) + 1;
          return Reflect.get(obj, key, receiver) as unknown;
        },
      });
    const options = counted(
      { client: clientFor(rec.fakeFetch), maxUrls: 2, mode: 'advanced', maxAgeSeconds: 600, includeLinks: counted({ maxLinks: 3 }, 'includeLinks.') },
      '',
    );
    const t = octenExtract(options as OctenExtractOptions);
    await run(t, { urls: [A] });
    expect(Object.entries(reads).filter(([, n]) => n > 1)).toEqual([]);
    expect(rec.calls[0]?.body).toEqual({ urls: [A], mode: 'advanced', max_age_seconds: 600, include_links: { max_links: 3 } });
  });

  it('rejects client together with a client option, like the other tools', () => {
    const err = thrown(() => octenExtract({ client, timeout: 1000 } as unknown as OctenExtractOptions));
    expect((err as OctenValidationError).field).toBe('timeout');
  });
});

describe('octenExtract result', () => {
  const [page, broken] = extractFixture.data.results;

  it('keeps every item, failures included, and carries request_id and warning', async () => {
    const { t } = build();
    const out = (await run(t, { urls: [page!.url, broken!.url] })) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(['request_id', 'warning', 'results']);
    expect(out['request_id']).toBe(extractFixture.request_id);
    expect(out['warning']).toBe(extractFixture.meta.warning);
    const results = out['results'] as Record<string, unknown>[];
    expect(results.map((r) => r['url'])).toEqual([page!.url, broken!.url]);
    expect(results[1]).toEqual({ url: broken!.url, status: 'failed', error_message: broken!.error_message });
    // favicon and resolved_mode are dropped; media becomes a list of URLs
    expect(results[0]).toEqual({
      url: page!.url,
      status: 'success',
      title: page!.title,
      full_content: page!.full_content,
      time_last_crawled: page!.time_last_crawled,
      category: page!.category,
      page_structure: page!.page_structure,
      cover_image: page!.cover_image!.url,
      images: page!.images!.map((i) => i.url),
      links: [
        { url: page!.links![0]!.url, anchor_text: page!.links![0]!.anchor_text, is_external: false },
        { url: page!.links![1]!.url, is_external: false },
        { url: page!.links![2]!.url, anchor_text: page!.links![2]!.anchor_text, is_external: false },
      ],
    });
  });

  it('keeps highlights, publish time, videos and audio, and drops empty or null values', async () => {
    const item = {
      url: A,
      status: 'success',
      resolved_mode: 'advanced',
      title: '',
      full_content: null,
      highlights: ['First passage.', '', 'Second passage.'],
      time_published: '2026-01-02T00:00:00Z',
      time_last_crawled: '2026-11-22T00:00:00Z',
      category: { primary: 'News', secondary: null },
      page_structure: null,
      cover_image: null,
      images: [],
      videos: [{ url: 'https://example.com/v.mp4' }, { url: '' }],
      audio: [{ url: 'https://example.com/a.mp3' }],
      links: [{ url: '' }, 'x'],
      error_message: '',
    };
    const rec = recordingFetch(() => jsonResponse({ ...extractFixture, data: { results: [item] }, meta: { warning: '' } }));
    const out = (await run(octenExtract({ client: clientFor(rec.fakeFetch) }), { urls: [A], query: 'q' })) as Record<string, unknown>;
    expect(out).toEqual({
      request_id: extractFixture.request_id,
      results: [
        {
          url: A,
          status: 'success',
          highlights: ['First passage.', 'Second passage.'],
          time_published: '2026-01-02T00:00:00Z',
          time_last_crawled: '2026-11-22T00:00:00Z',
          category: { primary: 'News' },
          videos: ['https://example.com/v.mp4'],
          audio: ['https://example.com/a.mp3'],
        },
      ],
    });
  });

  it('does not shorten the content', async () => {
    const long = 'x'.repeat(200_000);
    const rec = recordingFetch(() =>
      jsonResponse({ ...extractFixture, data: { results: [{ url: A, status: 'success', full_content: long }] } }),
    );
    const out = (await run(octenExtract({ client: clientFor(rec.fakeFetch) }), { urls: [A] })) as { results: { full_content?: string }[] };
    expect(out.results[0]?.full_content).toBe(long);
  });

  it('returns an empty list when data.results is null and throws when it is not a list', async () => {
    const empty = recordingFetch(() => jsonResponse({ ...extractFixture, data: { results: null }, meta: {} }));
    expect(await run(octenExtract({ client: clientFor(empty.fakeFetch) }), { urls: [A] })).toEqual({
      request_id: extractFixture.request_id,
      results: [],
    });
    const bad = recordingFetch(() => jsonResponse({ ...extractFixture, data: { results: 'oops' } }));
    await expect(run(octenExtract({ client: clientFor(bad.fakeFetch) }), { urls: [A] })).rejects.toThrow(/data\.results/);
  });
});

describe('octenExtract description', () => {
  const client = new Octen({ apiKey: 'test-key' });

  it('tells the model to match by url, that failures are per URL, and the cap', () => {
    const d = octenExtract({ client, maxUrls: 7 }).description ?? '';
    expect(d).toMatch(/Match results to your URLs by each item's `url`, not by position/);
    expect(d).toMatch(/status "failed" and an `error_message`/);
    expect(d).toMatch(/Pass at most 7 URLs per call; split a longer list into several calls\.$/);
    expect(octenExtract({ client }).description).toMatch(/at most 5 URLs per call/);
  });

  it('lets description replace the default', () => {
    expect(octenExtract({ client, description: 'Custom text' }).description).toBe('Custom text');
  });
});

describe('octenExtract errors and cancellation', () => {
  it('rejects with OctenAbortError when the signal is already aborted, without a request', async () => {
    const { t, calls } = build();
    const controller = new AbortController();
    controller.abort();
    await expect(run(t, { urls: [A] }, controller.signal)).rejects.toBeInstanceOf(OctenAbortError);
    expect(calls).toHaveLength(0);
  });

  it('forwards the abort signal to the in-flight request', async () => {
    const rec = recordingFetch((_url, init) => hangUntilAborted(init));
    const controller = new AbortController();
    const pending = run(octenExtract({ client: clientFor(rec.fakeFetch) }), { urls: [A] }, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(OctenAbortError);
    expect(rec.calls).toHaveLength(1);
  });

  // Errors propagate unchanged, as for the other tools; the AI SDK decides how the model sees them.
  it('propagates 400, 401 and 429 as the SDK error classes', async () => {
    const cases: [number, string, unknown][] = [
      [400, 'invalid request', OctenBadRequestError],
      [401, 'invalid api key', OctenAuthenticationError],
      [429, 'Exceeding the rate limit.', OctenRateLimitError],
    ];
    for (const [status, msg, cls] of cases) {
      const rec = recordingFetch(() => jsonResponse({ code: status, msg, request_id: `req-${status}-extract` }, status));
      const err = await run(octenExtract({ client: clientFor(rec.fakeFetch) }), { urls: [A] }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(cls as new () => Error);
      expect((err as OctenAuthenticationError).requestId).toBe(`req-${status}-extract`);
    }
  });
});
