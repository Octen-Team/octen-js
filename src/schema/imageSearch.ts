import type { Infer, InferResponse, ObjectDesc } from './descriptor';
import { requestId, stringArray } from './common';

// The endpoint takes exactly one input: a text query, or an image as a public URL or base64 data.
export const ImageSearchRequestDesc = {
  t: 'object',
  fields: {
    inputs: {
      t: 'array',
      required: true,
      items: {
        t: 'object',
        fields: {
          type: { t: 'string', enum: ['text', 'image'], required: true },
          url: { t: 'string' },
          data: { t: 'string' },
        },
      },
    },
    count: { t: 'integer' },
    include_domains: stringArray,
    exclude_domains: stringArray,
    safesearch: { t: 'string', enum: ['off', 'strict'] },
  },
} as const satisfies ObjectDesc;

const imageResult = {
  t: 'object',
  fields: {
    title: { t: 'string' },
    url: { t: 'string' },
    source_page: { t: 'string' },
    description: { t: 'string' },
    width: { t: 'integer' },
    height: { t: 'integer' },
    thumbnail: { t: 'string' },
  },
} as const satisfies ObjectDesc;

export const ImageSearchResponseDesc = {
  t: 'object',
  fields: {
    code: { t: 'integer' },
    msg: { t: 'string' },
    request_id: requestId,
    data: { t: 'object', fields: { results: { t: 'array', items: imageResult } } },
    meta: {
      t: 'object',
      fields: {
        usage: { t: 'object', fields: { num_search_queries: { t: 'integer' } } },
        latency: { t: 'number' },
        warning: { t: 'string', nullable: true },
      },
    },
  },
} as const satisfies ObjectDesc;

export type ImageSearchParams = Infer<typeof ImageSearchRequestDesc>;
export type ImageSearchResponse = InferResponse<typeof ImageSearchResponseDesc>;
