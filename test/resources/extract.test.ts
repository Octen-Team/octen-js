import { describe, expect, test, vi } from 'vitest';
import {
  OctenBadRequestError,
  OctenConnectionError,
  OctenPermissionDeniedError,
  OctenServerError,
  OctenTimeoutError,
  OctenValidationError,
} from '../../src/core/errors';
import { HttpCore, type RequestOptions } from '../../src/core/http';
import { defaultExtractTimeoutMs, ExtractResource } from '../../src/resources/extract';
import { BASE, makeFetch } from './helpers';

// Fields and limits: testdata/openapi.json, ExtractRequest / ExtractResult / ExtractUsage (snapshot 2026-11-21).
async function rejectWith(send: () => Promise<unknown>, fetchImpl: unknown, field: string) {
  const err = await send().catch((e: unknown) => e);
  expect(err).toBeInstanceOf(OctenValidationError);
  expect((err as OctenValidationError).field).toBe(field);
  expect(fetchImpl).not.toHaveBeenCalled();
}

const extract = (core: HttpCore) => new ExtractResource(core);

describe('ExtractResource.extract: request body', () => {
  test('sends every field unchanged, with the API wire names, to /extract', async () => {
    const { core, calls } = makeFetch();
    const params = {
      urls: ['https://example.com/a', 'https://example.com/b'],
      mode: 'auto',
      query: 'pricing',
      max_age_seconds: 3600,
      format: 'text',
      timeout: 45,
      include_images: true,
      include_videos: false,
      include_audio: true,
      include_links: { scope: 'prefer_external', max_links: 50 },
    } as const;
    await extract(core).extract(params);
    expect(calls).toEqual([{ url: `${BASE}/extract`, body: params }]);
  });

  test('adds no defaults: unset and undefined fields are omitted', async () => {
    const { core, calls } = makeFetch();
    await extract(core).extract({ urls: ['https://example.com'], mode: undefined, include_links: undefined });
    expect(calls[0]?.body).toEqual({ urls: ['https://example.com'] });
  });

  test('include_links: {} is sent as {} (server defaults), also when its keys are undefined', async () => {
    const { core, calls } = makeFetch();
    await extract(core).extract({ urls: ['https://example.com'], include_links: {} });
    await extract(core).extract({ urls: ['https://example.com'], include_links: { scope: undefined, max_links: undefined } });
    expect(calls.map((c) => c.body)).toEqual([
      { urls: ['https://example.com'], include_links: {} },
      { urls: ['https://example.com'], include_links: {} },
    ]);
  });

  // Ranges other than urls are left to the server, which clamps timeout and max_age_seconds and rejects the rest with a 400
  test('sends out-of-range values outside urls as given', async () => {
    const { core, calls } = makeFetch();
    const params = {
      urls: ['https://example.com'],
      query: 'q'.repeat(501),
      max_age_seconds: 0,
      timeout: 600,
      include_links: { max_links: 0 },
    };
    await extract(core).extract(params);
    expect(calls[0]?.body).toEqual(params);
  });

  test('accepts the documented edges: 20 URLs, and a URL of exactly 2048 characters', async () => {
    const { core, calls } = makeFetch();
    const twenty = Array.from({ length: 20 }, (_, i) => `https://example.com/${i}`);
    const long = `https://example.com/${'a'.repeat(2048 - 20)}`;
    // 2048 code points that are 4096 UTF-16 units: the limit counts characters, not units
    const wide = `https://example.com/${'\u{1F600}'.repeat(2048 - 20)}`;
    await extract(core).extract({ urls: twenty });
    await extract(core).extract({ urls: [long, wide] });
    expect(long).toHaveLength(2048);
    expect([...wide]).toHaveLength(2048);
    expect(calls.map((c) => (c.body as { urls: string[] }).urls.length)).toEqual([20, 2]);
  });
});

describe('ExtractResource.extract: local validation (nothing is sent)', () => {
  test.each([
    ['no urls', {}],
    ['urls: undefined', { urls: undefined }],
    ['an empty urls array', { urls: [] }],
    ['21 URLs', { urls: Array.from({ length: 21 }, (_, i) => `https://example.com/${i}`) }],
    ['a single URL string instead of an array', { urls: 'https://example.com' }],
    ['urls: null', { urls: null }],
    ['params that are not an object', null],
  ])('%s throws OctenValidationError(urls)', async (_name, params) => {
    const { core, fetchImpl } = makeFetch();
    await rejectWith(() => extract(core).extract(params as never), fetchImpl, 'urls');
  });

  test.each([
    ['an empty URL', ['https://example.com', ''], 'urls[1]'],
    ['a blank URL', [' \t '], 'urls[0]'],
    ['a non-string URL', ['https://example.com', 'https://example.org', 42], 'urls[2]'],
    ['an undefined item', ['https://example.com', undefined], 'urls[1]'],
    ['a URL of 2049 characters', [`https://example.com/${'a'.repeat(2049 - 20)}`], 'urls[0]'],
    ['2049 characters beyond the BMP', ['https://example.com', `https://example.com/${'\u{1F600}'.repeat(2049 - 20)}`], 'urls[1]'],
  ])('%s throws OctenValidationError(%s)', async (_name, urls, field) => {
    const { core, fetchImpl } = makeFetch();
    await rejectWith(() => extract(core).extract({ urls } as never), fetchImpl, field);
  });

  test.each([
    [{ include_link: {} }, 'include_link'],
    [{ include_links: { max_link: 3 } }, 'include_links.max_link'],
    [{ highlight: { enable: true } }, 'highlight'],
    [{ count: 5 }, 'count'],
  ])('rejects the undocumented field %j', async (extra, field) => {
    const { core, fetchImpl } = makeFetch();
    await rejectWith(() => extract(core).extract({ urls: ['https://example.com'], ...extra } as never), fetchImpl, field);
  });

  test('rejects values JSON cannot carry', async () => {
    const { core, fetchImpl } = makeFetch();
    await rejectWith(
      () => extract(core).extract({ urls: ['https://example.com'], timeout: Number.NaN }),
      fetchImpl,
      'timeout',
    );
  });
});

describe('ExtractResource.extract: response', () => {
  test('returns a mixed success / failure batch untouched, with media, links, classification and usage', async () => {
    const body = {
      code: 0,
      msg: 'success',
      request_id: 'req_1',
      data: {
        results: [
          {
            url: 'https://example.com/',
            status: 'success',
            resolved_mode: 'standard',
            title: 'Example',
            full_content: '# Example',
            highlights: null,
            time_published: null,
            time_last_crawled: '2026-11-20T10:00:00Z',
            page_structure: { primary: 'Index Page', secondary: null },
            category: null,
            favicon: 'https://example.com/favicon.ico',
            cover_image: { url: 'https://example.com/cover.png' },
            images: [{ url: 'https://example.com/1.png' }],
            videos: [{ url: 'https://example.com/1.mp4' }],
            audio: [{ url: 'https://example.com/1.mp3' }],
            links: [{ url: 'https://example.org/', anchor_text: '', is_external: true }],
            extra_field: 1,
          },
          { url: 'https://broken.invalid/', status: 'failed', error_message: 'Invalid or disallowed URL' },
        ],
      },
      meta: {
        usage: { total_urls: 2, successful_urls: 1, successful_by_mode: { standard_urls: 1, advanced_urls: 0 } },
        latency: 1832,
        warning: '',
      },
    };
    const { core } = makeFetch(body);
    const res = await extract(core).extract({ urls: ['https://example.com/', 'https://broken.invalid/'] });
    expect(res).toEqual(body);
    const byUrl = new Map((res.data?.results ?? []).map((r) => [r.url, r]));
    const ok = byUrl.get('https://example.com/');
    const failed = byUrl.get('https://broken.invalid/');
    expect(ok?.links?.[0]?.is_external).toBe(true);
    expect(ok?.cover_image?.url).toBe('https://example.com/cover.png');
    expect(ok?.page_structure?.secondary).toBeNull();
    expect(ok?.category).toBeNull();
    expect(ok?.extra_field).toBe(1);
    expect(failed?.status).toBe('failed');
    expect(failed?.error_message).toBe('Invalid or disallowed URL');
    expect(failed?.resolved_mode).toBeUndefined();
    expect(res.meta?.usage?.successful_by_mode?.standard_urls).toBe(1);
  });
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function networkError(code: string): TypeError {
  return Object.assign(new TypeError('fetch failed'), { cause: { code } });
}

function scripted(...steps: Array<Response | Error | 'hang'>) {
  const bodies: unknown[] = [];
  const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as unknown);
    const next = steps.shift();
    if (next === undefined) throw new Error('fetch called more times than scripted');
    if (next === 'hang') {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
    }
    if (next instanceof Error) throw next;
    return next;
  });
  const core = new HttpCore({
    apiKey: 'sk-test',
    baseURL: BASE,
    timeoutMs: 1000,
    maxRetries: 3,
    defaultHeaders: {},
    fetch: fetchImpl as unknown as typeof fetch,
    random: () => 0,
    sleep: async () => {},
  });
  return { core, bodies, fetchImpl };
}

const ok = { code: 0, request_id: 'req_ok', data: { results: [] } };
const one = { urls: ['https://example.com'] };

describe('ExtractResource.extract: errors and retries (the SDK-wide policy)', () => {
  test.each([
    [400, { code: 400, msg: 'Invalid params. Param include_links.max_links must be at least 1', request_id: 'r' }, OctenBadRequestError],
    [403, { code: 403, msg: 'Insufficient balance in account', request_id: 'r' }, OctenPermissionDeniedError],
  ])('HTTP %d maps to its class with the server message, without a retry', async (status, body, cls) => {
    const { core, fetchImpl } = scripted(json(status, body));
    const err = await extract(core).extract(one).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(cls);
    expect((err as Error).message).toBe(body.msg);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('a 502 after send is retried with the same body (and may bill again, as documented)', async () => {
    const { core, bodies } = scripted(json(502, { code: 502, msg: 'bad gateway' }), json(200, ok));
    const res = await extract(core).extract({ ...one, mode: 'advanced' });
    expect(res.request_id).toBe('req_ok');
    expect(bodies).toEqual([
      { ...one, mode: 'advanced' },
      { ...one, mode: 'advanced' },
    ]);
  });

  test('5xx retries stop after maxRetries with OctenServerError', async () => {
    const { core, fetchImpl } = scripted(...Array.from({ length: 4 }, () => json(500, { code: 500, msg: 'Internal error' })));
    const err = await extract(core).extract(one).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenServerError);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  test('a network error before sending is retried; one after sending is not', async () => {
    const pre = scripted(networkError('ECONNREFUSED'), json(200, ok));
    expect((await extract(pre.core).extract(one)).request_id).toBe('req_ok');
    expect(pre.fetchImpl).toHaveBeenCalledTimes(2);

    const post = scripted(networkError('ECONNRESET'), json(200, ok));
    expect(await extract(post.core).extract(one).catch((e: unknown) => e)).toBeInstanceOf(OctenConnectionError);
    expect(post.fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('a client timeout is not retried', async () => {
    const { core, fetchImpl } = scripted('hang', json(200, ok));
    const err = await extract(core).extract(one, { timeout: 20 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenTimeoutError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('ExtractResource.extract: HTTP timeout', () => {
  test.each([
    [undefined, 120_000],
    [30, 120_000],
    [1, 91_000],
    [60, 150_000],
    // the server clamps the per-URL timeout to 1-60 s, so the HTTP default follows the clamped value
    [0, 91_000],
    [-5, 91_000],
    [600, 150_000],
    [12.5, 102_500],
  ])('per-URL timeout %s gives an HTTP default of %d ms', (perUrl, ms) => {
    expect(defaultExtractTimeoutMs(perUrl)).toBe(ms);
  });

  test('passes the derived default, or the per-call timeout, with the other options intact', async () => {
    const posts: unknown[][] = [];
    const core = { post: async (...args: unknown[]) => (posts.push(args), { request_id: 'r' }) } as unknown as HttpCore;
    const signal = new AbortController().signal;
    await new ExtractResource(core).extract({ urls: ['u'], timeout: 60 }, { signal, headers: { 'x-a': '1' } });
    await new ExtractResource(core).extract({ urls: ['u'] }, { timeout: 5000 });
    expect(posts[0]?.[2]).toEqual({ signal, headers: { 'x-a': '1' }, timeout: 150_000 });
    expect(posts[1]?.[2]).toEqual({ timeout: 5000 });
  });

  test('with an explicit client timeout the options pass through untouched', async () => {
    const posts: unknown[][] = [];
    const core = { post: async (...args: unknown[]) => (posts.push(args), { request_id: 'r' }) } as unknown as HttpCore;
    const r: RequestOptions = { headers: { 'x-a': '1' } };
    await new ExtractResource(core, true).extract({ urls: ['u'], timeout: 60 }, r);
    await new ExtractResource(core, true).extract({ urls: ['u'] });
    expect(posts[0]?.[2]).toBe(r);
    expect(posts[1]?.[2]).toBeUndefined();
  });
});

// Type level only; never executed. If an @ts-expect-error stops erroring, typecheck fails.
export function typeLevelChecks(x: ExtractResource) {
  // @ts-expect-error urls is required
  void x.extract({ query: 'q' });
  // @ts-expect-error urls is an array, not a string
  void x.extract({ urls: 'https://example.com' });
  // @ts-expect-error mode is standard, advanced or auto
  void x.extract({ urls: ['u'], mode: 'turbo' });
  // @ts-expect-error format is markdown or text
  void x.extract({ urls: ['u'], format: 'html' });
  // @ts-expect-error scope is prefer_internal or prefer_external
  void x.extract({ urls: ['u'], include_links: { scope: 'all' } });
  // a readonly array is accepted
  const urls: readonly string[] = ['u'];
  void x.extract({ urls });
}
