# Changelog

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
