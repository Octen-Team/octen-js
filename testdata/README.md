# testdata

## openapi.json

Snapshot of the public Octen OpenAPI spec, saved byte-for-byte as downloaded, with one exception:
the Chinese example text in the `/v1/messages` `streamContentDelta` response example is replaced with an
English translation, to keep the repository English-only. That example is not compared by any test.

- Source: https://docs.octen.ai/api-reference/openapi.json
- Downloaded: 2026-11-21

The contract tests in `test/contract/` compare the SDK descriptors in `src/schema/` against this file.
Update it by hand (download again, update the date above, then fix the descriptors or `known_diffs.json`);
it is never overwritten automatically.

## known_diffs.json

Fields the SDK has but the snapshot lacks, and response fields the SDK types as nullable where the snapshot
documents `null` only in a description. Each entry is `{ "path": "<SchemaName>.<dotted.path>", "reason": "..." }`
and must carry a non-empty reason. Array items are written `field[]`, union variants `field[]{tag}`.
An entry that no longer matches an SDK-only field fails the contract test and must be removed.
