// 装包冒烟用的本地假服务器：校验 x-api-key / user-agent / 请求体，按路径回一个最小合法响应。
// 启动后在 stdout 打印一行 "PORT <n>"；收到 SIGTERM 退出；GET /__requests 返回收到的请求数。
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
    if (typeof body?.query !== 'string' || body.query === '') problems.push('body.query missing');
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
