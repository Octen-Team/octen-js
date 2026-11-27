import type { Infer, InferResponse, ObjectDesc } from './descriptor';
import { requestId, stringArray } from './common';

// input takes 1 to 1000 non-blank strings; the resource checks that before sending. Other ranges are left to the server.
export const EmbeddingRequestDesc = {
  t: 'object',
  fields: {
    input: { ...stringArray, required: true },
    model: { t: 'string', enum: ['octen-embedding-0.6b', 'octen-embedding-4b', 'octen-embedding-8b'] },
    dimension: { t: 'integer' },
    input_type: { t: 'string', enum: ['query', 'document'], nullable: true },
  },
} as const satisfies ObjectDesc;

export const EmbeddingResponseDesc = {
  t: 'object',
  fields: {
    code: { t: 'integer' },
    msg: { t: 'string' },
    request_id: requestId,
    data: {
      t: 'object',
      fields: {
        results: {
          t: 'array',
          items: { t: 'object', fields: { index: { t: 'integer' }, embedding: { t: 'array', items: { t: 'number' } } } },
        },
        model: { t: 'string' },
      },
    },
    meta: {
      t: 'object',
      fields: {
        usage: { t: 'object', fields: { input_tokens: { t: 'integer' } } },
        latency: { t: 'number' },
        warning: { t: 'string', nullable: true },
      },
    },
  },
} as const satisfies ObjectDesc;

export type EmbeddingParams = Infer<typeof EmbeddingRequestDesc>;
export type EmbeddingResponse = InferResponse<typeof EmbeddingResponseDesc>;
