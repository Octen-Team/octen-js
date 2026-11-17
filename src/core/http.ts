import { judgeResponse } from './envelope';
import {
  OctenAbortError,
  OctenConnectionError,
  OctenTimeoutError,
  OctenValidationError,
} from './errors';
import { isPreSendNetworkError, isRetryableStatus, parseRetryAfter, retryDelayMs } from './retry';
import { VERSION } from '../version';

export type RequestOptions = {
  /** 毫秒，覆盖本次请求的超时 */
  timeout?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
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
    const headers = this.buildHeaders(req.headers);
    const timeoutMs = req.timeout ?? this.timeoutMs;
    const callerSignal = req.signal;

    for (let attempt = 1; ; attempt++) {
      if (callerSignal?.aborted) throw abortError(callerSignal);

      const result = await this.attemptOnce(url, headers, payload, timeoutMs, callerSignal);

      if (result.kind === 'response') {
        const judged = judgeResponse(result.status, result.headers, result.text);
        if (judged.ok) return judged.body as T;
        if (!isRetryableStatus(result.status) || attempt > this.maxRetries) throw judged.error;
        const retryAfterMs = parseRetryAfter(result.headers.get('retry-after'), Date.now());
        const delay = retryDelayMs(attempt, result.status, retryAfterMs, this.random);
        if (delay === 'give-up') throw judged.error;
        await this.backoff(delay, callerSignal);
        continue;
      }

      if (!result.retryable || attempt > this.maxRetries) throw result.error;
      const delay = retryDelayMs(attempt, null, null, this.random);
      if (delay === 'give-up') throw result.error;
      await this.backoff(delay, callerSignal);
    }
  }

  private serialize(body: unknown): string {
    try {
      return JSON.stringify(body);
    } catch (err) {
      throw new OctenValidationError('body', `Request body is not JSON-serialisable: ${String(err)}`);
    }
  }

  // 用 Headers 合并以便大小写不敏感；API Key 最后写入，不允许被覆盖。
  private buildHeaders(perRequest: Record<string, string> | undefined): Record<string, string> {
    const merged = new Headers({
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': `octen-js-sdk/${VERSION}`,
    });
    for (const source of [this.defaultHeaders, perRequest]) {
      for (const [k, v] of Object.entries(source ?? {})) merged.set(k, v);
    }
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
    if (callerSignal?.aborted) throw abortError(callerSignal);
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
        error: new OctenConnectionError(undefined, { cause: err }),
        retryable: !sent && isPreSendNetworkError(err),
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  }
}
