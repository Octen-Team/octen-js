import { describe, expect, test } from 'vitest';
import { BroadSearchRequestDesc, BroadSearchResponseDesc } from '../../src/schema/broadSearch';
import { BusinessSearchRequestDesc, BusinessSearchResponseDesc } from '../../src/schema/businessSearch';
import { NewsSearchRequestDesc, NewsSearchResponseDesc } from '../../src/schema/newsSearch';
import { PlaceSearchRequestDesc, PlaceSearchResponseDesc } from '../../src/schema/placeSearch';
import { PulseSearchRequestDesc, PulseSearchResponseDesc } from '../../src/schema/pulseSearch';
import { SearchRequestDesc, SearchResponseDesc } from '../../src/schema/search';
import type { ObjectDesc } from '../../src/schema/descriptor';
import { compareRequest, compareResponse, loadKnownDiffs } from './compare';
import { flattenSchema, loadSnapshot } from './flatten';

// 公开 OpenAPI 快照（testdata/openapi.json）是每个字段的唯一出处；设计文档 §5.6、§5.1。
const spec = loadSnapshot();
const knownDiffs = loadKnownDiffs();
const ref = (name: string) => `#/components/schemas/${name}`;

const endpoints: Array<{ name: string; request: [string, ObjectDesc]; response: [string, ObjectDesc] }> = [
  { name: 'search', request: ['SearchRequest', SearchRequestDesc], response: ['SearchResponse', SearchResponseDesc] },
  {
    name: 'broad-search',
    request: ['BroadSearchRequest', BroadSearchRequestDesc],
    response: ['BroadSearchResponse', BroadSearchResponseDesc],
  },
  {
    name: 'news-search',
    request: ['NewsSearchRequest', NewsSearchRequestDesc],
    response: ['NewsSearchResponse', NewsSearchResponseDesc],
  },
  {
    name: 'business-search',
    request: ['BusinessSearchRequest', BusinessSearchRequestDesc],
    response: ['BusinessSearchResponse', BusinessSearchResponseDesc],
  },
  {
    name: 'pulse-search',
    request: ['PulseSearchRequest', PulseSearchRequestDesc],
    response: ['PulseSearchResponse', PulseSearchResponseDesc],
  },
  {
    name: 'place-search',
    request: ['PlaceSearchRequest', PlaceSearchRequestDesc],
    response: ['PlaceSearchResponse', PlaceSearchResponseDesc],
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

  // 条目指向没被对比的 schema 就永远不会被检查，过期条目会藏起来
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
