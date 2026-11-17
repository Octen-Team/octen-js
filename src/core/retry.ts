export const RETRYABLE_STATUS: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);

const MAX_DELAY_MS = 60000;
const BASE_DELAY_MS = 1000;
const RETRY_AFTER_STATUS: ReadonlySet<number> = new Set([429, 503]);
const PRE_SEND_ERROR_CODES: ReadonlySet<string> = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);
// 只有形如 "Tue, 17 Nov 2026 00:00:10 GMT" 的字符串才交给 Date.parse（它对 "5.5"、"-1" 等会宽松地返回过去的日期）。
const HTTP_DATE_SHAPE = /^[A-Za-z]{3,9},?\s+\S.*\d{2}:\d{2}:\d{2}/;

export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

// 秒数（非负整数）或 HTTP 日期；过去的日期返回 0，无法解析返回 null。
export function parseRetryAfter(header: string | null, now: number): number | null {
  if (header === null) return null;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  if (!HTTP_DATE_SHAPE.test(value)) return null;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

// attempt 从 1 开始；429/503 带 Retry-After 时以它为准，超过上限则放弃。
export function retryDelayMs(
  attempt: number,
  status: number | null,
  retryAfterMs: number | null,
  random: () => number,
): number | 'give-up' {
  if (status !== null && RETRY_AFTER_STATUS.has(status) && retryAfterMs !== null) {
    return retryAfterMs > MAX_DELAY_MS ? 'give-up' : retryAfterMs;
  }
  const backoff = BASE_DELAY_MS * 2 ** (attempt - 1) * (1 + 0.25 * random());
  return Math.min(MAX_DELAY_MS, backoff);
}

// 只认请求尚未发出就失败的连接错误（fetch 抛出的 TypeError，其 cause.code 在白名单内）。
export function isPreSendNetworkError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('cause' in err)) return false;
  const cause = err.cause;
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return false;
  return typeof cause.code === 'string' && PRE_SEND_ERROR_CODES.has(cause.code);
}
