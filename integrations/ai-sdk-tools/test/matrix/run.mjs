// Version-matrix scenarios. Runs inside a temp project that installed the packed tarball,
// @octen.ai/sdk, ai and zod (see scripts/matrix.sh). Usage: node run.mjs <search-fixture.json>
import { readFileSync } from 'node:fs';
import * as ai from 'ai';
import * as aiTest from 'ai/test';
import { Octen, OctenAuthenticationError } from '@octen.ai/sdk';
import { octenWebSearch } from '@octen.ai/ai-sdk-tools';

const fixture = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const installed = (name) =>
  JSON.parse(readFileSync(new URL(`./node_modules/${name}/package.json`, import.meta.url), 'utf8')).version;
const FINAL_TEXT = 'Answer based on the search results.';
const ERROR_REQUEST_ID = 'req-401-matrix';

// The newest MockLanguageModelV* in ai/test is the spec version that release is built around.
const mockName = Object.keys(aiTest)
  .filter((name) => /^MockLanguageModelV\d+$/.test(name))
  .sort((a, b) => Number(b.slice(18)) - Number(a.slice(18)))[0];
const Mock = aiTest[mockName];
const spec = new Mock().specificationVersion;
if (!['v2', 'v3', 'v4'].includes(spec)) throw new Error(`no result format known for ${mockName} (${spec})`);
const stepCount = ai.stepCountIs ?? ai.isStepCount;

// v2 uses a plain finish reason and flat token counts; v3 and v4 nest both.
const finishReason = (reason) => (spec === 'v2' ? reason : { unified: reason, raw: reason });
const usage = () =>
  spec === 'v2'
    ? { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
    : {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 5, text: 5, reasoning: undefined },
      };
const toolCall = { type: 'tool-call', toolCallId: 'call-1', toolName: 'webSearch', input: JSON.stringify({ query: 'x' }) };

function streamOf(parts) {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

// Step 1 calls the tool, every later step answers with text. prompts[i] is what call i received.
function mockModel() {
  const prompts = [];
  const model = new Mock({
    doGenerate: async (options) => {
      prompts.push(options.prompt);
      return prompts.length === 1
        ? { content: [toolCall], finishReason: finishReason('tool-calls'), usage: usage(), warnings: [] }
        : { content: [{ type: 'text', text: FINAL_TEXT }], finishReason: finishReason('stop'), usage: usage(), warnings: [] };
    },
    doStream: async (options) => {
      prompts.push(options.prompt);
      const parts =
        prompts.length === 1
          ? [{ type: 'stream-start', warnings: [] }, toolCall, { type: 'finish', finishReason: finishReason('tool-calls'), usage: usage() }]
          : [
              { type: 'stream-start', warnings: [] },
              { type: 'text-start', id: 't1' },
              { type: 'text-delta', id: 't1', delta: FINAL_TEXT },
              { type: 'text-end', id: 't1' },
              { type: 'finish', finishReason: finishReason('stop'), usage: usage() },
            ];
      return { stream: streamOf(parts) };
    },
  });
  return { model, prompts };
}

function fixtureFetch(status) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(String(url));
    const body = status === 200 ? fixture : { code: 401, msg: 'invalid api key', request_id: ERROR_REQUEST_ID };
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, calls };
}

function setup(status) {
  const { fetch, calls } = fixtureFetch(status);
  const client = new Octen({ apiKey: 'test-key', fetch });
  return { tools: { webSearch: octenWebSearch({ client }) }, calls, ...mockModel() };
}

function toolResultIn(prompt) {
  for (const message of prompt ?? []) {
    if (message.role !== 'tool') continue;
    for (const part of message.content) if (part.type === 'tool-result') return part;
  }
  return undefined;
}

function check(failures, ok, message) {
  if (!ok) failures.push(message);
}

function describeErr(err) {
  const name = err?.constructor?.name ?? typeof err;
  const auth = err instanceof OctenAuthenticationError ? `, instanceof OctenAuthenticationError, requestId=${err.requestId}` : '';
  return `${name}${auth}`;
}

async function scenarioA() {
  const failures = [];
  const s = setup(200);
  const result = await ai.generateText({ model: s.model, tools: s.tools, stopWhen: stepCount(5), prompt: 'q' });
  const fed = toolResultIn(s.prompts[1]);
  check(failures, s.calls.length === 1, `fetch calls ${s.calls.length}, want 1`);
  check(failures, s.prompts.length === 2, `model calls ${s.prompts.length}, want 2`);
  check(failures, fed?.output?.type === 'json', `second call tool-result output type ${fed?.output?.type}, want json`);
  check(failures, fed?.output?.value?.request_id === fixture.request_id, 'second call did not receive the fixture request_id');
  check(failures, result.text === FINAL_TEXT, `final text ${JSON.stringify(result.text)}`);
  return failures;
}

async function scenarioB() {
  const failures = [];
  const s = setup(200);
  const result = ai.streamText({ model: s.model, tools: s.tools, stopWhen: stepCount(5), prompt: 'q' });
  const counts = {};
  const errors = [];
  for await (const part of result.fullStream) {
    counts[part.type] = (counts[part.type] ?? 0) + 1;
    if (part.type === 'error') errors.push(String(part.error));
  }
  const text = await result.text;
  const fed = toolResultIn(s.prompts[1]);
  check(failures, counts['tool-call'] === 1, `tool-call parts ${counts['tool-call'] ?? 0}, want 1`);
  check(failures, counts['tool-result'] === 1, `tool-result parts ${counts['tool-result'] ?? 0}, want 1`);
  check(failures, errors.length === 0, `error parts: ${errors.join('; ')}`);
  check(failures, s.calls.length === 1, `fetch calls ${s.calls.length}, want 1`);
  check(failures, fed?.output?.value?.request_id === fixture.request_id, 'second call did not receive the fixture request_id');
  check(failures, text === FINAL_TEXT, `final text ${JSON.stringify(text)}`);
  return failures;
}

// Observation only: how a tool that throws surfaces through generateText.
async function scenarioC() {
  const s = setup(401);
  let result;
  try {
    result = await ai.generateText({ model: s.model, tools: s.tools, stopWhen: stepCount(5), prompt: 'q' });
  } catch (err) {
    return `rejects (${describeErr(err)}; model calls ${s.prompts.length})`;
  }
  const part = result.steps[0]?.content?.find((p) => p.type === 'tool-error');
  const fed = toolResultIn(s.prompts[1]);
  if (part === undefined || fed === undefined) {
    return `other (no tool-error part or not fed back; model calls ${s.prompts.length})`;
  }
  const value = typeof fed.output?.value === 'string' ? fed.output.value : JSON.stringify(fed.output?.value);
  return `tool-error (part.toolName: ${part.toolName}, part.error: ${describeErr(part.error)} status=${part.error?.status}; second call gets output ${fed.output?.type} ${JSON.stringify(value)}; final text ${JSON.stringify(result.text)})`;
}

async function scenarioCStream() {
  const s = setup(401);
  const seen = [];
  try {
    const result = ai.streamText({ model: s.model, tools: s.tools, stopWhen: stepCount(5), prompt: 'q' });
    for await (const part of result.fullStream) {
      if (part.type === 'tool-error') seen.push(`tool-error part (error: ${describeErr(part.error)})`);
      if (part.type === 'error') seen.push(`error part (${describeErr(part.error)})`);
    }
  } catch (err) {
    return `throws (${describeErr(err)})`;
  }
  const fed = toolResultIn(s.prompts[1]);
  return `${seen.join(', ') || 'none'}; model calls ${s.prompts.length}; second call gets output ${fed?.output?.type ?? 'nothing'}`;
}

// Observation only: what generateText does after a tool-call step when stopWhen is not set.
async function scenarioD() {
  const s = setup(200);
  const result = await ai.generateText({ model: s.model, tools: s.tools, prompt: 'q' });
  const verdict = s.prompts.length === 1 ? 'stops-after-1' : 'continues';
  return `${verdict} (model calls ${s.prompts.length}, fetch calls ${s.calls.length}, toolResults ${result.toolResults.length}, text ${JSON.stringify(result.text)})`;
}

async function attempt(fn) {
  try {
    return await fn();
  } catch (err) {
    return [`threw ${describeErr(err)}: ${err?.message ?? err}`];
  }
}

console.log(`combo: ai@${installed('ai')} zod@${installed('zod')} node@${process.versions.node} mock=${mockName}(${spec})`);
const a = await attempt(scenarioA);
console.log(`A generateText: ${a.length === 0 ? 'PASS' : `FAIL ${a.join('; ')}`}`);
const b = await attempt(scenarioB);
console.log(`B streamText: ${b.length === 0 ? 'PASS' : `FAIL ${b.join('; ')}`}`);
console.log(`error-behavior: ${await scenarioC().catch((err) => `observe failed: ${err?.message ?? err}`)}`);
console.log(`stream-error-behavior: ${await scenarioCStream().catch((err) => `observe failed: ${err?.message ?? err}`)}`);
console.log(`no-stopwhen: ${await scenarioD().catch((err) => `observe failed: ${err?.message ?? err}`)}`);
process.exitCode = a.length === 0 && b.length === 0 ? 0 : 1;
