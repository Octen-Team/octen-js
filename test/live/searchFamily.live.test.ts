import { describe, expect, it } from 'vitest';
import Octen, { OctenAPIError, OctenAuthenticationError, OctenBadRequestError } from '../../src/index';

// Web Search Premier, Image, Video and Design Search against production https://api.octen.ai (billed, small counts).
// Runs only with OCTEN_LIVE=1 and OCTEN_API_KEY; Video Search (invite-only beta) also needs OCTEN_LIVE_VIDEO=1.
// Each option is checked for its effect, against an unfiltered control on the same query where one is needed.
const apiKey = process.env.OCTEN_API_KEY ?? '';
const enabled = process.env.OCTEN_LIVE === '1' && apiKey !== '';
const videoEnabled = enabled && process.env.OCTEN_LIVE_VIDEO === '1';
const client = () => (enabled ? new Octen({ apiKey }) : (undefined as never as Octen));

// A stable public image for search-by-image
const EIFFEL_IMAGE =
  'https://upload.wikimedia.org/wikipedia/commons/thumb/8/85/Tour_Eiffel_Wikimedia_Commons_%28cropped%29.jpg/500px-Tour_Eiffel_Wikimedia_Commons_%28cropped%29.jpg';

const DAY_MS = 86_400_000;

function hostOf(u: string | undefined): string | undefined {
  if (!URL.canParse(u ?? '')) return undefined;
  return new URL(u as string).hostname.replace(/^www\./, '');
}
const onDomain = (u: string | undefined, d: string) => {
  const h = hostOf(u);
  return h !== undefined && (h === d || h.endsWith(`.${d}`));
};

// Distinct parseable hosts in result order; a control must show at least two so a domain filter means something
function distinctHosts(urls: readonly (string | undefined)[], name: string): string[] {
  const hosts = [...new Set(urls.map(hostOf).filter((h): h is string => h !== undefined))];
  console.log(`[live-family] ${name} hosts=${JSON.stringify(hosts)}`);
  expect(hosts.length, `${name}: the control needs at least two hosts`).toBeGreaterThanOrEqual(2);
  return hosts;
}

// Calls a control once and shares it between the tests that compare against it
function once<T>(run: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => (pending ??= run());
}

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

type Dated = { time_published?: string | undefined; time_last_crawled?: string | undefined };
type TimeField = 'time_published' | 'time_last_crawled';

// The spec: results missing the time_basis field are excluded when filtering by time, so every result must carry it
function expectAllWithin(results: readonly Dated[], field: TimeField, start: number, end: number, name: string) {
  console.log(`[live-family] ${name} ${field}=${JSON.stringify(results.map((r) => r[field]))}`);
  expect(results.length, `${name}: results`).toBeGreaterThanOrEqual(1);
  for (const r of results) {
    const t = r[field];
    expect(typeof t === 'string' && t !== '', `${name}: a result without ${field}`).toBe(true);
    expect(Date.parse(t as string), `${name}: ${t}`).toBeGreaterThanOrEqual(start);
    expect(Date.parse(t as string), `${name}: ${t}`).toBeLessThanOrEqual(end);
  }
}

// The unfiltered control must return something the window excludes, or the window proves nothing
function expectSomeBefore(results: readonly Dated[], field: TimeField, start: number, name: string) {
  const dates = results.map((r) => r[field]).filter((t): t is string => typeof t === 'string' && t !== '');
  console.log(`[live-family] ${name} control ${field}=${JSON.stringify(dates)}`);
  expect(dates.some((t) => Date.parse(t) < start), `${name}: control has a result outside the window`).toBe(true);
}

type Texty = {
  url?: string | undefined;
  title?: string | undefined;
  highlight?: string | undefined;
  full_content?: string | undefined;
};
const textOf = (r: Texty) => `${r.title ?? ''} ${r.highlight ?? ''} ${r.full_content ?? ''}`.toLowerCase();
const hasWord = (text: string, w: string) => new RegExp(`\\b${w}\\b`).test(text);

// Cheap language heuristic: common German function words; German pages can carry English titles, so require a majority
const looksGerman = (s: string) => /\b(der|die|das|und|für|mit|nicht|ist|von|den|zu)\b/i.test(s);
function expectMostlyGerman(results: readonly Texty[], name: string) {
  const flags = results.map((r) => looksGerman(`${r.title ?? ''} ${r.highlight ?? ''}`));
  const titles = JSON.stringify(results.map((r) => r.title));
  console.log(`[live-family] ${name} german=${JSON.stringify(flags)} titles=${titles}`);
  expect(flags.filter(Boolean).length * 2, `${name}: most results look German`).toBeGreaterThan(flags.length);
}

// Every URL in both responses must have a shorter highlight under the small cap; at least one URL must overlap
function expectShorterHighlights(capped: readonly Texty[], uncapped: readonly Texty[], name: string) {
  const baseline = new Map(uncapped.map((r) => [r.url, (r.highlight ?? '').length]));
  const pairs = capped.filter((r) => baseline.has(r.url)).map((r) => [(r.highlight ?? '').length, baseline.get(r.url)]);
  console.log(`[live-family] ${name} capped/uncapped highlight lengths=${JSON.stringify(pairs)}`);
  expect(pairs.length, `${name}: a URL in both responses`).toBeGreaterThanOrEqual(1);
  for (const [short, long] of pairs) {
    expect(short, name).toBeGreaterThan(0);
    expect(short, name).toBeLessThan(long as number);
  }
}

function logged<T extends { request_id?: string | undefined }>(name: string, res: T): T {
  console.log(`[live-family] OK ${name} request_id=${res.request_id}`);
  expect(typeof res.request_id).toBe('string');
  expect(res.request_id).not.toBe('');
  return res;
}

describe.skipIf(!enabled)('live: Web Search Premier', () => {
  // Probe on 2026-11-21: five hosts, two results older than a month, highlights of about 1,900 characters
  const query = 'electric vehicle battery';
  const control = once(async () =>
    logged(
      'searchPremier control',
      await client().search.searchPremier({
        query,
        count: 5,
        format: 'text',
        full_content: { enable: true, max_tokens: 500 },
      }),
    ),
  );

  it('include_domains keeps one host of the control; result_type dynamic is echoed; count caps', async () => {
    const hosts = distinctHosts((await control()).data?.results?.map((r) => r.url) ?? [], 'searchPremier control');
    const keep = hosts[1] as string;
    const res = logged(
      'searchPremier include_domains+dynamic',
      await client().search.searchPremier({ query, count: 5, include_domains: [keep], result_type: 'dynamic' }),
    );
    const results = res.data?.results ?? [];
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.length).toBeLessThanOrEqual(5);
    for (const r of results) expect(onDomain(r.url, keep), r.url).toBe(true);
    expect(res.meta?.result_type).toBe('dynamic');
  });

  it('exclude_text and exclude_domains each remove what the control shows; include_images adds images', async () => {
    const before = (await control()).data?.results ?? [];
    expect(before.some((r) => r.images !== undefined || r.cover_image !== undefined)).toBe(false);
    // A word on exactly one host, and a different host whose result lacks it, so each exclusion is shown on its own
    const texts = before.map((r) => ({ host: hostOf(r.url), text: textOf(r) }));
    const queryWords = new Set(query.split(' '));
    const words = [...new Set(texts.flatMap((t) => t.text.match(/\b[a-z]{7,}\b/g) ?? []))];
    const candidates = words.filter((w) => !queryWords.has(w));
    let pick: { word: string; wordHost: string; dropHost: string } | undefined;
    for (const word of candidates.sort()) {
      const having = texts.filter((t) => hasWord(t.text, word));
      const wordHost = having[0]?.host;
      if (having.length !== 1 || wordHost === undefined) continue;
      const drop = texts.find((t) => t.host !== undefined && t.host !== wordHost && !hasWord(t.text, word));
      if (drop?.host !== undefined) {
        pick = { word, wordHost, dropHost: drop.host };
        break;
      }
    }
    console.log(`[live-family] searchPremier exclusions ${JSON.stringify(pick)}`);
    expect(pick, 'control: a word on one host and another host without it').toBeDefined();
    const { word, dropHost } = pick as NonNullable<typeof pick>;

    const { c, bodies } = capturing();
    const res = logged(
      'searchPremier exclude_text+exclude_domains',
      await c.search.searchPremier({
        query,
        count: 5,
        exclude_text: [word],
        exclude_domains: [dropHost],
        include_images: true,
        full_content: { enable: true, max_tokens: 500 },
        // Accepted, effect not observable: highlights were identical for markdown and text on 2026-11-21
        format: 'markdown',
        safesearch: 'off',
      }),
    );
    const after = res.data?.results ?? [];
    console.log(`[live-family] searchPremier filtered hosts=${JSON.stringify(after.map((r) => hostOf(r.url)))}`);
    expect(after.length).toBeGreaterThanOrEqual(1);
    for (const r of after) {
      expect(hasWord(textOf(r), word), `${r.url} contains ${word}`).toBe(false);
      expect(onDomain(r.url, dropHost), r.url).toBe(false);
    }
    expect(after.some((r) => (r.images?.length ?? 0) > 0 || r.cover_image?.url !== undefined), 'images').toBe(true);
    expect(bodies[0]?.format).toBe('markdown');
    expect(bodies[0]?.safesearch).toBe('off');
  });

  it('highlight max_tokens 100 shortens the highlight of every URL the default control also returned', async () => {
    const before = (await control()).data?.results ?? [];
    const res = logged(
      'searchPremier highlight max_tokens=100',
      await client().search.searchPremier({
        query,
        count: 5,
        format: 'text',
        highlight: { enable: true, max_tokens: 100 },
      }),
    );
    expectShorterHighlights(res.data?.results ?? [], before, 'searchPremier highlight');
  });

  it('time_range month with time_basis published: every result is dated within the month', async () => {
    const start = Date.now() - 32 * DAY_MS;
    expectSomeBefore((await control()).data?.results ?? [], 'time_published', start, 'searchPremier month');
    const res = logged(
      'searchPremier time_range=month',
      await client().search.searchPremier({ query, count: 5, time_range: 'month', time_basis: 'published' }),
    );
    expectAllWithin(res.data?.results ?? [], 'time_published', start, Date.now() + DAY_MS, 'searchPremier month');
  });

  it('language de returns German results; start_time/end_time bound time_published', async () => {
    const start = '2025-01-01T00:00:00Z';
    const end = '2025-12-31T23:59:59Z';
    const res = logged(
      'searchPremier language=de start/end',
      await client().search.searchPremier({
        query: 'renewable energy policy',
        count: 3,
        language: ['de'],
        time_basis: 'published',
        start_time: start,
        end_time: end,
      }),
    );
    const results = res.data?.results ?? [];
    expectMostlyGerman(results, 'searchPremier language=de');
    expectAllWithin(results, 'time_published', Date.parse(start), Date.parse(end), 'searchPremier start/end');
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
    for (const r of results) expect(textOf(r), r.url).toMatch(/electrolyte/);
    expect(res.meta?.result_type).toBe('standard');
  });
});

describe.skipIf(!enabled)('live: Image Search', () => {
  const inputs = [{ type: 'text', data: 'Eiffel Tower' }] as const;
  // safesearch is the same on every call compared against this control
  const control = once(async () =>
    logged('imageSearch control', await client().imageSearch.search({ inputs, count: 5, safesearch: 'off' })),
  );
  const controlHosts = async () =>
    distinctHosts((await control()).data?.results?.map((r) => r.source_page) ?? [], 'imageSearch control');

  it('by text: returns up to count image results with image URLs', async () => {
    const results = (await control()).data?.results ?? [];
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.length).toBeLessThanOrEqual(5);
    for (const r of results) expect(r.url).toMatch(/^https?:\/\//);
  });

  it('include_domains keeps one source domain of the control', async () => {
    const keep = (await controlHosts())[1] as string;
    const res = logged(
      'imageSearch include_domains',
      await client().imageSearch.search({ inputs, count: 5, include_domains: [keep], safesearch: 'off' }),
    );
    const results = res.data?.results ?? [];
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) expect(onDomain(r.source_page, keep), r.source_page).toBe(true);
  });

  it('exclude_domains removes a source domain the control returns', async () => {
    const drop = (await controlHosts())[0] as string;
    const { c, bodies } = capturing();
    const res = logged(
      'imageSearch exclude_domains',
      await c.imageSearch.search({ inputs, count: 5, exclude_domains: [drop], safesearch: 'off' }),
    );
    const results = res.data?.results ?? [];
    const hosts = JSON.stringify(results.map((r) => hostOf(r.source_page)));
    console.log(`[live-family] imageSearch excluded=${drop} hosts=${hosts}`);
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) expect(onDomain(r.source_page, drop), r.source_page).toBe(false);
    // Accepted, effect not observable on a benign query: shown only to reach the wire
    expect(bodies[0]?.safesearch).toBe('off');
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

// Opt-in: the key must have beta access, and then any error (a 403 included) is a failure.
describe.skipIf(!videoEnabled)('live: Video Search (invite-only beta, OCTEN_LIVE_VIDEO=1)', () => {
  const inputs = [{ type: 'text', data: 'how to make fresh pasta' }] as const;

  it('time_range year: every result is dated within the year, while the unfiltered control is older', async () => {
    const start = Date.now() - 367 * DAY_MS;
    const { c, bodies } = capturing();
    const res = logged(
      'videoSearch time_range=year',
      await c.videoSearch.search({ inputs, count: 2, time_range: 'year', safesearch: 'off' }),
    );
    const results = res.data?.results ?? [];
    expect(results.length).toBeLessThanOrEqual(2);
    for (const r of results) expect(r.url).toMatch(/^https?:\/\//);
    expectAllWithin(results, 'time_published', start, Date.now() + DAY_MS, 'videoSearch year');
    // Accepted, effect not observable on a benign query: shown only to reach the wire
    expect(bodies[0]?.safesearch).toBe('off');
    const control = logged('videoSearch control', await client().videoSearch.search({ inputs, count: 5 }));
    expectSomeBefore(control.data?.results ?? [], 'time_published', start, 'videoSearch year');
  });

  it('start_time and end_time bound time_published', async () => {
    const start = '2025-01-01T00:00:00Z';
    const end = '2025-06-30T23:59:59Z';
    const res = logged(
      'videoSearch start/end',
      await client().videoSearch.search({ inputs, count: 3, start_time: start, end_time: end }),
    );
    const results = res.data?.results ?? [];
    expectAllWithin(results, 'time_published', Date.parse(start), Date.parse(end), 'videoSearch start/end');
  });
});

describe.skipIf(!enabled)('live: Design Search', () => {
  // Probe on 2026-11-21: web_section images with snippets and groups, four web hosts dated 140 to 246 days back
  const query = 'SaaS landing page hero section';
  const control = once(async () =>
    logged(
      'designSearch control',
      await client().designSearch.search({
        query,
        images: { count: 3 },
        web_search: { count: 4, full_content: { enable: true, max_tokens: 300 } },
      }),
    ),
  );
  const webHosts = async () =>
    distinctHosts((await control()).data?.results?.map((r) => r.url) ?? [], 'designSearch control web');

  it('images.count and web_search.count cap the results; defaults return design_facts and snippets', async () => {
    const res = await control();
    const images = res.data?.images ?? [];
    expect(images.length).toBeGreaterThanOrEqual(1);
    // Below the server default of 5
    expect(images.length).toBeLessThanOrEqual(3);
    for (const i of images) expect(i.url).toMatch(/^https?:\/\//);
    console.log(`[live-family] designSearch control snippet=${images.filter((i) => i.snippet).length}/${images.length}`);
    expect(images.filter((i) => i.snippet !== undefined).length).toBeGreaterThanOrEqual(2);
    expect(images.some((i) => i.design_facts !== undefined)).toBe(true);
    const web = res.data?.results ?? [];
    expect(web.length).toBeGreaterThanOrEqual(1);
    expect(web.length).toBeLessThanOrEqual(4);
    for (const r of web) expect(r.full_content, r.url).toBeTruthy();
  });

  it('a group_id lookup returns the group in order; web_search.enable false returns no web results', async () => {
    const images = (await control()).data?.images ?? [];
    const grouped = images.find((i) => (i.group?.total ?? 0) >= 2);
    expect(grouped, 'an image in a group of at least two').toBeDefined();
    const groupId = grouped?.group?.group_id as string;
    const res = logged(
      'designSearch group_id lookup',
      await client().designSearch.search({ images: { group_id: groupId, count: 2 }, web_search: { enable: false } }),
    );
    const members = res.data?.images ?? [];
    expect(members.map((i) => i.group?.position)).toEqual([1, 2]);
    for (const i of members) expect(i.group?.group_id).toBe(groupId);
    expect(res.data?.results ?? []).toEqual([]);
  });

  it('web include_domains keeps one host of the control; images.enable false returns no images', async () => {
    const keep = (await webHosts())[1] as string;
    const res = logged(
      'designSearch web include_domains',
      await client().designSearch.search({
        query,
        images: { enable: false },
        web_search: { count: 4, include_domains: [keep] },
      }),
    );
    expect(res.data?.images ?? []).toEqual([]);
    const results = res.data?.results ?? [];
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) expect(onDomain(r.url, keep), r.url).toBe(true);
  });

  it('design_facts/snippet off, web exclude_domains and highlight max_tokens each take effect', async () => {
    const before = (await control()).data?.results ?? [];
    const drop = (await webHosts())[0] as string;
    const res = logged(
      'designSearch options off+exclude_domains+highlight cap',
      await client().designSearch.search({
        query,
        images: { count: 3, design_facts: false, snippet: { enable: false } },
        web_search: { count: 4, exclude_domains: [drop], highlight: { enable: true, max_tokens: 100 } },
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
    for (const r of results) {
      expect(onDomain(r.url, drop), r.url).toBe(false);
      // full_content was not enabled on this call
      expect(r.full_content, r.url).toBeUndefined();
    }
    expectShorterHighlights(results, before, 'designSearch highlight');
  });

  it('web time_range month with time_basis published: every result is dated within the month', async () => {
    const start = Date.now() - 32 * DAY_MS;
    expectSomeBefore((await control()).data?.results ?? [], 'time_published', start, 'designSearch month');
    const res = logged(
      'designSearch web time_range=month',
      await client().designSearch.search({
        query,
        images: { enable: false },
        web_search: { count: 4, time_range: 'month', time_basis: 'published' },
      }),
    );
    expectAllWithin(res.data?.results ?? [], 'time_published', start, Date.now() + DAY_MS, 'designSearch month');
  });

  it('web language de returns German results; start_time/end_time bound time_published', async () => {
    const start = '2025-01-01T00:00:00Z';
    const end = '2025-12-31T23:59:59Z';
    const res = logged(
      'designSearch web language=de start/end',
      await client().designSearch.search({
        query: 'SaaS pricing page',
        images: { enable: false },
        web_search: { count: 3, language: ['de'], time_basis: 'published', start_time: start, end_time: end },
      }),
    );
    const results = res.data?.results ?? [];
    expectMostlyGerman(results, 'designSearch web language=de');
    expectAllWithin(results, 'time_published', Date.parse(start), Date.parse(end), 'designSearch web start/end');
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
