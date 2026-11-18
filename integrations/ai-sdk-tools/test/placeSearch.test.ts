import { Octen, OctenAbortError, OctenAuthenticationError } from '@octen.ai/sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { octenPlaceSearch } from '../src/tools/placeSearch.js';
import { clientFor, jsonResponse, recordingFetch, run } from './helpers.js';
// Replies are the production envelope recorded in test/fixtures/place-search.json (no web results in it).
import placeFixture from './fixtures/place-search.json';

const DEFAULT_DESCRIPTION =
  "Find places such as shops, restaurants and services, with address, coordinates, rating, opening hours and contact details. Put the area in the query, for example 'coffee near Shibuya, Tokyo', unless a location is already set.";

type Out = { request_id: string; places: Record<string, unknown>[]; results: Record<string, unknown>[] };

describe('octenPlaceSearch', () => {
  it('sends the tool defaults plus the model query', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(placeFixture));
    const t = octenPlaceSearch({ client: clientFor(fakeFetch) });
    await run(t, { query: 'coffee shops' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toMatch(/\/place-search$/);
    expect(calls[0]?.body).toEqual({ query: 'coffee shops', places: { count: 5 } });
  });

  it('sends the developer location defaults in the request body', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(placeFixture));
    const t = octenPlaceSearch({
      client: clientFor(fakeFetch),
      defaults: { latitude: 35.6812, longitude: 139.7671, radius: 1000 },
    });
    await run(t, { query: 'coffee shops' });
    expect(calls[0]?.body).toEqual({
      query: 'coffee shops',
      places: { count: 5 },
      latitude: 35.6812,
      longitude: 139.7671,
      radius: 1000,
    });
  });

  it('replaces the places object as a whole when the developer sets it', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(placeFixture));
    const t = octenPlaceSearch({ client: clientFor(fakeFetch), defaults: { places: { count: 2, max_reviews: 1 } } });
    await run(t, { query: 'q' });
    expect(calls[0]?.body).toEqual({ query: 'q', places: { count: 2, max_reviews: 1 } });
  });

  it('keeps the 12 place fields and drops the rest, with strings exactly as recorded', async () => {
    const { fakeFetch } = recordingFetch(() => jsonResponse(placeFixture));
    const t = octenPlaceSearch({ client: clientFor(fakeFetch) });
    const out = (await run(t, { query: 'q' })) as Out;
    expect(out.request_id).toBe(placeFixture.request_id);
    expect(out.places).toHaveLength(placeFixture.data.places.length);
    // The fixture place carries exactly these 12 fields; the address keeps its 〒 and −.
    expect(out.places[0]).toEqual(placeFixture.data.places[0]);
    expect(out.places[0]?.['address']).toBe(
      'Japan, 〒104-0028 Tokyo, Chuo City, Yaesu, 2 Chome−1−1 Underground Shopping Mall 1',
    );
    expect(Object.keys(out.places[0]!).sort()).toEqual(
      ['name', 'category', 'address', 'latitude', 'longitude', 'distance', 'rating', 'review_count', 'opening_hours', 'status', 'phone', 'website'].sort(),
    );
  });

  it('drops attributes and any other extra field on a place', async () => {
    // attributes is part of the place type in src/schema/placeSearch.ts but is not in the tool result.
    const { fakeFetch } = recordingFetch(() =>
      jsonResponse({
        ...placeFixture,
        data: { query: 'q', places: [{ name: 'A', attributes: { wifi: true }, extra: 1 }] },
      }),
    );
    const t = octenPlaceSearch({ client: clientFor(fakeFetch) });
    expect(((await run(t, { query: 'q' })) as Out).places).toEqual([{ name: 'A' }]);
  });

  it('omits empty, null and non-finite values, keeps zero, and drops non-string opening hours', async () => {
    const { fakeFetch } = recordingFetch(() =>
      jsonResponse({
        ...placeFixture,
        data: {
          query: 'q',
          places: [
            {
              name: 'A',
              category: '',
              address: null,
              latitude: 0,
              longitude: 'x',
              distance: 0,
              rating: null,
              review_count: 0,
              opening_hours: ['Mon 9-5', '', 3, null],
              status: '',
              phone: null,
              website: '',
            },
            { name: 'B', opening_hours: [] },
            { name: 'C', opening_hours: null },
            { name: 'D', opening_hours: 'Mon 9-5' },
            null,
          ],
        },
      }),
    );
    const t = octenPlaceSearch({ client: clientFor(fakeFetch) });
    const out = (await run(t, { query: 'q' })) as Out;
    expect(out.places).toEqual([
      { name: 'A', latitude: 0, distance: 0, review_count: 0, opening_hours: ['Mon 9-5'] },
      { name: 'B' },
      { name: 'C' },
      { name: 'D' },
    ]);
  });

  it('returns an empty results list when the reply has no web results', async () => {
    const { fakeFetch } = recordingFetch(() => jsonResponse(placeFixture));
    const t = octenPlaceSearch({ client: clientFor(fakeFetch) });
    const out = (await run(t, { query: 'q' })) as Out;
    expect(Object.keys(out).sort()).toEqual(['places', 'request_id', 'results']);
    expect(out.results).toEqual([]);
  });

  it('includes trimmed results when the reply has web results', async () => {
    // Web results sit in data.results of the response type: src/schema/placeSearch.ts, PlaceSearchResponseDesc.
    const { fakeFetch } = recordingFetch(() =>
      jsonResponse({
        ...placeFixture,
        data: {
          ...placeFixture.data,
          results: [
            {
              title: 'Best coffee in Tokyo',
              url: 'https://example.com/coffee',
              highlight: 'text',
              time_published: '2026-01-01T00:00:00Z',
              favicon: 'https://example.com/f.png',
              authors: 'someone',
            },
          ],
        },
      }),
    );
    const t = octenPlaceSearch({ client: clientFor(fakeFetch) });
    const out = (await run(t, { query: 'q' })) as Out;
    expect(out.results).toEqual([
      { title: 'Best coffee in Tokyo', url: 'https://example.com/coffee', highlight: 'text', time_published: '2026-01-01T00:00:00Z' },
    ]);
  });

  it('returns an empty results list when the reply carries an empty or null results list', async () => {
    for (const results of [[], null]) {
      const { fakeFetch } = recordingFetch(() => jsonResponse({ ...placeFixture, data: { ...placeFixture.data, results } }));
      const t = octenPlaceSearch({ client: clientFor(fakeFetch) });
      expect(((await run(t, { query: 'q' })) as Out).results).toEqual([]);
    }
  });

  it('uses the default description and lets description override it', () => {
    const client = new Octen({ apiKey: 'test-key' });
    expect(octenPlaceSearch({ client }).description).toBe(DEFAULT_DESCRIPTION);
    expect(octenPlaceSearch({ client, description: 'Custom text' }).description).toBe('Custom text');
  });

  it('exposes only query to the model', () => {
    const t = octenPlaceSearch({ client: new Octen({ apiKey: 'test-key' }) });
    const json = z.toJSONSchema(t.inputSchema as z.ZodType) as { properties: Record<string, unknown>; required?: string[] };
    expect(Object.keys(json.properties)).toEqual(['query']);
    expect(json.required).toEqual(['query']);
  });

  it('rejects with OctenAbortError when the signal is already aborted', async () => {
    const { fakeFetch } = recordingFetch(() => jsonResponse(placeFixture));
    const t = octenPlaceSearch({ client: clientFor(fakeFetch) });
    const controller = new AbortController();
    controller.abort();
    await expect(run(t, { query: 'q' }, controller.signal)).rejects.toBeInstanceOf(OctenAbortError);
  });

  it('propagates a 401 as OctenAuthenticationError with the reply request id', async () => {
    const { fakeFetch } = recordingFetch(() =>
      jsonResponse({ code: 401, msg: 'invalid api key', request_id: 'req-401-place' }, 401),
    );
    const t = octenPlaceSearch({ client: clientFor(fakeFetch) });
    const err = await run(t, { query: 'q' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenAuthenticationError);
    expect((err as OctenAuthenticationError).requestId).toBe('req-401-place');
  });

  it('returns an empty places list when places is null or missing', async () => {
    for (const data of [{ query: 'q', places: null }, { query: 'q' }]) {
      const { fakeFetch } = recordingFetch(() => jsonResponse({ ...placeFixture, data }));
      const t = octenPlaceSearch({ client: clientFor(fakeFetch) });
      expect(await run(t, { query: 'q' })).toEqual({ request_id: placeFixture.request_id, places: [], results: [] });
    }
  });
  it('passes a non-empty meta.warning through and omits an empty or null one', async () => {
    // meta.warning is a nullable string on the response: src/schema/placeSearch.ts; the fixture carries "".
    const cases: [unknown, string | undefined][] = [
      ['places_unavailable', 'places_unavailable'],
      [placeFixture.meta.warning, undefined],
      [null, undefined],
    ];
    for (const [warning, want] of cases) {
      const { fakeFetch } = recordingFetch(() => jsonResponse({ ...placeFixture, meta: { ...placeFixture.meta, warning } }));
      const out = (await run(octenPlaceSearch({ client: clientFor(fakeFetch) }), { query: 'q' })) as Record<string, unknown>;
      expect(out['warning']).toBe(want);
      expect('warning' in out).toBe(want !== undefined);
    }
  });

  it.each([
    ['data.places', { places: 'x' }],
    ['data.results', { places: [], results: { title: 'x' } }],
  ])('rejects with an error naming %s when it is not a list', async (label, data) => {
    const { fakeFetch } = recordingFetch(() => jsonResponse({ ...placeFixture, data }));
    const err = await run(octenPlaceSearch({ client: clientFor(fakeFetch) }), { query: 'q' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain(label);
  });

  it('drops non-object places and places with no non-empty field', async () => {
    const { fakeFetch } = recordingFetch(() =>
      jsonResponse({
        ...placeFixture,
        data: { places: ['x', 7, ['y'], { name: '', rating: null, opening_hours: [] }, { attributes: { wifi: true } }, { name: 'A' }] },
      }),
    );
    const out = (await run(octenPlaceSearch({ client: clientFor(fakeFetch) }), { query: 'q' })) as Out;
    expect(out.places).toEqual([{ name: 'A' }]);
  });
  // Backs the README claim: the tool default has count: 5, so a body without count proves a whole replace.
  it('replaces the places default whole when the developer object omits count', async () => {
    const { fakeFetch, calls } = recordingFetch(() => jsonResponse(placeFixture));
    await run(octenPlaceSearch({ client: clientFor(fakeFetch), defaults: { places: { max_reviews: 2 } } }), { query: 'q' });
    expect((calls[0]?.body as { places?: unknown }).places).toEqual({ max_reviews: 2 });
  });
});
