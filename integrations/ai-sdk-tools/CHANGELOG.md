# Changelog

## 0.2.0

- New tool `octenWebSearchPremier` for `POST /search-premier`: deeper retrieval and reranking than Web Search, with the same parameters and response. It is built like `octenWebSearch`: the model supplies `query` and an optional `time_range`, every other request field (`count`, `highlight`, `full_content`, `result_type`, domain and language filters and so on) is set through `defaults`, and pinning `time_range` removes it from the model's schema. The built-in defaults are `count: 5` and `highlight: { enable: true, max_tokens: 300 }`, and results are trimmed to the same web result fields. New public types `WebSearchPremierInput` and `WebSearchPremierToolResult`.
- Requires `@octen.ai/sdk` 0.2.x (dependency range `^0.2.0`), the first SDK release with `searchPremier`. If your project pins `@octen.ai/sdk` 0.1.x, upgrade it to 0.2.x so a single SDK copy is installed and a `client` you create still type-checks when passed to the tools.
- The six existing tools send the same requests and return the same results as in 0.1.2.

## 0.1.2

- Accepts `@octen.ai/sdk` 0.2.x as well as 0.1.x (dependency range `^0.1.0 || ^0.2.0`), so installing it next to `@octen.ai/sdk` 0.2.0 keeps a single SDK copy and a `client` you create type-checks when passed to the tools. No tool behavior changes.

## 0.1.1

- Documented the Node requirement for loading the package with `require()` (CommonJS) together with `ai` 7: Node 20.19 or later, or Node 22.12 or later. The ESM build still works on Node 20 and later.
- Added tests that type-check the published declarations against invalid options: `client` combined with a client option, and `query` in `defaults`.
- Documentation: a malformed list in a response (a list field that is neither missing nor an array) makes the tool throw an `Error` that names the field. This was already the behavior in 0.1.0.

## 0.1.0

Initial release.

- `octenWebSearch`, `octenBroadSearch`, `octenNewsSearch`, `octenBusinessSearch`, `octenPlaceSearch` and `octenPulseSearch`: one AI SDK tool for each Octen search endpoint, built on `@octen.ai/sdk`.
- The model only supplies `query` (plus `time_range` for Web and News). Request parameters you pin through `defaults` are removed from the model's input schema and take precedence over the tool's built-in defaults.
- Results are trimmed to the fields a model can use and carry the `request_id`, plus the API's `warning` when it is non-empty. Every list field is always present, Place `results` included. Full content is off unless you enable it.
- The model may send `time_range: null`, which means no time filter.
- SDK errors propagate unchanged, and the AI SDK `abortSignal` is passed to the SDK as `signal`.
- Public types: `OctenToolOptions` (passing `client` together with a client option is a type error), `ModelWebResult`, `ModelEntity` with its `ModelCompany` and `ModelPerson` members, `ModelPlace`, `TimeRange`, and the input and result type of each tool.
- Peer dependencies: `ai` `^5.0.0 || ^6.0.0 || ^7.0.0` and `zod` `^3.25.76 || ^4.1.8`; Node 20 or newer. Verified by the version matrix (`scripts/matrix.sh`): `ai` 5.0.291, 6.0.333 and 7.0.176, each with `zod` 3.25.76 and 4.1.8 on Node 24.18.0, plus `ai` 7.0.176 with `zod` 4.6.7 on Node 20.20.2 and 24.18.0.
