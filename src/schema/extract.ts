import type { Infer, InferResponse, ObjectDesc } from './descriptor';
import { requestId, stringArray } from './common';

// urls takes 1 to 20 URLs of at most 2048 characters each; the resource checks those limits before sending.
export const ExtractRequestDesc = {
  t: 'object',
  fields: {
    urls: { ...stringArray, required: true },
    mode: { t: 'string', enum: ['standard', 'advanced', 'auto'] },
    query: { t: 'string' },
    max_age_seconds: { t: 'integer' },
    format: { t: 'string', enum: ['markdown', 'text'] },
    timeout: { t: 'integer' },
    include_images: { t: 'boolean' },
    include_videos: { t: 'boolean' },
    include_audio: { t: 'boolean' },
    include_links: {
      t: 'object',
      fields: {
        scope: { t: 'string', enum: ['prefer_internal', 'prefer_external'] },
        max_links: { t: 'integer' },
      },
    },
  },
} as const satisfies ObjectDesc;

const media = { t: 'array', items: { t: 'object', fields: { url: { t: 'string' } } } } as const;

// The spec documents null for page_structure and category in prose only; see testdata/known_diffs.json.
const classification = {
  t: 'object',
  nullable: true,
  fields: { primary: { t: 'string' }, secondary: { t: 'string', nullable: true } },
} as const satisfies ObjectDesc;

const extractResult = {
  t: 'object',
  fields: {
    url: { t: 'string' },
    status: { t: 'string' },
    resolved_mode: { t: 'string' },
    title: { t: 'string', nullable: true },
    full_content: { t: 'string', nullable: true },
    highlights: { t: 'array', items: { t: 'string' }, nullable: true },
    time_published: { t: 'string', nullable: true },
    time_last_crawled: { t: 'string' },
    page_structure: classification,
    category: classification,
    favicon: { t: 'string', nullable: true },
    cover_image: { t: 'object', nullable: true, fields: { url: { t: 'string' } } },
    images: media,
    videos: media,
    audio: media,
    links: {
      t: 'array',
      items: {
        t: 'object',
        fields: { url: { t: 'string' }, anchor_text: { t: 'string' }, is_external: { t: 'boolean' } },
      },
    },
    error_message: { t: 'string' },
  },
} as const satisfies ObjectDesc;

export const ExtractResponseDesc = {
  t: 'object',
  fields: {
    code: { t: 'integer' },
    msg: { t: 'string' },
    request_id: requestId,
    data: { t: 'object', fields: { results: { t: 'array', items: extractResult } } },
    meta: {
      t: 'object',
      fields: {
        usage: {
          t: 'object',
          fields: {
            total_urls: { t: 'integer' },
            successful_urls: { t: 'integer' },
            successful_by_mode: {
              t: 'object',
              fields: { standard_urls: { t: 'integer' }, advanced_urls: { t: 'integer' } },
            },
          },
        },
        latency: { t: 'integer' },
        warning: { t: 'string' },
      },
    },
  },
} as const satisfies ObjectDesc;

export type ExtractParams = Infer<typeof ExtractRequestDesc>;
export type ExtractResponse = InferResponse<typeof ExtractResponseDesc>;
