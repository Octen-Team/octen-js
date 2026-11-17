// ESM consumer of the installed package: default export / named exports / real request / isOctenError still works alongside a CJS copy
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Octen, { Octen as Named, OctenValidationError, isOctenError } from '@octen.ai/sdk';

assert.equal(Octen, Named, 'default export and named export must be the same class');

const baseURL = process.env.OCTEN_FAKE_BASE_URL;
const client = new Octen({ apiKey: 'fake-e2e-key', baseURL, maxRetries: 0 });
const res = await client.search.search({ query: 'hello' });
assert.equal(res.request_id, 'fake-/search');
assert.equal(res.data.results[0].url, 'https://example.com');

// Load a CJS copy in the same process: the two error classes differ so instanceof fails, but isOctenError must still be true (promised in the README)
const require = createRequire(import.meta.url);
const cjs = require('@octen.ai/sdk');
assert.notEqual(cjs.Octen, Octen, 'ESM and CJS builds are expected to be separate copies');
const cjsClient = new cjs.Octen({ apiKey: 'fake-e2e-key', baseURL, maxRetries: 0 });
const err = await cjsClient.search.search({ query: '' }).then(
  () => assert.fail('empty query must be rejected'),
  (e) => e,
);
assert.equal(isOctenError(err), true);
assert.equal(err instanceof OctenValidationError, false);
assert.equal(err.name, 'OctenValidationError');
console.log('esm ok', res.request_id);
