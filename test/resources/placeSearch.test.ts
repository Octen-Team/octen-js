import { describe, expect, test, type Mock } from 'vitest';
import { OctenValidationError } from '../../src/core/errors';
import { PlaceSearchResource } from '../../src/resources/placeSearch';
import { BASE, makeFetch } from './helpers';

describe('PlaceSearchResource.search', () => {
  test('POSTs to /place-search with undefined keys stripped, nested fields kept', async () => {
    const { core, calls } = makeFetch();
    await new PlaceSearchResource(core).search({
      query: ' coffee ',
      places: { count: 5, max_reviews: 2 },
      user_location: { type: 'approximate', city: 'Seattle', region: undefined },
      latitude: 47.6,
      longitude: -122.3,
      radius: 1000,
    });
    expect(calls).toEqual([
      {
        url: `${BASE}/place-search`,
        body: {
          query: ' coffee ',
          places: { count: 5, max_reviews: 2 },
          user_location: { type: 'approximate', city: 'Seattle' },
          latitude: 47.6,
          longitude: -122.3,
          radius: 1000,
        },
      },
    ]);
  });

  test.each([[''], ['  '], ['\t\n']])('blank query %j throws OctenValidationError(query)', async (query) => {
    const { core, fetchImpl } = makeFetch();
    const err = await new PlaceSearchResource(core).search({ query }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toBe('query');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test.each([
    [{ country: 'US' }, 'country'],
    [{ places: { count: 1, bogus: 1 } }, 'places.bogus'],
    [{ web_search: { enable: true, highlight: { num_highlights: 1 } } }, 'web_search.highlight.num_highlights'],
  ])('rejects unknown field %j', async (extra, field) => {
    const { core, fetchImpl } = makeFetch();
    const err = await new PlaceSearchResource(core)
      .search({ query: 'q', ...extra } as never)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toBe(field);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('keeps unknown response fields, including inside places[] and places[].attributes', async () => {
    const body = {
      code: 0,
      request_id: 'req_1',
      data: {
        query: 'q',
        places: [{ name: 'A', attributes: { wifi: true, anything: ['x'] }, new_field: 1 }],
        new_data_field: 'x',
      },
      meta: { usage: { num_search_queries: 1, new_counter: 3 } },
    };
    const { core } = makeFetch(body);
    expect(await new PlaceSearchResource(core).search({ query: 'q' })).toEqual(body);
  });

  test('passes RequestOptions through to the HTTP core', async () => {
    const { core, fetchImpl } = makeFetch();
    await new PlaceSearchResource(core).search({ query: 'q' }, { headers: { 'x-extra': 'yes' } });
    const init = (fetchImpl as unknown as Mock).mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('x-extra')).toBe('yes');
  });
});

describe('A2: non-finite numbers in place search', () => {
  test.each([
    [{ query: 'q', latitude: Number.NaN, longitude: 1 }, 'latitude'],
    [{ query: 'q', latitude: 1, longitude: Number.POSITIVE_INFINITY }, 'longitude'],
    [{ query: 'q', places: { count: Number.NaN } }, 'places.count'],
  ])('%j -> OctenValidationError(%s), nothing sent', async (params, field) => {
    const { core, fetchImpl } = makeFetch();
    const err = await new PlaceSearchResource(core).search(params).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toBe(field);
    expect(fetchImpl).toHaveBeenCalledTimes(0);
  });
});
