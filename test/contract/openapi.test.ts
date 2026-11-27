import { describe, expect, test } from 'vitest';
import { BroadSearchRequestDesc, BroadSearchResponseDesc } from '../../src/schema/broadSearch';
import { BusinessSearchRequestDesc, BusinessSearchResponseDesc } from '../../src/schema/businessSearch';
import { DesignSearchRequestDesc, DesignSearchResponseDesc } from '../../src/schema/designSearch';
import { EmbeddingRequestDesc, EmbeddingResponseDesc } from '../../src/schema/embedding';
import { ExtractRequestDesc, ExtractResponseDesc } from '../../src/schema/extract';
import { ImageSearchRequestDesc, ImageSearchResponseDesc } from '../../src/schema/imageSearch';
import { NewsSearchRequestDesc, NewsSearchResponseDesc } from '../../src/schema/newsSearch';
import { PlaceSearchRequestDesc, PlaceSearchResponseDesc } from '../../src/schema/placeSearch';
import { PulseSearchRequestDesc, PulseSearchResponseDesc } from '../../src/schema/pulseSearch';
import {
  SearchPremierRequestDesc,
  SearchPremierResponseDesc,
  SearchRequestDesc,
  SearchResponseDesc,
} from '../../src/schema/search';
import { VideoSearchRequestDesc, VideoSearchResponseDesc } from '../../src/schema/videoSearch';
import { VLEmbeddingRequestDesc, VLEmbeddingResponseDesc } from '../../src/schema/vlEmbedding';
import type { ObjectDesc } from '../../src/schema/descriptor';
import { DesignSearchResource } from '../../src/resources/designSearch';
import { EmbeddingResource } from '../../src/resources/embedding';
import { ExtractResource } from '../../src/resources/extract';
import { ImageSearchResource } from '../../src/resources/imageSearch';
import { PlaceSearchResource } from '../../src/resources/placeSearch';
import { SearchResource } from '../../src/resources/search';
import { VideoSearchResource } from '../../src/resources/videoSearch';
import { VLEmbeddingResource } from '../../src/resources/vlEmbedding';
import { BASE, makeFetch } from '../resources/helpers';
import { compareRequest, compareResponse, loadKnownDiffs } from './compare';
import { flattenSchema, loadSnapshot } from './flatten';

// The public OpenAPI snapshot (testdata/openapi.json) is the single source for every field.
const spec = loadSnapshot();
const knownDiffs = loadKnownDiffs();
const ref = (name: string) => `#/components/schemas/${name}`;

type Core = ReturnType<typeof makeFetch>['core'];
type Endpoint = {
  name: string;
  request: [string, ObjectDesc];
  response: [string, ObjectDesc];
  send: (core: Core) => Promise<unknown>;
};

const endpoints: Endpoint[] = [
  {
    name: 'search',
    request: ['SearchRequest', SearchRequestDesc],
    response: ['SearchResponse', SearchResponseDesc],
    send: (core) => new SearchResource(core).search({ query: 'q' }),
  },
  {
    name: 'broad-search',
    request: ['BroadSearchRequest', BroadSearchRequestDesc],
    response: ['BroadSearchResponse', BroadSearchResponseDesc],
    send: (core) => new SearchResource(core).broadSearch({ query: 'q' }),
  },
  {
    name: 'news-search',
    request: ['NewsSearchRequest', NewsSearchRequestDesc],
    response: ['NewsSearchResponse', NewsSearchResponseDesc],
    send: (core) => new SearchResource(core).newsSearch({ query: 'q' }),
  },
  {
    name: 'business-search',
    request: ['BusinessSearchRequest', BusinessSearchRequestDesc],
    response: ['BusinessSearchResponse', BusinessSearchResponseDesc],
    send: (core) => new SearchResource(core).businessSearch({ query: 'q' }),
  },
  {
    name: 'pulse-search',
    request: ['PulseSearchRequest', PulseSearchRequestDesc],
    response: ['PulseSearchResponse', PulseSearchResponseDesc],
    send: (core) => new SearchResource(core).pulseSearch({ query: 'q' }),
  },
  {
    name: 'place-search',
    request: ['PlaceSearchRequest', PlaceSearchRequestDesc],
    response: ['PlaceSearchResponse', PlaceSearchResponseDesc],
    send: (core) => new PlaceSearchResource(core).search({ query: 'q' }),
  },
  {
    // The spec points /search-premier at the /search schemas
    name: 'search-premier',
    request: ['SearchRequest', SearchPremierRequestDesc],
    response: ['SearchResponse', SearchPremierResponseDesc],
    send: (core) => new SearchResource(core).searchPremier({ query: 'q' }),
  },
  {
    name: 'image-search',
    request: ['ImageSearchRequest', ImageSearchRequestDesc],
    response: ['ImageSearchResponse', ImageSearchResponseDesc],
    send: (core) => new ImageSearchResource(core).search({ inputs: [{ type: 'text', data: 'q' }] }),
  },
  {
    name: 'video-search',
    request: ['VideoSearchRequest', VideoSearchRequestDesc],
    response: ['VideoSearchResponse', VideoSearchResponseDesc],
    send: (core) => new VideoSearchResource(core).search({ inputs: [{ type: 'text', data: 'q' }] }),
  },
  {
    name: 'design-search',
    request: ['DesignSearchRequest', DesignSearchRequestDesc],
    response: ['DesignSearchResponse', DesignSearchResponseDesc],
    send: (core) => new DesignSearchResource(core).search({ query: 'q' }),
  },
  {
    name: 'extract',
    request: ['ExtractRequest', ExtractRequestDesc],
    response: ['ExtractResponse', ExtractResponseDesc],
    send: (core) => new ExtractResource(core).extract({ urls: ['https://example.com'] }),
  },
  {
    name: 'embedding',
    request: ['EmbeddingRequest', EmbeddingRequestDesc],
    response: ['EmbeddingResponse', EmbeddingResponseDesc],
    send: (core) => new EmbeddingResource(core).create({ input: ['a'] }),
  },
  {
    name: 'vl-embedding',
    request: ['VLEmbeddingRequest', VLEmbeddingRequestDesc],
    response: ['VLEmbeddingResponse', VLEmbeddingResponseDesc],
    send: (core) =>
      new VLEmbeddingResource(core).create({ model: 'octen-vl-embedding', input: { contents: [{ text: 'a' }] } }),
  },
];

describe('OpenAPI contract', () => {
  for (const ep of endpoints) {
    const [reqName, reqDesc] = ep.request;
    const [resName, resDesc] = ep.response;
    test(`${reqName} matches the public spec`, () => {
      expect(compareRequest(reqDesc, flattenSchema(spec, ref(reqName)), knownDiffs, reqName)).toEqual([]);
    });
    test(`${resName} matches the public spec`, () => {
      expect(compareResponse(resDesc, flattenSchema(spec, ref(resName), 'response'), knownDiffs, resName)).toEqual([]);
    });
  }

  // Ties each compared schema pair to the path the SDK actually POSTs to, so a pair cannot drift to another endpoint.
  type Operation = {
    requestBody?: { content?: Record<string, { schema?: { $ref?: string } }> };
    responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>;
  };
  const paths = spec.paths as Record<string, { post?: Operation }>;
  for (const ep of endpoints) {
    test(`/${ep.name}: snapshot refs are ${ep.request[0]} / ${ep.response[0]} and the SDK posts there`, async () => {
      const op = paths[`/${ep.name}`]?.post;
      expect(op?.requestBody?.content?.['application/json']?.schema?.$ref).toBe(ref(ep.request[0]));
      expect(op?.responses?.['200']?.content?.['application/json']?.schema?.$ref).toBe(ref(ep.response[0]));
      const { core, calls } = makeFetch();
      await ep.send(core);
      expect(calls.map((c) => c.url)).toEqual([`${BASE}/${ep.name}`]);
    });
  }

  // An entry pointing at a schema that is not compared would never be checked, so stale entries would hide
  test('every known_diffs entry points at a schema this test compares', () => {
    const compared = new Set(endpoints.flatMap((ep) => [ep.request[0], ep.response[0]]));
    expect(knownDiffs.length).toBeGreaterThan(0);
    for (const d of knownDiffs) {
      expect(compared, `${d.path} root schema`).toContain(d.path.split('.')[0]);
    }
  });

  test('response descriptors only mark request_id as required', () => {
    for (const ep of endpoints) {
      const required = Object.entries(ep.response[1].fields)
        .filter(([, d]) => d.required === true)
        .map(([k]) => k);
      expect(required, ep.response[0]).toEqual(['request_id']);
    }
  });
});
