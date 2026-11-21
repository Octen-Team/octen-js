// Local fake server for the packed-install smoke test: checks x-api-key / user-agent / request body and returns a minimal valid response per path.
// Prints one line "PORT <n>" on stdout once started; exits on SIGTERM; GET /__requests returns the requests received (path and any validation problems).
import { createServer } from 'node:http';

const EXPECTED_KEY = process.env.FAKE_EXPECTED_KEY ?? 'fake-e2e-key';
const seen = [];

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
    // A search needs a query, except image/video search (inputs[0]) and a design group lookup (images.group_id)
    const nonEmpty = (v) => typeof v === 'string' && v !== '';
    const input = body?.inputs?.[0];
    if (!nonEmpty(body?.query) && !nonEmpty(input?.data) && !nonEmpty(input?.url) && !nonEmpty(body?.images?.group_id)) {
      problems.push('body has no query, inputs or images.group_id');
    }
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
