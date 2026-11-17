import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
// 刻意从构建产物导入（不是 src）：验证发布出去的 dist 在真实 socket 上的行为。先 npm run build。
import Octen, {
  OctenAPIError,
  OctenAbortError,
  OctenBadRequestError,
  OctenConnectionError,
  OctenRateLimitError,
  OctenServerError,
  OctenTimeoutError,
} from '../../dist/index.js';

type Handler = (req: IncomingMessage, res: ServerResponse, n: number) => void;
type Arrival = { n: number; at: number; headers: IncomingMessage['headers']; body: string };
type Fake = { url: string; arrivals: Arrival[]; close: () => Promise<void> };

// 每个测试一个作用域：并发测试各自清理自己的服务器和定时器，不会关掉别人的
function scoped(onTestFinished: (fn: () => Promise<void> | void) => void) {
  const servers: Fake[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  onTestFinished(async () => {
    for (const t of timers) clearTimeout(t);
    await Promise.all(servers.map((f) => f.close()));
  });
  return {
    // 延迟回调；清理时统一取消，避免往已销毁的 socket 写数据
    later(ms: number, fn: () => void) {
      const t = setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
    },
    async server(handler: Handler): Promise<Fake> {
      const fake = await fakeServer(handler);
      servers.push(fake);
      return fake;
    },
  };
}

async function fakeServer(handler: Handler): Promise<Fake> {
  const arrivals: Arrival[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const n = arrivals.length + 1;
      arrivals.push({ n, at: performance.now(), headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      handler(req, res, n);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  let closed = false;
  return {
    url: `http://127.0.0.1:${port}`,
    arrivals,
    close: () =>
      new Promise<void>((resolve) => {
        if (closed) return resolve();
        closed = true;
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const OK_BODY = JSON.stringify({ code: 0, msg: 'ok', request_id: 'rid-ok', data: { query: 'q', results: [] } });
const ok = (res: ServerResponse) => {
  res.setHeader('content-type', 'application/json');
  res.end(OK_BODY);
};

function client(url: string, extra: { timeout?: number; maxRetries?: number } = {}) {
  return new Octen({ apiKey: 'e2e-key', baseURL: url, ...extra });
}

// 记录场景观测值，供测试记录核对
function observe(name: string, started: number, fields: Record<string, unknown>) {
  const elapsed = Math.round(performance.now() - started);
  console.log(`[e2e] ${name} elapsed_ms=${elapsed} ${Object.entries(fields).map(([k, v]) => `${k}=${String(v)}`).join(' ')}`);
  return elapsed;
}

async function rejection(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => {
      throw new Error('expected the call to reject');
    },
    (e: unknown) => e,
  );
}

// 每个场景有各自的服务器，互不干扰；并发执行，把真实退避等待（约 7-9 s）压在同一个窗口里
describe.concurrent('transport fault injection against dist/', () => {
  it('server answers after 1 s, client timeout 300 ms -> OctenTimeoutError, server saw 1 request', async ({ onTestFinished }) => {
    const sc = scoped(onTestFinished);
    const s = await sc.server((_req, res) => sc.later(1000, () => !res.destroyed && ok(res)));
    const t0 = performance.now();
    const err = await rejection(client(s.url, { timeout: 300 }).search.search({ query: 'q' }));
    const ms = observe('timeout-after-send', t0, { requests: s.arrivals.length, error: (err as Error).name });
    expect(err).toBeInstanceOf(OctenTimeoutError);
    expect(s.arrivals).toHaveLength(1);
    expect(ms).toBeLessThan(900); // 300 ms 超时，没有退避重试
  });

  it('server breaks the connection halfway through the response headers -> OctenConnectionError, 1 request', async ({ onTestFinished }) => {
    const sc = scoped(onTestFinished);
    const s = await sc.server((req) => {
      req.socket.write('HTTP/1.1 200 OK\r\nContent-Type: appli');
      req.socket.destroy();
    });
    const t0 = performance.now();
    const err = await rejection(client(s.url, { timeout: 5000 }).search.search({ query: 'q' }));
    observe('half-headers-disconnect', t0, { requests: s.arrivals.length, error: (err as Error).name });
    expect(err).toBeInstanceOf(OctenConnectionError);
    expect(s.arrivals).toHaveLength(1);
  });

  it('server resets the socket right after reading the request -> OctenConnectionError, 1 request (no retry after send)', async ({ onTestFinished }) => {
    const sc = scoped(onTestFinished);
    const s = await sc.server((req) => req.socket.destroy());
    const t0 = performance.now();
    const err = await rejection(client(s.url, { timeout: 5000 }).search.search({ query: 'q' }));
    observe('reset-after-send', t0, { requests: s.arrivals.length, error: (err as Error).name });
    expect(err).toBeInstanceOf(OctenConnectionError);
    expect(s.arrivals).toHaveLength(1);
  });

  it('response headers arrive but the body stalls past the timeout -> OctenTimeoutError, 1 request', async ({ onTestFinished }) => {
    const sc = scoped(onTestFinished);
    const s = await sc.server((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.writeHead(200);
      res.write('{"code":0,');
    });
    const t0 = performance.now();
    const err = await rejection(client(s.url, { timeout: 300 }).search.search({ query: 'q' }));
    observe('body-stall', t0, { requests: s.arrivals.length, error: (err as Error).name });
    expect(err).toBeInstanceOf(OctenTimeoutError);
    expect(s.arrivals).toHaveLength(1);
  });

  it('connection refused (port closed) -> OctenConnectionError after 4 attempts', async ({ onTestFinished }) => {
    const sc = scoped(onTestFinished);
    // 开一个服务器拿到空闲端口再关掉，端口此刻没人监听
    const probe = await sc.server(() => undefined);
    const url = probe.url;
    await probe.close();
    let calls = 0;
    const counting: typeof fetch = (input, init) => {
      calls += 1;
      return globalThis.fetch(input, init);
    };
    const c = new Octen({ apiKey: 'e2e-key', baseURL: url, timeout: 300, maxRetries: 3, fetch: counting });
    const t0 = performance.now();
    const err = await rejection(c.search.search({ query: 'q' }));
    const cause = (err as Error & { cause?: { cause?: { code?: string } } }).cause?.cause?.code;
    const ms = observe('connection-refused', t0, { fetch_calls: calls, error: (err as Error).name, cause_code: cause });
    expect(err).toBeInstanceOf(OctenConnectionError);
    expect(cause).toBe('ECONNREFUSED');
    expect(calls).toBe(4);
    // 退避 1 s + 2 s + 4 s，各带最多 25% 抖动
    expect(ms).toBeGreaterThanOrEqual(7000);
    expect(ms).toBeLessThan(9500);
  });

  it('503 then 200 -> succeeds on the 2nd request', async ({ onTestFinished }) => {
    const sc = scoped(onTestFinished);
    const s = await sc.server((_req, res, n) => {
      if (n === 1) {
        res.statusCode = 503;
        res.end('unavailable');
        return;
      }
      ok(res);
    });
    const t0 = performance.now();
    const res = await client(s.url, { timeout: 5000 }).search.search({ query: 'q' });
    const ms = observe('503-then-200', t0, { requests: s.arrivals.length, request_id: res.request_id });
    expect(res.request_id).toBe('rid-ok');
    expect(s.arrivals).toHaveLength(2);
    expect(ms).toBeGreaterThanOrEqual(1000); // 第 1 次退避 1 s
  });

  it('429 with Retry-After: 1 then 200 -> succeeds on the 2nd request, >= 1 s apart', async ({ onTestFinished }) => {
    const sc = scoped(onTestFinished);
    const s = await sc.server((_req, res, n) => {
      if (n === 1) {
        res.statusCode = 429;
        res.setHeader('retry-after', '1');
        res.end('slow down');
        return;
      }
      ok(res);
    });
    const t0 = performance.now();
    const res = await client(s.url, { timeout: 5000 }).search.search({ query: 'q' });
    const gap = s.arrivals[1]!.at - s.arrivals[0]!.at;
    observe('429-retry-after-1', t0, { requests: s.arrivals.length, gap_ms: Math.round(gap), request_id: res.request_id });
    expect(res.request_id).toBe('rid-ok');
    expect(s.arrivals).toHaveLength(2);
    expect(gap).toBeGreaterThanOrEqual(1000);
  });

  it('429 with Retry-After: 120 -> OctenRateLimitError with retryAfter 120, 1 request, no waiting', async ({ onTestFinished }) => {
    const sc = scoped(onTestFinished);
    const s = await sc.server((_req, res) => {
      res.statusCode = 429;
      res.setHeader('retry-after', '120');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ code: 429, msg: 'rate limited', request_id: 'rid-429' }));
    });
    const t0 = performance.now();
    const err = await rejection(client(s.url, { timeout: 5000 }).search.search({ query: 'q' }));
    const ms = observe('429-retry-after-120', t0, { requests: s.arrivals.length, retryAfter: (err as OctenRateLimitError).retryAfter });
    expect(err).toBeInstanceOf(OctenRateLimitError);
    expect((err as OctenRateLimitError).retryAfter).toBe(120);
    expect((err as OctenRateLimitError).requestId).toBe('rid-429');
    expect(s.arrivals).toHaveLength(1);
    expect(ms).toBeLessThan(900);
  });

  it('302 redirect to another local server -> OctenAPIError, origin 1 request, redirect target 0 (key not forwarded)', async ({ onTestFinished }) => {
    const sc = scoped(onTestFinished);
    const target = await sc.server((_req, res) => ok(res));
    const origin = await sc.server((_req, res) => {
      res.statusCode = 302;
      res.setHeader('location', `${target.url}/search`);
      res.end();
    });
    const t0 = performance.now();
    const err = await rejection(client(origin.url, { timeout: 5000 }).search.search({ query: 'q' }));
    observe('302-redirect', t0, { origin_requests: origin.arrivals.length, target_requests: target.arrivals.length, status: (err as OctenAPIError).status });
    expect(err).toBeInstanceOf(OctenAPIError);
    expect((err as OctenAPIError).status).toBe(302);
    expect(origin.arrivals).toHaveLength(1);
    expect(target.arrivals).toHaveLength(0);
  });

  it('caller abort() while the request is in flight -> OctenAbortError, 1 request, returns promptly', async ({ onTestFinished }) => {
    const sc = scoped(onTestFinished);
    const s = await sc.server((_req, res) => sc.later(2000, () => !res.destroyed && ok(res)));
    const ac = new AbortController();
    const t0 = performance.now();
    const pending = client(s.url, { timeout: 10_000 }).search.search({ query: 'q' }, { signal: ac.signal });
    await new Promise((r) => setTimeout(r, 150));
    ac.abort();
    const err = await rejection(pending);
    const ms = observe('caller-abort', t0, { requests: s.arrivals.length, error: (err as Error).name });
    expect(err).toBeInstanceOf(OctenAbortError);
    expect(s.arrivals).toHaveLength(1);
    expect(ms).toBeLessThan(900);
  });

  it('HTTP 200 whose body carries code 1001 -> OctenAPIError, 1 request, not retried', async ({ onTestFinished }) => {
    const sc = scoped(onTestFinished);
    const s = await sc.server((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ code: 1001, msg: 'business failure', request_id: 'rid-1001' }));
    });
    const t0 = performance.now();
    const err = await rejection(client(s.url, { timeout: 5000 }).search.search({ query: 'q' }));
    observe('200-code-1001', t0, { requests: s.arrivals.length, status: (err as OctenAPIError).status, code: (err as OctenAPIError).code });
    expect(err).toBeInstanceOf(OctenAPIError);
    expect((err as OctenAPIError).status).toBe(200);
    expect((err as OctenAPIError).code).toBe(1001);
    expect((err as OctenAPIError).requestId).toBe('rid-1001');
    expect(s.arrivals).toHaveLength(1);
  });

  it('HTML 502 on every attempt -> OctenServerError after 4 requests, body kept as raw text', async ({ onTestFinished }) => {
    const sc = scoped(onTestFinished);
    const html = '<html><body><h1>502 Bad Gateway</h1></body></html>';
    const s = await sc.server((_req, res) => {
      res.statusCode = 502;
      res.setHeader('content-type', 'text/html');
      res.end(html);
    });
    const t0 = performance.now();
    const err = await rejection(client(s.url, { timeout: 5000 }).search.search({ query: 'q' }));
    const ms = observe('html-502-x4', t0, { requests: s.arrivals.length, error: (err as Error).name });
    expect(err).toBeInstanceOf(OctenServerError);
    expect((err as OctenServerError).status).toBe(502);
    expect((err as OctenServerError).body).toBe(html);
    expect(s.arrivals).toHaveLength(4);
    expect(ms).toBeGreaterThanOrEqual(7000);
    expect(ms).toBeLessThan(9500);
  });

  it('wire format: key, user-agent, content-type and JSON body arrive as documented; 400 JSON -> OctenBadRequestError with requestId', async ({ onTestFinished }) => {
    const sc = scoped(onTestFinished);
    const s = await sc.server((_req, res) => {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ code: 400, msg: 'count out of range', request_id: 'rid-400' }));
    });
    const err = await rejection(client(s.url, { timeout: 5000 }).search.search({ query: 'q', count: 1 }));
    expect(err).toBeInstanceOf(OctenBadRequestError);
    expect((err as OctenBadRequestError).requestId).toBe('rid-400');
    expect((err as OctenBadRequestError).message).toBe('count out of range');
    expect(s.arrivals).toHaveLength(1);
    const a = s.arrivals[0]!;
    expect(a.headers['x-api-key']).toBe('e2e-key');
    expect(a.headers['user-agent']).toMatch(/^octen-js-sdk\//);
    expect(a.headers['content-type']).toBe('application/json');
    expect(JSON.parse(a.body)).toEqual({ query: 'q', count: 1 });
  });
});
