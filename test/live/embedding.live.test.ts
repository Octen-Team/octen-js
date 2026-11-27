import { describe, expect, it } from 'vitest';
import Octen, { OctenBadRequestError } from '../../src/index';

// Hits production https://api.octen.ai and is billed: runs only with OCTEN_LIVE=1 and OCTEN_API_KEY, otherwise the whole group is skipped.
// Media: public CC0 files the API could fetch on 2026-11-26.
const apiKey = process.env.OCTEN_API_KEY ?? '';
const enabled = process.env.OCTEN_LIVE === '1' && apiKey !== '';
const IMAGE = 'https://interactive-examples.mdn.mozilla.net/media/cc0-images/grapefruit-slice-332-332.jpg';
const VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  a.forEach((v, k) => {
    const w = b[k] ?? 0;
    dot += v * w;
    na += v * v;
    nb += w * w;
  });
  return dot / Math.sqrt(na * nb);
}

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
    // Control: each text embedded alone. Batched values differ by about 1e-4 (seen 2026-11-27), so the batch
    // vector at position i must be the one closest to text i alone, not equal to it.
    const alone: number[][] = [];
    for (const text of texts) {
      const single = await client().embedding.create({ input: [text], ...params });
      alone.push(single.data?.results?.[0]?.embedding ?? []);
    }
    for (const i of texts.keys()) {
      const b = batch.data?.results?.[i]?.embedding ?? [];
      expect(b).toHaveLength(8);
      const sims = alone.map((a) => cosine(a, b));
      expect(sims[i]).toBeGreaterThan(0.99);
      sims.forEach((s, j) => j === i || expect(s).toBeLessThan(sims[i] as number));
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
