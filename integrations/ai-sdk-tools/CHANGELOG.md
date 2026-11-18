# Changelog

## 0.1.0

Initial release.

- `octenWebSearch`, `octenBroadSearch`, `octenNewsSearch`, `octenBusinessSearch`, `octenPlaceSearch` and `octenPulseSearch`: one AI SDK tool for each Octen search endpoint, built on `@octen.ai/sdk`.
- The model only supplies `query` (plus `time_range` for Web and News). Request parameters you pin through `defaults` are removed from the model's input schema and take precedence over the tool's built-in defaults.
- Results are trimmed to the fields a model can use and carry the `request_id`, plus the API's `warning` when it is non-empty. Every list field is always present, Place `results` included. Full content is off unless you enable it.
- The model may send `time_range: null`, which means no time filter.
- SDK errors propagate unchanged, and the AI SDK `abortSignal` is passed to the SDK as `signal`.
- Public types: `OctenToolOptions`, `ModelWebResult`, `ModelEntity`, `ModelPlace`, and the input and result type of each tool.
- Peer dependencies: `ai` `^5.0.0 || ^6.0.0 || ^7.0.0` and `zod` `^3.25.76 || ^4.1.8`; Node 20 or newer. Verified by the version matrix (`scripts/matrix.sh`): `ai` 5.0.291, 6.0.333 and 7.0.176, each with `zod` 3.25.76 and 4.1.8 on Node 24.18.0, plus `ai` 7.0.176 with `zod` 4.6.7 on Node 20.20.2 and 24.18.0.
