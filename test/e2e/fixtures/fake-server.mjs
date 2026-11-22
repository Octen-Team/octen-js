// Local fake server for the packed-install smoke test: checks x-api-key / user-agent / request body and returns a minimal valid response per path.
// Prints one line "PORT <n>" on stdout once started; exits on SIGTERM; GET /__requests returns the requests received (path and any validation problems).
import { createServer } from 'node:http';

const EXPECTED_KEY = process.env.FAKE_EXPECTED_KEY ?? 'fake-e2e-key';
const seen = [];

const nonEmpty = (v) => typeof v === 'string' && v !== '';
const hasQuery = (b) => nonEmpty(b?.query);
// Exactly one input of an allowed type; text needs data and no url, an image exactly one of url or data
const hasInput = (types) => (b) => {
  const input = Array.isArray(b?.inputs) && b.inputs.length === 1 ? b.inputs[0] : undefined;
  if (!types.includes(input?.type) || b?.query !== undefined) return false;
  if (input.type === 'text') return nonEmpty(input.data) && input.url === undefined;
  const given = [input.url, input.data].filter((v) => v !== undefined);
  return given.length === 1 && nonEmpty(given[0]);
};
// The body shape each route accepts
const ROUTES = {
  '/search': hasQuery,
  '/search-premier': hasQuery,
  '/broad-search': hasQuery,
  '/news-search': hasQuery,
  '/business-search': hasQuery,
  '/pulse-search': hasQuery,
  '/place-search': hasQuery,
  '/image-search': hasInput(['text', 'image']),
  '/video-search': hasInput(['text']),
  '/design-search': (b) => b?.inputs === undefined && (hasQuery(b) || nonEmpty(b?.images?.group_id)),
  // 1 to 20 non-empty URL strings
  '/extract': (b) =>
    Array.isArray(b?.urls) && b.urls.length >= 1 && b.urls.length <= 20 && b.urls.every(nonEmpty) && b?.inputs === undefined,
};

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/__requests') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(seen));
    return;
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    const problems = [];
    if (req.method !== 'POST') problems.push(`method ${req.method}`);
    if (req.headers['x-api-key'] !== EXPECTED_KEY) problems.push('x-api-key mismatch');
    if (!String(req.headers['user-agent'] ?? '').startsWith('octen-js-sdk/')) problems.push('user-agent');
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) problems.push('content-type');
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      problems.push('body is not JSON');
    }
    const accepts = Object.hasOwn(ROUTES, req.url) ? ROUTES[req.url] : undefined;
    if (accepts === undefined) problems.push(`unknown path ${req.url}`);
    else if (!accepts(body)) problems.push(`body shape not accepted by ${req.url}`);
    seen.push({ path: req.url, problems });
    res.setHeader('content-type', 'application/json');
    if (problems.length > 0) {
      res.statusCode = 400;
      res.end(JSON.stringify({ code: 400, msg: `fake server rejected: ${problems.join(', ')}`, request_id: 'fake-bad' }));
      return;
    }
    res.end(
      JSON.stringify({
        code: 0,
        msg: 'ok',
        request_id: `fake-${req.url}`,
        data: {
          query: body.query,
          results: [{ title: 't', url: 'https://example.com' }],
          entities: [{ type: 'company', name: 'Example Inc', identifiers: { stock_ticker: 'EXM' } }],
        },
      }),
    );
  });
});

server.listen(0, '127.0.0.1', () => {
  console.log(`PORT ${server.address().port}`);
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
