# Changelog

## Unreleased

## 0.2.0

- New methods: `search.searchPremier` (`POST /search-premier`), `imageSearch.search` (`POST /image-search`), `videoSearch.search` (`POST /video-search`, invite-only beta) and `designSearch.search` (`POST /design-search`), with request and response types checked against the public OpenAPI spec.
- Local checks for the new endpoints: Image and Video Search take exactly one input of a type the endpoint accepts (a text input needs `data` and takes no `url`; an image input exactly one of `url` or `data`); Design Search needs a `query` unless `images.group_id` is set.
- `testdata/openapi.json` refreshed (2026-11-21) and `spec-drift` now covers the ten endpoints. The existing six endpoints' schemas are unchanged, and their requests are sent exactly as before.

## 0.1.1

- Documentation: the README comparison with the Python SDK now covers `octen-py` 0.12.0, including its `retry_after_send` option and the `request_sent` field on timeout and connection errors. No code changes.

## 0.1.0

Initial release.

- `Octen` client with `search.search`, `search.broadSearch`, `search.newsSearch`, `search.businessSearch`, `search.pulseSearch` and `placeSearch.search`.
- Request and response types for the six endpoints, checked against the public OpenAPI spec by contract tests.
- Typed error classes (`OctenAPIError` and subclasses, `OctenTimeoutError`, `OctenConnectionError`, `OctenAbortError`, `OctenValidationError`) and `isOctenError()`.
- Automatic retries for 408, 429, 500, 502, 503 and 504, and for network errors that happen before the request is sent; client timeouts, aborts and post-send network errors are not retried.
- An explicit client `timeout` applies to every endpoint, including `broadSearch`; precedence is per-request `timeout`, explicit client `timeout`, then the endpoint default (120 s for `broadSearch`, 30 s otherwise).
- Optional `ClientOptions` and `RequestOptions` fields accept an explicit `undefined` (works with `exactOptionalPropertyTypes`).
- Local checks reject what would otherwise be sent silently rewritten: unknown keys, `NaN`/`Infinity` and `undefined` array items in request bodies, `x-api-key` in `defaultHeaders`/`headers`, timeouts above 2147483647 ms and a `baseURL` with credentials.
- Zero runtime dependencies; ESM, CommonJS and type declarations.
