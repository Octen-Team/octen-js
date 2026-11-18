import { createOpenAI } from '@ai-sdk/openai';
import { generateText, stepCountIs, streamText } from 'ai';
import { describe, expect, it } from 'vitest';
import {
  octenBroadSearch,
  octenBusinessSearch,
  octenNewsSearch,
  octenPlaceSearch,
  octenPulseSearch,
  octenWebSearch,
} from '../../src/index.js';

// Billed calls against production. Skipped unless OCTEN_API_KEY is set.
const apiKey = process.env['OCTEN_API_KEY'];
const live = apiKey ? describe : describe.skip;
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

// A chat model served by Octen's gateway (not OpenAI's own endpoint); .chat because the Responses path is not served.
function gatewayModel() {
  return createOpenAI({ baseURL: 'https://api.octen.ai/v1', apiKey: apiKey ?? '' }).chat(MODEL_ID);
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
  console.log(`model run: ${steps.length} step(s), ${calls.length} tool call(s), model ${MODEL_ID}`);
}

live('live: tools against production', () => {
  it('octenWebSearch execute', { timeout: TIMEOUT }, async () => {
    const out = await runTool(octenWebSearch(), { query: 'solid-state battery breakthroughs', time_range: 'month' });
    expect(count(out['results'])).toBeGreaterThan(0);
    console.log(`web results ${count(out['results'])}`);
  });

  it('octenBroadSearch execute', { timeout: TIMEOUT }, async () => {
    const out = await runTool(octenBroadSearch(), { query: 'compare cloud GPU pricing across providers' });
    const groups = out['search_results'] as { results?: unknown[] }[];
    expect(groups.reduce((n, g) => n + count(g.results), 0)).toBeGreaterThan(0);
    console.log(`broad queries ${count(out['queries'])}, groups ${count(groups)}`);
  });

  it('octenNewsSearch execute', { timeout: TIMEOUT }, async () => {
    const out = await runTool(octenNewsSearch(), { query: 'EU AI Act enforcement', time_range: 'week' });
    expect(count(out['results'])).toBeGreaterThan(0);
    console.log(`news results ${count(out['results'])}, subjects ${count(out['subjects'])}`);
  });

  it('octenBusinessSearch execute', { timeout: TIMEOUT }, async () => {
    const out = await runTool(octenBusinessSearch({ defaults: { entities: { count: 2 } } }), {
      query: 'compare Stripe and Adyen',
    });
    expect(count(out['entities']) + count(out['results'])).toBeGreaterThan(0);
    console.log(`business entities ${count(out['entities'])}, results ${count(out['results'])}`);
  });

  it('octenPlaceSearch execute', { timeout: TIMEOUT }, async () => {
    const out = await runTool(octenPlaceSearch({ defaults: { latitude: 35.6812, longitude: 139.7671, radius: 1000 } }), {
      query: 'coffee shops',
    });
    expect(count(out['places'])).toBeGreaterThan(0);
    console.log(`places ${count(out['places'])}`);
  });

  it('octenPulseSearch execute', { timeout: TIMEOUT }, async () => {
    const out = await runTool(octenPulseSearch(), { query: 'github docs' });
    expect(count(out['results'])).toBeGreaterThan(0);
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

  it('streamText calls octenWebSearch through the gateway model', { timeout: TIMEOUT }, async () => {
    const result = streamText({
      model: gatewayModel(),
      tools: { webSearch: octenWebSearch() },
      stopWhen: stepCountIs(3),
      prompt: PROMPT,
    });
    const text = await result.text;
    checkSteps((await result.steps) as unknown as StepLike[], text);
  });
});
