import { describe, expect, test } from 'vitest';
import { OctenValidationError } from '../../src/core/errors';
import type { HttpCore } from '../../src/core/http';
import { EmbeddingResource } from '../../src/resources/embedding';
import { BASE, makeFetch } from './helpers';

// Fields and limits: testdata/openapi.json, EmbeddingRequest / EmbeddingResponse (snapshot 2026-11-21).
async function rejectWith(send: () => Promise<unknown>, fetchImpl: unknown, field: string) {
  const err = await send().catch((e: unknown) => e);
  expect(err).toBeInstanceOf(OctenValidationError);
  expect((err as OctenValidationError).field).toBe(field);
  expect(fetchImpl).not.toHaveBeenCalled();
}

const embedding = (core: HttpCore) => new EmbeddingResource(core);

describe('EmbeddingResource.create: request body', () => {
  test('sends only documented fields, unchanged, to /embedding', async () => {
    const { core, calls } = makeFetch();
    const params = { input: ['a'], model: 'octen-embedding-0.6b', dimension: 8, input_type: 'query' } as const;
    await embedding(core).create(params);
    expect(calls).toEqual([{ url: `${BASE}/embedding`, body: params }]);
    expect(Object.keys(calls[0]?.body as object).sort()).toEqual(['dimension', 'input', 'input_type', 'model']);
  });

  test('omits unset optional fields', async () => {
    const { core, calls } = makeFetch();
    await embedding(core).create({ input: ['a'], model: undefined });
    expect(calls[0]?.body).toEqual({ input: ['a'] });
  });

  test('sends input_type null as given (the spec marks it nullable)', async () => {
    const { core, calls } = makeFetch();
    await embedding(core).create({ input: ['a'], input_type: null });
    expect(calls[0]?.body).toEqual({ input: ['a'], input_type: null });
  });

  test('rejects unknown keys such as truncation', async () => {
    const { core, fetchImpl } = makeFetch();
    const params = { input: ['a'], truncation: true } as unknown as Parameters<EmbeddingResource['create']>[0];
    await rejectWith(() => embedding(core).create(params), fetchImpl, 'truncation');
  });

  // The server answers values out of range (dimension above the model maximum) with a 400; they are not checked here
  test('does not check dimension locally', async () => {
    const { core, calls } = makeFetch();
    await embedding(core).create({ input: ['a'], dimension: 99999 });
    expect(calls[0]?.body).toEqual({ input: ['a'], dimension: 99999 });
  });
});

describe('EmbeddingResource.create: local validation', () => {
  test('rejects a missing or empty input', async () => {
    const { core, fetchImpl } = makeFetch();
    await rejectWith(() => embedding(core).create({ input: [] }), fetchImpl, 'input');
    const missing = {} as unknown as Parameters<EmbeddingResource['create']>[0];
    await rejectWith(() => embedding(core).create(missing), fetchImpl, 'input');
  });

  test('rejects a bare string input', async () => {
    const { core, fetchImpl } = makeFetch();
    const bare = { input: 'a' } as unknown as Parameters<EmbeddingResource['create']>[0];
    await rejectWith(() => embedding(core).create(bare), fetchImpl, 'input');
  });

  // The server accepts a whitespace-only item and bills it (checked 2026-11-26); it is almost always a caller mistake
  test('rejects_blank_input_item', async () => {
    const { core, fetchImpl } = makeFetch();
    await rejectWith(() => embedding(core).create({ input: ['a', 'b', '  '] }), fetchImpl, 'input[2]');
    await rejectWith(() => embedding(core).create({ input: [''] }), fetchImpl, 'input[0]');
    const nonString = { input: ['a', 7] } as unknown as Parameters<EmbeddingResource['create']>[0];
    await rejectWith(() => embedding(core).create(nonString), fetchImpl, 'input[1]');
  });

  test('accepts 1000 items and rejects 1001', async () => {
    const { core, calls, fetchImpl } = makeFetch();
    await embedding(core).create({ input: Array.from({ length: 1000 }, (_, i) => `t${i}`) });
    expect(calls).toHaveLength(1);
    const over = makeFetch();
    await rejectWith(
      () => embedding(over.core).create({ input: Array.from({ length: 1001 }, (_, i) => `t${i}`) }),
      over.fetchImpl,
      'input',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('EmbeddingResource.create: options and response', () => {
  test('per_call_timeout_overrides_default: request options pass through untouched', async () => {
    const posts: unknown[][] = [];
    const core = { post: async (...args: unknown[]) => (posts.push(args), { request_id: 'r' }) } as unknown as HttpCore;
    await embedding(core).create({ input: ['a'] }, { timeout: 5000 });
    await embedding(core).create({ input: ['a'] });
    expect(posts[0]?.[0]).toBe('/embedding');
    expect(posts[0]?.[2]).toEqual({ timeout: 5000 });
    expect(posts[1]?.[2]).toBeUndefined();
  });

  test('decodes the documented response', async () => {
    // The 200 example of POST /embedding in testdata/openapi.json
    const body = {
      code: 0,
      msg: 'success',
      request_id: 'req_abc123def456',
      data: {
        results: [
          { index: 0, embedding: [0.0123, -0.0456, 0.0789] },
          { index: 1, embedding: [-0.0011, 0.0234, 0.0567] },
        ],
        model: 'octen-embedding-0.6b',
      },
      meta: { usage: { input_tokens: 128 }, latency: 167, warning: 'Input was truncated for one or more items.' },
    };
    const { core } = makeFetch(body);
    const res = await embedding(core).create({ input: ['a', 'b'] });
    expect(res.data?.results?.[1]?.embedding?.[2]).toBe(0.0567);
    expect(res.data?.model).toBe('octen-embedding-0.6b');
    expect(res.meta?.usage?.input_tokens).toBe(128);
    expect(res.meta?.latency).toBe(167);
    expect(res.request_id).toBe('req_abc123def456');
  });
});
