import { describe, expect, it } from 'vitest';
import Octen, {
  OctenAPIError,
  OctenAuthenticationError,
  OctenBadRequestError,
  OctenPermissionDeniedError,
} from '../../src/index';

// Web Search Premier, Image, Video and Design Search against production https://api.octen.ai (billed, small counts).
// Runs only with OCTEN_LIVE=1 and OCTEN_API_KEY. Each test checks that its options take effect, not only success.
const apiKey = process.env.OCTEN_API_KEY ?? '';
const enabled = process.env.OCTEN_LIVE === '1' && apiKey !== '';
const client = () => (enabled ? new Octen({ apiKey }) : (undefined as never as Octen));

// A stable public image for search-by-image
const EIFFEL_IMAGE =
  'https://upload.wikimedia.org/wikipedia/commons/thumb/8/85/Tour_Eiffel_Wikimedia_Commons_%28cropped%29.jpg/500px-Tour_Eiffel_Wikimedia_Commons_%28cropped%29.jpg';

const hostOf = (u: string | undefined) => new URL(u ?? 'http://invalid.invalid').hostname;
const onDomain = (u: string | undefined, d: string) => hostOf(u) === d || hostOf(u).endsWith(`.${d}`);

function logged<T extends { request_id?: string | undefined }>(name: string, res: T): T {
  console.log(`[live-family] OK ${name} request_id=${res.request_id}`);
  expect(typeof res.request_id).toBe('string');
  expect(res.request_id).not.toBe('');
  return res;
}

describe.skipIf(!enabled)('live: Web Search Premier', () => {
  it('include_domains restricts hosts, result_type dynamic is echoed, count caps the results', async () => {
    const res = logged(
      'searchPremier dynamic+include_domains',
      await client().search.searchPremier({
        query: 'EU AI Act guidance',
        count: 3,
        result_type: 'dynamic',
        include_domains: ['europa.eu'],
      }),
    );
    const results = res.data?.results ?? [];
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.length).toBeLessThanOrEqual(3);
    for (const r of results) expect(onDomain(r.url, 'europa.eu'), r.url).toBe(true);
    expect(res.meta?.result_type).toBe('dynamic');
  });

  it('result_type standard is echoed and full_content is returned when enabled', async () => {
    const res = logged(
      'searchPremier standard+full_content',
      await client().search.searchPremier({
        query: 'solid-state battery',
        count: 2,
        result_type: 'standard',
        full_content: { enable: true, max_tokens: 300 },
      }),
    );
    const results = res.data?.results ?? [];
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) expect(r.full_content, r.url).toBeTruthy();
    expect(res.meta?.result_type).toBe('standard');
  });
});

describe.skipIf(!enabled)('live: Image Search', () => {
  it('by text: returns image results with image URLs', async () => {
    const res = logged(
      'imageSearch text',
      await client().imageSearch.search({ inputs: [{ type: 'text', data: 'golden retriever puppy' }], count: 2 }),
    );
    const results = res.data?.results ?? [];
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.length).toBeLessThanOrEqual(2);
    for (const r of results) expect(r.url).toMatch(/^https?:\/\//);
  });

  it('by text with include_domains: every source_page is on the domain', async () => {
    const res = logged(
      'imageSearch include_domains',
      await client().imageSearch.search({
        inputs: [{ type: 'text', data: 'Eiffel Tower' }],
        count: 3,
        include_domains: ['wikipedia.org'],
      }),
    );
    const results = res.data?.results ?? [];
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) expect(onDomain(r.source_page, 'wikipedia.org'), r.source_page).toBe(true);
  });

  // The input is a photo of the Eiffel Tower; results about it show the image was used, not ignored
  it('by image URL: returns results about the pictured subject', async () => {
    const res = logged(
      'imageSearch image url',
      await client().imageSearch.search({ inputs: [{ type: 'image', url: EIFFEL_IMAGE }], count: 2 }),
    );
    const results = res.data?.results ?? [];
    expect(results.length).toBeGreaterThanOrEqual(1);
    console.log(`[live-family] imageSearch image url titles=${JSON.stringify(results.map((r) => r.title))}`);
    expect(results.some((r) => /eiffel/i.test(`${r.title ?? ''} ${r.description ?? ''}`))).toBe(true);
  });

  it('count 1000 -> OctenBadRequestError', async () => {
    const err = await client()
      .imageSearch.search({ inputs: [{ type: 'text', data: 'cat' }], count: 1000 })
      .catch((e: unknown) => e);
    if (err instanceof OctenAPIError) {
      console.log(`[live-family] NEG imageSearch count=1000 status=${err.status} msg=${err.message}`);
    }
    expect(err).toBeInstanceOf(OctenBadRequestError);
  });
});

describe.skipIf(!enabled)('live: Video Search (invite-only beta)', () => {
  // The key used on 2026-11-21 had beta access; the rejection branch assumes a 403 and is unverified.
  it('returns video results, or a permission error when the key has no beta access', async () => {
    const outcome = await client()
      .videoSearch.search({ inputs: [{ type: 'text', data: 'how to make fresh pasta' }], count: 2 })
      .then(
        (res) => ({ res }),
        (err: unknown) => ({ err }),
      );
    if ('res' in outcome) {
      logged('videoSearch', outcome.res);
      const results = outcome.res.data?.results ?? [];
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.length).toBeLessThanOrEqual(2);
      for (const r of results) expect(r.url).toMatch(/^https?:\/\//);
      return;
    }
    const err = outcome.err;
    if (err instanceof OctenAPIError) {
      console.log(
        `[live-family] videoSearch rejected: ${err.name} status=${err.status} code=${err.code} msg=${JSON.stringify(err.message)}`,
      );
    }
    expect(err).toBeInstanceOf(OctenPermissionDeniedError);
  });
});

describe.skipIf(!enabled)('live: Design Search', () => {
  it('returns image and web results; a group_id lookup returns the group in order', async () => {
    const res = logged(
      'designSearch hero section',
      await client().designSearch.search({
        query: 'SaaS landing page hero section',
        images: { count: 2 },
        web_search: { count: 1 },
      }),
    );
    const images = res.data?.images ?? [];
    expect(images.length).toBeGreaterThanOrEqual(1);
    for (const i of images) expect(i.url).toMatch(/^https?:\/\//);
    // Default on: the control for the "off" test below
    expect(images.some((i) => i.design_facts !== undefined)).toBe(true);
    expect(res.data?.results?.length ?? 0).toBeGreaterThanOrEqual(1);

    const groupId = images.find((i) => i.group?.group_id)?.group?.group_id;
    expect(groupId, 'an image result with a group').toBeTruthy();
    const group = logged(
      'designSearch group_id lookup',
      await client().designSearch.search({ images: { group_id: groupId as string, count: 2 } }),
    );
    const members = group.data?.images ?? [];
    expect(members.map((i) => i.group?.position)).toEqual([1, 2]);
    for (const i of members) expect(i.group?.group_id).toBe(groupId);
  });

  it('design_facts and snippet off remove those fields; web include_domains restricts hosts', async () => {
    const res = logged(
      'designSearch options off',
      await client().designSearch.search({
        query: 'SaaS pricing page',
        images: { count: 2, design_facts: false, snippet: { enable: false } },
        web_search: { count: 2, include_domains: ['stripe.com'] },
      }),
    );
    const images = res.data?.images ?? [];
    expect(images.length).toBeGreaterThanOrEqual(1);
    for (const i of images) {
      expect(i.design_facts, i.url).toBeUndefined();
      expect(i.snippet, i.url).toBeUndefined();
    }
    const results = res.data?.results ?? [];
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) expect(onDomain(r.url, 'stripe.com'), r.url).toBe(true);
  });

  it('images.enable and web_search.enable false return neither', async () => {
    const res = logged(
      'designSearch both disabled',
      await client().designSearch.search({
        query: 'SaaS pricing page',
        images: { enable: false },
        web_search: { enable: false },
      }),
    );
    expect(res.data?.images ?? []).toEqual([]);
    expect(res.data?.results ?? []).toEqual([]);
  });

  it('a query over 500 characters -> OctenBadRequestError', async () => {
    const err = await client()
      .designSearch.search({ query: 'landing page '.repeat(40), web_search: { enable: false } })
      .catch((e: unknown) => e);
    if (err instanceof OctenAPIError) {
      console.log(`[live-family] NEG designSearch query>500 status=${err.status} msg=${err.message}`);
    }
    expect(err).toBeInstanceOf(OctenBadRequestError);
  });
});

describe.skipIf(!enabled)('live: wrong API key on the new endpoints', () => {
  it.each([
    ['searchPremier', (c: Octen) => c.search.searchPremier({ query: 'octen', count: 1 })],
    ['imageSearch', (c: Octen) => c.imageSearch.search({ inputs: [{ type: 'text', data: 'cat' }], count: 1 })],
    ['videoSearch', (c: Octen) => c.videoSearch.search({ inputs: [{ type: 'text', data: 'cat' }], count: 1 })],
    ['designSearch', (c: Octen) => c.designSearch.search({ query: 'pricing page' })],
  ])('%s -> OctenAuthenticationError', async (_name, send) => {
    const bad = new Octen({ apiKey: 'octen-invalid-key-for-live-test', maxRetries: 0 });
    await expect(send(bad)).rejects.toBeInstanceOf(OctenAuthenticationError);
  });
});
