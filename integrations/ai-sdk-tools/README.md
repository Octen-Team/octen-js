# @octen.ai/ai-sdk-tools

[Octen](https://docs.octen.ai) search tools for the [Vercel AI SDK](https://ai-sdk.dev). Give a model web search, news, company and people lookup, place search and official-page lookup with one function call each. Built on [`@octen.ai/sdk`](https://github.com/Octen-Team/octen-js).

- [Install](#install)
- [Quick start](#quick-start)
- [The six tools](#the-six-tools)
- [Options and precedence](#options-and-precedence)
- [What the model sees](#what-the-model-sees)
- [Errors and cancellation](#errors-and-cancellation)
- [Retries and billing](#retries-and-billing)
- [Supported versions](#supported-versions)
- [License](#license)

## Install

```bash
npm install @octen.ai/ai-sdk-tools ai zod
```

`ai` and `zod` are peer dependencies, so the versions you already use are the ones the tools run on. Create an API key in your Octen account and either pass it as `apiKey` or set the `OCTEN_API_KEY` environment variable.

## Quick start

```bash
export OCTEN_API_KEY=sk-...
```

```ts
import { generateText, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { octenWebSearch } from '@octen.ai/ai-sdk-tools';

const { text } = await generateText({
  model: anthropic('claude-opus-5-5'),
  tools: { webSearch: octenWebSearch() },
  stopWhen: stepCountIs(5),
  prompt: 'What changed in the latest Node.js LTS release? Cite your sources.',
});
console.log(text);
```

Any AI SDK provider works the same way: only the `model` line changes. `stopWhen: stepCountIs(5)` lets the model search, read the results and answer in up to five steps. Without it, `generateText` stops after the first step in `ai` 5, 6 and 7: the search runs and its result is in `toolResults`, but the model is not called again to read it, so `text` is empty.

`octenWebSearch()` reads `OCTEN_API_KEY` when it is called, not when the package is imported. If no key is set, the call throws the same error the SDK's `Octen` constructor throws.

## The six tools

Each factory returns an AI SDK `Tool`. Pass any of them under any name in `tools`.

| Factory | Endpoint | What the model provides |
|---|---|---|
| `octenWebSearch(options?)` | `POST /search` | `query`, optional `time_range` |
| `octenBroadSearch(options?)` | `POST /broad-search` | `query` |
| `octenNewsSearch(options?)` | `POST /news-search` | `query`, optional `time_range` |
| `octenBusinessSearch(options?)` | `POST /business-search` | `query` |
| `octenPlaceSearch(options?)` | `POST /place-search` | `query` |
| `octenPulseSearch(options?)` | `POST /pulse-search` | `query` |

- **Web** is general search. **Broad** splits a multi-part question into sub-queries and runs them in parallel. **News** returns recent articles plus storylines. **Business** returns company and person cards plus sources. **Place** finds shops, restaurants and services with address, rating and opening hours. **Pulse** finds the official page for a site, product or document.
- `time_range` is `day`, `week`, `month` or `year`. The model may also send `null` or leave it out, which means no time filter.
- The model only ever supplies `query` (and `time_range` for Web and News). Everything else is fixed by the tool or by you through `defaults`, so the model has fewer decisions to get wrong.
- Place does not take a location from the model. Either put the area in the query ("coffee near Shibuya, Tokyo"), or pin a location with `defaults`.

## Options and precedence

Every factory takes the same options:

```ts
import { Octen } from '@octen.ai/sdk';
import { octenNewsSearch, octenPlaceSearch, octenWebSearch } from '@octen.ai/ai-sdk-tools';

// Reuse one client for several tools. `client` cannot be combined with apiKey, baseURL, timeout or maxRetries.
const client = new Octen({ apiKey: process.env.OCTEN_API_KEY, timeout: 20_000 });

const tools = {
  webSearch: octenWebSearch({
    client,
    description: 'Search the web for documentation and release notes.',
    defaults: { count: 8, include_domains: ['nodejs.org', 'github.com'] },
  }),
  // The model can no longer choose a time range: it is pinned to one week.
  newsSearch: octenNewsSearch({ client, defaults: { time_range: 'week' } }),
  // Pin the search area so the model only has to write the query.
  placeSearch: octenPlaceSearch({
    client,
    defaults: { latitude: 35.6595, longitude: 139.7005, radius: 2000 },
  }),
};

// Without `client`, the tool builds its own client from these four options.
const lowLevel = octenWebSearch({ apiKey: 'sk-...', baseURL: 'https://api.octen.ai', timeout: 15_000, maxRetries: 1 });
```

| Option | Meaning |
|---|---|
| `client` | An existing `Octen` client to reuse. Passing it together with `apiKey`, `baseURL`, `timeout` or `maxRetries` is a type error, and at runtime throws `OctenValidationError`, with `field` naming the conflicting option. |
| `apiKey`, `baseURL`, `timeout`, `maxRetries` | Same meaning as the SDK's client options. Omitted values fall back to the SDK defaults, including the `OCTEN_API_KEY` lookup. |
| `description` | Replaces the default tool description that the model reads when it decides whether to call the tool. |
| `defaults` | Request parameters you fix for every call. The type is the SDK's parameter type for that endpoint (`SearchParams`, `NewsSearchParams` and so on) without `query`. |

The factory builds one client and every call of that tool reuses it.

**Precedence.** For each request parameter, the first of these that sets it wins:

1. what the model sends (only `query` and `time_range`; a field you pinned in `defaults` is not in its schema, and a value for it is ignored);
2. your `defaults`;
3. the tool's built-in defaults, listed under [What the model sees](#what-the-model-sees).

**Fields you pin disappear from the model.** If `defaults` sets `time_range` on Web or News, the `time_range` input is removed from that tool's schema, so the model cannot override it. `query` always comes from the model, and a `query` placed in `defaults` is ignored.

**Merging happens at the top level only.** A nested object you pass replaces the tool's own object entirely; the two are not combined key by key:

```ts
import { octenBroadSearch, octenPlaceSearch, octenWebSearch } from '@octen.ai/ai-sdk-tools';

// The tool's default is highlight: { enable: true, max_tokens: 300 }.
// Your object replaces it entirely, so the request carries only the fields you set here.
const longerHighlights = octenWebSearch({ defaults: { highlight: { enable: true, max_tokens: 600 } } });

// The tool's default is places: { count: 5 }. Your object replaces it entirely, so the request carries no count.
const withReviews = octenPlaceSearch({ defaults: { places: { max_reviews: 2 } } });

// Broad Search takes its highlight option under search_options, which is replaced as a whole too.
const broad = octenBroadSearch({
  defaults: { search_options: { count: 3, highlight: { enable: true, max_tokens: 300 } } },
});
```

An explicit `undefined` in `defaults` means "not set" and does not override a built-in default.

## What the model sees

Tool results go into the model's context, so `execute` returns a trimmed copy of the response with only the fields a model can use, and every result carries the `request_id`. Empty or missing fields of results, entities, places and subjects are left out instead of being sent as `null` or `""`, and an item left with no fields at all is dropped. A non-empty API warning (`meta.warning`) is passed through as `warning`, so the model can tell a degraded upstream from "no results". There is no switch to return the raw response. If you need it, call [`@octen.ai/sdk`](https://github.com/Octen-Team/octen-js) directly.

A "web result" below has `title`, `url`, `highlight`, `time_published` and `full_content`, each present only when the API returned a non-empty value.

| Tool | Result | Built-in defaults |
|---|---|---|
| Web | `{ request_id, warning?, results: WebResult[] }` | `count: 5`, `highlight: { enable: true, max_tokens: 300 }` |
| Pulse | `{ request_id, warning?, results: WebResult[] }` | `count: 5` |
| Broad | `{ request_id, warning?, queries: string[], search_results: { query?, results: WebResult[] }[] }` | `search_options: { highlight: { enable: true, max_tokens: 300 } }`; the tool sends no `count` or `max_queries` |
| News | `{ request_id, warning?, results: WebResult[], subjects: { name?, summary?, time_latest?, top_news?: { title?, url? } }[] }` | `count: 5`, `highlight: { enable: true, max_tokens: 300 }` |
| Business | `{ request_id, warning?, entities: ModelEntity[], results: WebResult[] }` | `count: 5`, `highlight: { enable: true, max_tokens: 300 }` |
| Place | `{ request_id, warning?, places: ModelPlace[], results: WebResult[] }` | `places: { count: 5 }` |

- **Business entities.** A company keeps `type`, `name`, `summary` and `website` (taken from `identifiers.website`). A person keeps `type`, `name`, `summary`, `current_position` and `linkedin_url`. An entity type the SDK does not know yet keeps only `type`, `name` and `summary`. An entity without a `type` is dropped. Because an unknown `type` comes through as its own string, checking `e.type === 'company'` alone does not narrow the type: add a key check such as `'website' in e`, or cast to the exported `ModelCompany` or `ModelPerson`.
- **Places** keep `name`, `category`, `address`, `latitude`, `longitude`, `distance`, `rating`, `review_count`, `opening_hours`, `status`, `phone` and `website`. A value of `0` is kept; only missing values are dropped. `results` is empty unless you turn on web results with `defaults: { web_search: { enable: true } }`.
- **Full content is off by default.** A web result carries `full_content` only if you turn it on, for example `defaults: { full_content: { enable: true, max_tokens: 1000 } }`. Full content beyond the free allowance is billed separately, and it is a lot of text for the model to read, so the tools leave it off unless you ask for it. Web, News, Business and Pulse take `full_content` at the top level of `defaults`; Broad takes it under `search_options` and Place under `web_search`.

## Errors and cancellation

When a search fails, the tool throws the SDK's error as it is. It is not caught, wrapped or turned into a plain object. These are the classes from `@octen.ai/sdk`: every one extends `OctenError`, and API errors (`OctenAPIError` and its subclasses such as `OctenAuthenticationError` and `OctenRateLimitError`) carry `status` and `requestId`. Quote `requestId` when you contact support. The one error that does not come from the SDK is a plain `Error` naming the field, thrown when a list in the response is neither an array nor missing, so a malformed reply never looks like "no results".

```ts
import { OctenAPIError, OctenError } from '@octen.ai/sdk';

// Use this wherever you catch an error that came out of a tool call.
function describeError(err: unknown): string {
  if (err instanceof OctenAPIError) {
    return `Octen API error ${err.status} (request ${err.requestId}): ${err.message}`;
  }
  if (err instanceof OctenError) {
    return `${err.name}: ${err.message}`; // timeout, connection, abort or validation error
  }
  throw err;
}
```

**Cancellation.** Each tool forwards the `abortSignal` it receives from the AI SDK to the SDK as `signal`. Aborting that signal cancels the in-flight search request, the SDK stops retrying, and the tool throws `OctenAbortError`. `generateText` and `streamText` both take an `abortSignal` option. An abort makes `generateText` reject (see [What the AI SDK does with the error](#what-the-ai-sdk-does-with-the-error)), so catch it:

```ts
import { generateText, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { octenWebSearch } from '@octen.ai/ai-sdk-tools';

const controller = new AbortController();
setTimeout(() => controller.abort(), 20_000);

try {
  await generateText({
    model: anthropic('claude-opus-5-5'),
    tools: { webSearch: octenWebSearch() },
    stopWhen: stepCountIs(5),
    abortSignal: controller.signal,
    prompt: 'Summarize this week in open-source AI.',
  });
} catch (err) {
  // The rejection is the signal's AbortError, not the tool's OctenAbortError.
  if (err instanceof Error && err.name === 'AbortError') console.log('Cancelled.');
  else throw err;
}
```

```ts
import { streamText, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { octenWebSearch } from '@octen.ai/ai-sdk-tools';

const streamController = new AbortController();

const result = streamText({
  model: anthropic('claude-opus-5-5'),
  tools: { webSearch: octenWebSearch() },
  stopWhen: stepCountIs(5),
  abortSignal: streamController.signal,
  prompt: 'Summarize this week in open-source AI.',
});
for await (const chunk of result.textStream) process.stdout.write(chunk);
```

### What the AI SDK does with the error

The version matrix (see [Supported versions](#supported-versions)) ran three kinds of failing search through `generateText` and `streamText` in `ai` 5, 6 and 7. All three majors behaved the same, except for the error text noted below.

- **API error (HTTP 401) or connection error (connection refused).** `generateText` does not reject. It records a `tool-error` part for that tool call, whose `error` is the SDK error: `OctenAuthenticationError` with its `status` and `requestId`, or `OctenConnectionError` (observed with the client at `maxRetries: 0`). The next model call receives the error text as an `error-text` tool result. That text is the error message (`invalid api key`) in `ai` 5 and 6, and the class name followed by the message (`OctenAuthenticationError: invalid api key`) in `ai` 7. It does not include the `requestId`. `streamText` emits the same `tool-error` part in `fullStream` and then calls the model again.
- **Abort while the search is in flight** (`controller.abort()` called without a reason). The tool throws `OctenAbortError`, but `generateText` rejects with a `DOMException` named `AbortError` instead, and the model is not called again. `streamText` does not throw: `fullStream` emits an `abort` part and no `tool-error` part, then ends.

Other failures, such as a client timeout, were not part of the matrix.

Because API and connection errors do not reject the call, a problem such as a wrong API key only shows in the model's answer unless you look for it. Check the steps for tool errors:

```ts
import { generateText, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { OctenAPIError, OctenError } from '@octen.ai/sdk';
import { octenWebSearch } from '@octen.ai/ai-sdk-tools';

const result = await generateText({
  model: anthropic('claude-opus-5-5'),
  tools: { webSearch: octenWebSearch() },
  stopWhen: stepCountIs(5),
  prompt: 'What changed in the latest Node.js LTS release?',
});
for (const part of result.steps.flatMap((step) => step.content)) {
  if (part.type === 'tool-error' && part.error instanceof OctenError) {
    const api = part.error instanceof OctenAPIError ? ` (status ${part.error.status}, request ${part.error.requestId})` : '';
    console.error(`${part.toolName} failed: ${part.error.name}: ${part.error.message}${api}`);
  }
}
```

## Retries and billing

The tools use the SDK's default of `maxRetries: 3`, and you can change it with the `maxRetries` option or by passing your own `client`.

**Retried automatically:** HTTP 408, 429, 500, 502, 503 and 504, and network errors that happen before the request is sent.

**Not retried:** a client timeout (`OctenTimeoutError`; the server may have finished and billed the request by then), an abort, a network error after the request was sent, and other 4xx statuses.

**Known residual risk of double billing.** There are no idempotency keys yet, so two situations can bill a request twice or bill a request that looked like it failed:

1. An edge gateway or load balancer returns 408, 502, 503 or 504 after the backend already succeeded; the retry then runs and is billed again.
2. The server records the billing event but fails while writing the response (for example the connection is recycled mid-response). You see a network error, the SDK does not retry it, but the call was billed.

For billing-sensitive jobs, set `maxRetries: 0` and handle retries yourself. Server-side idempotency keys are the proper fix and are not available yet.

```ts
import { octenWebSearch } from '@octen.ai/ai-sdk-tools';

// No automatic retries: a rate limit or timeout surfaces as an error instead of a second billed request.
const strict = octenWebSearch({ maxRetries: 0 });
```

Keep in mind that each tool call the model makes is a separate Octen request, and a single step can contain several tool calls. `stopWhen` limits the number of steps, not the number of billed searches.

## Supported versions

| Package | Range |
|---|---|
| `ai` | `^5.0.0 \|\| ^6.0.0 \|\| ^7.0.0` |
| `zod` | `^3.25.76 \|\| ^4.1.8` |
| Node | 20 or newer |

The package declares `ai` and `zod` as peer dependency ranges. A version matrix (`scripts/matrix.sh` in the repository) checks them; on 2026-11-18 it passed for exactly these eight combinations:

| `ai` | `zod` | Node |
|---|---|---|
| 5.0.291 | 3.25.76, 4.1.8 | 24.18.0 |
| 6.0.333 | 3.25.76, 4.1.8 | 24.18.0 |
| 7.0.176 | 3.25.76, 4.1.8 | 24.18.0 |
| 7.0.176 | 4.6.7 | 20.20.2, 24.18.0 |

`ai` 5 and 6 were run on Node 24 only, `zod` 4.6.7 only with `ai` 7.0.176, and Node 20 only with `ai` 7.0.176 and `zod` 4.6.7. For each combination the matrix drives `generateText` and `streamText` with the AI SDK's mock model through a search and an answer, records how the failures described under [What the AI SDK does with the error](#what-the-ai-sdk-does-with-the-error) surface, and type-checks a project that uses all six tools with TypeScript 6.0.3, `strict` and `skipLibCheck: false`. With `skipLibCheck: false` you also need `@types/json-schema`, because the AI SDK's own declarations import `json-schema`.

The public types do not mention zod, so whether you use zod 3 or 4 does not affect your type checking. `ai` 4 is not supported: it uses `parameters` where this package uses the `inputSchema` form of `tool()`.

## License

MIT
