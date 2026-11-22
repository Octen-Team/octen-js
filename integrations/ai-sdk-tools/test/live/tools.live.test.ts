import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { Octen, OctenValidationError } from '@octen.ai/sdk';
import { generateText, stepCountIs, streamText } from 'ai';
import { describe, expect, it } from 'vitest';
import type {
  DesignSearchToolResult,
  ExtractToolResult,
  ImageSearchToolResult,
  ModelDesignImage,
  ModelExtractResult,
  OctenExtractOptions,
} from '../../src/index.js';
import {
  octenBroadSearch,
  octenBusinessSearch,
  octenDesignSearch,
  octenExtract,
  octenImageSearch,
  octenNewsSearch,
  octenPlaceSearch,
  octenPulseSearch,
  octenWebSearch,
  octenWebSearchPremier,
} from '../../src/index.js';

// Billed calls against production; test/live/setup.ts fails the run when OCTEN_API_KEY is unset.
const apiKey = process.env['OCTEN_API_KEY'];
const TIMEOUT = 60_000;

// Inputs are the ones recorded in test/fixtures/README.md.
const PROMPT =
  'Use the web search tool to find one recent news headline about solid-state batteries, then answer in one sentence.';
const MODEL_ID = process.env['OCTEN_LIVE_MODEL'] ?? 'openai/gpt-5.4';

type Out = { request_id: string } & Record<string, unknown>;

async function runTool(t: { execute?: unknown }, input: unknown): Promise<Out> {
  const execute = t.execute as (input: unknown, options: unknown) => Promise<Out>;
  const out = await execute(input, { toolCallId: 'live-1', messages: [], context: undefined });
  console.log(`request_id ${out.request_id}`);
  expect(out.request_id).toBeTruthy();
  return out;
}

const count = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

// A trimmed item must still identify something, so an all-empty item cannot pass as a result.
function first(out: Out, key: string): Record<string, unknown> {
  const list = out[key];
  expect(Array.isArray(list) && list.length > 0, `${key} is a non-empty list`).toBe(true);
  return (list as Record<string, unknown>[])[0]!;
}

function expectNamed(item: Record<string, unknown>, keys: string[]) {
  const named = keys.filter((k) => typeof item[k] === 'string' && item[k] !== '');
  expect(named.length, `one of ${keys.join(', ')} is a non-empty string`).toBeGreaterThan(0);
}

// A chat model served by Octen's gateway (not OpenAI's own endpoint); .chat because the Responses path is not served.
function gatewayModel() {
  return createOpenAI({ baseURL: 'https://api.octen.ai/v1', apiKey: apiKey ?? '' }).chat(MODEL_ID);
}

const STREAM_MODEL_ID = 'anthropic/claude-sonnet-5.5';

function messagesModel() {
  return createAnthropic({ baseURL: 'https://api.octen.ai/v1', apiKey: apiKey ?? '' })(STREAM_MODEL_ID);
}

type StepLike = { toolCalls: unknown[]; toolResults: { toolName: string; output: unknown }[] };

function checkSteps(steps: StepLike[], text: string) {
  const calls = steps.flatMap((s) => s.toolCalls);
  expect(calls.length).toBeGreaterThan(0);
  const results = steps.flatMap((s) => s.toolResults);
  expect(results.length).toBeGreaterThan(0);
  for (const r of results) {
    const id = (r.output as { request_id?: string }).request_id;
    console.log(`request_id ${id} (model run, tool ${r.toolName})`);
    expect(id).toBeTruthy();
  }
  expect(text.trim().length).toBeGreaterThan(0);
  console.log(`model run: ${steps.length} step(s), ${calls.length} tool call(s)`);
}

describe('live: tools against production', () => {
  it('octenWebSearch execute', { timeout: TIMEOUT }, async () => {
    const out = await runTool(octenWebSearch(), { query: 'solid-state battery breakthroughs', time_range: 'month' });
    expectNamed(first(out, 'results'), ['url', 'title']);
    console.log(`web results ${count(out['results'])}`);
  });

  it('octenBroadSearch execute', { timeout: TIMEOUT }, async () => {
    const out = await runTool(octenBroadSearch(), { query: 'compare cloud GPU pricing across providers' });
    const groups = out['search_results'] as { results?: unknown[] }[];
    expect(groups.reduce((n, g) => n + count(g.results), 0)).toBeGreaterThan(0);
    const group = groups.find((g) => count(g.results) > 0)!;
    expectNamed((group.results as Record<string, unknown>[])[0]!, ['url', 'title']);
    console.log(`broad queries ${count(out['queries'])}, groups ${count(groups)}`);
  });

  it('octenNewsSearch execute', { timeout: TIMEOUT }, async () => {
    const out = await runTool(octenNewsSearch(), { query: 'EU AI Act enforcement', time_range: 'week' });
    expectNamed(first(out, 'results'), ['url', 'title']);
    console.log(`news results ${count(out['results'])}, subjects ${count(out['subjects'])}`);
  });

  it('octenBusinessSearch execute', { timeout: TIMEOUT }, async () => {
    const out = await runTool(octenBusinessSearch({ defaults: { entities: { count: 2 } } }), {
      query: 'compare Stripe and Adyen',
    });
    const entity = first(out, 'entities');
    expectNamed(entity, ['type']);
    expectNamed(entity, ['name']);
    console.log(`business entities ${count(out['entities'])}, results ${count(out['results'])}`);
  });

  it('octenPlaceSearch execute', { timeout: TIMEOUT }, async () => {
    const out = await runTool(octenPlaceSearch({ defaults: { latitude: 35.6812, longitude: 139.7671, radius: 1000 } }), {
      query: 'coffee shops',
    });
    expectNamed(first(out, 'places'), ['name']);
    console.log(`places ${count(out['places'])}`);
  });

  it('octenPulseSearch execute', { timeout: TIMEOUT }, async () => {
    const out = await runTool(octenPulseSearch(), { query: 'github docs' });
    expectNamed(first(out, 'results'), ['url', 'title']);
    console.log(`pulse results ${count(out['results'])}`);
  });

  it('generateText calls octenWebSearch through the gateway model', { timeout: TIMEOUT }, async () => {
    const result = await generateText({
      model: gatewayModel(),
      tools: { webSearch: octenWebSearch() },
      stopWhen: stepCountIs(3),
      prompt: PROMPT,
    });
    checkSteps(result.steps as unknown as StepLike[], result.text);
  });

  // Uses the messages endpoint: the chat-completions stream currently ends with a usage chunk
  // that @ai-sdk/openai rejects.
  it('streamText calls octenWebSearch through the gateway messages endpoint', { timeout: TIMEOUT }, async () => {
    const result = streamText({
      model: messagesModel(),
      tools: { webSearch: octenWebSearch() },
      stopWhen: stepCountIs(3),
      prompt: PROMPT,
    });
    const text = await result.text;
    checkSteps((await result.steps) as unknown as StepLike[], text);
  });
});

// Records each request path, so a green run proves the call went to /search-premier and not /search.
function premierClient(paths: string[]): Octen {
  const fetchAndRecord: typeof fetch = async (input, init) => {
    paths.push(new URL(String(input instanceof Request ? input.url : input)).pathname);
    return await fetch(input, init);
  };
  return new Octen({ apiKey, fetch: fetchAndRecord });
}

const PREMIER_QUERY = 'solid-state battery breakthroughs';
// Diagnostics only: a missing or malformed URL is skipped instead of throwing.
const hostOf = (url: unknown): string | undefined => {
  try {
    return new URL(String(url)).hostname;
  } catch {
    return undefined;
  }
};
const onDomain = (url: unknown, domain: string) => {
  const host = new URL(String(url)).hostname;
  return host === domain || host.endsWith(`.${domain}`);
};

describe('live: web search premier against production', () => {
  // Also the control for the next tests: tool defaults (count 5, no full_content) on the same query.
  it('octenWebSearchPremier execute with the tool defaults', { timeout: TIMEOUT }, async () => {
    const paths: string[] = [];
    const out = await runTool(octenWebSearchPremier({ client: premierClient(paths) }), { query: PREMIER_QUERY, time_range: 'month' });
    // The SDK may retry a transient failure, so every attempt is checked, not just one.
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => p === '/search-premier'), paths.join(' ')).toBe(true);
    const results = out['results'] as Record<string, unknown>[];
    expectNamed(first(out, 'results'), ['url', 'title']);
    expect(results.length).toBeGreaterThan(2);
    expect(results.some((r) => 'full_content' in r)).toBe(false);
    console.log(`premier results ${results.length}, hosts ${results.map((r) => hostOf(r['url'])).filter((h) => h !== undefined).join(' ')}`);
  });

  it('octenWebSearchPremier honors include_domains against an unfiltered control', { timeout: TIMEOUT }, async () => {
    const domain = 'nature.com';
    const control = await runTool(octenWebSearchPremier({ client: premierClient([]) }), { query: PREMIER_QUERY });
    const controlUrls = (control['results'] as Record<string, unknown>[]).map((r) => r['url']);
    expect(controlUrls.some((u) => !onDomain(u, domain)), 'the control has a result outside the domain').toBe(true);
    const filtered = await runTool(octenWebSearchPremier({ client: premierClient([]), defaults: { include_domains: [domain] } }), {
      query: PREMIER_QUERY,
    });
    const urls = (filtered['results'] as Record<string, unknown>[]).map((r) => r['url']);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => onDomain(u, domain)), urls.join(' ')).toBe(true);
    console.log(`control ${controlUrls.length} results, filtered ${urls.length} results on ${domain}`);
  });

  it('octenWebSearchPremier honors developer count and full_content', { timeout: TIMEOUT }, async () => {
    const t = octenWebSearchPremier({
      client: premierClient([]),
      defaults: { count: 2, full_content: { enable: true, max_tokens: 200 } },
    });
    const out = await runTool(t, { query: PREMIER_QUERY, time_range: 'month' });
    const results = out['results'] as Record<string, unknown>[];
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(2);
    expect(results.some((r) => typeof r['full_content'] === 'string' && r['full_content'] !== '')).toBe(true);
    console.log(`premier count=2 results ${results.length}, with full_content ${results.filter((r) => 'full_content' in r).length}`);
  });

  // time_basis is pinned to published in both calls, so every kept result must carry time_published.
  it('octenWebSearchPremier filters by the model time_range against an unfiltered control', { timeout: TIMEOUT }, async () => {
    const query = 'history of the lithium-ion battery';
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const published = (out: Out) =>
      (out['results'] as Record<string, unknown>[]).map((r) => ({ url: r['url'], at: Date.parse(String(r['time_published'] ?? '')) }));
    const make = () => octenWebSearchPremier({ client: premierClient([]), defaults: { time_basis: 'published' } });
    const control = published(await runTool(make(), { query }));
    // Clearly older than a month, so a pass below cannot come from the control already being recent.
    expect(control.some((r) => r.at < now - 32 * day), JSON.stringify(control)).toBe(true);
    const filtered = published(await runTool(make(), { query, time_range: 'month' }));
    expect(filtered.length).toBeGreaterThan(0);
    // An undated result parses to NaN and fails this check; one day of slack covers the window's time zone.
    expect(filtered.every((r) => r.at >= now - 32 * day && r.at <= now + day), JSON.stringify(filtered)).toBe(true);
    const dated = control.map((r) => r.at).filter((at) => Number.isFinite(at));
    const oldest = dated.length > 0 ? new Date(Math.min(...dated)).toISOString() : 'none dated';
    console.log(`time_range control ${control.length} results, oldest ${oldest}; month ${filtered.length} results`);
  });
});

// Extract: about 10 billed URLs per run (failed URLs are not billed); no model is called.
// A: long article with markdown and many links. B: a page with images and a cover image.
// C: fetched only by the max-age test in this repository, so its cache age comes from earlier traffic.
const EXTRACT_A = 'https://en.wikipedia.org/wiki/Web_scraping';
const EXTRACT_B = 'https://octen.ai/';
const EXTRACT_C = 'https://www.python.org/about/';
const EXTRACT_BROKEN = 'https://octen-tools-live-check.invalid/';
const EXTRACT_TIMEOUT = 180_000;

type Exchange = { body: Record<string, unknown>; reply: Record<string, unknown> };
type RawItem = { url?: string; status?: string; resolved_mode?: string };

// Records each request body and reply, so a check can read fields the tool trims, such as resolved_mode.
function recordingClient(log: Exchange[]): Octen {
  const fetchAndRecord: typeof fetch = async (input, init) => {
    const res = await fetch(input, init);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    log.push({ body, reply: (await res.clone().json()) as Record<string, unknown> });
    return res;
  };
  return new Octen({ apiKey, fetch: fetchAndRecord });
}

// Runs the tool once and returns its items keyed by URL plus the raw items of the last reply.
async function extract(name: string, options: OctenExtractOptions, input: { urls: string[]; query?: string }) {
  const log: Exchange[] = [];
  const out = (await runTool(octenExtract({ ...options, client: recordingClient(log) } as OctenExtractOptions), input)) as ExtractToolResult;
  const last = log.at(-1)!;
  const raw = ((last.reply['data'] as { results?: RawItem[] } | undefined)?.results ?? []) as RawItem[];
  console.log(`[live-extract] ${name} sent=${JSON.stringify({ ...last.body, urls: input.urls.length })} usage=${JSON.stringify((last.reply['meta'] as { usage?: unknown })?.usage)}`);
  expect(out.results.map((r) => r.url).sort(), `${name}: one item per URL`).toEqual([...input.urls].sort());
  return { items: new Map(out.results.map((r) => [r.url!, r])), raw: new Map(raw.map((r) => [r.url!, r])), sent: last.body };
}

function succeeded(items: Map<string, ModelExtractResult>, url: string, name: string): ModelExtractResult {
  const item = items.get(url);
  expect(item?.status, `${name}: ${url} status (error_message=${item?.error_message})`).toBe('success');
  return item!;
}

// Calls a control once and shares it between the tests that compare against it.
function once<T>(run: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => (pending ??= run());
}

const markdownLink = /\]\(https?:\/\//;
const markdownHeading = /^#{1,6} /m;
const plainBatch = once(() => extract('plain batch', {}, { urls: [EXTRACT_A, EXTRACT_BROKEN, EXTRACT_B] }));

describe('live: extract against production', () => {
  it('reads real URLs and reports a failing URL in its own item', { timeout: EXTRACT_TIMEOUT }, async () => {
    const { items, raw, sent } = await plainBatch();
    expect(sent).toEqual({ urls: [EXTRACT_A, EXTRACT_BROKEN, EXTRACT_B] });
    for (const url of [EXTRACT_A, EXTRACT_B]) {
      const r = succeeded(items, url, 'plain');
      expect(r.full_content?.length ?? 0, `${url} full_content`).toBeGreaterThan(200);
      expect(raw.get(url)?.resolved_mode, `${url} resolved_mode`).toBe('standard');
    }
    const broken = items.get(EXTRACT_BROKEN);
    console.log(`[live-extract] broken item ${JSON.stringify(broken)}`);
    expect(broken?.status).toBe('failed');
    expect(broken?.error_message?.length ?? 0).toBeGreaterThan(0);
    expect(broken?.full_content).toBeUndefined();
  });

  it('query returns highlights instead of the full content on the same URL', { timeout: EXTRACT_TIMEOUT }, async () => {
    const control = succeeded((await plainBatch()).items, EXTRACT_A, 'control');
    expect(control.highlights, 'control: no highlights without a query').toBeUndefined();
    expect(control.full_content?.length ?? 0).toBeGreaterThan(200);
    const { items } = await extract('query', {}, { urls: [EXTRACT_A], query: 'legal issues and court cases' });
    const r = succeeded(items, EXTRACT_A, 'query');
    console.log(`[live-extract] highlights=${JSON.stringify(r.highlights?.map((h) => h.slice(0, 80)))}`);
    expect(r.highlights?.length ?? 0, 'highlights with a query').toBeGreaterThan(0);
    expect(r.full_content, 'no full_content with a query').toBeUndefined();
  });

  it('mode advanced resolves to advanced, where the standard control resolved to standard', { timeout: EXTRACT_TIMEOUT }, async () => {
    expect((await plainBatch()).raw.get(EXTRACT_A)?.resolved_mode).toBe('standard');
    const { items, raw } = await extract('advanced', { mode: 'advanced' }, { urls: [EXTRACT_A] });
    succeeded(items, EXTRACT_A, 'advanced');
    // Octen documents that an advanced request may resolve to standard; kept strict so a dropped mode is caught
    expect(raw.get(EXTRACT_A)?.resolved_mode).toBe('advanced');
  });

  it('format text returns no markdown syntax, where the markdown control has it', { timeout: EXTRACT_TIMEOUT }, async () => {
    const control = succeeded((await plainBatch()).items, EXTRACT_A, 'control').full_content ?? '';
    expect(markdownLink.test(control) || markdownHeading.test(control), 'control has markdown').toBe(true);
    const text = succeeded((await extract('text', { format: 'text' }, { urls: [EXTRACT_A] })).items, EXTRACT_A, 'text').full_content ?? '';
    console.log(`[live-extract] text head=${JSON.stringify(text.slice(0, 160))}`);
    expect(text.length).toBeGreaterThan(200);
    expect(markdownLink.test(text), 'text has no markdown links').toBe(false);
    expect(markdownHeading.test(text), 'text has no markdown headings').toBe(false);
  });

  it('includeLinks maxLinks 3 returns exactly 3 links; {} returns more; omitted returns none', { timeout: EXTRACT_TIMEOUT }, async () => {
    expect(succeeded((await plainBatch()).items, EXTRACT_A, 'control').links, 'no links when omitted').toBeUndefined();
    const defaults = succeeded((await extract('links {}', { includeLinks: {} }, { urls: [EXTRACT_A] })).items, EXTRACT_A, 'links {}');
    expect(defaults.links?.length ?? 0, 'the {} control returns more than 3 links').toBeGreaterThan(3);
    const capped = succeeded((await extract('links 3', { includeLinks: { maxLinks: 3 } }, { urls: [EXTRACT_A] })).items, EXTRACT_A, 'links 3');
    console.log(`[live-extract] links {}=${defaults.links?.length} capped=${JSON.stringify(capped.links)}`);
    expect(capped.links).toHaveLength(3);
    for (const l of capped.links ?? []) expect(l.url.length).toBeGreaterThan(0);
  });

  it('includeImages returns images and a cover image, where the control has neither', { timeout: EXTRACT_TIMEOUT }, async () => {
    const control = succeeded((await plainBatch()).items, EXTRACT_B, 'control');
    expect(control.images, 'control: no images').toBeUndefined();
    expect(control.cover_image, 'control: no cover_image').toBeUndefined();
    const r = succeeded((await extract('images', { includeImages: true }, { urls: [EXTRACT_B] })).items, EXTRACT_B, 'images');
    console.log(`[live-extract] images=${r.images?.length} cover=${r.cover_image}`);
    expect(r.images?.length ?? 0).toBeGreaterThan(0);
    expect(r.cover_image?.length ?? 0).toBeGreaterThan(0);
  });

  it('maxAgeSeconds 300 re-fetches a cached copy older than 5 minutes', { timeout: EXTRACT_TIMEOUT }, async (ctx) => {
    const MARGIN_MS = 60_000;
    const control = succeeded((await extract('max-age control', {}, { urls: [EXTRACT_C] })).items, EXTRACT_C, 'max-age control');
    const cachedAt = Date.parse(control.time_last_crawled ?? '');
    const age = Date.now() - cachedAt;
    console.log(`[live-extract] max-age control time_last_crawled=${control.time_last_crawled} age_ms=${age}`);
    expect(Number.isFinite(cachedAt), 'control time_last_crawled').toBe(true);
    if (age <= 300_000 + MARGIN_MS) {
      console.log('[live-extract] max-age: inconclusive, the default-cache copy is not older than 300 s + margin');
      ctx.skip();
    }
    const started = Date.now();
    const r = succeeded((await extract('max-age 300', { maxAgeSeconds: 300 }, { urls: [EXTRACT_C] })).items, EXTRACT_C, 'max-age 300');
    const crawledAt = Date.parse(r.time_last_crawled ?? '');
    console.log(`[live-extract] max-age 300 time_last_crawled=${r.time_last_crawled}`);
    expect(crawledAt, 'within the 300 s window').toBeGreaterThanOrEqual(started - 300_000);
    expect(crawledAt, 'newer than the control copy').toBeGreaterThan(cachedAt);
  });

  it('refuses more URLs than maxUrls without sending a request', async () => {
    const log: Exchange[] = [];
    const t = octenExtract({ client: recordingClient(log), maxUrls: 2 });
    const execute = t.execute as (input: unknown, options: unknown) => Promise<unknown>;
    const err = await execute({ urls: [EXTRACT_BROKEN, EXTRACT_A, EXTRACT_B] }, { toolCallId: 'live-1', messages: [], context: undefined }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as Error).message).toMatch(/got 3, but this tool reads at most 2 per call/);
    expect(log).toHaveLength(0);
  });

  // The URL cannot resolve, so the call is not billed whatever the server would do with the extra fields.
  it('sends none of the developer options a model passes', { timeout: EXTRACT_TIMEOUT }, async () => {
    const input = {
      urls: [EXTRACT_BROKEN],
      mode: 'advanced',
      format: 'text',
      max_age_seconds: 300,
      timeout: 60,
      include_images: true,
      include_links: {},
      maxUrls: 20,
    };
    const { sent, items } = await extract('model options', {}, input as unknown as { urls: string[] });
    expect(sent).toEqual({ urls: [EXTRACT_BROKEN] });
    expect(items.get(EXTRACT_BROKEN)?.status).toBe('failed');
  });
});

// Image Search: 6 billed calls per run; no model is called. Each option is compared with a control on the same query.
const IMAGE_QUERY = 'red vintage sports car';
// A night photo of the Eiffel Tower whose URL names no subject; the Commons file page describes it as
// "Tour Eiffel" in Category:Eiffel Tower illuminated yellow (commons.wikimedia.org/wiki/File:P_20170811_002542.jpg).
const IMAGE_URL = 'https://upload.wikimedia.org/wikipedia/commons/1/1d/P_20170811_002542.jpg';

type Sent = { path: string; body: Record<string, unknown> };

// Records the path and body of every request, so a check can prove what reached the server.
function sentClient(log: Sent[]): Octen {
  const fetchAndRecord: typeof fetch = async (input, init) => {
    log.push({ path: new URL(String(input)).pathname, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
    return await fetch(input, init);
  };
  return new Octen({ apiKey, fetch: fetchAndRecord });
}

const imageControl = once(async () => {
  const log: Sent[] = [];
  // The extra keys are developer-only fields a non-strict model might send; none may reach the request.
  const input = { query: IMAGE_QUERY, count: 10, safesearch: 'off', inputs: [{ type: 'text', data: 'x' }] };
  const out = (await runTool(octenImageSearch({ client: sentClient(log) }), input)) as ImageSearchToolResult;
  return { out, log };
});

const sources = (out: ImageSearchToolResult) => out.results.map((r) => r.source_page);

describe('live: image search against production', () => {
  it('searches by text with the API defaults and sends none of the model extras', { timeout: TIMEOUT }, async () => {
    const { out, log } = await imageControl();
    expect(log.map((l) => l.path)).toEqual(['/image-search']);
    expect(log[0]?.body).toEqual({ inputs: [{ type: 'text', data: IMAGE_QUERY }] });
    expect(out.results.length).toBeGreaterThan(2);
    expect(out.results.length).toBeLessThanOrEqual(5);
    for (const r of out.results) expectNamed(r as Record<string, unknown>, ['url']);
    console.log(`[live-image] control ${out.results.length} results, hosts ${sources(out).map(hostOf).join(' ')}`);
  });

  // Results about the pictured subject show the image was used, not ignored.
  it('searches by image URL and returns results about the pictured subject', { timeout: TIMEOUT }, async () => {
    const log: Sent[] = [];
    const out = (await runTool(octenImageSearch({ client: sentClient(log) }), { image_url: IMAGE_URL, query: null })) as ImageSearchToolResult;
    expect(log[0]?.body).toEqual({ inputs: [{ type: 'image', url: IMAGE_URL }] });
    console.log(`[live-image] by URL ${out.results.length} results, titles ${JSON.stringify(out.results.map((r) => r.title))}`);
    expect(out.results.some((r) => /eiffel/i.test(`${r.title ?? ''} ${r.description ?? ''}`))).toBe(true);
  });

  it('honors the model include_domains and exclude_domains against the unfiltered control', { timeout: TIMEOUT }, async () => {
    const control = sources((await imageControl()).out);
    const domain = 'wikimedia.org';
    expect(control.some((u) => !onDomain(u, domain)), 'the control has a result outside the domain').toBe(true);
    const included = sources((await runTool(octenImageSearch(), { query: IMAGE_QUERY, include_domains: [domain] })) as ImageSearchToolResult);
    expect(included.length).toBeGreaterThan(0);
    expect(included.every((u) => onDomain(u, domain)), included.join(' ')).toBe(true);
    const dropped = hostOf(control[0])!;
    expect(dropped).toBeTruthy();
    const excluded = sources((await runTool(octenImageSearch(), { query: IMAGE_QUERY, exclude_domains: [dropped] })) as ImageSearchToolResult);
    expect(excluded.length).toBeGreaterThan(0);
    expect(excluded.some((u) => onDomain(u, dropped)), excluded.join(' ')).toBe(false);
    console.log(`[live-image] include ${domain}: ${included.length}; exclude ${dropped}: ${excluded.map(hostOf).join(' ')}`);
  });

  it('honors a developer count above the default and sends safesearch', { timeout: TIMEOUT }, async () => {
    const control = (await imageControl()).out.results.length;
    const log: Sent[] = [];
    const out = (await runTool(octenImageSearch({ client: sentClient(log), count: 8, safesearch: 'strict' }), { query: IMAGE_QUERY })) as ImageSearchToolResult;
    expect(log[0]?.body).toEqual({ inputs: [{ type: 'text', data: IMAGE_QUERY }], count: 8, safesearch: 'strict' });
    expect(out.results.length).toBeGreaterThan(control);
    expect(out.results.length).toBeLessThanOrEqual(8);
    console.log(`[live-image] count 8: ${out.results.length} results, control ${control}`);
  });

  it('keeps a developer include_domains when the model sends its own', { timeout: TIMEOUT }, async () => {
    const log: Sent[] = [];
    const t = octenImageSearch({ client: sentClient(log), includeDomains: ['wikimedia.org'] });
    const out = (await runTool(t, { query: IMAGE_QUERY, include_domains: ['example.com'] })) as ImageSearchToolResult;
    expect(log[0]?.body).toEqual({ inputs: [{ type: 'text', data: IMAGE_QUERY }], include_domains: ['wikimedia.org'] });
    expect(out.results.length).toBeGreaterThan(0);
    expect(sources(out).every((u) => onDomain(u, 'wikimedia.org')), sources(out).join(' ')).toBe(true);
  });

  it('sends nothing when the model breaks the one-input rule', async () => {
    const log: Sent[] = [];
    const t = octenImageSearch({ client: sentClient(log) });
    const execute = t.execute as (input: unknown, options: unknown) => Promise<unknown>;
    for (const input of [{ query: IMAGE_QUERY, image_url: IMAGE_URL }, {}, { image_url: 'data:image/png;base64,iVBORw0KGgo=' }]) {
      const err = await execute(input, { toolCallId: 'live-1', messages: [], context: undefined }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(OctenValidationError);
    }
    expect(log).toHaveLength(0);
  });
});

// Design Search: 9 billed calls per run; no model is called.
const DESIGN_QUERY = 'pricing section for a SaaS landing page';

const designControl = once(async () => {
  const log: Sent[] = [];
  const input = { query: DESIGN_QUERY, images: { count: 50 }, web_search: { enable: false }, count: 50 };
  const out = (await runTool(octenDesignSearch({ client: sentClient(log) }), input)) as DesignSearchToolResult;
  return { out, log };
});

const withSnippet = (out: DesignSearchToolResult) => out.images.filter((i) => i.snippet !== undefined);
const urlPath = (url: unknown) => new URL(String(url)).pathname;

// Pairs each control image with the same image in another call; the signed query string differs per call.
function matchByPath(control: ModelDesignImage[], other: ModelDesignImage[]): [ModelDesignImage, ModelDesignImage][] {
  return control.flatMap((c) => {
    const o = other.find((i) => urlPath(i.url) === urlPath(c.url));
    return o === undefined ? [] : [[c, o] as [ModelDesignImage, ModelDesignImage]];
  });
}

describe('live: design search against production', () => {
  it('searches by query with the API defaults and sends none of the model extras', { timeout: TIMEOUT }, async () => {
    const { out, log } = await designControl();
    expect(log.map((l) => l.path)).toEqual(['/design-search']);
    expect(log[0]?.body).toEqual({ query: DESIGN_QUERY });
    expect(out.images.length).toBeGreaterThan(2);
    expect(out.images.length).toBeLessThanOrEqual(5);
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.images.some((i) => i.design_facts !== undefined), 'design_facts on by default').toBe(true);
    expect(out.images.some((i) => i.group?.group_id !== undefined), 'an image with a group').toBe(true);
    console.log(
      `[live-design] control images ${out.images.length} (types ${out.images.map((i) => i.type).join(' ')}, with snippet ${withSnippet(out).length}), web ${out.results.length}`,
    );
  });

  it('returns the images of a group from an earlier result, in group order', { timeout: TIMEOUT }, async () => {
    // A group of at least three images, so the order check covers several concrete positions.
    const seed = (await designControl()).out.images.find((i) => (i.group?.total ?? 0) >= 3);
    const group = seed?.group;
    expect(group?.group_id, 'the control has a group of three or more images').toBeTruthy();
    const log: Sent[] = [];
    // A count above the usual group size, so the returned prefix normally reaches the seed's own position.
    const out = (await runTool(octenDesignSearch({ client: sentClient(log), images: { count: 20 } }), { group_id: group!.group_id })) as DesignSearchToolResult;
    expect(log[0]?.body).toEqual({ images: { count: 20, group_id: group!.group_id } });
    const ids = out.images.map((i) => i.group?.group_id);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    expect(ids.every((id) => id === group!.group_id), JSON.stringify(ids)).toBe(true);
    const positions = out.images.map((i) => i.group?.position);
    const expected = Array.from({ length: Math.min(20, group!.total!) }, (_, i) => i + 1);
    expect(positions).toEqual(expected);
    // The seed image itself must sit at its own position when that position is within the returned prefix.
    const seedChecked = (group!.position ?? Infinity) <= expected.length;
    if (seedChecked) expect(urlPath(out.images[group!.position! - 1]?.url)).toBe(urlPath(seed!.url));
    console.log(`[live-design] seed position ${group!.position}, checked ${seedChecked}`);
    console.log(`[live-design] group ${group!.group_id} total ${group!.total}: positions ${positions.join(',')}, web results ${out.results.length}`);
  });

  it('honors a developer images.count above the default', { timeout: TIMEOUT }, async () => {
    const control = (await designControl()).out.images.length;
    const out = (await runTool(octenDesignSearch({ images: { count: 8 } }), { query: DESIGN_QUERY })) as DesignSearchToolResult;
    expect(out.images.length).toBeGreaterThan(control);
    expect(out.images.length).toBeLessThanOrEqual(8);
    console.log(`[live-design] images.count 8: ${out.images.length}, control ${control}`);
  });

  // Same query and count as the control, which has both on; image URLs are signed, so images match by path.
  it('turns off design facts and snippets, where the control has them', { timeout: TIMEOUT }, async () => {
    const control = (await designControl()).out;
    const out = (await runTool(octenDesignSearch({ images: { designFacts: false, snippet: { enable: false } } }), { query: DESIGN_QUERY })) as DesignSearchToolResult;
    const pairs = matchByPath(control.images, out.images);
    console.log(`[live-design] facts/snippets off: ${pairs.length} of ${control.images.length} control images matched`);
    expect(pairs.some(([c]) => c.snippet !== undefined), 'a matched control image has a snippet').toBe(true);
    expect(pairs.some(([c]) => c.design_facts !== undefined), 'a matched control image has design facts').toBe(true);
    expect(pairs.some(([, o]) => o.snippet !== undefined || o.design_facts !== undefined)).toBe(false);
    expect(withSnippet(out)).toHaveLength(0);
    expect(out.images.some((i) => i.design_facts !== undefined)).toBe(false);
  });

  it('caps snippet code with images.snippet.maxTokens, where the same images are longer in the control', { timeout: TIMEOUT }, async () => {
    const control = (await designControl()).out;
    const out = (await runTool(octenDesignSearch({ images: { snippet: { maxTokens: 100 } } }), { query: DESIGN_QUERY })) as DesignSearchToolResult;
    const pairs = matchByPath(control.images, out.images).filter(([c, o]) => c.snippet !== undefined && o.snippet !== undefined);
    const lengths = pairs.map(([c, o]) => `${c.snippet!.code.length}->${o.snippet!.code.length}`);
    console.log(`[live-design] snippet maxTokens 100, control->capped code lengths: ${lengths.join(' ')}`);
    expect(pairs.length, 'a control image with a snippet comes back with one').toBeGreaterThan(0);
    // A snippet already under the cap comes back whole, so only the longer ones must shrink.
    expect(pairs.every(([c, o]) => o.snippet!.code.length <= c.snippet!.code.length)).toBe(true);
    expect(pairs.some(([c, o]) => o.snippet!.code.length < c.snippet!.code.length)).toBe(true);
  });

  it('turns off web results with webSearch.enable false', { timeout: TIMEOUT }, async () => {
    expect((await designControl()).out.results.length).toBeGreaterThan(0);
    const out = (await runTool(octenDesignSearch({ webSearch: { enable: false } }), { query: DESIGN_QUERY })) as DesignSearchToolResult;
    expect(out.results).toHaveLength(0);
    expect(out.images.length).toBeGreaterThan(0);
  });

  // The control sends only the query, so the two requests differ only in web_search.count.
  it('caps web results with webSearch.count, where the control returns more', { timeout: TIMEOUT }, async () => {
    const control = (await designControl()).out.results;
    const log: Sent[] = [];
    const out = (await runTool(octenDesignSearch({ client: sentClient(log), webSearch: { count: 2 } }), { query: DESIGN_QUERY })) as DesignSearchToolResult;
    expect(log[0]?.body).toEqual({ query: DESIGN_QUERY, web_search: { count: 2 } });
    console.log(`[live-design] web count 2: ${out.results.length}, control ${control.length}`);
    expect(control.length, 'the uncapped control returns more than the cap').toBeGreaterThan(2);
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.results.length).toBeLessThanOrEqual(2);
  });

  it('turns highlights off and full content on, against the control', { timeout: TIMEOUT }, async () => {
    const control = (await designControl()).out.results;
    expect(control.some((r) => r.highlight !== undefined), 'the control has highlights').toBe(true);
    expect(control.some((r) => r.full_content !== undefined), 'the control has no full content').toBe(false);
    const log: Sent[] = [];
    const t = octenDesignSearch({ client: sentClient(log), webSearch: { highlight: { enable: false }, fullContent: { enable: true, maxTokens: 200 } } });
    const out = (await runTool(t, { query: DESIGN_QUERY })) as DesignSearchToolResult;
    expect(log[0]?.body).toEqual({ query: DESIGN_QUERY, web_search: { highlight: { enable: false }, full_content: { enable: true, max_tokens: 200 } } });
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.results.some((r) => r.highlight !== undefined)).toBe(false);
    expect(out.results.some((r) => (r.full_content ?? '') !== '')).toBe(true);
  });

  it('honors webSearch.includeDomains against the unfiltered control', { timeout: TIMEOUT }, async () => {
    const domain = 'dribbble.com';
    const control = (await designControl()).out.results.map((r) => r.url);
    expect(control.some((u) => !onDomain(u, domain)), 'the control has a result outside the domain').toBe(true);
    const out = (await runTool(octenDesignSearch({ webSearch: { includeDomains: [domain] } }), { query: DESIGN_QUERY })) as DesignSearchToolResult;
    const urls = out.results.map((r) => r.url);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => onDomain(u, domain)), urls.join(' ')).toBe(true);
  });

  it('sends nothing when the model gives neither query nor group_id', async () => {
    const log: Sent[] = [];
    const execute = octenDesignSearch({ client: sentClient(log) }).execute as (input: unknown, options: unknown) => Promise<unknown>;
    const err = await execute({ query: ' ', group_id: null }, { toolCallId: 'live-1', messages: [], context: undefined }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OctenValidationError);
    expect(log).toHaveLength(0);
  });
});
