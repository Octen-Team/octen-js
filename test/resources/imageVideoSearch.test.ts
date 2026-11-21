import { describe, expect, test } from 'vitest';
import { OctenValidationError } from '../../src/core/errors';
import type { HttpCore, RequestOptions } from '../../src/core/http';
import { ImageSearchResource } from '../../src/resources/imageSearch';
import { VideoSearchResource } from '../../src/resources/videoSearch';
import { BASE, makeFetch } from './helpers';

// Inputs and limits: testdata/openapi.json, ImageSearchRequest / ImageSearchInput / VideoSearchRequest.
async function rejectWith(send: () => Promise<unknown>, fetchImpl: unknown, field: string) {
  const err = await send().catch((e: unknown) => e);
  expect(err).toBeInstanceOf(OctenValidationError);
  expect((err as OctenValidationError).field).toBe(field);
  expect(fetchImpl).not.toHaveBeenCalled();
}

describe('ImageSearchResource.search', () => {
  test('sends every field unchanged to /image-search', async () => {
    const { core, calls } = makeFetch();
    const params = {
      inputs: [{ type: 'text', data: 'golden retriever' }],
      count: 7,
      include_domains: ['wikimedia.org'],
      exclude_domains: ['example.com'],
      safesearch: 'off',
    } as const;
    await new ImageSearchResource(core).search(params);
    expect(calls).toEqual([{ url: `${BASE}/image-search`, body: params }]);
  });

  test('adds no defaults and strips undefined keys', async () => {
    const { core, calls } = makeFetch();
    await new ImageSearchResource(core).search({
      inputs: [{ type: 'image', url: 'https://img.example.com/a.png', data: undefined }],
      count: undefined,
    });
    expect(calls[0]?.body).toEqual({ inputs: [{ type: 'image', url: 'https://img.example.com/a.png' }] });
  });

  test('sends an image given as base64 data', async () => {
    const { core, calls } = makeFetch();
    await new ImageSearchResource(core).search({ inputs: [{ type: 'image', data: 'aGVsbG8=' }] });
    expect(calls[0]?.body).toEqual({ inputs: [{ type: 'image', data: 'aGVsbG8=' }] });
  });

  test.each([
    ['missing inputs', {}, 'inputs'],
    ['inputs not an array', { inputs: { type: 'text', data: 'q' } }, 'inputs'],
    ['empty inputs', { inputs: [] }, 'inputs'],
    [
      'two inputs',
      {
        inputs: [
          { type: 'text', data: 'q' },
          { type: 'image', url: 'https://img.example.com/a.png' },
        ],
      },
      'inputs',
    ],
    ['an input that is not an object', { inputs: ['q'] }, 'inputs[0]'],
    ['an input without type', { inputs: [{ data: 'q' }] }, 'inputs[0].type'],
    ['an input type the endpoint does not take', { inputs: [{ type: 'video', url: 'https://v.example.com/a.mp4' }] }, 'inputs[0].type'],
    ['a text input without data', { inputs: [{ type: 'text' }] }, 'inputs[0].data'],
    ['a text input with blank data', { inputs: [{ type: 'text', data: '  ' }] }, 'inputs[0].data'],
    ['an image input without url or data', { inputs: [{ type: 'image' }] }, 'inputs[0]'],
    ['an image input with an empty url', { inputs: [{ type: 'image', url: '' }] }, 'inputs[0]'],
    [
      'an image input with both url and data',
      { inputs: [{ type: 'image', url: 'https://img.example.com/a.png', data: 'aGVsbG8=' }] },
      'inputs[0]',
    ],
    ['params that are not an object', null, 'inputs'],
  ])('%s throws OctenValidationError without sending', async (_name, params, field) => {
    const { core, fetchImpl } = makeFetch();
    await rejectWith(() => new ImageSearchResource(core).search(params as never), fetchImpl, field);
  });

  test.each([
    [{ topic: 'design' }, 'topic'],
    [{ html_snippet: { enable: true } }, 'html_snippet'],
    [{ query: 'q' }, 'query'],
    [{ inputs: [{ type: 'text', data: 'q', lang: 'en' }] }, 'inputs[0].lang'],
  ])('rejects the undocumented field %j', async (extra, field) => {
    const { core, fetchImpl } = makeFetch();
    const params = { inputs: [{ type: 'text', data: 'q' }], ...extra };
    await rejectWith(() => new ImageSearchResource(core).search(params as never), fetchImpl, field);
  });

  test('rejects values JSON cannot carry', async () => {
    const { core, fetchImpl } = makeFetch();
    await rejectWith(
      () => new ImageSearchResource(core).search({ inputs: [{ type: 'text', data: 'q' }], count: Number.NaN }),
      fetchImpl,
      'count',
    );
  });

  test('returns the response untouched, with missing and null fields and unknown keys', async () => {
    const body = {
      request_id: 'req_1',
      data: { results: [{ title: 't', url: 'https://img.example.com/1.jpg', width: 640, extra: 1 }] },
      meta: { warning: null },
    };
    const { core } = makeFetch(body);
    const res = await new ImageSearchResource(core).search({ inputs: [{ type: 'text', data: 'q' }] });
    expect(res).toEqual(body);
    expect(res.code).toBeUndefined();
    expect(res.data?.results?.[0]?.height).toBeUndefined();
    expect(res.meta?.warning).toBeNull();
  });

  test('passes RequestOptions through and adds no timeout of its own', async () => {
    const posts: unknown[][] = [];
    const core = { post: async (...args: unknown[]) => (posts.push(args), { request_id: 'r' }) } as unknown as HttpCore;
    const r: RequestOptions = { timeout: 1234 };
    await new ImageSearchResource(core).search({ inputs: [{ type: 'text', data: 'q' }] }, r);
    await new ImageSearchResource(core).search({ inputs: [{ type: 'text', data: 'q' }] });
    expect(posts[0]?.[2]).toBe(r);
    expect(posts[1]?.[2]).toBeUndefined();
  });
});

describe('VideoSearchResource.search', () => {
  test('sends every field unchanged to /video-search', async () => {
    const { core, calls } = makeFetch();
    const params = {
      inputs: [{ type: 'text', data: 'how to make pasta' }],
      count: 3,
      time_range: 'month',
      start_time: '2025-01-01T00:00:00Z',
      end_time: '2025-06-30T00:00:00Z',
      safesearch: 'off',
    } as const;
    await new VideoSearchResource(core).search(params);
    expect(calls).toEqual([{ url: `${BASE}/video-search`, body: params }]);
  });

  test('adds no defaults', async () => {
    const { core, calls } = makeFetch();
    await new VideoSearchResource(core).search({ inputs: [{ type: 'text', data: 'q' }], safesearch: undefined });
    expect(calls[0]?.body).toEqual({ inputs: [{ type: 'text', data: 'q' }] });
  });

  test.each([
    ['missing inputs', {}, 'inputs'],
    ['empty inputs', { inputs: [] }, 'inputs'],
    [
      'two inputs',
      {
        inputs: [
          { type: 'text', data: 'a' },
          { type: 'text', data: 'b' },
        ],
      },
      'inputs',
    ],
    ['an input without type', { inputs: [{ data: 'q' }] }, 'inputs[0].type'],
    ['an image input (video search takes text only)', { inputs: [{ type: 'image', data: 'x' }] }, 'inputs[0].type'],
    ['a text input with blank data', { inputs: [{ type: 'text', data: '' }] }, 'inputs[0].data'],
  ])('%s throws OctenValidationError without sending', async (_name, params, field) => {
    const { core, fetchImpl } = makeFetch();
    await rejectWith(() => new VideoSearchResource(core).search(params as never), fetchImpl, field);
  });

  test.each([
    [{ include_domains: ['youtube.com'] }, 'include_domains'],
    [{ inputs: [{ type: 'text', data: 'q', url: 'https://v.example.com' }] }, 'inputs[0].url'],
  ])('rejects the undocumented field %j', async (extra, field) => {
    const { core, fetchImpl } = makeFetch();
    const params = { inputs: [{ type: 'text', data: 'q' }], ...extra };
    await rejectWith(() => new VideoSearchResource(core).search(params as never), fetchImpl, field);
  });

  test('returns the response untouched, with missing fields', async () => {
    const body = { code: 0, request_id: 'req_1', data: { results: [{ title: 'v', duration_seconds: 61 }] } };
    const { core } = makeFetch(body);
    const res = await new VideoSearchResource(core).search({ inputs: [{ type: 'text', data: 'q' }] });
    expect(res).toEqual(body);
    expect(res.meta).toBeUndefined();
    expect(res.data?.results?.[0]?.cover_url).toBeUndefined();
  });
});

// Type level only; never executed. If an @ts-expect-error stops erroring, typecheck fails.
export function typeLevelChecks(image: ImageSearchResource, video: VideoSearchResource) {
  // @ts-expect-error inputs is required
  void image.search({ count: 1 });
  // @ts-expect-error input type is text or image
  void image.search({ inputs: [{ type: 'video', url: 'u' }] });
  // @ts-expect-error video inputs are text only
  void video.search({ inputs: [{ type: 'image', url: 'u' }] });
  // @ts-expect-error video search has no include_domains
  void video.search({ inputs: [{ type: 'text', data: 'q' }], include_domains: ['a.com'] });
}
