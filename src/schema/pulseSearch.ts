import type { Infer, InferResponse, ObjectDesc } from './descriptor';
import { contentOptions, requestId, webResultFields } from './common';

export const PulseSearchRequestDesc = {
  t: 'object',
  fields: {
    query: { t: 'string', required: true },
    mode: { t: 'string', enum: ['lite', 'standard'] },
    count: { t: 'integer' },
    highlight: contentOptions,
    full_content: contentOptions,
    safesearch: { t: 'string', enum: ['off', 'strict'] },
    include_images: { t: 'boolean' },
  },
} as const satisfies ObjectDesc;

// Pulse 的 title 可能为 null（规范标 nullable）
const pulseResult = {
  t: 'object',
  fields: { ...webResultFields, title: { t: 'string', nullable: true } },
} as const satisfies ObjectDesc;

export const PulseSearchResponseDesc = {
  t: 'object',
  fields: {
    code: { t: 'integer' },
    msg: { t: 'string' },
    request_id: requestId,
    data: { t: 'object', fields: { query: { t: 'string' }, results: { t: 'array', items: pulseResult } } },
    meta: {
      t: 'object',
      fields: {
        usage: {
          t: 'object',
          fields: {
            num_search_queries: { t: 'integer' },
            full_content_extra_count: { t: 'integer' },
            billed_mode: { t: 'string' },
          },
        },
        latency: { t: 'number' },
        warning: { t: 'string', nullable: true },
      },
    },
  },
} as const satisfies ObjectDesc;

export type PulseSearchParams = Infer<typeof PulseSearchRequestDesc>;
export type PulseSearchResponse = InferResponse<typeof PulseSearchResponseDesc>;
