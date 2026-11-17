import { vi } from 'vitest';
import { HttpCore } from '../../src/core/http';

export const BASE = 'https://api.example.com';

export type Captured = { url: string; body: unknown };

export function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

/** 假 fetch：记录每次请求的 URL 与解析后的请求体，并返回给定的响应体。 */
export function makeFetch(responseBody: unknown = { code: 0, request_id: 'req_1' }) {
  const calls: Captured[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) as unknown });
    return jsonResponse(responseBody);
  }) as unknown as typeof fetch;
  const core = new HttpCore({
    apiKey: 'sk-test',
    baseURL: BASE,
    timeoutMs: 1000,
    maxRetries: 0,
    defaultHeaders: {},
    fetch: fetchImpl,
  });
  return { core, calls, fetchImpl };
}
