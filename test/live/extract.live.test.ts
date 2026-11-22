import { describe, expect, it, vi } from 'vitest';
import Octen, { OctenBadRequestError, OctenValidationError, type ExtractParams, type ExtractResponse } from '../../src/index';

// Extract against production https://api.octen.ai (billed per successful URL; about 10 URLs per full run).
// Runs with OCTEN_LIVE=1 and OCTEN_API_KEY. Each option is checked against a control on the same URL, and every
// control asserts the property the option must change, so a control that cannot fail the check fails itself.
const apiKey = process.env.OCTEN_API_KEY ?? '';
const enabled = process.env.OCTEN_LIVE === '1' && apiKey !== '';
const client = () => (enabled ? new Octen({ apiKey }) : (undefined as never as Octen));

// A: a long article with markdown structure and many links. B: a page with images and a cover image.
// C: only the max_age_seconds test fetches it, so its cache age comes from earlier runs, not from this file.
const A = 'https://en.wikipedia.org/wiki/Web_scraping';
const B = 'https://octen.ai/';
const C = 'https://www.iana.org/help/example-domains';
const BROKEN = 'https://octen-sdk-live-check.invalid/';
const SLOW = 180_000;

type Item = NonNullable<NonNullable<ExtractResponse['data']>['results']>[number];

// Calls a control once and shares it between the tests that compare against it
function once<T>(run: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => (pending ??= run());
}

// Logs the billing line, checks that usage agrees with the items, and returns the items keyed by URL
async function call(name: string, params: ExtractParams): Promise<Map<string, Item>> {
  const res = await client().extract.extract(params);
  const items = res.data?.results ?? [];
  const usage = res.meta?.usage;
  console.log(`[live-extract] ${name} request_id=${res.request_id} usage=${JSON.stringify(usage)}`);
  const ok = items.filter((r) => r.status === 'success');
  expect(items.map((r) => r.url).sort(), `${name}: one item per URL`).toEqual([...params.urls].sort());
  expect(usage?.total_urls, `${name}: total_urls`).toBe(params.urls.length);
  expect(usage?.successful_urls, `${name}: successful_urls`).toBe(ok.length);
  expect(usage?.successful_by_mode?.standard_urls, `${name}: standard_urls`).toBe(
    ok.filter((r) => r.resolved_mode === 'standard').length,
  );
  expect(usage?.successful_by_mode?.advanced_urls, `${name}: advanced_urls`).toBe(
    ok.filter((r) => r.resolved_mode === 'advanced').length,
  );
  return new Map(items.map((r) => [r.url as string, r]));
}

function success(items: Map<string, Item>, url: string, name: string): Item {
  const item = items.get(url);
  expect(item?.status, `${name}: ${url} status (error_message=${item?.error_message})`).toBe('success');
  return item as Item;
}

const content = (r: Item) => r.full_content ?? '';
const markdownLink = /\]\(https?:\/\//;
const markdownHeading = /^#{1,6} /m;

// The no-option batch: A and B as plain standard-mode controls, plus a URL that cannot resolve
const plain = once(() => call('plain batch', { urls: [A, BROKEN, B] }));

describe.skipIf(!enabled)('live: Extract', () => {
  it('extracts real URLs and reports a failing URL per item while the others succeed', { timeout: SLOW }, async () => {
    const items = await plain();
    for (const url of [A, B]) {
      const r = success(items, url, 'plain');
      expect(content(r).length, `${url} full_content`).toBeGreaterThan(200);
      expect(r.resolved_mode, `${url} resolved_mode`).toBe('standard');
      expect(r.error_message, `${url} error_message`).toBeUndefined();
    }
    const broken = items.get(BROKEN);
    console.log(`[live-extract] broken item ${JSON.stringify(broken)}`);
    expect(broken?.status).toBe('failed');
    expect(typeof broken?.error_message === 'string' && broken.error_message !== '').toBe(true);
    expect(broken?.full_content ?? undefined).toBeUndefined();
  });

  it('query returns highlights instead of the full content on the same URL', { timeout: SLOW }, async () => {
    const control = success(await plain(), A, 'control');
    expect(control.highlights ?? null, 'control: no highlights without a query').toBeNull();
    expect(content(control).length).toBeGreaterThan(200);
    const r = success(await call('query', { urls: [A], query: 'legal issues and court cases' }), A, 'query');
    console.log(`[live-extract] highlights=${JSON.stringify(r.highlights?.map((h) => h.slice(0, 80)))}`);
    expect(Array.isArray(r.highlights) && r.highlights.length > 0, 'highlights with a query').toBe(true);
    expect(r.full_content ?? null, 'no full_content with a query').toBeNull();
  });

  it('mode advanced resolves to advanced, where the standard control resolved to standard', { timeout: SLOW }, async () => {
    expect(success(await plain(), A, 'control').resolved_mode).toBe('standard');
    const r = success(await call('advanced', { urls: [A], mode: 'advanced' }), A, 'advanced');
    // Octen documents that an advanced request may resolve to standard; kept strict so a dropped mode is caught
    expect(r.resolved_mode).toBe('advanced');
  });

  it('format text returns no markdown syntax, where the markdown control has it', { timeout: SLOW }, async () => {
    const control = content(success(await plain(), A, 'control'));
    expect(markdownLink.test(control) || markdownHeading.test(control), 'control has markdown').toBe(true);
    const text = content(success(await call('text', { urls: [A], format: 'text' }), A, 'text'));
    console.log(`[live-extract] text head=${JSON.stringify(text.slice(0, 160))}`);
    expect(text.length).toBeGreaterThan(200);
    expect(markdownLink.test(text), 'text has no markdown links').toBe(false);
    expect(markdownHeading.test(text), 'text has no markdown headings').toBe(false);
  });

  it('include_links max_links 3 returns exactly 3 links; {} returns more; omitted returns none', { timeout: SLOW }, async () => {
    const omitted = success(await plain(), A, 'control');
    expect(omitted.links ?? [], 'no links when include_links is omitted').toEqual([]);
    const defaults = success(await call('links {}', { urls: [A], include_links: {} }), A, 'links {}');
    expect(defaults.links?.length ?? 0, 'the {} control returns more than 3 links').toBeGreaterThan(3);
    const capped = success(await call('links 3', { urls: [A], include_links: { max_links: 3 } }), A, 'links 3');
    console.log(`[live-extract] links {}=${defaults.links?.length} capped=${JSON.stringify(capped.links)}`);
    expect(capped.links).toHaveLength(3);
    for (const l of capped.links ?? []) {
      expect(typeof l.url === 'string' && l.url !== '').toBe(true);
      expect(typeof l.is_external).toBe('boolean');
    }
  });

  it('include_images returns images and a cover image, where the control has neither', { timeout: SLOW }, async () => {
    const control = success(await plain(), B, 'control');
    expect(control.images ?? [], 'control: no images').toEqual([]);
    expect(control.cover_image ?? null, 'control: no cover_image').toBeNull();
    const r = success(await call('images', { urls: [B], include_images: true }), B, 'images');
    console.log(`[live-extract] images=${r.images?.length} cover=${JSON.stringify(r.cover_image)}`);
    expect(r.images?.length ?? 0).toBeGreaterThan(0);
    expect(r.images?.every((i) => typeof i.url === 'string' && i.url !== '')).toBe(true);
    expect(typeof r.cover_image?.url === 'string' && r.cover_image.url !== '').toBe(true);
  });

  it('max_age_seconds 300 re-fetches a cached copy older than 5 minutes', { timeout: SLOW }, async (ctx) => {
    const MARGIN_MS = 60_000;
    const control = success(await call('max-age control', { urls: [C] }), C, 'max-age control');
    const cachedAt = Date.parse(control.time_last_crawled ?? '');
    const age = Date.now() - cachedAt;
    console.log(`[live-extract] max-age control time_last_crawled=${control.time_last_crawled} age_ms=${age}`);
    expect(Number.isFinite(cachedAt), 'control time_last_crawled').toBe(true);
    if (age <= 300_000 + MARGIN_MS) {
      console.log('[live-extract] max-age: inconclusive, the default-cache copy is not older than 300 s + margin');
      ctx.skip();
    }
    const started = Date.now();
    const r = success(await call('max-age 300', { urls: [C], max_age_seconds: 300 }), C, 'max-age 300');
    const crawledAt = Date.parse(r.time_last_crawled ?? '');
    console.log(`[live-extract] max-age 300 time_last_crawled=${r.time_last_crawled}`);
    expect(crawledAt, 'within the 300 s window').toBeGreaterThanOrEqual(started - 300_000);
    expect(crawledAt, 'newer than the control copy').toBeGreaterThan(cachedAt);
  });

  describe('rejected before sending (nothing is billed)', () => {
    function counting(): { c: Octen; fetchImpl: ReturnType<typeof vi.fn> } {
      const fetchImpl = vi.fn((input: string | URL | Request, init?: RequestInit) => globalThis.fetch(input, init));
      return { c: new Octen({ apiKey, fetch: fetchImpl as unknown as typeof fetch }), fetchImpl };
    }
    it.each([
      ['21 URLs', 'urls', { urls: Array.from({ length: 21 }, (_, i) => `${BROKEN}${i}`) }],
      ['an empty list', 'urls', { urls: [] }],
      ['a URL of 2049 characters', 'urls[0]', { urls: [`${BROKEN}${'a'.repeat(2049 - BROKEN.length)}`] }],
      ['a blank URL', 'urls[1]', { urls: [BROKEN, '  '] }],
      ['an unknown key', 'include_links.max_link', { urls: [BROKEN], include_links: { max_link: 3 } }],
    ])('%s -> OctenValidationError(%s), 0 requests', async (_name, field, params) => {
      const { c, fetchImpl } = counting();
      const err = await c.extract.extract(params as ExtractParams).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(OctenValidationError);
      expect((err as OctenValidationError).field).toBe(field);
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  // Ranges outside urls are the server's to check; a URL that cannot resolve keeps these unbilled even if accepted
  describe('server-side bounds (a 400, never a 5xx)', () => {
    it.each([
      ['include_links.max_links 0', { urls: [BROKEN], include_links: { max_links: 0 } }],
      ['include_links.max_links 1001', { urls: [BROKEN], include_links: { max_links: 1001 } }],
      ['a query of 501 characters', { urls: [BROKEN], query: 'q'.repeat(501) }],
    ])('%s -> OctenBadRequestError', async (name, params) => {
      const err = await client().extract.extract(params as ExtractParams).catch((e: unknown) => e);
      console.log(`[live-extract] ${name}: ${(err as Error).name} ${(err as Error).message}`);
      expect(err).toBeInstanceOf(OctenBadRequestError);
    });
  });
});
