import type { Infer, InferResponse, ObjectDesc } from './descriptor';
import {
  contentOptions,
  domainFilterFields,
  languageArray,
  requestId,
  stringArray,
  timeFilterFields,
  webResults,
} from './common';

export const PlaceSearchRequestDesc = {
  t: 'object',
  fields: {
    query: { t: 'string', required: true },
    places: {
      t: 'object',
      fields: {
        count: { t: 'integer' },
        // 服务端与外部文档支持（0–5，默认 0），公开 OpenAPI 缺（known_diffs.json）
        max_reviews: { t: 'integer' },
      },
    },
    web_search: {
      t: 'object',
      fields: {
        enable: { t: 'boolean' },
        count: { t: 'integer' },
        highlight: contentOptions,
        full_content: contentOptions,
        ...domainFilterFields,
        language: languageArray,
        ...timeFilterFields,
      },
    },
    user_location: {
      t: 'object',
      fields: {
        type: { t: 'string', enum: ['approximate'] },
        city: { t: 'string' },
        region: { t: 'string' },
        country: { t: 'string' },
        timezone: { t: 'string' },
      },
    },
    latitude: { t: 'number' },
    longitude: { t: 'number' },
    radius: { t: 'integer' },
  },
} as const satisfies ObjectDesc;

const place = {
  t: 'object',
  fields: {
    name: { t: 'string' },
    category: { t: 'string' },
    address: { t: 'string' },
    latitude: { t: 'number' },
    longitude: { t: 'number' },
    distance: { t: 'integer' },
    phone: { t: 'string' },
    website: { t: 'string' },
    opening_hours: stringArray,
    status: { t: 'string' },
    rating: { t: 'number' },
    review_count: { t: 'integer' },
    // 自由结构，键由服务端决定
    attributes: { t: 'object', fields: {} },
  },
} as const satisfies ObjectDesc;

export const PlaceSearchResponseDesc = {
  t: 'object',
  fields: {
    code: { t: 'integer' },
    msg: { t: 'string' },
    request_id: requestId,
    data: {
      t: 'object',
      fields: {
        query: { t: 'string' },
        location: { t: 'object', fields: { latitude: { t: 'number' }, longitude: { t: 'number' } } },
        places: { t: 'array', items: place },
        results: webResults,
      },
    },
    meta: {
      t: 'object',
      fields: {
        usage: {
          t: 'object',
          fields: { num_search_queries: { t: 'integer' }, full_content_extra_count: { t: 'integer' } },
        },
        latency: { t: 'number' },
        warning: { t: 'string', nullable: true },
      },
    },
  },
} as const satisfies ObjectDesc;

export type PlaceSearchParams = Infer<typeof PlaceSearchRequestDesc>;
export type PlaceSearchResponse = InferResponse<typeof PlaceSearchResponseDesc>;
