import { describe, expect, test } from 'vitest';
import { OctenValidationError } from '../../src/core/errors';
import type { HttpCore } from '../../src/core/http';
import { VLEmbeddingResource } from '../../src/resources/vlEmbedding';
import { BASE, makeFetch } from './helpers';

// Fields and limits: testdata/openapi.json, VLEmbeddingRequest / VLEmbeddingInput / VLEmbeddingContent / VLEmbeddingResponse.
type Params = Parameters<VLEmbeddingResource['create']>[0];

async function rejectWith(send: () => Promise<unknown>, fetchImpl: unknown, field: string) {
  const err = await send().catch((e: unknown) => e);
  expect(err).toBeInstanceOf(OctenValidationError);
  expect((err as OctenValidationError).field).toBe(field);
  expect(fetchImpl).not.toHaveBeenCalled();
}

const vl = (core: HttpCore) => new VLEmbeddingResource(core);
const withContents = (contents: unknown): Params => ({ model: 'octen-vl-embedding', input: { contents } }) as Params;

describe('VLEmbeddingResource.create: request body', () => {
  test('sends every field unchanged, nested contents included, to /vl-embedding', async () => {
    const { core, calls } = makeFetch();
    const params = {
      model: 'octen-vl-embedding-large',
      input: {
        contents: [{ text: 'tent' }, { image: 'https://example.com/a.jpg' }, { video: 'https://example.com/v.mp4' }],
      },
      enable_fusion: true,
      dimension: 2048,
      fps: 0.3,
      instruct: 'Represent the outdoor product for retrieval',
    } as const;
    await vl(core).create(params);
    expect(calls).toEqual([{ url: `${BASE}/vl-embedding`, body: params }]);
  });

  test('omits unset optional fields', async () => {
    const { core, calls } = makeFetch();
    await vl(core).create({ model: 'octen-vl-embedding', input: { contents: [{ text: 'a' }] }, fps: undefined });
    expect(calls[0]?.body).toEqual({ model: 'octen-vl-embedding', input: { contents: [{ text: 'a' }] } });
  });

  // The server answers these with a 400 (checked 2026-11-26), so they are not checked here
  test('does not check image count, fps or dimension locally', async () => {
    const { core, calls } = makeFetch();
    const six = Array.from({ length: 6 }, () => ({ image: 'https://example.com/a.jpg' }));
    await vl(core).create({ model: 'octen-vl-embedding', input: { contents: six }, fps: 1.5, dimension: 99999 });
    expect(calls).toHaveLength(1);
  });
});

describe('VLEmbeddingResource.create: local validation', () => {
  test('rejects missing, empty or more than 20 contents', async () => {
    const { core, fetchImpl } = makeFetch();
    await rejectWith(() => vl(core).create(withContents([])), fetchImpl, 'input.contents');
    await rejectWith(() => vl(core).create({ model: 'octen-vl-embedding' } as Params), fetchImpl, 'input.contents');
    const many = Array.from({ length: 21 }, () => ({ text: 'a' }));
    await rejectWith(() => vl(core).create(withContents(many)), fetchImpl, 'input.contents');
  });

  test('accepts 20 contents', async () => {
    const { core, calls } = makeFetch();
    await vl(core).create(withContents(Array.from({ length: 20 }, () => ({ text: 'a' }))));
    expect(calls).toHaveLength(1);
  });

  // The API reference says each item holds exactly one of text, image or video
  test('rejects content with zero or two modalities', async () => {
    const { core, fetchImpl } = makeFetch();
    await rejectWith(() => vl(core).create(withContents([{}])), fetchImpl, 'input.contents[0]');
    await rejectWith(
      () => vl(core).create(withContents([{ text: 'a' }, { text: 'a', image: 'https://example.com/a.jpg' }])),
      fetchImpl,
      'input.contents[1]',
    );
    await rejectWith(() => vl(core).create(withContents(['a'])), fetchImpl, 'input.contents[0]');
  });

  test('rejects a blank content value', async () => {
    const { core, fetchImpl } = makeFetch();
    await rejectWith(() => vl(core).create(withContents([{ text: '  ' }])), fetchImpl, 'input.contents[0]');
    await rejectWith(() => vl(core).create(withContents([{ image: '' }])), fetchImpl, 'input.contents[0]');
  });

  test('rejects unknown keys inside a content item', async () => {
    const { core, fetchImpl } = makeFetch();
    await rejectWith(() => vl(core).create(withContents([{ text: 'a', audio: 'x' }])), fetchImpl, 'input.contents[0].audio');
  });
});

describe('VLEmbeddingResource.create: options and response', () => {
  test('request options pass through untouched', async () => {
    const posts: unknown[][] = [];
    const core = { post: async (...args: unknown[]) => (posts.push(args), { request_id: 'r' }) } as unknown as HttpCore;
    await vl(core).create(withContents([{ text: 'a' }]), { timeout: 5000 });
    expect(posts[0]?.[0]).toBe('/vl-embedding');
    expect(posts[0]?.[2]).toEqual({ timeout: 5000 });
  });

  // The fusion and independent 200 examples of POST /vl-embedding in testdata/openapi.json
  test('decodes fusion and independent responses', async () => {
    const usage = { input_tokens: 6814, text_tokens: 18, image_tokens: 6796, image_count: 2, duration: 22 };
    const result = (index: number, type: string) => ({ index, embedding: [0.0156, -0.0298, 0.0411], type });
    const fusion = makeFetch({
      code: 0,
      msg: 'success',
      request_id: 'a7b8c9d0',
      data: { results: [result(0, 'fusion')], model: 'octen-vl-embedding-large' },
      meta: { usage, warning: '' },
    });
    const a = await vl(fusion.core).create(withContents([{ text: 'a' }]));
    expect(a.data?.results?.[0]?.type).toBe('fusion');
    expect(a.meta?.usage?.image_count).toBe(2);
    expect(a.meta?.warning).toBe('');

    const independent = makeFetch({
      code: 0,
      request_id: 'a7b8c9d0',
      data: { results: [0, 1, 2, 3].map((i) => result(i, 'vl')), model: 'octen-vl-embedding-large' },
      meta: { usage, warning: '' },
    });
    const b = await vl(independent.core).create(withContents([{ text: 'a' }]));
    expect(b.data?.results).toHaveLength(4);
    expect(b.data?.results?.map((r) => r.type)).toEqual(['vl', 'vl', 'vl', 'vl']);
    expect(b.meta?.usage?.duration).toBe(22);
  });
});
