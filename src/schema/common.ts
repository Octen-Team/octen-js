import type { ArrayDesc, ObjectDesc } from './descriptor';

// 多个接口共用的描述片段，逐字段对应 testdata/openapi.json（OpenAPI 对比测试逐项核对）。
// 请求描述不放 nullable；响应描述除 request_id 外都不标 required，标量不带枚举（服务端可能新增取值）。

export const stringArray = { t: 'array', items: { t: 'string' } } as const satisfies ArrayDesc;

/** 请求里的 language：数组元素是固定的 18 个语言码 */
export const languageArray = {
  t: 'array',
  items: {
    t: 'string',
    enum: ['ar', 'de', 'en', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'nl', 'pl', 'pt', 'ru', 'th', 'tr', 'vi', 'zh'],
  },
} as const satisfies ArrayDesc;

/** 请求里的 highlight / full_content 选项 */
export const contentOptions = {
  t: 'object',
  fields: { enable: { t: 'boolean' }, max_tokens: { t: 'integer' } },
} as const satisfies ObjectDesc;

const timeBasis = { t: 'string', enum: ['auto', 'published', 'crawled'] } as const;
const timeRange = { t: 'string', enum: ['day', 'week', 'month', 'year', 'd', 'w', 'm', 'y'] } as const;

/** /search、/broad-search 的 search_options、/news-search、/business-search、place 的 web_search 共有的时间与域名过滤 */
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

/** /search 请求与 /broad-search 的 search_options 完全相同的字段 */
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

/** 响应里一条网页结果（SearchResult 及其同构结构） */
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
