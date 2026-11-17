import { judgeResponse } from './envelope';
import {
  OctenAbortError,
  OctenAPIError,
  OctenConnectionError,
  OctenTimeoutError,
  OctenValidationError,
} from './errors';
import { normalizeHeaders } from './headers';
import { isPreSendNetworkError, isRetryableStatus, parseRetryAfter, retryDelayMs } from './retry';
import { VERSION } from '../version';

export type RequestOptions = {
  /** 毫秒，覆盖本次请求的超时 */
  timeout?: number | undefined;
  signal?: AbortSignal | undefined;
  headers?: Record<string, string> | undefined;
};

export type HttpCoreOptions = {
  apiKey: string;
  baseURL: string;
  timeoutMs: number;
  maxRetries: number;
  defaultHeaders: Record<string, string>;
  fetch: typeof fetch;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

type AttemptResult =
  | { kind: 'response'; status: number; headers: Headers; text: string }
  | { kind: 'error'; error: Error; retryable: boolean };

// 让 promise 在 signal 中止时立即以 signal.reason 拒绝，即使底层实现不理会 signal。
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

// 可被 signal 打断的默认 sleep；中止时清掉定时器，不让进程多挂最长 60 秒。
function interruptibleSleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError(signal: AbortSignal): OctenAbortError {
  return new OctenAbortError('Request was aborted.', { cause: signal.reason });
}

// Larger values overflow setTimeout's 32-bit delay and fire after 1 ms.
const MAX_TIMEOUT_MS = 2_147_483_647;

export function assertValidTimeout(value: unknown, field = 'timeout'): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > MAX_TIMEOUT_MS) {
    throw new OctenValidationError(
      field,
      `${field} must be a finite number of milliseconds greater than 0 and at most ${MAX_TIMEOUT_MS}.`,
    );
  }
}

function stringCode(x: unknown): string | undefined {
  if (typeof x !== 'object' || x === null || !('code' in x)) return undefined;
  return typeof x.code === 'string' ? x.code : undefined;
}

// Node's fetch only says "fetch failed"; the errno code sits on its cause.
function connectionErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const cause = typeof err === 'object' && err !== null && 'cause' in err ? err.cause : undefined;
  const code = stringCode(err) ?? stringCode(cause);
  return `Connection error: ${message}${code === undefined ? '' : ` (${code})`}`;
}

function isRedirect(status: number): boolean {
  return status === 0 || (status >= 300 && status < 400);
}

// fetch runs with redirect: 'manual'; browsers hide the redirect behind status 0 (opaque redirect).
function redirectError(err: OctenAPIError, headers: Headers): OctenAPIError {
  const location = headers.get('location');
  const message =
    err.status === 0
      ? 'A redirect was blocked (status 0, opaque redirect); redirects are not followed, check baseURL'
      : `HTTP ${err.status} redirect${location ? ` to ${location}` : ''}; redirects are not followed, check baseURL`;
  return new OctenAPIError({ status: err.status, code: err.code, message, requestId: err.requestId, body: err.body });
}

export class HttpCore {
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly defaultHeaders: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly random: () => number;
  private readonly sleepImpl: ((ms: number) => Promise<void>) | undefined;

  constructor(opts: HttpCoreOptions) {
    this.apiKey = opts.apiKey;
    this.baseURL = opts.baseURL.replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs;
    this.maxRetries = opts.maxRetries;
    this.defaultHeaders = opts.defaultHeaders;
    this.fetchImpl = opts.fetch;
    this.random = opts.random ?? Math.random;
    this.sleepImpl = opts.sleep;
  }

  async post<T>(path: string, body: unknown, req: RequestOptions = {}): Promise<T> {
    const url = `${this.baseURL}${path.startsWith('/') ? '' : '/'}${path}`;
    const payload = this.serialize(body);
    if (req.timeout != null) assertValidTimeout(req.timeout);
    const headers = this.buildHeaders(normalizeHeaders(req.headers));
    const timeoutMs = req.timeout ?? this.timeoutMs;
    const callerSignal = req.signal;

    for (let attempt = 1; ; attempt++) {
      if (callerSignal?.aborted) throw abortError(callerSignal);

      const result = await this.attemptOnce(url, headers, payload, timeoutMs, callerSignal);
      let error: Error;
      let delay: number | null;
      if (result.kind === 'response') {
        const judged = judgeResponse(result.status, result.headers, result.text);
        if (judged.ok) return judged.body as T;
        if (isRedirect(result.status)) throw redirectError(judged.error, result.headers);
        error = judged.error;
        delay = this.nextDelay(attempt, isRetryableStatus(result.status), result.status, result.headers);
      } else {
        error = result.error;
        delay = this.nextDelay(attempt, result.retryable, null, null);
      }
      if (delay === null) throw error;
      await this.backoff(delay, callerSignal);
    }
  }

  // Wait before the next attempt, or null to give up; status and headers are null for transport errors.
  private nextDelay(attempt: number, retryable: boolean, status: number | null, headers: Headers | null): number | null {
    if (!retryable || attempt > this.maxRetries) return null;
    const retryAfterMs = headers === null ? null : parseRetryAfter(headers.get('retry-after'), Date.now());
    const delay = retryDelayMs(attempt, status, retryAfterMs, this.random);
    return delay === 'give-up' ? null : delay;
  }

  private serialize(body: unknown): string {
    try {
      return JSON.stringify(body);
    } catch (err) {
      throw new OctenValidationError('body', `Request body is not JSON-serialisable: ${String(err)}`);
    }
  }

  // 用 Headers 合并以便大小写不敏感；API Key 最后写入，不允许被覆盖。
  private buildHeaders(perRequest: Headers): Record<string, string> {
    const merged = new Headers({
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': `octen-js-sdk/${VERSION}`,
    });
    for (const [k, v] of Object.entries(this.defaultHeaders)) merged.set(k, v);
    for (const [k, v] of perRequest) merged.set(k, v);
    merged.set('x-api-key', this.apiKey);
    return Object.fromEntries(merged.entries());
  }

  private async backoff(ms: number, callerSignal: AbortSignal | undefined): Promise<void> {
    try {
      if (this.sleepImpl === undefined) {
        await interruptibleSleep(ms, callerSignal);
      } else {
        const pending = this.sleepImpl(ms);
        await (callerSignal === undefined ? pending : abortable(pending, callerSignal));
      }
    } catch (err) {
      if (callerSignal?.aborted) throw abortError(callerSignal);
      throw err;
    }
  }

  // 一次尝试：超时计时与响应体读取同属一个 signal，读完正文才解除。
  private async attemptOnce(
    url: string,
    headers: Record<string, string>,
    payload: string,
    timeoutMs: number,
    callerSignal: AbortSignal | undefined,
  ): Promise<AttemptResult> {
    const controller = new AbortController();
    let reason: 'timeout' | 'caller' | null = null;

    const onCallerAbort = () => {
      if (reason !== null) return;
      reason = 'caller';
      controller.abort(callerSignal?.reason);
    };
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true });

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        if (reason !== null) return;
        reason = 'timeout';
        controller.abort(new OctenTimeoutError());
      }, timeoutMs);
    }

    let sent = false;
    try {
      const res = await abortable(
        Promise.resolve(
          this.fetchImpl(url, {
            method: 'POST',
            headers,
            body: payload,
            redirect: 'manual',
            signal: controller.signal,
          }),
        ),
        controller.signal,
      );
      sent = true;
      const text = await abortable(res.text(), controller.signal);
      return { kind: 'response', status: res.status, headers: res.headers, text };
    } catch (err) {
      if (reason === 'timeout') {
        return { kind: 'error', error: new OctenTimeoutError(undefined, { cause: err }), retryable: false };
      }
      if (reason === 'caller' && callerSignal !== undefined) {
        return { kind: 'error', error: abortError(callerSignal), retryable: false };
      }
      return {
        kind: 'error',
        error: new OctenConnectionError(connectionErrorMessage(err), { cause: err }),
        retryable: !sent && isPreSendNetworkError(err),
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  }
}
