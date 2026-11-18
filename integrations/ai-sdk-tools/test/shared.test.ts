import { Octen, OctenValidationError } from '@octen.ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OctenToolOptions } from '../src/shared.js';
import { mergeParams, modelSchema, requestOptions, resolveClient, trimWebResult } from '../src/shared.js';

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
    const err = caught(() => resolveClient({ client, ...extra }));
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toBe(field);
    expect((err as Error).message).toBe(
      `Pass either \`client\` or \`${field}\`, not both: \`client\` already carries its own configuration.`,
    );
  });

  it('reports the first conflicting key in the order apiKey, baseURL, timeout, maxRetries', () => {
    const client = new Octen({ apiKey: 'k' });
    const err = caught(() => resolveClient({ client, maxRetries: 1, timeout: 5, baseURL: 'https://example.com' }));
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
  it('accepts query and a valid time_range', () => {
    const schema = modelSchema({ query: true, time_range: true }, undefined);
    expect(schema.parse({ query: 'a', time_range: 'week' })).toEqual({ query: 'a', time_range: 'week' });
  });

  it('accepts a query without time_range', () => {
    expect(modelSchema({ query: true, time_range: true }, undefined).parse({ query: 'a' })).toEqual({ query: 'a' });
  });

  it('rejects the short time_range spelling (spec 4.3: only day|week|month|year)', () => {
    const schema = modelSchema({ query: true, time_range: true }, undefined);
    expect(schema.safeParse({ query: 'a', time_range: 'w' }).success).toBe(false);
  });

  it('rejects a missing query', () => {
    expect(modelSchema({ query: true }, undefined).safeParse({}).success).toBe(false);
  });

  it('omits time_range from the shape when the developer pinned it', () => {
    const schema = modelSchema({ query: true, time_range: true }, { time_range: 'day' });
    expect('time_range' in schema.shape).toBe(false);
    expect('query' in schema.shape).toBe(true);
  });

  it('keeps time_range when the pinned value is undefined', () => {
    const schema = modelSchema({ query: true, time_range: true }, { time_range: undefined });
    expect('time_range' in schema.shape).toBe(true);
  });

  it('has no time_range for query-only tools', () => {
    expect('time_range' in modelSchema({ query: true }, undefined).shape).toBe(false);
  });

  it('carries the exact field descriptions', () => {
    const { shape } = modelSchema({ query: true, time_range: true }, undefined);
    const description = (field: unknown) => (field as { description?: string } | undefined)?.description;
    expect(description(shape['query'])).toBe('The search query');
    expect(description(shape['time_range'])).toBe('Only return results from this recent window. Omit for no time filter.');
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
    const out = trimWebResult({
      title: 'T',
      url: 'https://a.example',
      highlight: 'H',
      full_content: '',
      authors: 'Someone',
      time_published: '2026-10-29T18:37:11Z',
      time_last_crawled: '2026-11-03T15:45:59Z',
      favicon: 'https://a.example/f.png',
    });
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
