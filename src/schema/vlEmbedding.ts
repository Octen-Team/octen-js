import type { Infer, InferResponse, ObjectDesc } from './descriptor';
import { requestId } from './common';

// contents takes 1 to 20 items, each with exactly one of text, image (URL or base64) or video (URL); the resource checks
// that before sending. Image and video counts, dimension and fps are checked by the server.
export const VLEmbeddingRequestDesc = {
  t: 'object',
  fields: {
    model: { t: 'string', enum: ['octen-vl-embedding', 'octen-vl-embedding-large'], required: true },
    input: {
      t: 'object',
      required: true,
      fields: {
        contents: {
          t: 'array',
          required: true,
          items: { t: 'object', fields: { text: { t: 'string' }, image: { t: 'string' }, video: { t: 'string' } } },
        },
      },
    },
    enable_fusion: { t: 'boolean' },
    dimension: { t: 'integer' },
    fps: { t: 'number' },
    instruct: { t: 'string' },
  },
} as const satisfies ObjectDesc;

export const VLEmbeddingResponseDesc = {
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
          items: {
            t: 'object',
            fields: { index: { t: 'integer' }, embedding: { t: 'array', items: { t: 'number' } }, type: { t: 'string' } },
          },
        },
        model: { t: 'string' },
      },
    },
    meta: {
      t: 'object',
      fields: {
        usage: {
          t: 'object',
          fields: {
            input_tokens: { t: 'integer' },
            text_tokens: { t: 'integer' },
            image_tokens: { t: 'integer' },
            image_count: { t: 'integer' },
            duration: { t: 'integer' },
          },
        },
        warning: { t: 'string', nullable: true },
      },
    },
  },
} as const satisfies ObjectDesc;

export type VLEmbeddingParams = Infer<typeof VLEmbeddingRequestDesc>;
export type VLEmbeddingResponse = InferResponse<typeof VLEmbeddingResponseDesc>;
