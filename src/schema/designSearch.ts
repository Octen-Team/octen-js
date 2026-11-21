import type { Infer, InferResponse, ObjectDesc } from './descriptor';
import { contentOptions, domainFilterFields, languageArray, requestId, timeFilterFields, webResults } from './common';

// query is optional because a group lookup (images.group_id) needs none; the resource checks that one of them is set.
export const DesignSearchRequestDesc = {
  t: 'object',
  fields: {
    query: { t: 'string' },
    images: {
      t: 'object',
      fields: {
        enable: { t: 'boolean' },
        count: { t: 'integer' },
        design_facts: { t: 'boolean' },
        snippet: contentOptions,
        group_id: { t: 'string' },
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
  },
} as const satisfies ObjectDesc;

// design_facts and group.master are free-form: their keys vary by image
const designImage = {
  t: 'object',
  fields: {
    type: { t: 'string' },
    title: { t: 'string' },
    description: { t: 'string' },
    url: { t: 'string' },
    thumbnail: { t: 'string' },
    source_page: { t: 'string' },
    width: { t: 'integer' },
    height: { t: 'integer' },
    group: {
      t: 'object',
      fields: {
        group_id: { t: 'string' },
        type: { t: 'string' },
        name: { t: 'string' },
        position: { t: 'integer' },
        total: { t: 'integer' },
        master: { t: 'object', fields: {} },
      },
    },
    design_facts: { t: 'object', fields: {} },
    snippet: { t: 'object', fields: { format: { t: 'string' }, code: { t: 'string' } } },
  },
} as const satisfies ObjectDesc;

export const DesignSearchResponseDesc = {
  t: 'object',
  fields: {
    code: { t: 'integer' },
    msg: { t: 'string' },
    request_id: requestId,
    data: {
      t: 'object',
      fields: { query: { t: 'string' }, images: { t: 'array', items: designImage }, results: webResults },
    },
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

export type DesignSearchParams = Infer<typeof DesignSearchRequestDesc>;
export type DesignSearchResponse = InferResponse<typeof DesignSearchResponseDesc>;
