# @octen.ai/ai-sdk-tools

[Octen](https://docs.octen.ai) search tools for the [Vercel AI SDK](https://ai-sdk.dev). Give a model web search (standard or Premier), news, company and people lookup, place search, official-page lookup, image search, design reference search and page reading by URL with one function call each. Built on [`@octen.ai/sdk`](https://github.com/Octen-Team/octen-js).

- [Install](#install)
- [Quick start](#quick-start)
- [The ten tools](#the-ten-tools)
- [Extract](#extract)
- [Image Search](#image-search)
- [Design Search](#design-search)
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

## The ten tools

Each factory returns an AI SDK `Tool`. Pass any of them under any name in `tools`.

| Factory | Endpoint | What the model provides |
|---|---|---|
| `octenWebSearch(options?)` | `POST /search` | `query`, optional `time_range` |
| `octenWebSearchPremier(options?)` | `POST /search-premier` | `query`, optional `time_range` |
| `octenBroadSearch(options?)` | `POST /broad-search` | `query` |
| `octenNewsSearch(options?)` | `POST /news-search` | `query`, optional `time_range` |
| `octenBusinessSearch(options?)` | `POST /business-search` | `query` |
| `octenPlaceSearch(options?)` | `POST /place-search` | `query` |
| `octenPulseSearch(options?)` | `POST /pulse-search` | `query` |
| `octenExtract(options?)` | `POST /extract` | `urls`, optional `query` |
| `octenImageSearch(options?)` | `POST /image-search` | exactly one of `query` or `image_url`, optional `include_domains`, `exclude_domains` |
| `octenDesignSearch(options?)` | `POST /design-search` | `query`, `group_id` or both |

- **Web** is general search. **Web Search Premier** takes the same parameters and returns the same shape, but uses deeper retrieval and reranking so the page that holds the answer ranks higher; use it for a specific fact, a niche document or a page that is hard to find, and Web for low-latency lookups. **Broad** splits a multi-part question into sub-queries and runs them in parallel. **News** returns recent articles plus storylines. **Business** returns company and person cards plus sources. **Place** finds shops, restaurants and services with address, rating and opening hours. **Pulse** finds the official page for a site, product or document. **Extract** reads pages the model already has URLs for and returns their clean content; see [Extract](#extract). **Image Search** finds images by a text query or by a reference image URL; see [Image Search](#image-search). **Design Search** finds design references (screenshots of web pages, page sections, app screens and slides, with their design values); see [Design Search](#design-search).
- `time_range` is `day`, `week`, `month` or `year`. The model may also send `null` or leave it out, which means no time filter.
- The model only ever supplies `query` (and `time_range` for Web, Web Search Premier and News; `urls` and an optional `query` for Extract; `query` or `image_url` and the two domain filters for Image Search; `query` and `group_id` for Design Search). Everything else is fixed by the tool or by you through `defaults` (named options for Extract, Image Search and Design Search), so the model has fewer decisions to get wrong.
- Place does not take a location from the model. Either put the area in the query ("coffee near Shibuya, Tokyo"), or pin a location with `defaults`.

Everything that changes how much a call returns or costs, such as `count`, `highlight`, `full_content` or `result_type`, is yours to set. For example, a Web Search Premier tool restricted to a few sources:

```ts
import { octenWebSearchPremier } from '@octen.ai/ai-sdk-tools';

// The model still only writes the query and may pick a time range; the rest is fixed here.
const premier = octenWebSearchPremier({
  defaults: { count: 3, result_type: 'dynamic', include_domains: ['nature.com', 'science.org'] },
});
```

## Extract

`octenExtract` reads web pages by URL. The model chooses only the URLs and an optional `query`. The most URLs it may pass in one call, and every option that changes what a call returns or costs, are yours to set when you build the tool. Each option is checked then: a value out of range throws `OctenValidationError`, with `field` naming the option, before any request. An option you leave unset is not sent, so the API default applies.

```ts
import { generateText, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { octenExtract, octenWebSearch } from '@octen.ai/ai-sdk-tools';

// The model finds pages with web search, then reads up to three of them per call.
const { text: summary } = await generateText({
  model: anthropic('claude-opus-5-5'),
  tools: {
    webSearch: octenWebSearch(),
    readPages: octenExtract({ maxUrls: 3, maxAgeSeconds: 3600, includeLinks: { maxLinks: 20 } }),
  },
  stopWhen: stepCountIs(8),
  prompt: 'Read the latest Node.js release announcement and list its three biggest changes.',
});
console.log(summary);
```

| Option | Request field | Values | When unset |
|---|---|---|---|
| `maxUrls` | none: the tool's own cap | integer 1 to 20 | 5 |
| `mode` | `mode` | `'standard'`, `'advanced'` (for pages that are hard to reach; slower and billed at a higher rate) or `'auto'` (picks one per URL) | not sent; the API uses `standard` |
| `format` | `format` | `'markdown'` or `'text'` | not sent; the API uses `markdown` |
| `maxAgeSeconds` | `max_age_seconds` | integer 300 to 31536000; a cached copy older than this is fetched again | not sent; the API uses 86400 |
| `urlTimeout` | `timeout` | integer 1 to 60, seconds for each URL on the server | not sent; the API uses 30 |
| `includeImages`, `includeVideos`, `includeAudio` | `include_images`, `include_videos`, `include_audio` | boolean; images also turn on `cover_image` | not sent; off |
| `includeLinks` | `include_links` | `{}` for the API defaults, or `{ scope?: 'prefer_internal' \| 'prefer_external', maxLinks?: 1 to 1000 }` | not sent; no links |

`client`, `apiKey`, `baseURL`, `timeout`, `maxRetries` and `description` work as for the other tools (see [Options and precedence](#options-and-precedence)). Extract takes no `defaults`.

- **The URL cap.** The model's input schema allows 1 to `maxUrls` URLs of at most 2048 characters each, and the default description tells the model the cap. A call with more URLs than `maxUrls`, or with none, never reaches the API: the AI SDK's input check rejects it, and the model receives a tool error that states the cap and asks for several calls (checked by the version matrix in `ai` 5, 6 and 7). `execute`, if called directly, throws `OctenValidationError` naming how many URLs were passed and the cap.
- **Without `query`** each result carries the page's full content. With `query` (1 to 500 characters), each result carries ranked `highlights` instead, so the page body is partial. The default description tells the model to leave `query` unset in the normal case.
- **Each URL succeeds or fails on its own.** A page that could not be read comes back as its own item with `status: 'failed'` and an `error_message`, while the other URLs still return their content; failed URLs are not billed. The default description tells the model to match results to its URLs by `url`, not by position.
- **HTTP timeout.** Unless you pass `timeout` or a `client`, the tool uses the SDK's default for Extract: the per-URL timeout (`urlTimeout`, or 30 s when unset) plus 90 s, so 120 s by default. A `timeout` you pass, or one set on a shared `client`, applies to Extract too, so a short timeout chosen for the search tools can abort Extract while the server is still reading pages.

## Image Search

`octenImageSearch` finds images on the web. The model passes exactly one input: a text `query` (1 to 500 characters), or an `image_url`, a public http(s) URL of an image, to find visually similar images. It may also pass `include_domains` and `exclude_domains` (up to 10 domains each, matched against each result's source page). These filters narrow the results without changing what a call returns or costs, so they are the model's to choose unless you pin them. The number of results and the adult-content filter are yours to set when you build the tool, and are checked then like Extract's options.

```ts
import { generateText, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { octenImageSearch } from '@octen.ai/ai-sdk-tools';

// Up to eight images per call, from Wikimedia only; the model writes a query or passes an image URL.
const { text: gallery } = await generateText({
  model: anthropic('claude-opus-5-5'),
  tools: { imageSearch: octenImageSearch({ count: 8, includeDomains: ['wikimedia.org'] }) },
  stopWhen: stepCountIs(5),
  prompt: 'Find three photos of the Golden Gate Bridge at sunset and list each image URL with its source page.',
});
console.log(gallery);
```

| Option | Request field | Values | When unset |
|---|---|---|---|
| `count` | `count` | integer 1 to 10 | not sent; the API returns 5 |
| `safesearch` | `safesearch` | `'off'` or `'strict'` (drops adult content) | not sent; the API uses `strict` |
| `includeDomains`, `excludeDomains` | `include_domains`, `exclude_domains` | 1 to 10 domains. Setting one pins it: that filter is removed from the model's schema and a value the model sends for it is ignored | not sent, unless the model sets the filter |

`client`, `apiKey`, `baseURL`, `timeout`, `maxRetries` and `description` work as for the other tools. Image Search takes no `defaults`; an option it does not know, such as `defaults` or a snake_case name, throws `OctenValidationError` with `field` naming it, and so does a list with an empty slot.

- **Exactly one input.** A call with both `query` and `image_url`, or with neither (a blank string counts as missing), never reaches the API: the AI SDK's input check rejects it, and the model receives a tool error telling it to pass exactly one (checked by the version matrix in `ai` 5, 6 and 7). An `image_url` that is not an http(s) URL with a host name, such as base64 data, a `data:` URI or a string that does not parse as a URL, is refused the same way. `execute`, if called directly, throws `OctenValidationError`.
- **An image the API cannot use.** When the API answers HTTP 413 (image too large) or 415 (unsupported format), the tool throws an `OctenAPIError` with the same `status`, `code`, `requestId` and `body`, whose message tells the model to try a smaller image (at most 5 MB) or one in a supported format (JPEG, PNG, WEBP, BMP, TIFF, ICO, DIB, ICNS or SGI), followed by the API's own message. The AI SDK passes that message to the model as the tool error. Every other error, such as 401 or 403, is thrown unchanged.
- **No base64 input.** The API can also take an image as base64 data, but a model cannot reliably write out an image that way, so the tool does not offer it. To search by an image you hold, call `imageSearch.search` in `@octen.ai/sdk` directly.

## Design Search

`octenDesignSearch` searches for design references: screenshots of web pages, page sections, app screens and slides, each with its design values (`design_facts`, such as colors, fonts and font sizes) and, when the image has it, reusable HTML code (`snippet`). Web pages on the same query come back alongside as `results`. The model passes a `query` (1 to 500 characters), a `group_id`, or both. An image that belongs to a web page or deck carries a `group` with a `group_id`; when the model passes that `group_id`, the API returns the images of that page or deck in group order instead of searching by query, so the model can look through the rest of a page or deck it found. That is why `group_id` is model input: it only ever comes from an earlier result. Everything that changes how much a call returns is yours to set when you build the tool, grouped as `images` and `webSearch` like the API's `images` and `web_search` objects, with camelCase keys.

```ts
import { generateText, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { octenDesignSearch } from '@octen.ai/ai-sdk-tools';

// Ten references per call with shorter code snippets, and no web results.
const { text: ideas } = await generateText({
  model: anthropic('claude-opus-5-5'),
  tools: {
    designSearch: octenDesignSearch({ images: { count: 10, snippet: { maxTokens: 1000 } }, webSearch: { enable: false } }),
  },
  stopWhen: stepCountIs(5),
  prompt: 'Find pricing sections of SaaS landing pages and describe the three most common layouts.',
});
console.log(ideas);
```

| Option | Request field | Values | When unset |
|---|---|---|---|
| `images.enable` | `images.enable` | boolean; `false` returns no images | not sent; on |
| `images.count` | `images.count` | integer 1 to 100; also caps a `group_id` lookup | not sent; 5 |
| `images.designFacts` | `images.design_facts` | boolean | not sent; on |
| `images.snippet` | `images.snippet` | `{ enable?: boolean, maxTokens?: 100 to 100000 }` | not sent; on, up to 5000 tokens per image |
| `webSearch.enable` | `web_search.enable` | boolean; `false` returns no web results | not sent; on |
| `webSearch.count` | `web_search.count` | integer 1 to 100 | not sent; 5 |
| `webSearch.highlight` | `web_search.highlight` | `{ enable?: boolean, maxTokens?: 100 to 20000 }` | not sent; on, 512 tokens |
| `webSearch.fullContent` | `web_search.full_content` | `{ enable?: boolean, maxTokens?: 100 to 100000 }` | not sent; off |
| `webSearch.includeDomains`, `webSearch.excludeDomains` | `web_search.include_domains`, `web_search.exclude_domains` | 1 to 1200 domains of at most 60 characters | not sent |
| `webSearch.language` | `web_search.language` | ISO 639-1 codes: `ar`, `de`, `en`, `es`, `fr`, `hi`, `id`, `it`, `ja`, `ko`, `nl`, `pl`, `pt`, `ru`, `th`, `tr`, `vi`, `zh` | not sent; no language filter |
| `webSearch.timeBasis` | `web_search.time_basis` | `'auto'`, `'published'` or `'crawled'` | not sent; `auto` |
| `webSearch.timeRange` | `web_search.time_range` | `'day'`, `'week'`, `'month'` or `'year'` | not sent; no time filter |
| `webSearch.startTime`, `webSearch.endTime` | `web_search.start_time`, `web_search.end_time` | RFC 3339 date-time with seconds and a time zone, e.g. `'2025-01-01T00:00:00Z'`; every field must be in range (no `2025-02-30` or `+24:00`), and `startTime` may not be after `endTime` | not sent |

A key the table does not list, at the top level or inside `images` and `webSearch`, such as a snake_case name, throws `OctenValidationError` with `field` naming it, and so does a list with an empty slot. Turning off both `images.enable` and `webSearch.enable` throws too, because the tool would return nothing. `client`, `apiKey`, `baseURL`, `timeout`, `maxRetries` and `description` work as for the other tools. Design Search takes no `defaults`.

- **Query or group.** A call with neither `query` nor `group_id` (a blank string counts as missing) never reaches the API: the AI SDK's input check rejects it and the model receives a tool error that explains both inputs (checked by the version matrix in `ai` 5, 6 and 7). `execute`, if called directly, throws `OctenValidationError`.
- **With `images.enable: false`** the tool only returns web results: its default description no longer mentions screenshots or groups, `group_id` is removed from the model's schema, `query` becomes required, and a `group_id` the model sends anyway is not sent.
- **The `webSearch` options apply to the web results only**; they do not filter the images. The domain, language and time filters are therefore yours to set, not the model's.
- **Size.** With the API defaults each image carries its design values and up to 5000 tokens of snippet code, and all of it goes into the model's context. Lower `images.snippet.maxTokens`, or turn snippets or design values off, if the model does not need them. The default description stops mentioning design values, code or web results when you turn them off.

## Options and precedence

Every search factory takes the same options; Extract, Image Search and Design Search take the same client options and `description`, and their own options in place of `defaults` (see [Extract](#extract), [Image Search](#image-search) and [Design Search](#design-search)):

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

**Fields you pin disappear from the model.** If `defaults` sets `time_range` on Web, Web Search Premier or News, the `time_range` input is removed from that tool's schema, so the model cannot override it. `query` always comes from the model, and a `query` placed in `defaults` is ignored.

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
| Web Search Premier | `{ request_id, warning?, results: WebResult[] }` | `count: 5`, `highlight: { enable: true, max_tokens: 300 }` (the API's own highlight default is 512 tokens) |
| Pulse | `{ request_id, warning?, results: WebResult[] }` | `count: 5` |
| Broad | `{ request_id, warning?, queries: string[], search_results: { query?, results: WebResult[] }[] }` | `search_options: { highlight: { enable: true, max_tokens: 300 } }`; the tool sends no `count` or `max_queries` |
| News | `{ request_id, warning?, results: WebResult[], subjects: { name?, summary?, time_latest?, top_news?: { title?, url? } }[] }` | `count: 5`, `highlight: { enable: true, max_tokens: 300 }` |
| Business | `{ request_id, warning?, entities: ModelEntity[], results: WebResult[] }` | `count: 5`, `highlight: { enable: true, max_tokens: 300 }` |
| Place | `{ request_id, warning?, places: ModelPlace[], results: WebResult[] }` | `places: { count: 5 }` |
| Extract | `{ request_id, warning?, results: ModelExtractResult[] }` | none: the request carries the model's `urls` and `query` and only the options you set |
| Image Search | `{ request_id, warning?, results: ModelImageResult[] }` | none: the request carries the model's input and filters and only the options you set |
| Design Search | `{ request_id, warning?, images: ModelDesignImage[], results: WebResult[] }` | none: the request carries the model's `query` and `group_id` and only the options you set |

- **Business entities.** A company keeps `type`, `name`, `summary` and `website` (taken from `identifiers.website`). A person keeps `type`, `name`, `summary`, `current_position` and `linkedin_url`. An entity type the SDK does not know yet keeps only `type`, `name` and `summary`. An entity without a `type` is dropped. Because an unknown `type` comes through as its own string, checking `e.type === 'company'` alone does not narrow the type: add a key check such as `'website' in e`, or cast to the exported `ModelCompany` or `ModelPerson`.
- **Places** keep `name`, `category`, `address`, `latitude`, `longitude`, `distance`, `rating`, `review_count`, `opening_hours`, `status`, `phone` and `website`. A value of `0` is kept; only missing values are dropped. `results` is empty unless you turn on web results with `defaults: { web_search: { enable: true } }`.
- **Extract results** keep one item per URL, failures included, in the order the API returns them. Every item has `url` and `status`, and a failed one has `error_message`. A successful item has `title`, `full_content` (or `highlights` when the model sent a `query`), `time_published`, `time_last_crawled`, and `category` and `page_structure` as `{ primary, secondary? }`, each when the API returned it. Only when you turned them on does it also have `cover_image` and `images`, `videos` and `audio` as lists of URLs, and `links` as `{ url, anchor_text?, is_external? }`. `favicon` and `resolved_mode` are left out. The content is not shortened. The API's `warning`, for example that some URLs failed and were not billed, comes through as `warning`.
- **Image results** keep `title`, `url` (the image itself), `source_page` (the page that hosts it), `description`, `width`, `height` and `thumbnail`.
- **Design images** keep `type` (`web_page`, `web_section`, `app_screen` or `slide`), `title`, `description`, `url`, `thumbnail`, `source_page`, `width`, `height`, `group` as `{ group_id, type, name, position, total, master? }`, `design_facts`, and `snippet` as `{ format, code }`. `design_facts` and a deck's `master` are passed through as the API returns them, because their keys vary by image. Design Search web results are trimmed to the same web result fields as the other tools, so `authors`, `favicon`, `cover_image` and page images are left out. `results` is empty when you turn web results off.
- **Full content is off by default.** A web result carries `full_content` only if you turn it on, for example `defaults: { full_content: { enable: true, max_tokens: 1000 } }`. Full content beyond the free allowance is billed separately, and it is a lot of text for the model to read, so the tools leave it off unless you ask for it. Web, Web Search Premier, News, Business and Pulse take `full_content` at the top level of `defaults`; Broad takes it under `search_options`, Place under `web_search`, and Design Search as `webSearch.fullContent`.

## Errors and cancellation

When a call fails, the tool throws the SDK's error as it is. It is not caught, wrapped or turned into a plain object. These are the classes from `@octen.ai/sdk`: every one extends `OctenError`, and API errors (`OctenAPIError` and its subclasses such as `OctenAuthenticationError` and `OctenRateLimitError`) carry `status` and `requestId`. Quote `requestId` when you contact support. The one error that does not come from the SDK is a plain `Error` naming the field, thrown when a list in the response is neither an array nor missing, so a malformed reply never looks like "no results". Extract, Image Search and Design Search also throw the SDK's `OctenValidationError` themselves: when one is built with an option out of range, and when `execute` gets input that breaks its rule (more URLs than `maxUrls` or none; not exactly one of `query` and `image_url`; neither `query` nor `group_id`). Neither case sends a request.

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

Extract is billed per successful URL, so in the first case a retry can bill again every URL that succeeded on the first attempt, up to `maxUrls` URLs, at the `advanced` rate if you set `mode: 'advanced'`.

Keep in mind that each tool call the model makes is a separate Octen request, and a single step can contain several tool calls. `stopWhen` limits the number of steps, not the number of billed searches.

## Supported versions

| Package | Range |
|---|---|
| `ai` | `^5.0.0 \|\| ^6.0.0 \|\| ^7.0.0` |
| `zod` | `^3.25.76 \|\| ^4.1.8` |
| `@octen.ai/sdk` | `^0.3.0`, a dependency installed with the tools; 0.3.0 is the first release with Extract (Image Search and Design Search came in 0.2.0) |
| Node | 20 or newer for the ESM build; 20.19+ or 22.12+ to load it with `require()` together with `ai` 7 |

`ai` 7 is published as ESM only, so loading this package through `require()` (CommonJS) together with `ai` 7 needs Node 20.19 or later, or Node 22.12 or later: older Node versions cannot `require()` an ES module and fail with `ERR_REQUIRE_ESM`. Measured on 2026-11-18 with `@octen.ai/ai-sdk-tools` 0.1.0 and `ai` 7.0.176: Node 20.18.3 and 22.11.0 fail, Node 20.19.0 and 22.12.0 work. The ESM build works on Node 20 and later.

The package declares `ai` and `zod` as peer dependency ranges. A version matrix (`scripts/matrix.sh` in the repository) checks them; on 2026-11-22, for version 0.3.0 with `@octen.ai/sdk` 0.3.0, it passed for exactly these eight combinations:

| `ai` | `zod` | Node |
|---|---|---|
| 5.0.291 | 3.25.76, 4.1.8 | 24.18.0 |
| 6.0.333 | 3.25.76, 4.1.8 | 24.18.0 |
| 7.0.176 | 3.25.76, 4.1.8 | 24.18.0 |
| 7.0.179 | 4.6.7 | 20.20.2, 24.18.0 |

`ai` 5 and 6 were run on Node 24 only, `zod` 4.6.7 only with `ai` 7.0.179, and Node 20 only with `ai` 7.0.179 and `zod` 4.6.7. For each combination the matrix drives `generateText` and `streamText` with the AI SDK's mock model through a search and an answer, checks the JSON schema the model is given (`query` required, `time_range` optional and removed when pinned) and that `time_range: null` passes the AI SDK's input check, checks that an Extract call over its URL cap sends no request and that the model gets the cap in the error, checks the same for Image Search and Design Search calls that break their input rule, records how the failures described under [What the AI SDK does with the error](#what-the-ai-sdk-does-with-the-error) surface, loads the package through `require`, and type-checks a project that uses all ten tools with TypeScript 6.0.3, `strict` and `skipLibCheck: false`. With `skipLibCheck: false` you also need `@types/json-schema`, because the AI SDK's own declarations import `json-schema`.

The public types do not mention zod, so whether you use zod 3 or 4 does not affect your type checking. `ai` 4 is not supported: it uses `parameters` where this package uses the `inputSchema` form of `tool()`.

## License

MIT
