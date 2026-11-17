import type { Infer, InferResponse, ObjectDesc } from './descriptor';
import {
  contentOptions,
  domainFilterFields,
  languageArray,
  requestId,
  timeFilterFields,
  webResultFields,
  webResults,
} from './common';

export const NewsSearchRequestDesc = {
  t: 'object',
  fields: {
    query: { t: 'string', required: true },
    count: { t: 'integer' },
    ...domainFilterFields,
    ...timeFilterFields,
    language: languageArray,
    highlight: contentOptions,
    full_content: contentOptions,
    subjects: {
      t: 'object',
      fields: { enable: { t: 'boolean' }, count: { t: 'integer' }, max_sub_news: { t: 'integer' } },
    },
  },
} as const satisfies ObjectDesc;

const subjectTopNews = {
  t: 'object',
  fields: { ...webResultFields, summary: { t: 'string' } },
} as const satisfies ObjectDesc;

const subject = {
  t: 'object',
  fields: {
    name: { t: 'string' },
    summary: { t: 'string' },
    time_start: { t: 'string' },
    time_latest: { t: 'string' },
    top_news: subjectTopNews,
    sub_news: webResults,
  },
} as const satisfies ObjectDesc;

export const NewsSearchResponseDesc = {
  t: 'object',
  fields: {
    code: { t: 'integer' },
    msg: { t: 'string' },
    request_id: requestId,
    data: {
      t: 'object',
      fields: { query: { t: 'string' }, results: webResults, subjects: { t: 'array', items: subject } },
    },
    meta: {
      t: 'object',
      fields: {
        usage: {
          t: 'object',
          fields: {
            num_search_queries: { t: 'integer' },
            num_subject_search_queries: { t: 'integer' },
            full_content_extra_count: { t: 'integer' },
          },
        },
        latency: { t: 'number' },
        warning: { t: 'string', nullable: true },
      },
    },
  },
} as const satisfies ObjectDesc;

export type NewsSearchParams = Infer<typeof NewsSearchRequestDesc>;
export type NewsSearchResponse = InferResponse<typeof NewsSearchResponseDesc>;
