// Common user patterns: must pass tsc under both strict and exactOptionalPropertyTypes configs, and actually run.
import Octen, { OctenAPIError, OctenRateLimitError, isOctenError } from '@octen.ai/sdk';
import type { SearchResponse } from '@octen.ai/sdk';

// Explicit undefined: must also compile under exactOptionalPropertyTypes (promised in the README)
const client = new Octen({ apiKey: process.env.OCTEN_API_KEY, baseURL: process.env.OCTEN_FAKE_BASE_URL, maxRetries: 0 });

export async function callAllSix(): Promise<string[]> {
  const ids: string[] = [];
  const web: SearchResponse = await client.search.search({
    query: 'rust async runtimes',
    count: 1,
    include_domains: ['github.com'],
    time_range: 'month',
    highlight: { enable: true, max_tokens: 300 },
  });
  ids.push(web.request_id);
  const first: string | undefined = web.data?.results?.[0]?.url;
  if (first === undefined) throw new Error('no result');

  const broad = await client.search.broadSearch({ query: 'q', max_queries: 1, search_options: { count: 1, language: ['en'] } });
  ids.push(broad.request_id);
  const news = await client.search.newsSearch({ query: 'q', count: 1, subjects: { enable: true, count: 1 } });
  ids.push(news.request_id);
  const biz = await client.search.businessSearch({ query: 'q', entities: { enable: true, count: 1 } });
  ids.push(biz.request_id);
  let narrowed = '';
  for (const e of biz.data?.entities ?? []) {
    if (e.type === 'company') narrowed = e.identifiers?.stock_ticker ?? '';
    else if (e.type === 'person') narrowed = e.current_position ?? '';
  }
  if (narrowed !== 'EXM') throw new Error(`company narrowing at runtime gave "${narrowed}"`);
  const pulse = await client.search.pulseSearch({ query: 'q', mode: 'lite', count: 1 });
  ids.push(pulse.request_id);
  const place = await client.placeSearch.search({
    query: 'q',
    places: { count: 1, max_reviews: 1 },
    latitude: 37.788,
    longitude: -122.4075,
    radius: 2000,
    web_search: { enable: false },
    user_location: { type: 'approximate', city: 'San Francisco' },
  });
  ids.push(place.request_id);
  return ids;
}

export async function errorHandling(): Promise<string> {
  try {
    await client.search.search({ query: 'hello' }, { timeout: 5000, signal: new AbortController().signal, headers: { 'x-extra': '1' } });
    return 'ok';
  } catch (e) {
    if (e instanceof OctenRateLimitError) {
      const seconds: number | null = e.retryAfter;
      return `rate limited ${seconds}`;
    }
    if (e instanceof OctenAPIError) return `api ${e.status} ${e.requestId} ${JSON.stringify(e.body)}`;
    if (isOctenError(e)) return e.name;
    throw e;
  }
}

callAllSix()
  .then((ids) => {
    if (ids.length !== 6 || ids.some((id) => !id.startsWith('fake-'))) throw new Error(`unexpected ids ${ids.join(',')}`);
    return errorHandling();
  })
  .then((r) => {
    if (r !== 'ok') throw new Error(`errorHandling gave ${r}`);
    console.log('ts ok');
  })
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
