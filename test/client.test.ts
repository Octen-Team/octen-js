import { afterEach, describe, expect, test, vi } from 'vitest';
import Octen, { Octen as NamedOcten, OctenValidationError, VERSION, isOctenError } from '../src/index';
import * as publicApi from '../src/index';
import { HttpCore } from '../src/core/http';

const captured = vi.hoisted(() => ({ options: [] as unknown[] }));

vi.mock('../src/core/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/http')>();
  class SpyCore extends actual.HttpCore {
    constructor(opts: ConstructorParameters<typeof actual.HttpCore>[0]) {
      captured.options.push(opts);
      super(opts);
    }
  }
  return { ...actual, HttpCore: SpyCore };
});

type FetchFn = typeof fetch;

function lastOptions(): ConstructorParameters<typeof HttpCore>[0] {
  return captured.options[captured.options.length - 1] as ConstructorParameters<typeof HttpCore>[0];
}

function okFetch() {
  return vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
    return new Response(JSON.stringify({ code: 0, request_id: 'r' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

function fieldOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof OctenValidationError) return e.field;
    throw e;
  }
  return undefined;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  captured.options.length = 0;
});

describe('Octen client construction', () => {
  test('default export and named export are the same class', () => {
    expect(Octen).toBe(NamedOcten);
  });

  test('defaults: baseURL, 30000 ms timeout, 3 retries', () => {
    new Octen({ apiKey: 'sk-test' });
    const o = lastOptions();
    expect(o.baseURL).toBe('https://api.octen.ai');
    expect(o.timeoutMs).toBe(30000);
    expect(o.maxRetries).toBe(3);
    expect(o.defaultHeaders).toEqual({});
  });

  test('options map onto HttpCore (timeout is milliseconds)', () => {
    const f = okFetch() as unknown as FetchFn;
    new Octen({
      apiKey: 'sk-test',
      baseURL: 'https://example.test/',
      timeout: 1234,
      maxRetries: 0,
      defaultHeaders: { 'x-a': 'b' },
      fetch: f,
    });
    const o = lastOptions();
    expect(o.baseURL).toBe('https://example.test');
    expect(o.timeoutMs).toBe(1234);
    expect(o.maxRetries).toBe(0);
    expect(o.defaultHeaders).toEqual({ 'x-a': 'b' });
  });

  test('a user-supplied fetch is called without the HttpCore/client as this', async () => {
    const thisValues: unknown[] = [];
    const f = function (this: unknown, _input: string | URL | Request, _init?: RequestInit) {
      thisValues.push(this);
      return Promise.resolve(
        new Response(JSON.stringify({ code: 0 }), { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    } as unknown as FetchFn;
    const c = new Octen({ apiKey: 'sk-test', fetch: f });
    await c.search.search({ query: 'q' });
    expect(thisValues).toHaveLength(1);
    expect(thisValues[0] === undefined || thisValues[0] === globalThis).toBe(true);
  });

  test('exposes search and placeSearch resources', () => {
    const c = new Octen({ apiKey: 'sk-test' });
    expect(typeof c.search.search).toBe('function');
    expect(typeof c.search.broadSearch).toBe('function');
    expect(typeof c.placeSearch.search).toBe('function');
  });

  test('sends the key and joins paths against a trailing-slash baseURL', async () => {
    const f = okFetch();
    const c = new Octen({ apiKey: 'sk-abc', baseURL: 'https://example.test///', fetch: f as unknown as FetchFn });
    await c.search.search({ query: 'q' });
    expect(f.mock.calls[0]?.[0]).toBe('https://example.test/search');
    const headers = new Headers(f.mock.calls[0]?.[1]?.headers);
    expect(headers.get('x-api-key')).toBe('sk-abc');
  });

  test('uses the global fetch lazily when none is passed', async () => {
    const f = okFetch();
    const c = new Octen({ apiKey: 'sk-test' });
    vi.stubGlobal('fetch', f);
    await c.placeSearch.search({ query: 'q' });
    expect(f.mock.calls[0]?.[0]).toBe('https://api.octen.ai/place-search');
  });
});

describe('apiKey resolution', () => {
  test('apiKey: undefined behaves like omitting it (environment fallback)', async () => {
    vi.stubEnv('OCTEN_API_KEY', 'sk-env');
    const f = okFetch();
    // Type level: { apiKey: string | undefined } must compile under exactOptionalPropertyTypes
    const fromEnv: string | undefined = process.env.OCTEN_API_KEY;
    await new Octen({ apiKey: fromEnv, fetch: f as unknown as FetchFn }).search.search({ query: 'q' });
    expect(new Headers(f.mock.calls[0]?.[1]?.headers).get('x-api-key')).toBe('sk-env');
  });

  test('every optional option accepts an explicit undefined', () => {
    expect(
      () =>
        new Octen({
          apiKey: 'sk-test',
          baseURL: undefined,
          timeout: undefined,
          maxRetries: undefined,
          defaultHeaders: undefined,
          fetch: undefined,
          dangerouslyAllowBrowser: undefined,
        }),
    ).not.toThrow();
    const o = lastOptions();
    expect(o.baseURL).toBe('https://api.octen.ai');
    expect(o.timeoutMs).toBe(30000);
    expect(o.maxRetries).toBe(3);
  });

  test('request options accept an explicit undefined', async () => {
    const f = okFetch();
    const c = new Octen({ apiKey: 'sk-test', fetch: f as unknown as FetchFn });
    await c.search.search({ query: 'q' }, { timeout: undefined, signal: undefined, headers: undefined });
    expect(f).toHaveBeenCalledTimes(1);
  });

  test('falls back to OCTEN_API_KEY when apiKey is not passed', async () => {
    vi.stubEnv('OCTEN_API_KEY', 'sk-env');
    const f = okFetch();
    await new Octen({ fetch: f as unknown as FetchFn }).search.search({ query: 'q' });
    expect(new Headers(f.mock.calls[0]?.[1]?.headers).get('x-api-key')).toBe('sk-env');
  });

  test('an explicit apiKey wins over the environment', async () => {
    vi.stubEnv('OCTEN_API_KEY', 'sk-env');
    const f = okFetch();
    await new Octen({ apiKey: 'sk-arg', fetch: f as unknown as FetchFn }).search.search({ query: 'q' });
    expect(new Headers(f.mock.calls[0]?.[1]?.headers).get('x-api-key')).toBe('sk-arg');
  });

  test('missing key with no environment variable is OctenValidationError("apiKey")', () => {
    vi.stubEnv('OCTEN_API_KEY', '');
    expect(fieldOf(() => new Octen())).toBe('apiKey');
  });

  test.each(['', '  ', '\t\n'])('test_blank_api_key_rejected: %j', (apiKey) => {
    vi.stubEnv('OCTEN_API_KEY', '');
    expect(fieldOf(() => new Octen({ apiKey }))).toBe('apiKey');
  });

  test('a blank passed apiKey is not rescued by the environment', () => {
    vi.stubEnv('OCTEN_API_KEY', 'sk-env');
    expect(fieldOf(() => new Octen({ apiKey: '' }))).toBe('apiKey');
  });

  test('a whitespace-only OCTEN_API_KEY is rejected', () => {
    vi.stubEnv('OCTEN_API_KEY', '   ');
    expect(fieldOf(() => new Octen())).toBe('apiKey');
  });

  test('the environment is not read when apiKey is passed (throwing accessor is harmless)', () => {
    vi.stubGlobal('process', {
      get env(): never {
        throw new Error('--allow-env required');
      },
    });
    expect(() => new Octen({ apiKey: 'sk-test' })).not.toThrow();
  });

  test('a throwing env accessor counts as absent when apiKey is not passed', () => {
    vi.stubGlobal('process', {
      get env(): never {
        throw new Error('--allow-env required');
      },
    });
    expect(fieldOf(() => new Octen())).toBe('apiKey');
  });

  test.each([
    ['CR/LF', 'sk-a\r\nx-evil: 1'],
    ['above U+00FF', 'sk-\u4e2d\u6587'],
  ])('apiKey with %s is OctenValidationError("apiKey")', (_label, apiKey) => {
    expect(fieldOf(() => new Octen({ apiKey }))).toBe('apiKey');
  });
});

describe('defaultHeaders validation', () => {
  test.each([
    ['CR/LF value', { 'x-a': 'a\r\nb' }],
    ['value above U+00FF', { 'x-a': '\u4e2d' }],
    ['non-string value', { 'x-a': 5 as unknown as string }],
    ['invalid header name', { 'bad name': 'v' }],
  ])('%s is OctenValidationError("defaultHeaders")', (_label, defaultHeaders) => {
    expect(fieldOf(() => new Octen({ apiKey: 'sk-test', defaultHeaders }))).toBe('defaultHeaders');
  });

  test('valid headers pass', () => {
    expect(() => new Octen({ apiKey: 'sk-test', defaultHeaders: { 'x-a': 'ok value' } })).not.toThrow();
  });
});

describe('numeric option validation', () => {
  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, '30' as unknown as number])(
    'timeout %s is OctenValidationError("timeout")',
    (timeout) => {
      expect(fieldOf(() => new Octen({ apiKey: 'sk-test', timeout }))).toBe('timeout');
    },
  );

  test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '3' as unknown as number])(
    'maxRetries %s is OctenValidationError("maxRetries")',
    (maxRetries) => {
      expect(fieldOf(() => new Octen({ apiKey: 'sk-test', maxRetries }))).toBe('maxRetries');
    },
  );

  test('maxRetries 0 is allowed', () => {
    expect(() => new Octen({ apiKey: 'sk-test', maxRetries: 0 })).not.toThrow();
  });
});

describe('baseURL validation', () => {
  test.each([
    'not a url',
    '/relative',
    'ftp://example.test',
    'javascript:alert(1)',
    '',
    ' https://x.test',
    'https://x.test ',
    'https://x.test/ ',
    'https://x.test/a b',
    'https://x.test?x=1',
    'https://x.test/p?x=1',
    'https://x.test/p#frag',
    'https://x.test/?',
    'http:example.com',
    'https:///path',
    'https://',
  ])(
    '%j is OctenValidationError("baseURL")',
    (baseURL) => {
      expect(fieldOf(() => new Octen({ apiKey: 'sk-test', baseURL }))).toBe('baseURL');
    },
  );

  test('path prefixes are kept and one trailing slash is stripped', () => {
    new Octen({ apiKey: 'sk-test', baseURL: 'https://gw.test/octen/' });
    expect(lastOptions().baseURL).toBe('https://gw.test/octen');
    new Octen({ apiKey: 'sk-test', baseURL: 'http://localhost:8888' });
    expect(lastOptions().baseURL).toBe('http://localhost:8888');
  });

  test('http and https are accepted', () => {
    expect(() => new Octen({ apiKey: 'sk-test', baseURL: 'http://localhost:8888' })).not.toThrow();
    expect(() => new Octen({ apiKey: 'sk-test', baseURL: 'https://api.octen.ai/' })).not.toThrow();
  });
});

describe('browser detection', () => {
  test('constructing with window and document defined throws unless dangerouslyAllowBrowser', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    const err = (() => {
      try {
        new Octen({ apiKey: 'sk-test' });
      } catch (e) {
        return e;
      }
      return undefined;
    })();
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toBe('dangerouslyAllowBrowser');
    expect((err as OctenValidationError).message).toMatch(/API key/i);
    expect(() => new Octen({ apiKey: 'sk-test', dangerouslyAllowBrowser: true })).not.toThrow();
  });

  test('a lone window (no document) is not treated as a browser', () => {
    vi.stubGlobal('window', {});
    expect(() => new Octen({ apiKey: 'sk-test' })).not.toThrow();
  });
});

describe('public entry point', () => {
  test('exports error classes, isOctenError and VERSION; hides internals', () => {
    for (const name of [
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
      'isOctenError',
      'VERSION',
      'Octen',
    ]) {
      expect(publicApi, name).toHaveProperty(name);
    }
    expect(VERSION).toBe('0.1.0');
    expect(isOctenError(new OctenValidationError('x'))).toBe(true);
    for (const hidden of ['HttpCore', 'checkUnknownFields', 'prepareBody', 'retryDelayMs']) {
      expect(publicApi).not.toHaveProperty(hidden);
    }
  });
});

// Precedence: per-call timeout > explicit client timeout > endpoint default (broadSearch 120000, others 30000)
describe('timeout precedence', () => {
  // fetch never returns; use a fake clock in 1000 ms steps to find after how many ms the SDK gives up
  async function timeoutAfterMs(
    options: ConstructorParameters<typeof Octen>[0],
    run: (c: Octen) => Promise<unknown>,
  ): Promise<number> {
    vi.useFakeTimers();
    try {
      const hang = vi.fn((_input: string | URL | Request, _init?: RequestInit) => new Promise<Response>(() => {}));
      const c = new Octen({ apiKey: 'sk-test', fetch: hang as unknown as FetchFn, ...options });
      let error: unknown;
      let settled = false;
      void run(c).catch((e: unknown) => {
        error = e;
        settled = true;
      });
      let elapsed = 0;
      while (!settled && elapsed < 200_000) {
        await vi.advanceTimersByTimeAsync(1000);
        elapsed += 1000;
      }
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).name).toBe('OctenTimeoutError');
      return elapsed;
    } finally {
      vi.useRealTimers();
    }
  }
  const search = (c: Octen) => c.search.search({ query: 'q' });
  const broad = (c: Octen) => c.search.broadSearch({ query: 'q' });

  test('no timeout set: broadSearch 120000, search 30000', async () => {
    expect(await timeoutAfterMs({}, broad)).toBe(120_000);
    expect(await timeoutAfterMs({}, search)).toBe(30_000);
  });

  test('explicit client timeout applies to broadSearch and search alike', async () => {
    expect(await timeoutAfterMs({ timeout: 10_000 }, broad)).toBe(10_000);
    expect(await timeoutAfterMs({ timeout: 10_000 }, search)).toBe(10_000);
  });

  test('a longer explicit client timeout also applies to broadSearch', async () => {
    expect(await timeoutAfterMs({ timeout: 150_000 }, broad)).toBe(150_000);
  });

  test('a per-request timeout overrides both the default and the client timeout', async () => {
    const withTimeout = (ms: number) => ({
      broad: (c: Octen) => c.search.broadSearch({ query: 'q' }, { timeout: ms }),
      search: (c: Octen) => c.search.search({ query: 'q' }, { timeout: ms }),
    });
    expect(await timeoutAfterMs({}, withTimeout(5000).broad)).toBe(5000);
    expect(await timeoutAfterMs({ timeout: 10_000 }, withTimeout(5000).broad)).toBe(5000);
    expect(await timeoutAfterMs({ timeout: 10_000 }, withTimeout(5000).search)).toBe(5000);
  });

  test('timeout: undefined counts as not set', async () => {
    expect(await timeoutAfterMs({ timeout: undefined }, broad)).toBe(120_000);
  });
});

describe('final-review fixes (A, client level)', () => {
  test('A1: client timeout above the setTimeout limit is rejected, the limit itself is accepted', () => {
    expect(fieldOf(() => new Octen({ apiKey: 'sk-test', timeout: 2_147_483_648 }))).toBe('timeout');
    expect(() => new Octen({ apiKey: 'sk-test', timeout: 2_147_483_647 })).not.toThrow();
  });

  class Custom {
    'x-a' = 'b';
  }
  test.each([
    ['a Headers instance', new Headers({ 'x-a': 'b' })],
    ['an array', [['x-a', 'b']]],
    ['a Map', new Map([['x-a', 'b']])],
    ['a class instance', new Custom()],
    ['null', null],
  ])('A3: defaultHeaders given as %s is OctenValidationError("defaultHeaders")', (_label, defaultHeaders) => {
    expect(
      fieldOf(() => new Octen({ apiKey: 'sk-test', defaultHeaders: defaultHeaders as unknown as Record<string, string> })),
    ).toBe('defaultHeaders');
  });

  test.each(['x-api-key', 'X-API-KEY', 'X-Api-Key'])('A3: defaultHeaders %s is rejected, pointing at apiKey', (name) => {
    let err: unknown;
    try {
      new Octen({ apiKey: 'sk-test', defaultHeaders: { [name]: 'other' } });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toBe('defaultHeaders');
    expect((err as OctenValidationError).message).toMatch(/apiKey/);
  });

  test('A3: an object with a null prototype is a plain object', () => {
    const headers = Object.assign(Object.create(null) as Record<string, string>, { 'x-a': 'b' });
    expect(() => new Octen({ apiKey: 'sk-test', defaultHeaders: headers })).not.toThrow();
  });

  test.each(['http://user:pw@localhost:8888', 'https://user@api.example.com', 'https://:pw@api.example.com/'])(
    'A5: baseURL with credentials %j is OctenValidationError("baseURL")',
    (baseURL) => {
      expect(fieldOf(() => new Octen({ apiKey: 'sk-test', baseURL }))).toBe('baseURL');
    },
  );
});
