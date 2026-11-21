import { describe, expect, it } from 'vitest';
import Octen, { OctenAPIError, OctenAuthenticationError, OctenBadRequestError } from '../../src/index';

// Web Search Premier, Image, Video and Design Search against production https://api.octen.ai (billed, small counts).
// Runs only with OCTEN_LIVE=1 and OCTEN_API_KEY; Video Search (invite-only beta) also needs OCTEN_LIVE_VIDEO=1.
// Each option is checked for its effect against an unfiltered control on the same query; a control that does not
// show what the option should change fails the test.
const apiKey = process.env.OCTEN_API_KEY ?? '';
const enabled = process.env.OCTEN_LIVE === '1' && apiKey !== '';
const videoEnabled = enabled && process.env.OCTEN_LIVE_VIDEO === '1';
const client = () => (enabled ? new Octen({ apiKey }) : (undefined as never as Octen));

// A stable public image for search-by-image
const EIFFEL_IMAGE =
  'https://upload.wikimedia.org/wikipedia/commons/thumb/8/85/Tour_Eiffel_Wikimedia_Commons_%28cropped%29.jpg/500px-Tour_Eiffel_Wikimedia_Commons_%28cropped%29.jpg';

const DAY_MS = 86_400_000;
const YEAR_2025 = { start: '2025-01-01T00:00:00Z', end: '2025-12-31T23:59:59Z' } as const;

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

type Dated = { time_published?: string | undefined };

// The spec: results missing the time_basis field are excluded when filtering by time, so every result must carry it
function expectAllWithin(results: readonly Dated[], start: number, end: number, name: string) {
  console.log(`[live-family] ${name} time_published=${JSON.stringify(results.map((r) => r.time_published))}`);
  expect(results.length, `${name}: results`).toBeGreaterThanOrEqual(1);
  for (const r of results) {
    const t = r.time_published;
    expect(typeof t === 'string' && t !== '', `${name}: a result without time_published`).toBe(true);
    expect(Date.parse(t as string), `${name}: ${t}`).toBeGreaterThanOrEqual(start);
    expect(Date.parse(t as string), `${name}: ${t}`).toBeLessThanOrEqual(end);
  }
}

// The unfiltered control must return a dated result the window excludes, or the window proves nothing
function expectSomeOutside(results: readonly Dated[], start: number, end: number, name: string) {
  const dates = results.map((r) => r.time_published).filter((t): t is string => typeof t === 'string' && t !== '');
  console.log(`[live-family] ${name} control time_published=${JSON.stringify(dates)}`);
  const outside = dates.some((t) => Date.parse(t) < start || Date.parse(t) > end);
  expect(outside, `${name}: the control has a result outside the window`).toBe(true);
}

type Texty = {
  url?: string | undefined;
  title?: string | undefined;
  highlight?: string | undefined;
  full_content?: string | undefined;
};
const textOf = (r: Texty) => `${r.title ?? ''} ${r.highlight ?? ''} ${r.full_content ?? ''}`.toLowerCase();
const hasWord = (text: string, w: string) => new RegExp(`\\b${w}\\b`).test(text);
// Lower-case words of seven letters or more in a result, minus the query's own words
function wordsOf(r: Texty, query: string): Set<string> {
  const skip = new Set(query.toLowerCase().split(' '));
  return new Set((textOf(r).match(/\b[a-z]{7,}\b/g) ?? []).filter((w) => !skip.has(w)));
}

// Cheap language heuristic: common German function words; German pages can carry English titles, so require a majority
const looksGerman = (s: string) => /\b(der|die|das|und|für|mit|nicht|ist|von|den|zu)\b/i.test(s);
function expectMostlyGerman(results: readonly Texty[], name: string) {
  const flags = results.map((r) => looksGerman(`${r.title ?? ''} ${r.highlight ?? ''}`));
  const titles = JSON.stringify(results.map((r) => r.title));
  console.log(`[live-family] ${name} german=${JSON.stringify(flags)} titles=${titles}`);
  expect(flags.filter(Boolean).length * 2, `${name}: most results look German`).toBeGreaterThan(flags.length);
}

// For every URL in both responses the small cap must give a shorter, non-empty field; at least one URL must overlap
function expectShorter(
  field: 'highlight' | 'full_content',
  capped: readonly Texty[],
  uncapped: readonly Texty[],
  name: string,
) {
  const baseline = new Map(uncapped.map((r) => [r.url, (r[field] ?? '').length]));
  const pairs = capped.filter((r) => baseline.has(r.url)).map((r) => [(r[field] ?? '').length, baseline.get(r.url)]);
  console.log(`[live-family] ${name} capped/uncapped ${field} lengths=${JSON.stringify(pairs)}`);
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
  // Probe on 2026-11-21: five hosts, results dated 2025-12 and 2026-01 among undated ones, ~1,900-character highlights.
  // full_content is generous because include_text / exclude_text match the whole page.
  const query = 'electric vehicle battery';
  const fullContent = { enable: true, max_tokens: 20000 } as const;
  const control = once(async () =>
    logged(
      'searchPremier control',
      await client().search.searchPremier({ query, count: 5, format: 'text', full_content: fullContent }),
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

  it('include_text: the control has a result without the word, every filtered result has it', async () => {
    const before = (await control()).data?.results ?? [];
    const sets = before.map((r) => wordsOf(r, query));
    // The word in the most control results, but not in all of them
    const counts = new Map<string, number>();
    for (const s of sets) for (const w of s) counts.set(w, (counts.get(w) ?? 0) + 1);
    const ranked = [...counts]
      .filter(([, n]) => n < sets.length)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const word = ranked[0]?.[0];
    console.log(`[live-family] searchPremier include_text word=${word} in ${ranked[0]?.[1]}/${sets.length} control results`);
    expect(word, 'control: a word some results lack').toBeDefined();
    expect(before.some((r) => !hasWord(textOf(r), word as string)), 'control: a result without the word').toBe(true);

    const res = logged(
      'searchPremier include_text+standard',
      await client().search.searchPremier({
        query,
        count: 5,
        include_text: [word as string],
        result_type: 'standard',
        full_content: fullContent,
      }),
    );
    const results = res.data?.results ?? [];
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) expect(hasWord(textOf(r), word as string), `${r.url} lacks ${word}`).toBe(true);
    // standard is also the default, so this echo alone does not show the option took effect; dynamic does above
    expect(res.meta?.result_type).toBe('standard');
  });

  it('exclude_text, exclude_domains, highlight max_tokens and include_images each take effect', async () => {
    const before = (await control()).data?.results ?? [];
    expect(before.some((r) => r.images !== undefined || r.cover_image !== undefined)).toBe(false);
    // A word on exactly one host, and a different host whose result lacks it, so each exclusion is shown on its own
    const texts = before.map((r) => ({ host: hostOf(r.url), words: wordsOf(r, query) }));
    let pick: { word: string; wordHost: string; dropHost: string } | undefined;
    for (const word of [...new Set(texts.flatMap((t) => [...t.words]))].sort()) {
      const having = texts.filter((t) => t.words.has(word));
      const wordHost = having[0]?.host;
      if (having.length !== 1 || wordHost === undefined) continue;
      const drop = texts.find((t) => t.host !== undefined && t.host !== wordHost && !t.words.has(word));
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
      'searchPremier exclude_text+exclude_domains+highlight cap',
      await c.search.searchPremier({
        query,
        count: 5,
        exclude_text: [word],
        exclude_domains: [dropHost],
        include_images: true,
        highlight: { enable: true, max_tokens: 100 },
        full_content: fullContent,
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
    expectShorter('highlight', after, before, 'searchPremier highlight');
    expect(after.some((r) => (r.images?.length ?? 0) > 0 || r.cover_image?.url !== undefined), 'images').toBe(true);
    expect(bodies[0]?.format).toBe('markdown');
    expect(bodies[0]?.safesearch).toBe('off');
  });

  it('time_range month with time_basis published: every result is dated within the month', async () => {
    const start = Date.now() - 32 * DAY_MS;
    const end = Date.now() + DAY_MS;
    expectSomeOutside((await control()).data?.results ?? [], start, end, 'searchPremier month');
    const res = logged(
      'searchPremier time_range=month',
      await client().search.searchPremier({ query, count: 5, time_range: 'month', time_basis: 'published' }),
    );
    expectAllWithin(res.data?.results ?? [], start, end, 'searchPremier month');
  });

  it('start_time/end_time (2025) bound time_published; language de returns German results', async () => {
    const start = Date.parse(YEAR_2025.start);
    const end = Date.parse(YEAR_2025.end);
    expectSomeOutside((await control()).data?.results ?? [], start, end, 'searchPremier 2025');
    const res = logged(
      'searchPremier start/end+language=de',
      await client().search.searchPremier({
        query,
        count: 3,
        language: ['de'],
        time_basis: 'published',
        start_time: YEAR_2025.start,
        end_time: YEAR_2025.end,
      }),
    );
    const results = res.data?.results ?? [];
    expectAllWithin(results, start, end, 'searchPremier 2025');
    expectMostlyGerman(results, 'searchPremier language=de');
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
  // Probe on 2026-11-21: every unfiltered result was published between 2020 and 2024
  const control = once(async () =>
    logged('videoSearch control', await client().videoSearch.search({ inputs, count: 5 })),
  );

  it('time_range year: every result is dated within the year, while the unfiltered control is older', async () => {
    const start = Date.now() - 367 * DAY_MS;
    const end = Date.now() + DAY_MS;
    const { c, bodies } = capturing();
    const res = logged(
      'videoSearch time_range=year',
      await c.videoSearch.search({ inputs, count: 2, time_range: 'year', safesearch: 'off' }),
    );
    const results = res.data?.results ?? [];
    expect(results.length).toBeLessThanOrEqual(2);
    for (const r of results) expect(r.url).toMatch(/^https?:\/\//);
    expectAllWithin(results, start, end, 'videoSearch year');
    // Accepted, effect not observable on a benign query: shown only to reach the wire
    expect(bodies[0]?.safesearch).toBe('off');
    expectSomeOutside((await control()).data?.results ?? [], start, end, 'videoSearch year');
  });

  it('start_time and end_time bound time_published, while the unfiltered control is outside', async () => {
    const start = '2025-01-01T00:00:00Z';
    const end = '2025-06-30T23:59:59Z';
    const res = logged(
      'videoSearch start/end',
      await client().videoSearch.search({ inputs, count: 3, start_time: start, end_time: end }),
    );
    expectAllWithin(res.data?.results ?? [], Date.parse(start), Date.parse(end), 'videoSearch start/end');
    expectSomeOutside((await control()).data?.results ?? [], Date.parse(start), Date.parse(end), 'videoSearch start/end');
  });
});

describe.skipIf(!enabled)('live: Design Search', () => {
  // Probe on 2026-11-21: web_section images with snippets in groups of 6 to 18, web results dated in 2026.
  // The control uses the server defaults (5 images, 5 web results) so the caps below have something to cut.
  const query = 'SaaS landing page hero section';
  const control = once(async () =>
    logged(
      'designSearch control',
      await client().designSearch.search({ query, web_search: { full_content: { enable: true, max_tokens: 2000 } } }),
    ),
  );
  const webHosts = async () =>
    distinctHosts((await control()).data?.results?.map((r) => r.url) ?? [], 'designSearch control web');

  it('a group_id lookup returns the first two of a group of three or more, in order', async () => {
    const images = (await control()).data?.images ?? [];
    const grouped = images.find((i) => (i.group?.total ?? 0) >= 3);
    expect(grouped, 'an image in a group of at least three').toBeDefined();
    const groupId = grouped?.group?.group_id as string;
    const res = logged(
      'designSearch group_id lookup',
      await client().designSearch.search({ images: { group_id: groupId, count: 2 }, web_search: { enable: false } }),
    );
    const members = res.data?.images ?? [];
    expect(members.map((i) => i.group?.position)).toEqual([1, 2]);
    for (const i of members) expect(i.group?.group_id).toBe(groupId);
    expect(res.data?.results ?? [], 'web_search.enable false').toEqual([]);
  });

  it('web include_domains keeps one host of the control; images.enable false returns no images', async () => {
    const keep = (await webHosts())[1] as string;
    const res = logged(
      'designSearch web include_domains',
      await client().designSearch.search({ query, images: { enable: false }, web_search: { include_domains: [keep] } }),
    );
    expect(res.data?.images ?? []).toEqual([]);
    const results = res.data?.results ?? [];
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) expect(onDomain(r.url, keep), r.url).toBe(true);
  });

  it('counts, design_facts/snippet off, exclude_domains, highlight/full_content max_tokens take effect', async () => {
    const control_ = await control();
    const images0 = control_.data?.images ?? [];
    const web0 = control_.data?.results ?? [];
    // Preconditions on the control: more than the caps below, and the fields that are turned off
    expect(images0.length, 'control images').toBeGreaterThan(3);
    expect(web0.length, 'control web results').toBeGreaterThan(4);
    console.log(`[live-family] designSearch control snippet=${images0.filter((i) => i.snippet).length}/${images0.length}`);
    expect(images0.filter((i) => i.snippet !== undefined).length).toBeGreaterThanOrEqual(2);
    expect(images0.filter((i) => i.design_facts !== undefined).length).toBeGreaterThanOrEqual(2);
    const drop = (await webHosts())[0] as string;

    const res = logged(
      'designSearch caps+off+exclude_domains',
      await client().designSearch.search({
        query,
        images: { count: 3, design_facts: false, snippet: { enable: false } },
        web_search: {
          count: 4,
          exclude_domains: [drop],
          highlight: { enable: true, max_tokens: 100 },
          full_content: { enable: true, max_tokens: 100 },
        },
      }),
    );
    const images = res.data?.images ?? [];
    expect(images.length).toBeGreaterThanOrEqual(1);
    expect(images.length).toBeLessThanOrEqual(3);
    for (const i of images) {
      expect(i.design_facts, i.url).toBeUndefined();
      expect(i.snippet, i.url).toBeUndefined();
    }
    const results = res.data?.results ?? [];
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.length).toBeLessThanOrEqual(4);
    for (const r of results) expect(onDomain(r.url, drop), r.url).toBe(false);
    expectShorter('highlight', results, web0, 'designSearch highlight');
    expectShorter('full_content', results, web0, 'designSearch full_content');
  });

  it('web start_time/end_time (2025) bound time_published; language de returns German results', async () => {
    const start = Date.parse(YEAR_2025.start);
    const end = Date.parse(YEAR_2025.end);
    expectSomeOutside((await control()).data?.results ?? [], start, end, 'designSearch 2025');
    const res = logged(
      'designSearch web start/end+language=de',
      await client().designSearch.search({
        query,
        images: { enable: false },
        web_search: {
          count: 3,
          language: ['de'],
          time_basis: 'published',
          start_time: YEAR_2025.start,
          end_time: YEAR_2025.end,
        },
      }),
    );
    const results = res.data?.results ?? [];
    expectAllWithin(results, start, end, 'designSearch 2025');
    expectMostlyGerman(results, 'designSearch web language=de');
  });

  // A seasonal query has fresh pages this month and older ones from past years
  it('web time_range month with time_basis published: every result is dated within the month', async () => {
    const fresh = 'Black Friday landing page';
    const start = Date.now() - 32 * DAY_MS;
    const end = Date.now() + DAY_MS;
    const freshControl = logged(
      'designSearch month control',
      await client().designSearch.search({ query: fresh, images: { enable: false } }),
    );
    expectSomeOutside(freshControl.data?.results ?? [], start, end, 'designSearch month');
    const res = logged(
      'designSearch web time_range=month',
      await client().designSearch.search({
        query: fresh,
        images: { enable: false },
        web_search: { time_range: 'month', time_basis: 'published' },
      }),
    );
    expectAllWithin(res.data?.results ?? [], start, end, 'designSearch month');
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
