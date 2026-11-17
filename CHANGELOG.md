# Changelog

## 0.1.0

Initial release.

- `Octen` client with `search.search`, `search.broadSearch`, `search.newsSearch`, `search.businessSearch`, `search.pulseSearch` and `placeSearch.search`.
- Request and response types for the six endpoints, checked against the public OpenAPI spec by contract tests.
- Typed error classes (`OctenAPIError` and subclasses, `OctenTimeoutError`, `OctenConnectionError`, `OctenAbortError`, `OctenValidationError`) and `isOctenError()`.
- Automatic retries for 408, 429, 5xx and network errors that happen before the request is sent; client timeouts, aborts and post-send network errors are not retried.
- Zero runtime dependencies; ESM, CommonJS and type declarations.
