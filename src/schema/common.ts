import type { ArrayDesc, ObjectDesc } from './descriptor';

// Description fragments shared by several endpoints, mapped field by field to testdata/openapi.json (checked by the OpenAPI comparison test).
// Request descriptions are never nullable. Response descriptions mark nothing required and carry no enums (the server may add values),
// except request_id and the BusinessEntity `type` tag, which discriminates the union.

export const stringArray = { t: 'array', items: { t: 'string' } } as const satisfies ArrayDesc;

/** language in requests: array elements are a fixed set of 18 language codes */
export const languageArray = {
  t: 'array',
  items: {
    t: 'string',
    enum: ['ar', 'de', 'en', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'nl', 'pl', 'pt', 'ru', 'th', 'tr', 'vi', 'zh'],
  },
} as const satisfies ArrayDesc;

/** highlight / full_content options in requests */
export const contentOptions = {
  t: 'object',
  fields: { enable: { t: 'boolean' }, max_tokens: { t: 'integer' } },
} as const satisfies ObjectDesc;

const timeBasis = { t: 'string', enum: ['auto', 'published', 'crawled'] } as const;
const timeRange = { t: 'string', enum: ['day', 'week', 'month', 'year', 'd', 'w', 'm', 'y'] } as const;

/** Time and domain filters shared by /search and /broad-search search_options, /news-search, /business-search, and place web_search */
export const timeFilterFields = {
  time_basis: timeBasis,
  time_range: timeRange,
  start_time: { t: 'string' },
  end_time: { t: 'string' },
} as const;

export const domainFilterFields = {
  include_domains: stringArray,
  exclude_domains: stringArray,
} as const;

/** Fields that /search requests and /broad-search search_options have in common */
export const webSearchOptionFields = {
  result_type: { t: 'string', enum: ['standard', 'dynamic'] },
  count: { t: 'integer' },
  ...domainFilterFields,
  include_text: stringArray,
  exclude_text: stringArray,
  ...timeFilterFields,
  language: languageArray,
  highlight: contentOptions,
  full_content: contentOptions,
  format: { t: 'string', enum: ['markdown', 'text'] },
  safesearch: { t: 'string', enum: ['off', 'strict'] },
  include_images: { t: 'boolean' },
} as const satisfies ObjectDesc['fields'];

const image = {
  t: 'object',
  fields: { url: { t: 'string' }, description: { t: 'string' } },
} as const satisfies ObjectDesc;

/** A web result in a response (SearchResult and structurally identical shapes) */
export const webResultFields = {
  title: { t: 'string' },
  url: { t: 'string' },
  highlight: { t: 'string' },
  full_content: { t: 'string' },
  authors: { t: 'string' },
  time_published: { t: 'string' },
  time_last_crawled: { t: 'string' },
  favicon: { t: 'string' },
  cover_image: image,
  images: { t: 'array', items: image },
} as const satisfies ObjectDesc['fields'];

export const webResult = { t: 'object', fields: webResultFields } as const satisfies ObjectDesc;
export const webResults = { t: 'array', items: webResult } as const satisfies ArrayDesc;

export const requestId = { t: 'string', required: true } as const;
