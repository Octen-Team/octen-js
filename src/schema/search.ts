import type { Infer, InferResponse, ObjectDesc } from './descriptor';
import { requestId, webResults, webSearchOptionFields } from './common';

export const SearchRequestDesc = {
  t: 'object',
  fields: { query: { t: 'string', required: true }, ...webSearchOptionFields },
} as const satisfies ObjectDesc;

export const SearchResponseDesc = {
  t: 'object',
  fields: {
    code: { t: 'integer' },
    msg: { t: 'string' },
    request_id: requestId,
    data: { t: 'object', fields: { query: { t: 'string' }, results: webResults } },
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

export type SearchParams = Infer<typeof SearchRequestDesc>;
export type SearchResponse = InferResponse<typeof SearchResponseDesc>;

// The spec points /search-premier at the /search schemas: the same body (no topic) and the same response shape.
export const SearchPremierRequestDesc = SearchRequestDesc;
export const SearchPremierResponseDesc = SearchResponseDesc;

export type SearchPremierParams = SearchParams;
export type SearchPremierResponse = SearchResponse;
