import type { Infer, InferResponse, ObjectDesc } from './descriptor';
import { requestId } from './common';

// Invite-only beta. Takes exactly one text input.
export const VideoSearchRequestDesc = {
  t: 'object',
  fields: {
    inputs: {
      t: 'array',
      required: true,
      items: {
        t: 'object',
        fields: { type: { t: 'string', enum: ['text'], required: true }, data: { t: 'string' } },
      },
    },
    count: { t: 'integer' },
    time_range: { t: 'string', enum: ['day', 'week', 'month', 'year', 'd', 'w', 'm', 'y'] },
    start_time: { t: 'string' },
    end_time: { t: 'string' },
    safesearch: { t: 'string', enum: ['off', 'strict'] },
  },
} as const satisfies ObjectDesc;

const videoResult = {
  t: 'object',
  fields: {
    title: { t: 'string' },
    url: { t: 'string' },
    source_page: { t: 'string' },
    description: { t: 'string' },
    cover_url: { t: 'string' },
    duration_seconds: { t: 'integer' },
    authors: { t: 'string' },
    time_published: { t: 'string' },
    time_last_crawled: { t: 'string' },
  },
} as const satisfies ObjectDesc;

export const VideoSearchResponseDesc = {
  t: 'object',
  fields: {
    code: { t: 'integer' },
    msg: { t: 'string' },
    request_id: requestId,
    data: { t: 'object', fields: { results: { t: 'array', items: videoResult } } },
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

export type VideoSearchParams = Infer<typeof VideoSearchRequestDesc>;
export type VideoSearchResponse = InferResponse<typeof VideoSearchResponseDesc>;
