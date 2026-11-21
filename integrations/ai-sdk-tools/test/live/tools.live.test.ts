import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { Octen } from '@octen.ai/sdk';
import { generateText, stepCountIs, streamText } from 'ai';
import { describe, expect, it } from 'vitest';
import {
  octenBroadSearch,
  octenBusinessSearch,
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
const onDomain = (url: unknown, domain: string) => {
  const host = new URL(String(url)).hostname;
  return host === domain || host.endsWith(`.${domain}`);
};

describe('live: web search premier against production', () => {
  // Also the control for the next tests: tool defaults (count 5, no full_content) on the same query.
  it('octenWebSearchPremier execute with the tool defaults', { timeout: TIMEOUT }, async () => {
    const paths: string[] = [];
    const out = await runTool(octenWebSearchPremier({ client: premierClient(paths) }), { query: PREMIER_QUERY, time_range: 'month' });
    expect(paths).toEqual(['/search-premier']);
    const results = out['results'] as Record<string, unknown>[];
    expectNamed(first(out, 'results'), ['url', 'title']);
    expect(results.length).toBeGreaterThan(2);
    expect(results.some((r) => 'full_content' in r)).toBe(false);
    console.log(`premier results ${results.length}, hosts ${results.map((r) => new URL(String(r['url'])).hostname).join(' ')}`);
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
    console.log(`time_range control ${control.length} results, oldest ${new Date(Math.min(...control.map((r) => r.at))).toISOString()}; month ${filtered.length} results`);
  });
});
