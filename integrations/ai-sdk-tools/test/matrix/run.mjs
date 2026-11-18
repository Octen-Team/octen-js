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

// kind: 200 replays the fixture, 401 replies with an auth error, conn throws like fetch does when
// the connection is refused, abort hangs until the request's signal aborts.
function fakeFetch(kind) {
  const calls = [];
  let markEntered;
  const entered = new Promise((resolve) => (markEntered = resolve));
  const fetch = async (url, init) => {
    calls.push(String(url));
    markEntered();
    if (kind === 'conn') {
      const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' });
      throw new TypeError('fetch failed', { cause });
    }
    if (kind === 'abort') {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal === undefined || signal === null) {
          setTimeout(() => reject(new Error('no signal reached fetch')), 2000);
          return;
        }
        const fail = () => reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
        if (signal.aborted) fail();
        else signal.addEventListener('abort', fail, { once: true });
      });
    }
    const body = kind === 200 ? fixture : { code: 401, msg: 'invalid api key', request_id: ERROR_REQUEST_ID };
    return new Response(JSON.stringify(body), { status: kind, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, calls, entered };
}

function setup(kind) {
  const { fetch, calls, entered } = fakeFetch(kind);
  // No retries for conn: the SDK would retry a refused connection with backoff, which only slows the run.
  const client = new Octen({ apiKey: 'test-key', fetch, ...(kind === 'conn' ? { maxRetries: 0 } : {}) });
  const webSearch = octenWebSearch({ client });
  // Records what the tool itself threw, which can differ from what generateText rejects with.
  const toolThrew = [];
  const execute = webSearch.execute;
  webSearch.execute = async (...args) => {
    try {
      return await execute(...args);
    } catch (err) {
      toolThrew.push(className(err));
      throw err;
    }
  };
  return { tools: { webSearch }, calls, entered, toolThrew, ...mockModel() };
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

function className(err) {
  const ctor = err?.constructor?.name ?? typeof err;
  return typeof err?.name === 'string' && err.name !== ctor ? `${ctor}(${err.name})` : ctor;
}

function describeErr(err) {
  const auth = err instanceof OctenAuthenticationError ? `, requestId=${err.requestId}` : '';
  const status = err?.status === undefined ? '' : `, status=${err.status}`;
  return `${className(err)}${status}${auth}`;
}

// How the error text the next model call received was built from the thrown error.
function textShape(err, fed) {
  const value = fed?.output?.value;
  if (value === err?.message) return 'message';
  if (value === `${err?.name}: ${err?.message}`) return 'name-message';
  return 'other-text';
}

function withTimeout(promise, ms, what) {
  // unref so a finished run does not wait for the timer.
  const timeout = new Promise((_r, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), ms).unref());
  return Promise.race([promise, timeout]);
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

// Observation only: how a failing search surfaces through generateText. The first token is
// `rejects/<class>`, `tool-error/<class>/<textShape>` or `other`; scripts/matrix.sh compares it.
async function scenarioC(kind) {
  const s = setup(kind);
  const controller = new AbortController();
  const pending = ai.generateText({
    model: s.model,
    tools: s.tools,
    stopWhen: stepCount(5),
    prompt: 'q',
    ...(kind === 'abort' ? { abortSignal: controller.signal } : {}),
  });
  pending.catch(() => {});
  if (kind === 'abort') {
    await withTimeout(s.entered, 5000, 'waiting for the search fetch');
    controller.abort();
  }
  let result;
  try {
    result = await withTimeout(pending, 10000, 'generateText');
  } catch (err) {
    return `rejects/${className(err)} (${describeErr(err)}; message ${JSON.stringify(err?.message)}; model calls ${s.prompts.length}, fetch calls ${s.calls.length}; tool threw ${s.toolThrew.join(',') || 'nothing'})`;
  }
  const part = result.steps[0]?.content?.find((p) => p.type === 'tool-error');
  const fed = toolResultIn(s.prompts[1]);
  if (part === undefined || fed === undefined) {
    return `other (no tool-error part or not fed back; model calls ${s.prompts.length})`;
  }
  const value = typeof fed.output?.value === 'string' ? fed.output.value : JSON.stringify(fed.output?.value);
  return `tool-error/${className(part.error)}/${textShape(part.error, fed)} (part.toolName ${part.toolName}, part.error ${describeErr(part.error)}; second call gets output ${fed.output?.type} ${JSON.stringify(value)}; model calls ${s.prompts.length}; tool threw ${s.toolThrew.join(',') || 'nothing'}; final text ${JSON.stringify(result.text)})`;
}

// Same for streamText. The first token joins what fullStream showed: `tool-error/<class>`,
// `error/<class>` and `abort` parts, `throws/<class>` if iterating threw, or `none`.
async function scenarioCStream(kind) {
  const s = setup(kind);
  const controller = new AbortController();
  const seen = [];
  const details = [];
  const consume = (async () => {
    const result = ai.streamText({
      model: s.model,
      tools: s.tools,
      stopWhen: stepCount(5),
      prompt: 'q',
      ...(kind === 'abort' ? { abortSignal: controller.signal } : {}),
    });
    for await (const part of result.fullStream) {
      if (part.type === 'tool-error' || part.type === 'error' || part.type === 'abort') seen.push(part);
      if (part.type === 'tool-error' || part.type === 'error') details.push(describeErr(part.error));
    }
  })();
  consume.catch(() => {});
  if (kind === 'abort') {
    await withTimeout(s.entered, 5000, 'waiting for the search fetch');
    controller.abort();
  }
  let threw;
  try {
    await withTimeout(consume, 10000, 'streamText');
  } catch (err) {
    threw = err;
    details.push(describeErr(err));
  }
  const fed = toolResultIn(s.prompts[1]);
  const tokens = [];
  for (const part of seen) {
    const token =
      part.type === 'tool-error' ? `tool-error/${className(part.error)}/${textShape(part.error, fed)}`
      : part.type === 'error' ? `error/${className(part.error)}`
      : 'abort';
    if (!tokens.includes(token)) tokens.push(token);
  }
  if (threw !== undefined) tokens.push(`throws/${className(threw)}`);
  return `${tokens.join('+') || 'none'} (${details.join('; ') || 'no error parts'}; tool threw ${s.toolThrew.join(',') || 'nothing'}; model calls ${s.prompts.length}; second call gets output ${fed?.output?.type ?? 'nothing'})`;
}

// What the model is shown: the JSON schema each tool hands to the model, and the AI SDK's own input check.
async function scenarioSchema() {
  const failures = [];
  const client = new Octen({ apiKey: 'test-key', fetch: fakeFetch(200).fetch });
  const tools = { webSearch: octenWebSearch({ client }), pinned: octenWebSearch({ client, defaults: { time_range: 'week' } }) };
  const seen = [];
  const model = new Mock({
    doGenerate: async (options) => {
      seen.push(options.tools ?? []);
      return { content: [{ type: 'text', text: FINAL_TEXT }], finishReason: finishReason('stop'), usage: usage(), warnings: [] };
    },
  });
  await ai.generateText({ model, tools, prompt: 'q' });
  const byName = Object.fromEntries((seen[0] ?? []).map((t) => [t.name, t.inputSchema]));
  const keys = (schema) => Object.keys(schema?.properties ?? {}).sort().join(',');
  const required = (schema) => JSON.stringify(schema?.required ?? []);
  check(failures, keys(byName.webSearch) === 'query,time_range', `webSearch properties ${keys(byName.webSearch)}`);
  check(failures, required(byName.webSearch) === '["query"]', `webSearch required ${required(byName.webSearch)}`);
  check(failures, keys(byName.pinned) === 'query', `pinned properties ${keys(byName.pinned)}`);
  check(failures, required(byName.pinned) === '["query"]', `pinned required ${required(byName.pinned)}`);
  const validate = async (value) => (await ai.asSchema(tools.webSearch.inputSchema).validate(value)).success;
  check(failures, (await validate({ query: 'q', time_range: null })) === true, 'time_range null rejected');
  check(failures, (await validate({ query: 'q' })) === true, 'missing time_range rejected');
  check(failures, (await validate({ query: 'q', time_range: 'w' })) === false, "time_range 'w' accepted");
  return { failures, timeRange: JSON.stringify(byName.webSearch?.properties?.time_range) };
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
let schemaFailures;
try {
  const { failures, timeRange } = await scenarioSchema();
  schemaFailures = failures;
  console.log(`schema: ${failures.length === 0 ? 'PASS' : `FAIL ${failures.join('; ')}`} (time_range ${timeRange})`);
} catch (err) {
  schemaFailures = [String(err)];
  console.log(`schema: FAIL threw ${describeErr(err)}: ${err?.message ?? err}`);
}
const observe = (promise) => promise.catch((err) => `observe-failed (${err?.message ?? err})`);
for (const [kind, label] of [[401, 'error-behavior'], ['conn', 'conn-error-behavior'], ['abort', 'abort-error-behavior']]) {
  console.log(`${label}: ${await observe(scenarioC(kind))}`);
  console.log(`stream-${label}: ${await observe(scenarioCStream(kind))}`);
}
console.log(`no-stopwhen: ${await observe(scenarioD())}`);
process.exitCode = a.length === 0 && b.length === 0 && schemaFailures.length === 0 ? 0 : 1;
