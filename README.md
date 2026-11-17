# @octen.ai/sdk

Official TypeScript SDK for the [Octen](https://docs.octen.ai) search API. Zero runtime dependencies, ships ESM, CommonJS and type declarations.

It covers six endpoints: Web Search, Broad Search, News Search, Business Search, Pulse Search and Place Search.

- [Install](#install)
- [Quick start](#quick-start)
- [The six methods](#the-six-methods)
- [Request options](#request-options)
- [Client options](#client-options)
- [Errors](#errors)
- [Retries and timeouts](#retries-and-timeouts)
- [Runtimes and browsers](#runtimes-and-browsers)
- [Differences from the Python SDK](#differences-from-the-python-sdk)
- [Development and releasing](#development-and-releasing)

## Install

```bash
npm install @octen.ai/sdk
```

Requires Node 20 or newer. Create an API key in your Octen account and either pass it as `apiKey` or set the `OCTEN_API_KEY` environment variable.

## Quick start

ESM / TypeScript:

```ts
import Octen from '@octen.ai/sdk'; // or: import { Octen } from '@octen.ai/sdk'

const client = new Octen(); // reads OCTEN_API_KEY; or: new Octen({ apiKey: 'sk-...' })

const res = await client.search.search({ query: 'latest advances in solid-state batteries', count: 5 });
for (const r of res.data?.results ?? []) {
  console.log(r.title, r.url);
}
```

CommonJS: `require()` returns the module object, not the class, so pick the class off it:

```js
const { Octen } = require('@octen.ai/sdk'); // `require('@octen.ai/sdk').default` is the same class

const client = new Octen(); // reads OCTEN_API_KEY
client.search.search({ query: 'hello' }).then((res) => console.log(res.request_id));
```

Responses are the parsed JSON bodies, so field names are snake_case exactly as in the [API reference](https://docs.octen.ai). Apart from `request_id`, response fields are typed as optional (hence the `?.` above), and unknown extra fields are passed through untouched.

## The six methods

Every method takes the request body as an object (`query` is required everywhere) and an optional [request options](#request-options) object as the second argument. Parameter names match the API reference; the SDK does not rename them.

```ts
// Web Search: POST /search
const web = await client.search.search({
  query: 'rust async runtimes',
  count: 10,
  include_domains: ['github.com'],
  time_range: 'month',
  highlight: { enable: true, max_tokens: 300 },
});
console.log(web.data?.results?.[0]?.highlight);

// Broad Search: POST /broad-search (rewrites the question and runs several sub-queries)
const broad = await client.search.broadSearch({
  query: 'compare central bank rate decisions this quarter',
  max_queries: 5,
  search_options: { count: 5, language: ['en'] },
});
console.log(broad.data?.queries);
for (const group of broad.data?.search_results ?? []) {
  console.log(group.query, group.results?.length);
}

// News Search: POST /news-search
const news = await client.search.newsSearch({
  query: 'Federal Reserve interest rate decision',
  count: 5,
  time_range: 'week',
  subjects: { enable: true, count: 3, max_sub_news: 5 },
});
console.log(news.data?.subjects?.map((s) => s.name));

// Business Search: POST /business-search (company and person entity cards)
const biz = await client.search.businessSearch({
  query: 'Example Semiconductor quarterly results',
  count: 5,
  entities: { enable: true, count: 2, max_activities: 5, max_news: 5 },
});
for (const entity of biz.data?.entities ?? []) {
  switch (entity.type) {
    case 'company':
      console.log('company', entity.name, entity.identifiers?.stock_ticker);
      break;
    case 'person':
      console.log('person', entity.name, entity.current_position);
      break;
    default:
      // the server may add new entity types; they are returned as-is at runtime
      console.log('other entity type', (entity as { type?: string }).type);
  }
}

// Pulse Search: POST /pulse-search (mode: 'lite' returns URL and title only)
const pulse = await client.search.pulseSearch({
  query: 'python list methods',
  mode: 'standard',
  count: 3,
  full_content: { enable: true, max_tokens: 1000 },
});
console.log(pulse.meta?.usage?.billed_mode);

// Place Search: POST /place-search (note: client.placeSearch, not client.search)
const places = await client.placeSearch.search({
  query: 'Korean restaurants',
  places: { count: 5 },
  latitude: 37.788,
  longitude: -122.4075,
  radius: 2000, // meters, needs latitude and longitude
});
for (const p of places.data?.places ?? []) {
  console.log(p.name, p.distance, p.rating);
}
```

`BusinessEntity` note: the TypeScript type lists the two variants that exist today, `company` and `person`, so `entity.type === 'company'` narrows the type. The server can add new `type` values at any time and the SDK returns them unchanged at runtime, so always keep a `default` branch like the one above.

### Local validation

Before sending anything the SDK checks that `query` is a non-empty string and rejects keys it does not know, at every nesting level (`OctenValidationError`, with the offending path in `field`, for example `highlight.max_token`). It does not check value ranges (for example `count`); out-of-range values come back from the server as a 400 (`OctenBadRequestError`). Keys whose value is `undefined` are treated as not passed. `broadSearch`'s `search_options` takes the same keys as `search`.

## Request options

Each method accepts an optional second argument:

| Option | Meaning |
|---|---|
| `timeout` | Milliseconds for each attempt of this call; overrides the client default and the Broad Search default |
| `signal` | An `AbortSignal`; aborting rejects with `OctenAbortError` and stops retrying |
| `headers` | Extra headers for this call (the `x-api-key` header cannot be overridden) |

```ts
const ac = new AbortController();
setTimeout(() => ac.abort(), 5_000);
await client.search.search({ query: 'hello' }, { signal: ac.signal, timeout: 10_000 });
```

## Client options

```ts
const client = new Octen({
  apiKey: 'sk-...',          // default: process.env.OCTEN_API_KEY; the constructor throws if neither is set
  baseURL: 'https://api.octen.ai',
  timeout: 30_000,           // ms per attempt, default 30 s
  maxRetries: 3,             // default 3 (at most 4 requests)
  defaultHeaders: {},        // sent with every request
  fetch: customFetch,        // default: the runtime's global fetch
  dangerouslyAllowBrowser: false,
});
```

- `timeout` counts each attempt and includes reading the response body. **Broad Search is the exception: it defaults to 120 s and ignores the client-level `timeout`**, because it runs many sub-queries; pass `{ timeout }` in the request options of that call to change it.
- Only the `x-api-key` header carries credentials. Redirects are never followed (a redirect is reported as an error), so the key cannot be forwarded to another host.
- The `User-Agent` is `octen-js-sdk/<version>`.
- Invalid options (empty key, malformed `baseURL`, non-positive `timeout`, negative `maxRetries`, and so on) throw `OctenValidationError` from the constructor.

## Errors

Every error the SDK throws extends `OctenError`. API errors (`OctenAPIError` and its subclasses) are decided from the HTTP status:

| Situation | Class |
|---|---|
| 401 | `OctenAuthenticationError` |
| 403 (no permission, insufficient balance) | `OctenPermissionDeniedError` |
| 400, 422 | `OctenBadRequestError` |
| 429 (retries used up, or `Retry-After` above 60 s) | `OctenRateLimitError`, has `retryAfter` |
| 5xx (retries used up) | `OctenServerError` |
| Any other non-2xx; a 2xx that is not a usable result (see below) | `OctenAPIError` |
| Client timeout (`timeout`) | `OctenTimeoutError` |
| Network error | `OctenConnectionError` |
| Aborted through `signal` | `OctenAbortError` |
| Rejected by the SDK before sending | `OctenValidationError` (has `field`) |

A 2xx response counts as a failure when the body is not a non-empty JSON object (HTML, an array, `{}`, an empty body) or when it carries a numeric `code` other than 0.

```ts
import { OctenAPIError, OctenRateLimitError, isOctenError } from '@octen.ai/sdk';

try {
  await client.search.search({ query: 'hello' });
} catch (err) {
  if (err instanceof OctenRateLimitError) {
    console.log('slow down, retry after', err.retryAfter, 'seconds'); // number | null
  }
  if (err instanceof OctenAPIError) {
    // status: HTTP status; code: the body's numeric `code` or null;
    // requestId: x-request-id header, else the body's request_id (string | null);
    // body: the parsed JSON, or the raw text when it is not JSON
    console.error(err.status, err.code, err.requestId, err.message);
  } else if (isOctenError(err)) {
    console.error(err.name, err.message); // timeout, connection, abort or validation error
  } else {
    throw err;
  }
}
```

Prefer `isOctenError()` over `instanceof OctenError` when a process may load both the ESM and the CommonJS build of the package: with two copies of the classes `instanceof` fails, while the marker that `isOctenError` checks works across copies. `instanceof` against a subclass has the same limit, so in that situation branch on `err.name` instead.

The message is taken from the response body's `msg`, `message`, `detail` or `error` field (in that order), else the first 500 characters of the body, else `HTTP <status>`. Quote `requestId` when contacting support.

## Retries and timeouts

**Retried automatically** (up to `maxRetries` times, default 3):

- HTTP 408, 429, 500, 502, 503 and 504.
- Network errors that happen before the request is sent: on Node, errors whose `cause.code` is `ECONNREFUSED`, `ENOTFOUND` or `EAI_AGAIN`.

**Waiting between attempts:** `1 s * 2^(n-1)` before retry `n`, plus up to 25% random jitter, at most 60 s. A `Retry-After` header (seconds or an HTTP date) is honoured on 429 and 503 only; if it asks for more than 60 s the SDK stops and throws, and `OctenRateLimitError.retryAfter` carries the value in seconds.

**Not retried:**

- A client timeout (`OctenTimeoutError`). The server may have finished and billed the request by then, so a blind retry could bill twice. The caller decides whether to resend.
- Aborts through `signal` (`OctenAbortError`): the SDK stops immediately.
- Network errors after the request was sent (a connection reset mid-response, an edge gateway recycling the connection) and any network error the SDK cannot classify as "before sending". On Bun, Deno and Cloudflare Workers `fetch` only throws a plain `TypeError`, so network errors are never retried there.
- Other 4xx statuses.

**Known residual risk of double billing.** There are no idempotency keys yet, so two situations can bill a request twice or bill a request that looked like it failed:

1. An edge gateway or load balancer returns 408, 502, 503 or 504 after the backend already succeeded; the retry then runs and is billed again.
2. The server records the billing event but fails while writing the response (for example the connection is recycled mid-response). You see a network error, the SDK does not retry it, but the call was billed.

For billing-sensitive jobs, set `maxRetries: 0` and handle retries yourself. Server-side idempotency keys are the proper fix and are not available yet.

## Runtimes and browsers

- **Node 20+** is the supported runtime, and the only one tested in CI (Node 20 and 22).
- The SDK only needs a global `fetch` (or the `fetch` option), so it is expected to work on Bun, Deno, Vercel Edge and Cloudflare Workers, but these are **not tested** here. `OCTEN_API_KEY` is read only if `process.env` exists and is accessible, so on those runtimes pass `apiKey` explicitly.
- **Not for browsers.** An API key in front-end code is visible to everyone who opens the page. When the SDK detects a browser (both `window` and `document` exist) the constructor throws `OctenValidationError` unless you pass `dangerouslyAllowBrowser: true`. Call Octen from your server instead, and only use the flag if you accept the exposure (for example a throwaway key).

## Differences from the Python SDK

Compared with `octen-py` 0.11.1:

| Area | `octen-py` | `@octen.ai/sdk` |
|---|---|---|
| Parameter validation | Checks value ranges (such as `count`) locally | Checks only `query` and unknown keys; ranges are checked by the server (400) |
| Unknown keys in nested request objects | Top level rejected, nested `highlight` / `full_content` allowed | Rejected at every level |
| Client timeout | Retried | Not retried |
| `Retry-After` | 429 only | 429 and 503; above 60 s no retry |
| Network errors | All retried | Only errors before the request is sent |
| 2xx responses | Validated against the full response model | Judged only by the rules under [Errors](#errors) |
| Error classes | Dedicated classes for 401 and 429 | Also 403, 400/422 and 5xx subclasses |
| Auth headers | `x-api-key` and `Authorization: Bearer` | `x-api-key` only |
| Deprecated `topic` parameter | Still present | Not exposed |
| Broad Search timeout | 30 s like every endpoint | 120 s, separate default |

## Development and releasing

```bash
npm ci
npm run typecheck && npm test && npm run build
OCTEN_LIVE=1 OCTEN_API_KEY=... npm run test:live   # real, billed calls
npm run spec-drift   # compares the live OpenAPI spec with testdata/openapi.json
```

`testdata/openapi.json` is a snapshot of the public OpenAPI spec that the contract tests compare against; see `testdata/README.md`. A weekly workflow (`spec-drift.yml`) fails when the six endpoints' schemas change upstream; it never rewrites the snapshot.

**Releasing.** The version lives in two places, `package.json` and `src/version.ts` (a smoke test fails if they differ), so a release bumps both. To release: bump both, add a `CHANGELOG.md` entry, merge to `main`, then push a `v<version>` tag. `release.yml` checks that the tag equals both versions, type-checks, tests, builds and publishes with npm provenance through OIDC trusted publishing (no token stored). The very first version has to be published manually by a maintainer of the `@octen.ai` npm organization, after which the trusted publisher (repository `Octen-Team/octen-js`, workflow `release.yml`) is configured in the package settings.

## License

MIT
