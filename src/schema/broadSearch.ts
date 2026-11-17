import type { Infer, InferResponse, ObjectDesc } from './descriptor';
import { requestId, stringArray, webResults, webSearchOptionFields } from './common';

export const BroadSearchRequestDesc = {
  t: 'object',
  fields: {
    query: { t: 'string', required: true },
    max_queries: { t: 'integer' },
    search_options: { t: 'object', fields: webSearchOptionFields },
  },
} as const satisfies ObjectDesc;

export const BroadSearchResponseDesc = {
  t: 'object',
  fields: {
    code: { t: 'integer' },
    // Returned by the server but missing from the public OpenAPI (known_diffs.json)
    msg: { t: 'string' },
    request_id: requestId,
    data: {
      t: 'object',
      fields: {
        query: { t: 'string' },
        queries: stringArray,
        search_results: {
          t: 'array',
          items: {
            t: 'object',
            fields: { query: { t: 'string' }, results: webResults, latency: { t: 'integer' } },
          },
        },
      },
    },
    meta: {
      t: 'object',
      fields: {
        usage: {
          t: 'object',
          fields: { num_search_queries: { t: 'integer' }, full_content_extra_count: { t: 'integer' } },
        },
        result_type: { t: 'string' },
        latency: { t: 'number' },
        warning: { t: 'string', nullable: true },
      },
    },
  },
} as const satisfies ObjectDesc;

export type BroadSearchParams = Infer<typeof BroadSearchRequestDesc>;
export type BroadSearchResponse = InferResponse<typeof BroadSearchResponseDesc>;
