import { describe, expect, it } from 'vitest';
import Octen, { OctenAPIError, OctenAuthenticationError, OctenBadRequestError } from '../../src/index';

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

// A client that also records each request body, to show what a call carried
function capturing(): { c: Octen; bodies: Record<string, unknown>[] } {
  const bodies: Record<string, unknown>[] = [];
  const c = new Octen({
    apiKey,
    fetch: (input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return globalThis.fetch(input, init);
    },
  });
  return { c, bodies };
}

type Dated = { time_published?: string | undefined };
const DAY_MS = 86_400_000;
// Every result with a time_published ("" means none) is inside [start, end]; at least one must have one
function expectPublishedWithin(results: readonly Dated[], start: number, end: number, name: string) {
  const dates = results.map((r) => r.time_published).filter((t): t is string => typeof t === 'string' && t !== '');
  console.log(`[live-family] ${name} time_published=${JSON.stringify(dates)}`);
  expect(dates.length, `${name}: no result carries time_published`).toBeGreaterThanOrEqual(1);
  for (const t of dates) {
    expect(Date.parse(t), `${name}: ${t}`).toBeGreaterThanOrEqual(start);
    expect(Date.parse(t), `${name}: ${t}`).toBeLessThanOrEqual(end);
  }
}

type Texty = { title?: string | undefined; highlight?: string | undefined; full_content?: string | undefined };
const textOf = (r: Texty) => `${r.title ?? ''} ${r.highlight ?? ''} ${r.full_content ?? ''}`;
// Cheap language heuristic: common German function words
const looksGerman = (s: string) => /\b(der|die|das|und|für|mit|nicht|ist|von|den|zu)\b/i.test(s);
// German pages can carry English titles, so require a majority and log each result
function expectMostlyGerman(results: readonly Texty[], name: string) {
  const flags = results.map((r) => looksGerman(`${r.title ?? ''} ${r.highlight ?? ''}`));
  const titles = JSON.stringify(results.map((r) => r.title));
  console.log(`[live-family] ${name} german=${JSON.stringify(flags)} titles=${titles}`);
  expect(flags.filter(Boolean).length * 2, `${name}: most results look German`).toBeGreaterThan(flags.length);
}

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

  it('result_type standard is echoed, full_content is returned, include_text is in every result', async () => {
    const res = logged(
      'searchPremier standard+full_content+include_text',
      await client().search.searchPremier({
        query: 'solid-state battery',
        count: 2,
        result_type: 'standard',
        full_content: { enable: true, max_tokens: 300 },
        include_text: ['electrolyte'],
      }),
    );
    const results = res.data?.results ?? [];
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) expect(r.full_content, r.url).toBeTruthy();
    for (const r of results) expect(textOf(r), r.url).toMatch(/electrolyte/i);
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

  // Same photo sent inline as base64 data instead of a URL
  it('by base64 image data: returns results about the pictured subject', async () => {
    // Wikimedia may refuse fetch's default user agent, so name the client
    const download = await fetch(EIFFEL_IMAGE, {
      headers: { 'user-agent': 'octen-js-sdk-live-tests (https://github.com/Octen-Team/octen-js)' },
      signal: AbortSignal.timeout(30_000),
    });
    expect(download.ok, `download status ${download.status}`).toBe(true);
    const data = Buffer.from(await download.arrayBuffer()).toString('base64');
    const res = logged(
      'imageSearch image data',
      await client().imageSearch.search({ inputs: [{ type: 'image', data }], count: 2 }),
    );
    const results = res.data?.results ?? [];
    expect(results.length).toBeGreaterThanOrEqual(1);
    const titles = JSON.stringify(results.map((r) => r.title));
    console.log(`[live-family] imageSearch image data bytes=${data.length} titles=${titles}`);
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
  // The key used for these tests has beta access, so anything but results (including any 403) is a failure.
  it('returns up to count video results for a text query; time_range year bounds the dates', async () => {
    const { c, bodies } = capturing();
    const res = logged(
      'videoSearch time_range=year safesearch=off',
      await c.videoSearch.search({
        inputs: [{ type: 'text', data: 'how to make fresh pasta' }],
        count: 2,
        time_range: 'year',
        safesearch: 'off',
      }),
    );
    const results = res.data?.results ?? [];
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.length).toBeLessThanOrEqual(2);
    for (const r of results) expect(r.url).toMatch(/^https?:\/\//);
    expectPublishedWithin(results, Date.now() - 367 * DAY_MS, Date.now() + DAY_MS, 'videoSearch time_range=year');
    // safesearch has no observable effect on a benign query; it is only shown to reach the wire
    expect(bodies[0]?.safesearch).toBe('off');
  });

  it('start_time and end_time bound the publish dates', async () => {
    const start = '2025-01-01T00:00:00Z';
    const end = '2025-06-30T23:59:59Z';
    const res = logged(
      'videoSearch start/end',
      await client().videoSearch.search({
        inputs: [{ type: 'text', data: 'how to make fresh pasta' }],
        count: 3,
        start_time: start,
        end_time: end,
      }),
    );
    expectPublishedWithin(res.data?.results ?? [], Date.parse(start), Date.parse(end), 'videoSearch start/end');
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

  it('design_facts and snippet off remove those fields (control: the same query with defaults has them)', async () => {
    // Page-section query: on 2026-11-21 all 5 default images were web_section results with a snippet
    const query = 'SaaS landing page hero section';
    const control = logged(
      'designSearch options control (defaults)',
      await client().designSearch.search({ query, images: { count: 5 }, web_search: { enable: false } }),
    );
    const withDefaults = control.data?.images ?? [];
    const withSnippet = withDefaults.filter((i) => i.snippet !== undefined).length;
    console.log(`[live-family] designSearch control snippet=${withSnippet}/${withDefaults.length}`);
    expect(withSnippet).toBeGreaterThanOrEqual(2);
    expect(withDefaults.some((i) => i.design_facts !== undefined)).toBe(true);

    const res = logged(
      'designSearch options off',
      await client().designSearch.search({
        query,
        images: { count: 5, design_facts: false, snippet: { enable: false } },
        web_search: { enable: false },
      }),
    );
    const images = res.data?.images ?? [];
    expect(images.length).toBeGreaterThanOrEqual(1);
    for (const i of images) {
      expect(i.design_facts, i.url).toBeUndefined();
      expect(i.snippet, i.url).toBeUndefined();
    }
  });

  it('web_search include_domains restricts the web result hosts', async () => {
    const res = logged(
      'designSearch web include_domains',
      await client().designSearch.search({
        query: 'SaaS pricing page',
        images: { enable: false },
        web_search: { count: 2, include_domains: ['stripe.com'] },
      }),
    );
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

describe.skipIf(!enabled)('live: Web Search Premier parameter effects', () => {
  // One unfiltered control and one filtered call on the same query and time_range. Probe on 2026-11-21: only
  // electrek.co mentioned Tesla, so the excluded domain is picked among results that do not, keeping the two
  // exclusions separable. The filtered call also flips format, include_images and highlight.
  it('exclude_text, exclude_domains, time_range, format, include_images and highlight take effect', async () => {
    const query = 'electric vehicle news';
    const control = logged(
      'searchPremier control',
      await client().search.searchPremier({
        query,
        count: 5,
        time_range: 'month',
        format: 'text',
        full_content: { enable: true, max_tokens: 500 },
      }),
    );
    const before = control.data?.results ?? [];
    expect(before.some((r) => /tesla/i.test(textOf(r))), 'control: some result mentions Tesla').toBe(true);
    const dropHost = hostOf(before.find((r) => !/tesla/i.test(textOf(r)))?.url).replace(/^www\./, '');
    expect(dropHost, 'control: a result without Tesla').not.toBe('invalid.invalid');
    expect(before.some((r) => r.images !== undefined || r.cover_image !== undefined)).toBe(false);
    expect(before.some((r) => /\]\(https?:\/\//.test(r.full_content ?? ''))).toBe(false);
    expectPublishedWithin(before, Date.now() - 32 * DAY_MS, Date.now() + DAY_MS, 'searchPremier control month');

    const { c, bodies } = capturing();
    const res = logged(
      'searchPremier filtered',
      await c.search.searchPremier({
        query,
        count: 5,
        time_range: 'month',
        exclude_text: ['Tesla'],
        exclude_domains: [dropHost],
        format: 'markdown',
        include_images: true,
        highlight: { enable: true, max_tokens: 100 },
        full_content: { enable: true, max_tokens: 500 },
        safesearch: 'off',
      }),
    );
    const after = res.data?.results ?? [];
    const hosts = JSON.stringify(after.map((r) => hostOf(r.url)));
    console.log(`[live-family] searchPremier excluded host=${dropHost} hosts=${hosts}`);
    expect(after.length).toBeGreaterThanOrEqual(1);
    for (const r of after) {
      expect(textOf(r), r.url).not.toMatch(/tesla/i);
      expect(onDomain(r.url, dropHost), r.url).toBe(false);
      expect(r.highlight, r.url).toBeTruthy();
      // The control's default 512-token highlights ran about 1,900 characters
      expect((r.highlight ?? '').length, r.url).toBeLessThanOrEqual(600);
    }
    const markdown = /(^|\n)#{1,6} \S|\]\(https?:\/\/|\*\*\S/;
    expect(after.some((r) => markdown.test(r.full_content ?? '')), 'markdown').toBe(true);
    expect(after.some((r) => (r.images?.length ?? 0) > 0 || r.cover_image?.url !== undefined), 'images').toBe(true);
    expectPublishedWithin(after, Date.now() - 32 * DAY_MS, Date.now() + DAY_MS, 'searchPremier filtered month');
    expect(bodies[0]?.safesearch).toBe('off');
  });

  it('language de returns German results; start_time/end_time bound the dates', async () => {
    const start = '2025-01-01T00:00:00Z';
    const end = '2025-12-31T23:59:59Z';
    const { c, bodies } = capturing();
    const res = logged(
      'searchPremier language=de start/end',
      await c.search.searchPremier({
        query: 'renewable energy policy',
        count: 3,
        language: ['de'],
        time_basis: 'published',
        start_time: start,
        end_time: end,
      }),
    );
    const results = res.data?.results ?? [];
    expect(results.length).toBeGreaterThanOrEqual(1);
    expectMostlyGerman(results, 'searchPremier language=de');
    expectPublishedWithin(results, Date.parse(start), Date.parse(end), 'searchPremier start/end');
    // time_basis published vs auto cannot be told apart from the response; it is only shown to reach the wire
    expect(bodies[0]?.time_basis).toBe('published');
  });
});

describe.skipIf(!enabled)('live: Image Search parameter effects', () => {
  it('exclude_domains removes a source domain that the unfiltered control returns', async () => {
    const inputs = [{ type: 'text', data: 'Eiffel Tower' }] as const;
    const control = logged('imageSearch control', await client().imageSearch.search({ inputs, count: 5 }));
    const before = control.data?.results ?? [];
    expect(before.length).toBeGreaterThanOrEqual(1);
    const dropHost = hostOf(before[0]?.source_page).replace(/^www\./, '');
    const { c, bodies } = capturing();
    const res = logged(
      'imageSearch exclude_domains',
      await c.imageSearch.search({ inputs, count: 5, exclude_domains: [dropHost], safesearch: 'off' }),
    );
    const after = res.data?.results ?? [];
    const hosts = JSON.stringify(after.map((r) => hostOf(r.source_page)));
    console.log(`[live-family] imageSearch excluded=${dropHost} hosts=${hosts}`);
    expect(after.length).toBeGreaterThanOrEqual(1);
    for (const r of after) expect(onDomain(r.source_page, dropHost), r.source_page).toBe(false);
    // safesearch has no observable effect on a benign query; it is only shown to reach the wire
    expect(bodies[0]?.safesearch).toBe('off');
  });
});

describe.skipIf(!enabled)('live: Design Search parameter effects', () => {
  it('images.count caps images; web highlight, full_content, time_range and exclude_domains take effect', async () => {
    const query = 'SaaS pricing page';
    const web = { count: 5, time_range: 'year', highlight: { enable: true, max_tokens: 100 } } as const;
    const control = logged(
      'designSearch control',
      await client().designSearch.search({
        query,
        // The default is 5, and the hero section query returned 5 images
        images: { count: 3 },
        web_search: { ...web, full_content: { enable: true, max_tokens: 300 } },
      }),
    );
    const images = control.data?.images ?? [];
    expect(images.length).toBeGreaterThanOrEqual(1);
    expect(images.length).toBeLessThanOrEqual(3);
    const before = control.data?.results ?? [];
    expect(before.length).toBeGreaterThanOrEqual(1);
    for (const r of before) {
      expect(r.highlight, r.url).toBeTruthy();
      expect((r.highlight ?? '').length, r.url).toBeLessThanOrEqual(600);
      expect(r.full_content, r.url).toBeTruthy();
    }
    expectPublishedWithin(before, Date.now() - 367 * DAY_MS, Date.now() + DAY_MS, 'designSearch web time_range=year');

    const dropHost = hostOf(before[0]?.url).replace(/^www\./, '');
    const res = logged(
      'designSearch web exclude_domains',
      await client().designSearch.search({
        query,
        images: { enable: false },
        web_search: { ...web, exclude_domains: [dropHost] },
      }),
    );
    const after = res.data?.results ?? [];
    const hosts = JSON.stringify(after.map((r) => hostOf(r.url)));
    console.log(`[live-family] designSearch excluded=${dropHost} hosts=${hosts}`);
    expect(after.length).toBeGreaterThanOrEqual(1);
    for (const r of after) {
      expect(onDomain(r.url, dropHost), r.url).toBe(false);
      // full_content was not enabled on this call
      expect(r.full_content, r.url).toBeUndefined();
    }
  });

  it('web language de returns German results; start_time/end_time bound the dates', async () => {
    const start = '2025-01-01T00:00:00Z';
    const end = '2025-12-31T23:59:59Z';
    const { c, bodies } = capturing();
    const res = logged(
      'designSearch web language=de start/end',
      await c.designSearch.search({
        query: 'SaaS pricing page',
        images: { enable: false },
        web_search: { count: 3, language: ['de'], time_basis: 'published', start_time: start, end_time: end },
      }),
    );
    const results = res.data?.results ?? [];
    expect(results.length).toBeGreaterThanOrEqual(1);
    expectMostlyGerman(results, 'designSearch web language=de');
    expectPublishedWithin(results, Date.parse(start), Date.parse(end), 'designSearch web start/end');
    // time_basis cannot be told apart from the response; it is only shown to reach the wire
    expect((bodies[0]?.web_search as { time_basis?: string } | undefined)?.time_basis).toBe('published');
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
