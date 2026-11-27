// Common user patterns: must pass tsc under both strict and exactOptionalPropertyTypes configs, and actually run.
import Octen, { OctenAPIError, OctenRateLimitError, isOctenError } from '@octen.ai/sdk';
import type {
  DesignSearchResponse,
  EmbeddingParams,
  EmbeddingResponse,
  ExtractParams,
  ExtractResponse,
  ImageSearchParams,
  SearchPremierResponse,
  SearchResponse,
  VLEmbeddingParams,
  VLEmbeddingResponse,
} from '@octen.ai/sdk';

// Explicit undefined: must also compile under exactOptionalPropertyTypes (promised in the README)
const client = new Octen({ apiKey: process.env.OCTEN_API_KEY, baseURL: process.env.OCTEN_FAKE_BASE_URL, maxRetries: 0 });

// The fake server answers with request_id "fake-<path>", so each call must have reached its own route
function hit(ids: string[], path: string, requestId: string): void {
  if (requestId !== `fake-${path}`) throw new Error(`expected a call to ${path}, the server saw ${requestId}`);
  ids.push(requestId);
}

export async function callAll(): Promise<string[]> {
  const ids: string[] = [];
  const web: SearchResponse = await client.search.search({
    query: 'rust async runtimes',
    count: 1,
    include_domains: ['github.com'],
    time_range: 'month',
    highlight: { enable: true, max_tokens: 300 },
  });
  hit(ids, '/search', web.request_id);
  const first: string | undefined = web.data?.results?.[0]?.url;
  if (first === undefined) throw new Error('no result');

  const broad = await client.search.broadSearch({ query: 'q', max_queries: 1, search_options: { count: 1, language: ['en'] } });
  hit(ids, '/broad-search', broad.request_id);
  const news = await client.search.newsSearch({ query: 'q', count: 1, subjects: { enable: true, count: 1 } });
  hit(ids, '/news-search', news.request_id);
  const biz = await client.search.businessSearch({ query: 'q', entities: { enable: true, count: 1 } });
  hit(ids, '/business-search', biz.request_id);
  let narrowed = '';
  for (const e of biz.data?.entities ?? []) {
    if (e.type === 'company') narrowed = e.identifiers?.stock_ticker ?? '';
    else if (e.type === 'person') narrowed = e.current_position ?? '';
  }
  if (narrowed !== 'EXM') throw new Error(`company narrowing at runtime gave "${narrowed}"`);
  const pulse = await client.search.pulseSearch({ query: 'q', mode: 'lite', count: 1 });
  hit(ids, '/pulse-search', pulse.request_id);
  const place = await client.placeSearch.search({
    query: 'q',
    places: { count: 1, max_reviews: 1 },
    latitude: 37.788,
    longitude: -122.4075,
    radius: 2000,
    web_search: { enable: false },
    user_location: { type: 'approximate', city: 'San Francisco' },
  });
  hit(ids, '/place-search', place.request_id);
  const premier: SearchPremierResponse = await client.search.searchPremier({
    query: 'q',
    result_type: 'dynamic',
    count: 1,
  });
  hit(ids, '/search-premier', premier.request_id);
  const imageParams: ImageSearchParams = { inputs: [{ type: 'image', url: 'https://example.com/a.png' }], count: 1 };
  const image = await client.imageSearch.search(imageParams);
  hit(ids, '/image-search', image.request_id);
  const video = await client.videoSearch.search({ inputs: [{ type: 'text', data: 'q' }], time_range: 'week' });
  hit(ids, '/video-search', video.request_id);
  const design: DesignSearchResponse = await client.designSearch.search({
    images: { group_id: 'deck_1', count: 2, snippet: { enable: false } },
    web_search: { enable: false },
  });
  hit(ids, '/design-search', design.request_id);
  const position: number | undefined = design.data?.images?.[0]?.group?.position;
  void position;
  const extractParams: ExtractParams = {
    urls: ['https://example.com'],
    mode: 'auto',
    format: 'text',
    timeout: 60,
    include_links: {},
  };
  const extracted: ExtractResponse = await client.extract.extract(extractParams, { timeout: 5000 });
  hit(ids, '/extract', extracted.request_id);
  const item = extracted.data?.results?.find((r) => r.url === 'https://example.com');
  const structure: string | null | undefined = item?.page_structure?.primary;
  const billed: number | undefined = extracted.meta?.usage?.successful_by_mode?.advanced_urls;
  void structure;
  void billed;
  const embeddingParams: EmbeddingParams = { input: ['q'], model: 'octen-embedding-0.6b', dimension: 8, input_type: 'query' };
  const embedded: EmbeddingResponse = await client.embedding.create(embeddingParams);
  hit(ids, '/embedding', embedded.request_id);
  const vector: number[] | undefined = embedded.data?.results?.[0]?.embedding;
  void vector;
  const vlParams: VLEmbeddingParams = {
    model: 'octen-vl-embedding',
    input: { contents: [{ text: 'q' }, { image: 'https://example.com/a.png' }] },
    enable_fusion: true,
  };
  const vlEmbedded: VLEmbeddingResponse = await client.vlEmbedding.create(vlParams, { timeout: 5000 });
  hit(ids, '/vl-embedding', vlEmbedded.request_id);
  const kind: string | undefined = vlEmbedded.data?.results?.[0]?.type;
  void kind;
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

callAll()
  .then((ids) => {
    if (ids.length !== 13 || ids.some((id) => !id.startsWith('fake-'))) throw new Error(`unexpected ids ${ids.join(',')}`);
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
