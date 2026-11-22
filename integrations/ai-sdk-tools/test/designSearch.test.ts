import { Octen, OctenAbortError, OctenAuthenticationError, OctenServerError, OctenValidationError } from '@octen.ai/sdk';
import { asSchema } from 'ai';
import { describe, expect, it } from 'vitest';
import { octenDesignSearch } from '../src/tools/designSearch.js';
import type { OctenDesignSearchOptions } from '../src/tools/designSearch.js';
import { clientFor, hangUntilAborted, jsonResponse, modelJsonSchema, recordingFetch, run, validateInput } from './helpers.js';
// Replies are the production envelope recorded in test/fixtures/design-search.json.
import designFixture from './fixtures/design-search.json';

const GROUP = 'pg_3c7181619bcc3445c0ea7b03a26f2ace9cbbe26b';

// Every developer option, with values inside the bounds of docs.octen.ai/api-reference/design-search.
const ALL_OPTIONS: OctenDesignSearchOptions = {
  images: { enable: true, count: 12, designFacts: false, snippet: { enable: true, maxTokens: 800 } },
  webSearch: {
    enable: true,
    count: 3,
    highlight: { enable: true, maxTokens: 200 },
    fullContent: { enable: true, maxTokens: 1000 },
    includeDomains: ['dribbble.com'],
    excludeDomains: ['pinterest.com'],
    language: ['en', 'ja'],
    timeBasis: 'published',
    timeRange: 'year',
    startTime: '2025-01-01T00:00:00+08:00',
    endTime: '2026-01-01T00:00:00Z',
  },
};
const ALL_OPTIONS_WIRE = {
  images: { enable: true, count: 12, design_facts: false, snippet: { enable: true, max_tokens: 800 } },
  web_search: {
    enable: true,
    count: 3,
    highlight: { enable: true, max_tokens: 200 },
    full_content: { enable: true, max_tokens: 1000 },
    include_domains: ['dribbble.com'],
    exclude_domains: ['pinterest.com'],
    language: ['en', 'ja'],
    time_basis: 'published',
    time_range: 'year',
    start_time: '2025-01-01T00:00:00+08:00',
    end_time: '2026-01-01T00:00:00Z',
  },
};

function build(options: OctenDesignSearchOptions = {}) {
  const rec = recordingFetch(() => jsonResponse(designFixture));
  const t = octenDesignSearch({ ...options, client: clientFor(rec.fakeFetch) } as OctenDesignSearchOptions);
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

describe('octenDesignSearch request', () => {
  it('sends only the model query to /design-search when no option is set', async () => {
    const { t, calls } = build();
    await run(t, { query: 'pricing section for a SaaS landing page' });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!.url).pathname).toBe('/design-search');
    expect(calls[0]?.body).toEqual({ query: 'pricing section for a SaaS landing page' });
  });

  it('sends a model group_id as images.group_id, without a query', async () => {
    const { t, calls } = build();
    await run(t, { group_id: GROUP, query: null });
    expect(calls[0]?.body).toEqual({ images: { group_id: GROUP } });
  });

  it('merges group_id into the developer images options and keeps a query sent with it', async () => {
    const { t, calls } = build({ images: { count: 30 } });
    await run(t, { group_id: GROUP, query: 'pricing' });
    expect(calls[0]?.body).toEqual({ query: 'pricing', images: { count: 30, group_id: GROUP } });
  });

  it('sends every developer option under the API names', async () => {
    const { t, calls } = build(ALL_OPTIONS);
    await run(t, { query: 'q' });
    expect(calls[0]?.body).toEqual({ query: 'q', ...ALL_OPTIONS_WIRE });
  });

  it('sends disabled sections as enable false', async () => {
    const { t, calls } = build({ images: { snippet: { enable: false } }, webSearch: { enable: false } });
    await run(t, { query: 'q' });
    expect(calls[0]?.body).toEqual({ query: 'q', images: { snippet: { enable: false } }, web_search: { enable: false } });
  });

  // A non-strict provider can send keys outside the schema; none of them may reach the request.
  it('drops developer-only fields the model sends outside its schema', async () => {
    const { t, calls } = build();
    await run(t, { query: 'q', ...ALL_OPTIONS_WIRE, ...ALL_OPTIONS, count: 100 });
    expect(calls[0]?.body).toEqual({ query: 'q' });
  });

  it('omits options set to undefined and a group_id sent as null or blank', async () => {
    const { t, calls } = build({
      images: { count: undefined, snippet: { enable: undefined, maxTokens: 300 } },
      webSearch: undefined,
    } as unknown as OctenDesignSearchOptions);
    await run(t, { query: 'q', group_id: null });
    await run(t, { query: 'q', group_id: ' ' });
    expect(calls.map((c) => c.body)).toEqual([
      { query: 'q', images: { snippet: { max_tokens: 300 } } },
      { query: 'q', images: { snippet: { max_tokens: 300 } } },
    ]);
  });

  it('copies the developer options when the tool is built', async () => {
    const images = { count: 3, snippet: { maxTokens: 200 } };
    const webSearch = { includeDomains: ['dribbble.com'] };
    const { t, calls } = build({ images, webSearch });
    Object.assign(images, { count: 100, designFacts: true });
    images.snippet.maxTokens = 100_000;
    webSearch.includeDomains.push('example.com');
    await run(t, { query: 'q' });
    expect(calls[0]?.body).toEqual({
      query: 'q',
      images: { count: 3, snippet: { max_tokens: 200 } },
      web_search: { include_domains: ['dribbble.com'] },
    });
  });
});

describe('octenDesignSearch query or group_id', () => {
  const MISSING =
    'Pass `query` to search for design references, or `group_id` (the `group.group_id` of an earlier image result) to get the images of that web page or deck. Both are missing or blank. No request was made.';

  it('refuses a call with neither query nor group_id without a request', async () => {
    const { t, calls } = build();
    for (const input of [{}, { query: null, group_id: null }, { query: ' ' }, { group_id: '' }]) {
      const err = await run(t, input).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(OctenValidationError);
      expect((err as OctenValidationError).field).toBe('query');
      expect((err as Error).message).toBe(MISSING);
    }
    expect(calls).toHaveLength(0);
  });

  it('rejects it in the input check the AI SDK runs, with the same advice for the model', async () => {
    const t = octenDesignSearch({ client: new Octen({ apiKey: 'test-key' }) });
    const result = await asSchema(t.inputSchema as Parameters<typeof asSchema>[0]).validate?.({ query: null });
    expect(result?.success).toBe(false);
    expect(result?.success === false ? String(result.error.message) : '').toContain('Pass `query` to search for design references');
  });

  it('accepts a query, a group_id or both, and a query of up to 500 code points', async () => {
    const t = octenDesignSearch({ client: new Octen({ apiKey: 'test-key' }) });
    expect(await validateInput(t, { query: 'q' })).toBe(true);
    expect(await validateInput(t, { group_id: GROUP })).toBe(true);
    expect(await validateInput(t, { query: 'q', group_id: GROUP })).toBe(true);
    expect(await validateInput(t, { query: '\u{1F600}'.repeat(500) })).toBe(true);
    expect(await validateInput(t, { query: 'q'.repeat(501) })).toBe(false);
  });
});

describe('octenDesignSearch model input', () => {
  it('exposes only query and group_id, none required', async () => {
    const json = await modelJsonSchema(octenDesignSearch({ ...ALL_OPTIONS, client: new Octen({ apiKey: 'test-key' }) } as OctenDesignSearchOptions));
    expect(Object.keys(json.properties ?? {}).sort()).toEqual(['group_id', 'query']);
    expect(json.required ?? []).toEqual([]);
    expect(json.properties?.['query']).toMatchObject({ anyOf: [{ type: 'string', minLength: 1, maxLength: 500 }, { type: 'null' }] });
  });
});

describe('octenDesignSearch construction', () => {
  const client = new Octen({ apiKey: 'test-key' });
  const VALID: [string, OctenDesignSearchOptions][] = [
    ['images count 1', { images: { count: 1 } }],
    ['images count 100', { images: { count: 100 } }],
    ['snippet maxTokens 100', { images: { snippet: { maxTokens: 100 } } }],
    ['snippet maxTokens 100000', { images: { snippet: { maxTokens: 100_000 } } }],
    ['web count 1', { webSearch: { count: 1 } }],
    ['web count 100', { webSearch: { count: 100 } }],
    ['highlight maxTokens 100', { webSearch: { highlight: { maxTokens: 100 } } }],
    ['highlight maxTokens 20000', { webSearch: { highlight: { maxTokens: 20_000 } } }],
    ['fullContent maxTokens 100000', { webSearch: { fullContent: { maxTokens: 100_000 } } }],
    ['domain of 60 characters', { webSearch: { includeDomains: [`${'a'.repeat(56)}.com`] } }],
    ['1200 domains', { webSearch: { excludeDomains: Array.from({ length: 1200 }, (_, i) => `d${i}.com`) } }],
    ['empty sections', { images: {}, webSearch: {} }],
    ['every option', ALL_OPTIONS],
  ];
  it.each(VALID)('accepts %s', (_name, options) => {
    expect(() => octenDesignSearch({ ...options, client } as OctenDesignSearchOptions)).not.toThrow();
  });

  const INVALID: [string, string, Record<string, unknown>][] = [
    ['images not an object', 'images', { images: 5 }],
    ['images group_id', 'images.group_id', { images: { group_id: GROUP } }],
    ['images groupId', 'images.groupId', { images: { groupId: GROUP } }],
    ['images design_facts', 'images.design_facts', { images: { design_facts: false } }],
    ['images count 0', 'images.count', { images: { count: 0 } }],
    ['images count 101', 'images.count', { images: { count: 101 } }],
    ['images enable "no"', 'images.enable', { images: { enable: 'no' } }],
    ['images designFacts 0', 'images.designFacts', { images: { designFacts: 0 } }],
    ['snippet maxTokens 99', 'images.snippet.maxTokens', { images: { snippet: { maxTokens: 99 } } }],
    ['snippet maxTokens 100001', 'images.snippet.maxTokens', { images: { snippet: { maxTokens: 100_001 } } }],
    ['snippet max_tokens', 'images.snippet.max_tokens', { images: { snippet: { max_tokens: 500 } } }],
    ['web_search key', 'webSearch.include_domains', { webSearch: { include_domains: ['a.com'] } }],
    ['web count 0', 'webSearch.count', { webSearch: { count: 0 } }],
    ['web count 101', 'webSearch.count', { webSearch: { count: 101 } }],
    ['highlight maxTokens 99', 'webSearch.highlight.maxTokens', { webSearch: { highlight: { maxTokens: 99 } } }],
    ['highlight maxTokens 20001', 'webSearch.highlight.maxTokens', { webSearch: { highlight: { maxTokens: 20_001 } } }],
    ['fullContent maxTokens 99', 'webSearch.fullContent.maxTokens', { webSearch: { fullContent: { maxTokens: 99 } } }],
    ['fullContent maxTokens 100001', 'webSearch.fullContent.maxTokens', { webSearch: { fullContent: { maxTokens: 100_001 } } }],
    ['domain of 61 characters', 'webSearch.includeDomains[0]', { webSearch: { includeDomains: [`${'a'.repeat(57)}.com`] } }],
    ['1201 domains', 'webSearch.excludeDomains', { webSearch: { excludeDomains: Array.from({ length: 1201 }, (_, i) => `d${i}.com`) } }],
    ['language xx', 'webSearch.language[1]', { webSearch: { language: ['en', 'xx'] } }],
    ['language []', 'webSearch.language', { webSearch: { language: [] } }],
    ['timeBasis indexed', 'webSearch.timeBasis', { webSearch: { timeBasis: 'indexed' } }],
    ['timeRange w', 'webSearch.timeRange', { webSearch: { timeRange: 'w' } }],
    ['startTime date only', 'webSearch.startTime', { webSearch: { startTime: '2025-01-01' } }],
    ['endTime number', 'webSearch.endTime', { webSearch: { endTime: 1_700_000_000 } }],
  ];
  it.each(INVALID)('rejects %s with OctenValidationError(%s)', (_name, field, options) => {
    const err = thrown(() => octenDesignSearch({ client, ...options } as unknown as OctenDesignSearchOptions));
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toBe(field);
  });

  it('rejects client together with a client option, like the other tools', () => {
    const err = thrown(() => octenDesignSearch({ client, maxRetries: 0 } as unknown as OctenDesignSearchOptions));
    expect((err as OctenValidationError).field).toBe('maxRetries');
  });
});

describe('octenDesignSearch result', () => {
  it('keeps the images with group, design facts and snippet, and trims the web results', async () => {
    const { t } = build();
    const out = (await run(t, { query: designFixture.data.query })) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(['request_id', 'images', 'results']);
    expect(out['request_id']).toBe(designFixture.request_id);
    const images = out['images'] as Record<string, unknown>[];
    // The recorded images carry only documented fields, all non-empty, so each one comes through whole.
    expect(images).toEqual(designFixture.data.images);
    expect(images[0]?.['group']).toEqual({ group_id: GROUP, type: 'web_page', name: expect.any(String), position: 9, total: 12 });
    const web = designFixture.data.results[0]!;
    // favicon, authors, cover_image, images and time_last_crawled are dropped, as for every web result.
    expect((out['results'] as unknown[])[0]).toEqual({ title: web.title, url: web.url, highlight: web.highlight, time_published: web.time_published });
  });

  it('drops empty fields, empty groups and snippets without code, and keeps a deck master', async () => {
    const image = {
      type: 'slide',
      title: '',
      url: 'https://example.com/p-005.png',
      width: 1920,
      height: null,
      group: { group_id: 'deck_1', type: 'deck', position: 5, total: 14, master: { majorFont: 'Calibri Light' }, name: '' },
      design_facts: {},
      snippet: { format: 'html', code: '' },
    };
    const rec = recordingFetch(() =>
      jsonResponse({
        request_id: 'r1',
        data: { images: [image, { group: {}, snippet: null }, 'x'], results: null },
        meta: { warning: 'web results unavailable' },
      }),
    );
    const out = await run(octenDesignSearch({ client: clientFor(rec.fakeFetch) }), { query: 'q' });
    expect(out).toEqual({
      request_id: 'r1',
      warning: 'web results unavailable',
      images: [
        {
          type: 'slide',
          url: 'https://example.com/p-005.png',
          width: 1920,
          group: { group_id: 'deck_1', type: 'deck', position: 5, total: 14, master: { majorFont: 'Calibri Light' } },
        },
      ],
      results: [],
    });
  });

  it('throws when data.images is not a list', async () => {
    const bad = recordingFetch(() => jsonResponse({ request_id: 'r3', data: { images: 'oops' } }));
    await expect(run(octenDesignSearch({ client: clientFor(bad.fakeFetch) }), { query: 'q' })).rejects.toThrow(/data\.images/);
  });
});

describe('octenDesignSearch description', () => {
  const client = new Octen({ apiKey: 'test-key' });

  it('tells the model about group_id follow-ups, design values, code and web results by default', () => {
    const d = octenDesignSearch({ client }).description ?? '';
    expect(d).toMatch(/call again with that `group_id` and no query/);
    expect(d).toMatch(/design values/);
    expect(d).toMatch(/reusable HTML code/);
    expect(d).toMatch(/`results`/);
  });

  it('leaves out what the developer turned off', () => {
    const d = octenDesignSearch({ client, images: { designFacts: false, snippet: { enable: false } }, webSearch: { enable: false } }).description ?? '';
    expect(d).not.toMatch(/design values/);
    expect(d).not.toMatch(/HTML code/);
    expect(d).not.toMatch(/`results`/);
  });

  it('lets description replace the default', () => {
    expect(octenDesignSearch({ client, description: 'Custom text' }).description).toBe('Custom text');
  });
});

describe('octenDesignSearch errors and cancellation', () => {
  it('forwards the abort signal to the in-flight request', async () => {
    const rec = recordingFetch((_url, init) => hangUntilAborted(init));
    const controller = new AbortController();
    const pending = run(octenDesignSearch({ client: clientFor(rec.fakeFetch) }), { query: 'q' }, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(OctenAbortError);
    expect(rec.calls).toHaveLength(1);
  });

  it('propagates 401 and 500 as the SDK error classes', async () => {
    const cases: [number, unknown][] = [
      [401, OctenAuthenticationError],
      [500, OctenServerError],
    ];
    for (const [status, cls] of cases) {
      const rec = recordingFetch(() => jsonResponse({ code: status, msg: 'm', request_id: `req-${status}-design` }, status));
      const err = await run(octenDesignSearch({ client: clientFor(rec.fakeFetch) }), { query: 'q' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(cls as new () => Error);
      expect((err as OctenAuthenticationError).requestId).toBe(`req-${status}-design`);
    }
  });
});

describe('octenDesignSearch review fixes', () => {
  const client = new Octen({ apiKey: 'test-key' });
  const noImages = { images: { enable: false } } as const;

  it('with images off, offers neither screenshots nor group_id and requires query', async () => {
    const t = octenDesignSearch({ client, ...noImages });
    expect(t.description).not.toMatch(/screenshot|group_id|design values|HTML code/i);
    expect(t.description).toMatch(/`results`/);
    const json = await modelJsonSchema(t);
    expect(Object.keys(json.properties ?? {})).toEqual(['query']);
    expect(json.required).toEqual(['query']);
    expect(await validateInput(t, { query: 'q' })).toBe(true);
    expect(await validateInput(t, { group_id: GROUP })).toBe(false);
    expect(await validateInput(t, { query: null })).toBe(false);
  });

  it('with images off, refuses a call without query and never sends group_id', async () => {
    const { t, calls } = build(noImages);
    const err = await run(t, { group_id: GROUP }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as Error).message).toBe('Pass `query`, the design topic to search for. No request was made.');
    expect(calls).toHaveLength(0);
    await run(t, { query: 'q', group_id: GROUP });
    expect(calls.map((c) => c.body)).toEqual([{ query: 'q', images: { enable: false } }]);
  });

  it('rejects turning off both images and web results', () => {
    const err = thrown(() => octenDesignSearch({ client, images: { enable: false }, webSearch: { enable: false } }));
    expect((err as OctenValidationError).field).toBe('images.enable');
  });

  it.each([
    '2025-02-30T00:00:00Z',
    '2023-02-29T00:00:00Z',
    '2025-13-01T00:00:00Z',
    '2025-00-10T00:00:00Z',
    '2025-01-01T24:00:00Z',
    '2025-01-01T00:60:00Z',
    '2025-01-01T00:00:60Z',
    '2025-01-01T00:00:00+24:00',
    '2025-01-01T00:00:00+05:60',
    '2025-01-01T00:00Z',
    '2025-01-01 00:00:00Z',
  ])('rejects the impossible or malformed startTime %s', (value) => {
    const err = thrown(() => octenDesignSearch({ client, webSearch: { startTime: value } }));
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toBe('webSearch.startTime');
  });

  it.each(['2024-02-29T00:00:00Z', '2025-12-31T23:59:59.999+14:00', '2025-01-01t00:00:00z', '2025-06-30T12:00:00-09:30'])(
    'accepts the RFC 3339 date-time %s',
    (value) => {
      expect(() => octenDesignSearch({ client, webSearch: { startTime: value, endTime: '2030-01-01T00:00:00Z' } })).not.toThrow();
    },
  );

  it('rejects a startTime after the endTime', () => {
    const err = thrown(() =>
      octenDesignSearch({ client, webSearch: { startTime: '2026-01-02T00:00:00+08:00', endTime: '2026-01-01T00:00:00Z' } }),
    );
    expect((err as OctenValidationError).field).toBe('webSearch.startTime');
  });

  it.each([
    ['image', { image: { count: 3 } }],
    ['web_search', { web_search: { enable: false } }],
    ['defaults', { defaults: {} }],
  ])('rejects the unknown option %s at construction', (field, options) => {
    const err = thrown(() => octenDesignSearch({ client, ...options } as unknown as OctenDesignSearchOptions));
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toBe(field);
  });

  it('rejects sparse lists at construction', () => {
    const language: string[] = [];
    language[0] = 'en';
    language[2] = 'ja';
    const domains: string[] = [];
    domains[1] = 'a.com';
    const err1 = thrown(() => octenDesignSearch({ client, webSearch: { language } } as unknown as OctenDesignSearchOptions));
    expect((err1 as OctenValidationError).field).toBe('webSearch.language[1]');
    const err2 = thrown(() => octenDesignSearch({ client, webSearch: { includeDomains: domains } }));
    expect((err2 as OctenValidationError).field).toBe('webSearch.includeDomains[0]');
  });
});

describe('octenDesignSearch group follow-up wording', () => {
  const client = new Octen({ apiKey: 'test-key' });
  const groupText = async (options: OctenDesignSearchOptions) => {
    const t = octenDesignSearch({ client, ...options } as OctenDesignSearchOptions);
    const schema = (await modelJsonSchema(t)).properties?.['group_id'] as { description?: string };
    return { description: t.description ?? '', schema: schema.description ?? '' };
  };

  it('promises up to the API default of 5 group images when images.count is unset', async () => {
    const { description, schema } = await groupText({});
    expect(description).toMatch(/up to 5 of its images come back, in group order/);
    expect(schema).toMatch(/returns up to 5 images of that web page or deck/);
    expect(`${description} ${schema}`).not.toMatch(/every image|all (of )?(its|the) images|the rest of/i);
  });

  it('promises up to the developer images.count', async () => {
    const { description, schema } = await groupText({ images: { count: 30 } });
    expect(description).toMatch(/up to 30 of its images/);
    expect(schema).toMatch(/returns up to 30 images/);
  });
});

describe('octenDesignSearch review round 3', () => {
  const client = new Octen({ apiKey: 'test-key' });

  it('rejects a startTime after the endTime by less than a millisecond', () => {
    const err = thrown(() =>
      octenDesignSearch({ client, webSearch: { startTime: '2026-01-01T00:00:00.0005Z', endTime: '2026-01-01T00:00:00.0001Z' } }),
    );
    expect((err as OctenValidationError).field).toBe('webSearch.startTime');
  });

  it('accepts equal and sub-millisecond ordered bounds, including different offsets for the same instant', () => {
    for (const [startTime, endTime] of [
      ['2026-01-01T00:00:00.0001Z', '2026-01-01T00:00:00.0005Z'],
      ['2026-01-01T00:00:00.5Z', '2026-01-01T00:00:00.500Z'],
      ['2026-01-01T08:00:00.0001+08:00', '2026-01-01T00:00:00.00010Z'],
    ] as const) {
      expect(() => octenDesignSearch({ client, webSearch: { startTime, endTime } })).not.toThrow();
    }
  });

  it('with images off, promises an excerpt only when web highlights are on', () => {
    expect(octenDesignSearch({ client, images: { enable: false } }).description).toMatch(/query-relevant excerpt/);
    const d = octenDesignSearch({ client, images: { enable: false }, webSearch: { highlight: { enable: false } } }).description ?? '';
    expect(d).not.toMatch(/excerpt/);
    expect(d).toMatch(/`results`/);
  });
});

describe('octenDesignSearch review round 5', () => {
  it('with images off, ignores a group_id of any type in the input check and never sends it', async () => {
    const { t, calls } = build({ images: { enable: false } });
    for (const groupId of [123, { id: 'x' }, ['pg_1'], 'pg_1']) {
      expect(await validateInput(t, { query: 'q', group_id: groupId })).toBe(true);
      await run(t, { query: 'q', group_id: groupId });
    }
    expect(calls.map((c) => c.body)).toEqual(Array.from({ length: 4 }, () => ({ query: 'q', images: { enable: false } })));
  });
});

describe('octenDesignSearch review round 6', () => {
  it.each([
    ['a 501-character query', { query: 'q'.repeat(501) }, 'query'],
    ['a non-string group_id', { group_id: 42 }, 'group_id'],
    ['a non-string query', { query: 7, group_id: 'pg_1' }, 'query'],
  ])('refuses %s in a direct execute call without a request', async (_name, input, field) => {
    const { t, calls } = build();
    const err = await run(t, input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toBe(field);
    expect((err as Error).message).toMatch(/No request was made\.$/);
    expect(calls).toHaveLength(0);
  });
});
