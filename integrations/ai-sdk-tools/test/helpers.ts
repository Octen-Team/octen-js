import { Octen } from '@octen.ai/sdk';

export type Recorded = { url: string; body: unknown };

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export function recordingFetch(reply: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Recorded[] = [];
  const fakeFetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return await reply(url, init);
  }) as typeof fetch;
  return { fakeFetch, calls };
}

export function clientFor(fakeFetch: typeof fetch): Octen {
  return new Octen({ apiKey: 'test-key', fetch: fakeFetch, maxRetries: 0 });
}

// Calls execute the way the AI SDK does; context is required by ai@7's ToolExecutionOptions.
export function run(t: { execute?: unknown }, input: unknown, abortSignal?: AbortSignal) {
  const execute = t.execute as (input: unknown, options: unknown) => Promise<unknown>;
  return execute(input, { toolCallId: 't1', messages: [], abortSignal, context: undefined });
}

// Rejects once the request's signal aborts, like a real fetch would.
export function hangUntilAborted(init: RequestInit | undefined): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    const fail = () => reject(signal?.reason ?? new DOMException('aborted', 'AbortError'));
    if (signal?.aborted === true) fail();
    else signal?.addEventListener('abort', fail, { once: true });
  });
}
