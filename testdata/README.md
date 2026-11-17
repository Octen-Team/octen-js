# testdata

## openapi.json

Snapshot of the public Octen OpenAPI spec, saved byte-for-byte as downloaded.

- Source: https://docs.octen.ai/api-reference/openapi.json
- Downloaded: 2026-11-17

The contract tests in `test/contract/` compare the SDK descriptors in `src/schema/` against this file.
Update it by hand (download again, update the date above, then fix the descriptors or `known_diffs.json`);
it is never overwritten automatically.

## known_diffs.json

Fields the SDK has but the snapshot lacks. Each entry is `{ "path": "<SchemaName>.<dotted.path>", "reason": "..." }`
and must carry a non-empty reason. Array items are written `field[]`, union variants `field[]{tag}`.
An entry that no longer matches an SDK-only field fails the contract test and must be removed.
