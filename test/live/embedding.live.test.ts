import { describe, expect, it } from 'vitest';
import Octen, { OctenBadRequestError } from '../../src/index';

// Hits production https://api.octen.ai and is billed: runs only with OCTEN_LIVE=1 and OCTEN_API_KEY, otherwise the whole group is skipped.
// Media: public CC0 files the API could fetch on 2026-11-26.
const apiKey = process.env.OCTEN_API_KEY ?? '';
const enabled = process.env.OCTEN_LIVE === '1' && apiKey !== '';
const IMAGE = 'https://interactive-examples.mdn.mozilla.net/media/cc0-images/grapefruit-slice-332-332.jpg';
const VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';

describe.skipIf(!enabled)('live: Embedding and VL Embedding', () => {
  const client = (opts: { fetch?: typeof fetch } = {}) => new Octen({ apiKey, ...opts });

  it('embedding_basic: dimension and model are applied', async () => {
    const res = await client().embedding.create({
      input: ['What is vector search?'],
      model: 'octen-embedding-0.6b',
      dimension: 8,
      input_type: 'query',
    });
    expect(res.data?.results).toHaveLength(1);
    expect(res.data?.results?.[0]?.embedding).toHaveLength(8);
    expect(res.data?.model).toBe('octen-embedding-0.6b');
    expect(res.meta?.usage?.input_tokens).toBeGreaterThan(0);
  });

  it('embedding_batch_order: results follow the input order', async () => {
    const texts = ['red apple', 'blue ocean', 'green forest'];
    const params = { model: 'octen-embedding-0.6b', dimension: 8 } as const;
    const batch = await client().embedding.create({ input: texts, ...params });
    expect(batch.data?.results?.map((r) => r.index)).toEqual([0, 1, 2]);
    // Control: each text embedded alone gives the vector at its batch position
    for (const [i, text] of texts.entries()) {
      const single = await client().embedding.create({ input: [text], ...params });
      const a = single.data?.results?.[0]?.embedding ?? [];
      const b = batch.data?.results?.[i]?.embedding ?? [];
      expect(a).toHaveLength(8);
      a.forEach((v, k) => expect(b[k]).toBeCloseTo(v, 4));
    }
  });

  it('embedding_dimension_over_max: the server answers with a 400', async () => {
    const err = await client()
      .embedding.create({ input: ['a'], model: 'octen-embedding-0.6b', dimension: 4096 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenBadRequestError);
  });

  it('vl_embedding_independent: one vector per content item', async () => {
    const res = await client().vlEmbedding.create({
      model: 'octen-vl-embedding',
      input: { contents: [{ text: 'grapefruit' }, { image: IMAGE }] },
      dimension: 8,
    });
    expect(res.data?.results?.map((r) => r.type)).toEqual(['vl', 'vl']);
    expect(res.data?.results?.[1]?.embedding).toHaveLength(8);
    expect(res.meta?.usage?.image_count).toBe(1);
  });

  it('vl_embedding_fusion: a single fused vector', async () => {
    const res = await client().vlEmbedding.create({
      model: 'octen-vl-embedding',
      input: { contents: [{ text: 'grapefruit' }, { image: IMAGE }] },
      dimension: 8,
      enable_fusion: true,
    });
    expect(res.data?.results).toHaveLength(1);
    expect(res.data?.results?.[0]?.type).toBe('fusion');
  });

  it('vl_embedding_video: a video URL is embedded', async () => {
    const started = Date.now();
    const res = await client().vlEmbedding.create({
      model: 'octen-vl-embedding',
      input: { contents: [{ video: VIDEO }] },
      dimension: 8,
      fps: 0.5,
    });
    console.log(`[live] vl_embedding_video took ${Date.now() - started} ms`);
    expect(res.data?.results).toHaveLength(1);
    expect(res.meta?.usage?.duration).toBeGreaterThan(0);
  });

  it('vl_embedding_unreachable_media: a 400, sent once', async () => {
    let calls = 0;
    const counting: typeof fetch = (input, init) => {
      calls += 1;
      return fetch(input, init);
    };
    const err = await client({ fetch: counting })
      .vlEmbedding.create({ model: 'octen-vl-embedding', input: { contents: [{ image: 'https://example.invalid/a.jpg' }] } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenBadRequestError);
    expect(calls).toBe(1);
  });
});
