// CJS consumer of the installed package
const assert = require('node:assert/strict');
const sdk = require('@octen.ai/sdk');
const { Octen, isOctenError, OctenRateLimitError } = sdk;

assert.equal(typeof Octen, 'function');
assert.equal(sdk.default, Octen, 'require(...).default must be the same class as the named export');
assert.equal(typeof sdk.VERSION, 'string');

const baseURL = process.env.OCTEN_FAKE_BASE_URL;
const client = new Octen({ apiKey: 'fake-e2e-key', baseURL, maxRetries: 0 });
client.search
  .search({ query: 'hello' })
  .then((res) => {
    assert.equal(res.request_id, 'fake-/search');
    assert.equal(isOctenError(new OctenRateLimitError({ status: 429, code: null, message: 'm', requestId: null, body: null, retryAfter: 1 })), true);
    console.log('cjs ok', res.request_id);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
