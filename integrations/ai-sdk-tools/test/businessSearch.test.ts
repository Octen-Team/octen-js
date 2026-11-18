import { Octen, OctenAbortError, OctenAuthenticationError } from '@octen.ai/sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { octenBusinessSearch } from '../src/tools/businessSearch.js';
import { clientFor, jsonResponse, recordingFetch, run } from './helpers.js';
// Replies are the production envelope recorded in test/fixtures/business-search.json (company entities only).
import businessFixture from './fixtures/business-search.json';

const DEFAULT_DESCRIPTION =
  'Look up companies and people. Returns entity cards for companies or people with a summary and key identifiers, plus ranked sources. Use it for company research, people lookup and competitor comparison.';

type Out = { request_id: string; entities: Record<string, unknown>[]; results: Record<string, unknown>[] };

describe('octenBusinessSearch', () => {
  it('sends the tool defaults plus the model query', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(businessFixture));
    const t = octenBusinessSearch({ client: clientFor(fakeFetch) });
    await run(t, { query: 'compare Stripe and Adyen' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toMatch(/\/business-search$/);
    expect(calls[0]?.body).toEqual({
      query: 'compare Stripe and Adyen',
      count: 5,
      highlight: { enable: true, max_tokens: 300 },
    });
  });

  it('merges developer defaults over the tool defaults and replaces highlight as a whole', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(businessFixture));
    const t = octenBusinessSearch({
      client: clientFor(fakeFetch),
      defaults: { count: 10, entities: { count: 2 }, highlight: { enable: true, max_tokens: 100 } },
    });
    await run(t, { query: 'q' });
    expect(calls[0]?.body).toEqual({
      query: 'q',
      count: 10,
      entities: { count: 2 },
      highlight: { enable: true, max_tokens: 100 },
    });
  });

  it('trims company entities to type, name, summary and the website from identifiers', async () => {
    const { fakeFetch } = recordingFetch(() => jsonResponse(businessFixture));
    const t = octenBusinessSearch({ client: clientFor(fakeFetch) });
    const out = (await run(t, { query: 'q' })) as Out;
    expect(out.request_id).toBe(businessFixture.request_id);
    expect(out.entities).toHaveLength(businessFixture.data.entities.length);
    const source = businessFixture.data.entities[0]!;
    // linkedin_url, attributes, metrics, key_people, logo, activities and news are dropped
    expect(out.entities[0]).toEqual({
      type: 'company',
      name: source.name,
      summary: source.summary,
      website: source.identifiers.website,
    });
  });

  it('trims web results like the other tools', async () => {
    const { fakeFetch } = recordingFetch(() => jsonResponse(businessFixture));
    const t = octenBusinessSearch({ client: clientFor(fakeFetch) });
    const out = (await run(t, { query: 'q' })) as Out;
    expect(out.results).toHaveLength(businessFixture.data.results.length);
    const source = businessFixture.data.results[0]!;
    expect(out.results[0]).toEqual({
      title: source.title,
      url: source.url,
      highlight: source.highlight,
      time_published: source.time_published,
    });
  });

  it('trims person entities to the person fields', async () => {
    // Person shape from the SDK 0.1.0 response type: src/schema/businessSearch.ts, personEntity.
    const { fakeFetch } = recordingFetch(() =>
      jsonResponse({
        ...businessFixture,
        data: {
          query: 'q',
          results: [],
          entities: [
            {
              type: 'person',
              name: 'A Person',
              summary: 'Summary.',
              current_position: 'CEO at Example',
              linkedin_url: 'https://www.linkedin.com/in/example',
              career: [{ organization: 'Example', title: 'CEO' }],
              photo: { url: 'https://example.com/p.jpg' },
              news: [],
            },
          ],
        },
      }),
    );
    const t = octenBusinessSearch({ client: clientFor(fakeFetch) });
    const out = (await run(t, { query: 'q' })) as Out;
    expect(out.entities).toEqual([
      {
        type: 'person',
        name: 'A Person',
        summary: 'Summary.',
        current_position: 'CEO at Example',
        linkedin_url: 'https://www.linkedin.com/in/example',
      },
    ]);
  });

  it('keeps only type, name and summary for an unknown entity type', async () => {
    // Unknown types come back as is at runtime (see the comment above businessEntity in src/schema/businessSearch.ts).
    const { fakeFetch } = recordingFetch(() =>
      jsonResponse({
        ...businessFixture,
        data: { query: 'q', results: [], entities: [{ type: 'fund', name: 'X', summary: 'Y', extra: 1 }] },
      }),
    );
    const t = octenBusinessSearch({ client: clientFor(fakeFetch) });
    const out = (await run(t, { query: 'q' })) as Out;
    expect(out.entities).toEqual([{ type: 'fund', name: 'X', summary: 'Y' }]);
  });

  it('omits empty, null and missing values and skips entities without a string type or that are null', async () => {
    const { fakeFetch } = recordingFetch(() =>
      jsonResponse({
        ...businessFixture,
        data: {
          query: 'q',
          results: [],
          entities: [
            { type: 'company', name: 'A', summary: '', identifiers: { website: '' } },
            { type: 'company', name: 'B', identifiers: null },
            { type: 'company', identifiers: { website: 'b.com' } },
            { type: 'person', name: null, current_position: '', linkedin_url: null },
            null,
            { name: 'no type' },
            { type: 7, name: 'bad type' },
            { type: 'fund' },
          ],
        },
      }),
    );
    const t = octenBusinessSearch({ client: clientFor(fakeFetch) });
    const out = (await run(t, { query: 'q' })) as Out;
    expect(out.entities).toEqual([
      { type: 'company', name: 'A' },
      { type: 'company', name: 'B' },
      { type: 'company', website: 'b.com' },
      { type: 'person' },
      { type: 'fund' },
    ]);
  });

  it('uses the default description and lets description override it', () => {
    const client = new Octen({ apiKey: 'test-key' });
    expect(octenBusinessSearch({ client }).description).toBe(DEFAULT_DESCRIPTION);
    expect(octenBusinessSearch({ client, description: 'Custom text' }).description).toBe('Custom text');
  });

  it('exposes only query to the model', () => {
    const t = octenBusinessSearch({ client: new Octen({ apiKey: 'test-key' }) });
    const json = z.toJSONSchema(t.inputSchema as z.ZodType) as { properties: Record<string, unknown>; required?: string[] };
    expect(Object.keys(json.properties)).toEqual(['query']);
    expect(json.required).toEqual(['query']);
  });

  it('rejects with OctenAbortError when the signal is already aborted', async () => {
    const { fakeFetch } = recordingFetch(() => jsonResponse(businessFixture));
    const t = octenBusinessSearch({ client: clientFor(fakeFetch) });
    const controller = new AbortController();
    controller.abort();
    await expect(run(t, { query: 'q' }, controller.signal)).rejects.toBeInstanceOf(OctenAbortError);
  });

  it('propagates a 401 as OctenAuthenticationError with the reply request id', async () => {
    const { fakeFetch } = recordingFetch(() =>
      jsonResponse({ code: 401, msg: 'invalid api key', request_id: 'req-401-business' }, 401),
    );
    const t = octenBusinessSearch({ client: clientFor(fakeFetch) });
    const err = await run(t, { query: 'q' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenAuthenticationError);
    expect((err as OctenAuthenticationError).requestId).toBe('req-401-business');
  });

  it('returns empty arrays when entities and results are null or missing', async () => {
    const { fakeFetch } = recordingFetch(() =>
      jsonResponse({ ...businessFixture, data: { query: 'q', results: null, entities: null } }),
    );
    const t = octenBusinessSearch({ client: clientFor(fakeFetch) });
    expect(await run(t, { query: 'q' })).toEqual({ request_id: businessFixture.request_id, entities: [], results: [] });
    const missing = recordingFetch(() => jsonResponse({ ...businessFixture, data: { query: 'q' } }));
    const t2 = octenBusinessSearch({ client: clientFor(missing.fakeFetch) });
    expect(await run(t2, { query: 'q' })).toEqual({ request_id: businessFixture.request_id, entities: [], results: [] });
  });
  it('passes a non-empty meta.warning through and omits an empty one', async () => {
    // meta.warning is a string on the response: src/schema/businessSearch.ts; the fixture carries "".
    const cases: [unknown, string | undefined][] = [
      ['Entity cards unavailable.', 'Entity cards unavailable.'],
      [businessFixture.meta.warning, undefined],
      [null, undefined],
    ];
    for (const [warning, want] of cases) {
      const { fakeFetch } = recordingFetch(() =>
        jsonResponse({ ...businessFixture, meta: { ...businessFixture.meta, warning } }),
      );
      const out = (await run(octenBusinessSearch({ client: clientFor(fakeFetch) }), { query: 'q' })) as Record<string, unknown>;
      expect(out['warning']).toBe(want);
      expect('warning' in out).toBe(want !== undefined);
    }
  });

  it.each([
    ['data.entities', { entities: 'x', results: [] }],
    ['data.results', { entities: [], results: 7 }],
  ])('rejects with an error naming %s when it is not a list', async (label, data) => {
    const { fakeFetch } = recordingFetch(() => jsonResponse({ ...businessFixture, data }));
    const err = await run(octenBusinessSearch({ client: clientFor(fakeFetch) }), { query: 'q' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain(label);
  });

  it('skips array entities and ignores identifiers that are not an object', async () => {
    const { fakeFetch } = recordingFetch(() =>
      jsonResponse({
        ...businessFixture,
        data: {
          results: [],
          entities: [['company'], { type: 'company', name: 'A', identifiers: 'a.com' }, { type: 'company', name: 'B', identifiers: ['b.com'] }],
        },
      }),
    );
    const out = (await run(octenBusinessSearch({ client: clientFor(fakeFetch) }), { query: 'q' })) as Out;
    expect(out.entities).toEqual([
      { type: 'company', name: 'A' },
      { type: 'company', name: 'B' },
    ]);
  });
});
