import { describe, expect, test, vi } from 'vitest';
import {
  OctenAbortError,
  OctenAPIError,
  OctenBadRequestError,
  OctenConnectionError,
  OctenError,
  OctenRateLimitError,
  OctenServerError,
  OctenTimeoutError,
  OctenValidationError,
  isOctenError,
} from '../../src/core/errors';
import { HttpCore } from '../../src/core/http';
import { VERSION } from '../../src/version';

type FetchFn = typeof fetch;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function makeCore(fetchImpl: FetchFn, over: Partial<ConstructorParameters<typeof HttpCore>[0]> = {}) {
  const sleeps: number[] = [];
  const core = new HttpCore({
    apiKey: 'sk-test',
    baseURL: 'https://api.example.com',
    timeoutMs: 1000,
    maxRetries: 3,
    defaultHeaders: {},
    fetch: fetchImpl,
    random: () => 0,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...over,
  });
  return { core, sleeps };
}

function sequence(...responses: Array<Response | Error>) {
  const fn = vi.fn(async () => {
    const next = responses.shift();
    if (next === undefined) throw new Error('fetch called more times than scripted');
    if (next instanceof Error) throw next;
    return next;
  });
  return fn;
}

function networkError(code: string): TypeError {
  return Object.assign(new TypeError('fetch failed'), { cause: { code } });
}

describe('HttpCore.post', () => {
  test('returns the parsed body on 2xx', async () => {
    const f = sequence(json(200, { results: [1] }));
    const { core } = makeCore(f as unknown as FetchFn);
    await expect(core.post('/search', { query: 'q' })).resolves.toEqual({ results: [1] });
    expect(f).toHaveBeenCalledTimes(1);
  });

  test('retries 503 then succeeds', async () => {
    const f = sequence(json(503, { msg: 'busy' }), json(200, { ok: 1 }));
    const { core, sleeps } = makeCore(f as unknown as FetchFn);
    await expect(core.post('/search', {})).resolves.toEqual({ ok: 1 });
    expect(f).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([1000]);
  });

  test('backoff grows per attempt and Retry-After wins on 429/503', async () => {
    const f = sequence(
      json(502, {}),
      json(502, {}),
      json(503, {}, { 'retry-after': '2' }),
      json(200, { ok: 1 }),
    );
    const { core, sleeps } = makeCore(f as unknown as FetchFn);
    await core.post('/search', {});
    expect(sleeps).toEqual([1000, 2000, 2000]);
  });

  test('gives up after maxRetries retries with the mapped class', async () => {
    const f = vi.fn(async () => json(503, { msg: 'busy' }));
    const { core } = makeCore(f as unknown as FetchFn, { maxRetries: 2 });
    const err = await core.post('/search', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenServerError);
    expect((err as OctenServerError).status).toBe(503);
    expect(f).toHaveBeenCalledTimes(3);
  });

  test('exhausted 429 is OctenRateLimitError and exhausted 408 is OctenAPIError', async () => {
    const f429 = vi.fn(async () => json(429, { msg: 'slow' }));
    const a = await makeCore(f429 as unknown as FetchFn, { maxRetries: 1 })
      .core.post('/x', {})
      .catch((e: unknown) => e);
    expect(a).toBeInstanceOf(OctenRateLimitError);
    expect(f429).toHaveBeenCalledTimes(2);

    const f408 = vi.fn(async () => json(408, { msg: 'timeout' }));
    const b = await makeCore(f408 as unknown as FetchFn, { maxRetries: 1 })
      .core.post('/x', {})
      .catch((e: unknown) => e);
    expect((b as object).constructor).toBe(OctenAPIError);
    expect(f408).toHaveBeenCalledTimes(2);
  });

  test('maxRetries 0 sends exactly once', async () => {
    const f = vi.fn(async () => json(503, {}));
    const { core } = makeCore(f as unknown as FetchFn, { maxRetries: 0 });
    await expect(core.post('/x', {})).rejects.toBeInstanceOf(OctenServerError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  test('does not retry other statuses', async () => {
    for (const status of [400, 401, 403, 404, 422, 501]) {
      const f = vi.fn(async () => json(status, { msg: 'no' }));
      const { core } = makeCore(f as unknown as FetchFn);
      await expect(core.post('/x', {})).rejects.toBeInstanceOf(OctenAPIError);
      expect(f).toHaveBeenCalledTimes(1);
    }
  });

  test('does not retry a 2xx that is judged a failure', async () => {
    const f = vi.fn(async () => json(200, { code: 1001, msg: 'invalid' }));
    const { core } = makeCore(f as unknown as FetchFn);
    const err = await core.post('/x', {}).catch((e: unknown) => e);
    expect((err as OctenAPIError).code).toBe(1001);
    expect(f).toHaveBeenCalledTimes(1);
  });

  test('does not retry client timeout', async () => {
    const f = vi.fn(() => new Promise<Response>(() => {}));
    const { core } = makeCore(f as unknown as FetchFn, { timeoutMs: 20 });
    await expect(core.post('/x', {})).rejects.toBeInstanceOf(OctenTimeoutError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  test('per-request timeout overrides the client default', async () => {
    const f = vi.fn(() => new Promise<Response>(() => {}));
    const { core } = makeCore(f as unknown as FetchFn, { timeoutMs: 60_000 });
    await expect(core.post('/x', {}, { timeout: 20 })).rejects.toBeInstanceOf(OctenTimeoutError);
  });

  test('test_timeout_covers_body_read', async () => {
    const f = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"a":'));
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const { core } = makeCore(f as unknown as FetchFn, { timeoutMs: 30 });
    await expect(core.post('/x', {})).rejects.toBeInstanceOf(OctenTimeoutError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  test('test_pre_aborted_signal_sends_nothing', async () => {
    const f = vi.fn(async () => json(200, { ok: 1 }));
    const { core } = makeCore(f as unknown as FetchFn);
    const ac = new AbortController();
    ac.abort();
    await expect(core.post('/x', {}, { signal: ac.signal })).rejects.toBeInstanceOf(OctenAbortError);
    expect(f).toHaveBeenCalledTimes(0);
  });

  test('caller abort while fetch is pending is OctenAbortError, not a timeout', async () => {
    const ac = new AbortController();
    const f = vi.fn(() => {
      queueMicrotask(() => ac.abort());
      return new Promise<Response>(() => {});
    });
    const { core } = makeCore(f as unknown as FetchFn, { timeoutMs: 60_000 });
    await expect(core.post('/x', {}, { signal: ac.signal })).rejects.toBeInstanceOf(OctenAbortError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  test('abort during backoff stops retrying', async () => {
    const ac = new AbortController();
    const f = sequence(json(503, {}), json(200, { ok: 1 }));
    const { core } = makeCore(f as unknown as FetchFn, {
      sleep: () => {
        ac.abort();
        return new Promise<void>(() => {});
      },
    });
    await expect(core.post('/x', {}, { signal: ac.signal })).rejects.toBeInstanceOf(OctenAbortError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  // The loop re-checks the signal before every attempt, so a sleep that resolves after an abort still stops.
  test('a sleep that resolves after the caller aborted does not send again', async () => {
    const ac = new AbortController();
    const f = sequence(json(503, {}), json(200, { ok: 1 }));
    const { core } = makeCore(f as unknown as FetchFn, {
      sleep: async () => {
        ac.abort();
      },
    });
    await expect(core.post('/x', {}, { signal: ac.signal })).rejects.toBeInstanceOf(OctenAbortError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  test('abort during the default backoff sleep rejects promptly', async () => {
    const ac = new AbortController();
    const f = vi.fn(async () => json(503, {}));
    const core = new HttpCore({
      apiKey: 'sk-test',
      baseURL: 'https://api.example.com',
      timeoutMs: 1000,
      maxRetries: 3,
      defaultHeaders: {},
      fetch: f as unknown as FetchFn,
      random: () => 0,
    });
    setTimeout(() => ac.abort(), 30);
    const started = Date.now();
    await expect(core.post('/x', {}, { signal: ac.signal })).rejects.toBeInstanceOf(OctenAbortError);
    expect(Date.now() - started).toBeLessThan(500);
    expect(f).toHaveBeenCalledTimes(1);
  });

  test('does not retry after-send network error', async () => {
    const f = sequence(networkError('ECONNRESET'));
    const { core } = makeCore(f as unknown as FetchFn);
    const err = await core.post('/x', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenConnectionError);
    expect((err as OctenConnectionError).cause).toBeInstanceOf(TypeError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  test('does not retry a network error without a cause code', async () => {
    const f = sequence(new TypeError('fetch failed'));
    const { core } = makeCore(f as unknown as FetchFn);
    await expect(core.post('/x', {})).rejects.toBeInstanceOf(OctenConnectionError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  test('a pre-send-looking error while reading the body is not retried', async () => {
    const f = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(networkError('ECONNREFUSED'));
        },
      });
      return new Response(stream, { status: 200 });
    });
    const { core } = makeCore(f as unknown as FetchFn);
    await expect(core.post('/x', {})).rejects.toBeInstanceOf(OctenConnectionError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  test('retries pre-send network error', async () => {
    const f = sequence(networkError('ECONNREFUSED'), networkError('ENOTFOUND'), json(200, { ok: 1 }));
    const { core, sleeps } = makeCore(f as unknown as FetchFn);
    await expect(core.post('/x', {})).resolves.toEqual({ ok: 1 });
    expect(f).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  test('pre-send network error is OctenConnectionError once retries run out', async () => {
    const f = vi.fn(async () => {
      throw networkError('ECONNREFUSED');
    });
    const { core } = makeCore(f as unknown as FetchFn, { maxRetries: 1 });
    await expect(core.post('/x', {})).rejects.toBeInstanceOf(OctenConnectionError);
    expect(f).toHaveBeenCalledTimes(2);
  });

  test('429 with Retry-After over 60s gives up', async () => {
    const f = sequence(json(429, { msg: 'slow' }, { 'retry-after': '61' }));
    const { core, sleeps } = makeCore(f as unknown as FetchFn);
    const err = await core.post('/x', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenRateLimitError);
    expect((err as OctenRateLimitError).retryAfter).toBe(61);
    expect(f).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  test('sends headers', async () => {
    let seen: RequestInit | undefined;
    const f = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      seen = init;
      return json(200, { ok: 1 });
    });
    const { core } = makeCore(f as unknown as FetchFn, {
      defaultHeaders: { 'x-example-env': 'test', 'X-Trace': 'default' },
    });
    await core.post('/search', { query: 'q' }, { headers: { 'x-trace': 'per-request' } });
    const headers = new Headers(seen?.headers);
    expect(headers.get('x-api-key')).toBe('sk-test');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('user-agent')).toBe(`octen-js-sdk/${VERSION}`);
    expect(headers.get('x-example-env')).toBe('test');
    expect(headers.get('x-trace')).toBe('per-request');
    expect(seen?.method).toBe('POST');
    expect(seen?.body).toBe('{"query":"q"}');
  });

  // The client rejects x-api-key in defaultHeaders; HttpCore still writes the key last as a backstop.
  test('the API key is written last even if defaultHeaders reaching HttpCore carry one', async () => {
    let seen: RequestInit | undefined;
    const f = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      seen = init;
      return json(200, { ok: 1 });
    });
    const { core } = makeCore(f as unknown as FetchFn, { defaultHeaders: { 'X-API-Key': 'other' } });
    await core.post('/x', {});
    expect(new Headers(seen?.headers).get('x-api-key')).toBe('sk-test');
  });

  test('joins baseURL and path without doubling slashes', async () => {
    const urls: string[] = [];
    const f = vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      return json(200, { ok: 1 });
    });
    await makeCore(f as unknown as FetchFn, { baseURL: 'https://api.example.com/' }).core.post('/search', {});
    await makeCore(f as unknown as FetchFn, { baseURL: 'https://api.example.com' }).core.post('search', {});
    expect(urls).toEqual(['https://api.example.com/search', 'https://api.example.com/search']);
  });

  test('does not follow redirects', async () => {
    let seen: RequestInit | undefined;
    const f = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      seen = init;
      return new Response('', { status: 302, headers: { location: 'https://evil.example.com/' } });
    });
    const { core } = makeCore(f as unknown as FetchFn);
    const err = await core.post('/x', {}).catch((e: unknown) => e);
    expect(seen?.redirect).toBe('manual');
    expect((err as object).constructor).toBe(OctenAPIError);
    expect((err as OctenAPIError).status).toBe(302);
    expect(f).toHaveBeenCalledTimes(1);
  });

  test('a body that cannot be serialised is an OctenValidationError and sends nothing', async () => {
    const f = vi.fn(async () => json(200, {}));
    const { core } = makeCore(f as unknown as FetchFn);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(core.post('/x', circular)).rejects.toBeInstanceOf(OctenValidationError);
    expect(f).toHaveBeenCalledTimes(0);
  });

  test('a 400 is OctenBadRequestError carrying body and request id', async () => {
    const f = vi.fn(async () =>
      json(400, { code: 1002, msg: 'bad', request_id: 'r-1' }, { 'x-request-id': 'h-1' }),
    );
    const { core } = makeCore(f as unknown as FetchFn);
    const err = (await core.post('/x', {}).catch((e: unknown) => e)) as OctenBadRequestError;
    expect(err).toBeInstanceOf(OctenBadRequestError);
    expect(err.code).toBe(1002);
    expect(err.requestId).toBe('h-1');
    expect(err.body).toEqual({ code: 1002, msg: 'bad', request_id: 'r-1' });
  });
});

describe('errors', () => {
  test('isOctenError works across module copies', () => {
    const foreign = { [Symbol.for('octen.error')]: true };
    expect(isOctenError(foreign)).toBe(true);
    expect(isOctenError(new Error('x'))).toBe(false);
    expect(isOctenError(null)).toBe(false);
    expect(isOctenError(undefined)).toBe(false);
    expect(isOctenError('octen')).toBe(false);
    expect(isOctenError(new OctenValidationError('query'))).toBe(true);
    expect(isOctenError(new OctenTimeoutError())).toBe(true);
  });

  test('hierarchy', () => {
    expect(new OctenServerError({ status: 500, code: null, message: 'm', requestId: null, body: null })).toBeInstanceOf(
      OctenAPIError,
    );
    expect(new OctenAPIError({ status: 404, code: null, message: 'm', requestId: null, body: null })).toBeInstanceOf(
      OctenError,
    );
    expect(new OctenConnectionError()).toBeInstanceOf(OctenError);
    expect(new OctenAbortError()).toBeInstanceOf(OctenError);
  });

  test('OctenValidationError carries the field and a default message', () => {
    const e = new OctenValidationError('count');
    expect(e.field).toBe('count');
    expect(e.message).toContain('count');
    expect(new OctenValidationError('count', 'must be 1..20').message).toBe('must be 1..20');
    expect(e.name).toBe('OctenValidationError');
  });
});

describe('HttpCore.post request validation', () => {
  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, '5' as unknown as number])(
    'per-request timeout %s is rejected before any fetch',
    async (timeout) => {
      const f = vi.fn(async () => json(200, {}));
      const { core } = makeCore(f as unknown as FetchFn);
      const err = await core.post('/x', {}, { timeout }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(OctenValidationError);
      expect((err as OctenValidationError).field).toBe('timeout');
      expect(f).not.toHaveBeenCalled();
    },
  );

  test.each([
    ['CR/LF', 'a\r\nx-evil: 1'],
    ['above U+00FF', 'caf中'],
  ])('per-request header value with %s is OctenValidationError("headers")', async (_label, value) => {
    const f = vi.fn(async () => json(200, {}));
    const { core } = makeCore(f as unknown as FetchFn);
    const err = await core.post('/x', {}, { headers: { 'x-a': value } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toBe('headers');
    expect(f).not.toHaveBeenCalled();
  });

  test('a non-string per-request header value is OctenValidationError("headers")', async () => {
    const f = vi.fn(async () => json(200, {}));
    const { core } = makeCore(f as unknown as FetchFn);
    const err = await core
      .post('/x', {}, { headers: { 'x-a': 5 as unknown as string } })
      .catch((e: unknown) => e);
    expect((err as OctenValidationError).field).toBe('headers');
    expect(f).not.toHaveBeenCalled();
  });
});

describe('final-review fixes (A)', () => {
  test('A1: per-request timeout above the setTimeout limit is rejected, the limit itself is accepted', async () => {
    const f = vi.fn(async () => json(200, { ok: 1 }));
    const { core } = makeCore(f as unknown as FetchFn);
    const err = await core.post('/x', {}, { timeout: 2_147_483_648 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toBe('timeout');
    expect(f).not.toHaveBeenCalled();
    await expect(core.post('/x', {}, { timeout: 2_147_483_647 })).resolves.toEqual({ ok: 1 });
  });

  class Custom {
    'x-a' = 'b';
  }
  test.each([
    ['a Headers instance', new Headers({ 'x-a': 'b' })],
    ['an array', [['x-a', 'b']]],
    ['a Map', new Map([['x-a', 'b']])],
    ['a class instance', new Custom()],
  ])('A3: per-request headers given as %s are OctenValidationError("headers")', async (_label, headers) => {
    const f = vi.fn(async () => json(200, {}));
    const { core } = makeCore(f as unknown as FetchFn);
    const err = await core
      .post('/x', {}, { headers: headers as unknown as Record<string, string> })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toBe('headers');
    expect(f).not.toHaveBeenCalled();
  });

  test.each(['x-api-key', 'X-API-Key', 'X-Api-KEY'])('A3: per-request %s header is rejected, pointing at apiKey', async (name) => {
    const f = vi.fn(async () => json(200, {}));
    const { core } = makeCore(f as unknown as FetchFn);
    const err = await core.post('/x', {}, { headers: { [name]: 'other' } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toBe('headers');
    expect((err as OctenValidationError).message).toMatch(/apiKey/);
    expect(f).not.toHaveBeenCalled();
  });

  test.each([
    ['cause.cause.code', networkError('ECONNRESET'), 'Connection error: fetch failed (ECONNRESET)'],
    ['cause.code', Object.assign(new Error('socket hang up'), { code: 'EPIPE' }), 'Connection error: socket hang up (EPIPE)'],
    ['no code', new TypeError('fetch failed'), 'Connection error: fetch failed'],
    ['non-string code', Object.assign(new Error('odd'), { code: 42 }), 'Connection error: odd'],
  ])('A4: connection error message includes the cause (%s)', async (_label, thrown, message) => {
    const f = sequence(thrown);
    const { core } = makeCore(f as unknown as FetchFn);
    const err = (await core.post('/x', {}).catch((e: unknown) => e)) as OctenConnectionError;
    expect(err).toBeInstanceOf(OctenConnectionError);
    expect(err.message).toBe(message);
    expect(err.cause).toBe(thrown);
    expect(f).toHaveBeenCalledTimes(1);
  });

  test.each([
    [301, { location: 'https://other.example.com/search' }, 'HTTP 301 redirect to https://other.example.com/search; redirects are not followed, check baseURL'],
    [302, {}, 'HTTP 302 redirect; redirects are not followed, check baseURL'],
    [307, { location: '/v2/search' }, 'HTTP 307 redirect to /v2/search; redirects are not followed, check baseURL'],
  ])('A6: a %i response explains that redirects are not followed', async (status, headers, message) => {
    const f = sequence(new Response('<html>Moved</html>', { status, headers }));
    const { core } = makeCore(f as unknown as FetchFn);
    const err = (await core.post('/x', {}).catch((e: unknown) => e)) as OctenAPIError;
    expect(err.constructor).toBe(OctenAPIError);
    expect(err.status).toBe(status);
    expect(err.message).toBe(message);
    expect(f).toHaveBeenCalledTimes(1);
  });

  test('A6: status 0 (opaque redirect in browsers) says a redirect was blocked', async () => {
    const opaque = { status: 0, headers: new Headers(), text: async () => '' } as unknown as Response;
    const f = sequence(opaque);
    const { core } = makeCore(f as unknown as FetchFn);
    const err = (await core.post('/x', {}).catch((e: unknown) => e)) as OctenAPIError;
    expect(err.constructor).toBe(OctenAPIError);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/redirect was blocked/);
    expect(err.message).toMatch(/check baseURL/);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('A7: error names', () => {
  const init = { status: 500, code: null, message: 'm', requestId: null, body: null };
  const expected = [
    'OctenError',
    'OctenAPIError',
    'OctenAuthenticationError',
    'OctenPermissionDeniedError',
    'OctenBadRequestError',
    'OctenServerError',
    'OctenRateLimitError',
    'OctenTimeoutError',
    'OctenConnectionError',
    'OctenAbortError',
    'OctenValidationError',
  ];

  function instances(mod: typeof import('../../src/core/errors')): Record<string, Error> {
    return {
      OctenError: new mod.OctenError('m'),
      OctenAPIError: new mod.OctenAPIError(init),
      OctenAuthenticationError: new mod.OctenAuthenticationError(init),
      OctenPermissionDeniedError: new mod.OctenPermissionDeniedError(init),
      OctenBadRequestError: new mod.OctenBadRequestError(init),
      OctenServerError: new mod.OctenServerError(init),
      OctenRateLimitError: new mod.OctenRateLimitError({ ...init, retryAfter: null }),
      OctenTimeoutError: new mod.OctenTimeoutError(),
      OctenConnectionError: new mod.OctenConnectionError(),
      OctenAbortError: new mod.OctenAbortError(),
      OctenValidationError: new mod.OctenValidationError('f'),
    };
  }

  test('every class reports its own name', async () => {
    const mod = await import('../../src/core/errors');
    const all = instances(mod);
    expect(Object.keys(all)).toEqual(expected);
    for (const [name, err] of Object.entries(all)) expect(err.name, name).toBe(name);
  });

  // Consumers' bundlers rename classes when minifying; the names must not depend on that.
  test('names survive minification of the class identifiers', async () => {
    const { build } = await import('esbuild');
    const out = await build({
      entryPoints: [new URL('../../src/core/errors.ts', import.meta.url).pathname],
      bundle: true,
      minify: true,
      format: 'esm',
      write: false,
    });
    const code = out.outputFiles[0]!.text;
    const mod = (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)) as typeof import('../../src/core/errors');
    for (const [name, err] of Object.entries(instances(mod))) expect(err.name, name).toBe(name);
  });
});
