import { Octen, OctenTimeoutError, OctenValidationError } from '@octen.ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { OctenToolOptions } from '../src/shared.js';
import {
  asList,
  isRecord,
  mergeParams,
  modelSchema,
  nonEmpty,
  requestOptions,
  resolveClient,
  trimWebResult,
  trimWebResults,
} from '../src/shared.js';

function caught(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

describe('resolveClient', () => {
  beforeEach(() => {
    vi.stubEnv('OCTEN_API_KEY', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the same instance when only client is passed', () => {
    const client = new Octen({ apiKey: 'k' });
    expect(resolveClient({ client })).toBe(client);
  });

  it.each([
    ['apiKey', { apiKey: 'k' }],
    ['baseURL', { baseURL: 'https://example.com' }],
    ['timeout', { timeout: 1000 }],
    ['maxRetries', { maxRetries: 1 }],
  ] as const)('throws OctenValidationError for client plus %s', (field, extra) => {
    const client = new Octen({ apiKey: 'k' });
    // The type forbids this combination, so a JS caller is simulated with a cast.
    const err = caught(() => resolveClient({ client, ...extra } as unknown as OctenToolOptions<unknown>));
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toBe(field);
    expect((err as Error).message).toBe(
      `Pass either \`client\` or \`${field}\`, not both: \`client\` already carries its own configuration.`,
    );
  });

  it('reports the first conflicting key in the order apiKey, baseURL, timeout, maxRetries', () => {
    const client = new Octen({ apiKey: 'k' });
    const err = caught(() =>
      resolveClient({ client, maxRetries: 1, timeout: 5, baseURL: 'https://example.com' } as unknown as OctenToolOptions<unknown>),
    );
    expect((err as OctenValidationError).field).toBe('baseURL');
  });

  it('does not treat an explicitly undefined key as a conflict', () => {
    const client = new Octen({ apiKey: 'k' });
    expect(resolveClient({ client, apiKey: undefined } as unknown as OctenToolOptions<unknown>)).toBe(client);
  });

  it('builds a client from apiKey', () => {
    expect(resolveClient({ apiKey: 'k' })).toBeInstanceOf(Octen);
  });

  it('throws the SDK error with field apiKey when no key is available', () => {
    const err = caught(() => resolveClient({}));
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toBe('apiKey');
  });

  it('reads OCTEN_API_KEY from the environment', () => {
    vi.stubEnv('OCTEN_API_KEY', 'env-key');
    expect(resolveClient({})).toBeInstanceOf(Octen);
  });
  describe('option forwarding', () => {
    const okBody = JSON.stringify({ code: 0, msg: 'success', request_id: 'r', data: { query: 'q', results: [] }, meta: {} });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    // The client reads the global fetch on every call, so a stub observes what resolveClient configured.
    it('forwards baseURL to the client', async () => {
      const fetchMock = vi.fn(async (_url: unknown) => new Response(okBody, { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      await resolveClient({ apiKey: 'k', baseURL: 'https://custom.example.test' }).search.search({ query: 'q' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/^https:\/\/custom\.example\.test\/search/);
    });

    it('forwards maxRetries: 0 so a 503 is attempted exactly once', async () => {
      const fetchMock = vi.fn(async () => new Response('{}', { status: 503 }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(resolveClient({ apiKey: 'k', maxRetries: 0 }).search.search({ query: 'q' })).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('forwards timeout so a hung request rejects with OctenTimeoutError', async () => {
      vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
      await expect(
        resolveClient({ apiKey: 'k', timeout: 50, maxRetries: 0 }).search.search({ query: 'q' }),
      ).rejects.toBeInstanceOf(OctenTimeoutError);
    });
  });
});

describe('mergeParams', () => {
  type P = { query: string; time_range?: string; count?: number; highlight?: { max_tokens?: number; extra?: boolean } };
  const fields = ['query', 'time_range'] as const;

  it('applies tool default < dev default < model input', () => {
    const out = mergeParams<P>({ count: 5, time_range: 'day' }, { count: 8 }, { query: 'q', time_range: 'week' }, fields);
    expect(out).toEqual({ query: 'q', time_range: 'week', count: 8 });
  });

  it('replaces a top-level object whole instead of deep-merging', () => {
    const out = mergeParams<P>(
      { highlight: { max_tokens: 100, extra: true } },
      { highlight: { max_tokens: 500 } },
      { query: 'q' },
      fields,
    );
    expect(out.highlight).toEqual({ max_tokens: 500 });
  });

  it('drops a model value for a field the developer pinned', () => {
    const out = mergeParams<P>({}, { time_range: 'month' }, { query: 'q', time_range: 'day' }, fields);
    expect(out.time_range).toBe('month');
  });

  it('does not treat a dev default whose value is undefined as pinned', () => {
    const out = mergeParams<P>({}, { time_range: undefined } as unknown as Partial<P>, { query: 'q', time_range: 'day' }, fields);
    expect(out.time_range).toBe('day');
  });

  it('keeps a tool default when the dev default is explicitly undefined', () => {
    const out = mergeParams<P>({ count: 5 }, { count: undefined } as unknown as Partial<P>, { query: 'q' }, fields);
    expect(out.count).toBe(5);
  });

  it('drops a null model value so it cannot override a default', () => {
    const out = mergeParams<P>({ time_range: 'year' }, undefined, { query: 'q', time_range: null }, fields);
    expect(out.time_range).toBe('year');
  });

  it('drops model keys outside modelFields', () => {
    const out = mergeParams<P>({}, undefined, { query: 'q', count: 99, bogus: 1 }, fields);
    expect(out).toEqual({ query: 'q' });
  });

  it('always takes query from the model, even if a JS caller put it in devDefaults', () => {
    const out = mergeParams<P>({}, { query: 'pinned' } as Partial<P>, { query: 'from-model' }, fields);
    expect(out.query).toBe('from-model');
  });
});

describe('modelSchema', () => {
  type Json = { properties: Record<string, { description?: string }>; required?: string[] };
  const props = (schema: unknown) => Object.keys((z.toJSONSchema(schema as z.ZodType) as Json).properties).sort();

  it('accepts query and a valid time_range', () => {
    const schema = modelSchema(['query', 'time_range'], undefined);
    expect(schema.parse({ query: 'a', time_range: 'week' })).toEqual({ query: 'a', time_range: 'week' });
  });

  it('accepts a query without time_range', () => {
    expect(modelSchema(['query', 'time_range'], undefined).parse({ query: 'a' })).toEqual({ query: 'a' });
  });

  it('rejects the short time_range spelling (spec 4.3: only day|week|month|year)', () => {
    const schema = modelSchema(['query', 'time_range'], undefined);
    expect(schema.safeParse({ query: 'a', time_range: 'w' }).success).toBe(false);
  });

  it('rejects a missing query', () => {
    expect(modelSchema(['query'], undefined).safeParse({}).success).toBe(false);
  });

  it('omits time_range when the developer pinned it', () => {
    expect(props(modelSchema(['query', 'time_range'], { time_range: 'day' }))).toEqual(['query']);
  });

  it('keeps time_range when the pinned value is undefined', () => {
    expect(props(modelSchema(['query', 'time_range'], { time_range: undefined }))).toEqual(['query', 'time_range']);
  });

  it('has no time_range for query-only tools', () => {
    expect(props(modelSchema(['query'], undefined))).toEqual(['query']);
  });

  it('carries the exact field descriptions', () => {
    const json = z.toJSONSchema(modelSchema(['query', 'time_range'], undefined)) as Json;
    expect(json.properties['query']?.description).toBe('The search query');
    expect(json.properties['time_range']?.description).toBe(
      'Only return results from this recent window. Omit for no time filter.',
    );
  });
});

describe('requestOptions', () => {
  it('forwards the abort signal', () => {
    const signal = new AbortController().signal;
    expect(requestOptions(signal)).toEqual({ signal });
  });

  it('returns an empty object when there is no signal', () => {
    expect(requestOptions(undefined)).toEqual({});
    expect('signal' in requestOptions(undefined)).toBe(false);
  });
});

describe('trimWebResult', () => {
  // Input shapes: test/fixtures/search.json (full_content is "" when not requested, plus extra fields)
  // and test/fixtures/pulse-search.json (lite results carry only title and url).
  it('keeps only the five model-visible fields and drops an empty full_content', () => {
    const recorded = {
      title: 'T',
      url: 'https://a.example',
      highlight: 'H',
      full_content: '',
      authors: 'Someone',
      time_published: '2026-10-29T18:37:11Z',
      time_last_crawled: '2026-11-03T15:45:59Z',
      favicon: 'https://a.example/f.png',
    };
    const out = trimWebResult(recorded);
    expect(out).toEqual({ title: 'T', url: 'https://a.example', highlight: 'H', time_published: '2026-10-29T18:37:11Z' });
    expect('full_content' in out).toBe(false);
  });

  it('keeps full_content when present', () => {
    expect(trimWebResult({ title: 'T', full_content: 'body' })).toEqual({ title: 'T', full_content: 'body' });
  });

  it('handles pulse lite results that carry only title and url', () => {
    expect(trimWebResult({ title: 'GitHub Docs', url: 'docs.github.com' })).toEqual({
      title: 'GitHub Docs',
      url: 'docs.github.com',
    });
  });

  it('never emits null or undefined keys', () => {
    const out = trimWebResult({ title: null, url: undefined, highlight: '', time_published: null } as never);
    expect(out).toEqual({});
    expect(Object.keys(out)).toEqual([]);
  });
});

describe('nonEmpty', () => {
  it('returns a non-empty string and undefined for everything else', () => {
    expect(nonEmpty('a')).toBe('a');
    for (const value of ['', null, undefined, 0, 7, {}, ['a']]) expect(nonEmpty(value)).toBeUndefined();
  });
});

describe('isRecord', () => {
  it('accepts plain objects only', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    for (const value of [null, undefined, [], ['x'], 'x', 3, true]) expect(isRecord(value)).toBe(false);
  });
});

describe('asList', () => {
  it('treats null and undefined as an empty list', () => {
    expect(asList(null, 'data.results')).toEqual([]);
    expect(asList(undefined, 'data.results')).toEqual([]);
  });

  it('returns an array as is', () => {
    const list = [1, 'a', null];
    expect(asList(list, 'data.results')).toBe(list);
  });

  it.each([['x'], [3], [{}], [true]])('throws a plain Error naming the field for %j', (value) => {
    const err = caught(() => asList(value, 'data.places'));
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(OctenValidationError);
    expect((err as Error).message).toContain('data.places');
  });
});

describe('trimWebResults', () => {
  it('trims each result and skips null and non-object items', () => {
    const list = [{ title: 'A', favicon: 'f' }, null, 'text', 7, undefined, ['x'], { url: 'https://b.example' }];
    expect(trimWebResults(list, 'data.results')).toEqual([{ title: 'A' }, { url: 'https://b.example' }]);
  });

  it('drops a result that has no non-empty model field', () => {
    const list = [{ favicon: 'f', full_content: '' }, { title: '' }, { title: 'kept' }];
    expect(trimWebResults(list, 'data.results')).toEqual([{ title: 'kept' }]);
  });

  it('returns an empty list for null or undefined', () => {
    for (const value of [null, undefined]) expect(trimWebResults(value, 'data.results')).toEqual([]);
  });

  it('throws naming the field for a non-array list', () => {
    for (const value of ['x', 3, {}]) {
      expect(() => trimWebResults(value, 'data.results')).toThrow(/data\.results/);
    }
  });
});
