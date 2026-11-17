export const RETRYABLE_STATUS: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);

const MAX_DELAY_MS = 60000;
const BASE_DELAY_MS = 1000;
const RETRY_AFTER_STATUS: ReadonlySet<number> = new Set([429, 503]);
const PRE_SEND_ERROR_CODES: ReadonlySet<string> = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);
// Only strings shaped like "Tue, 17 Nov 2026 00:00:10 GMT" go to Date.parse (it leniently returns past dates for "5.5", "-1", etc.).
const HTTP_DATE_SHAPE = /^[A-Za-z]{3,9},?\s+\S.*\d{2}:\d{2}:\d{2}/;

export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

// Seconds (non-negative integer) or an HTTP date; a past date returns 0, an unparseable value returns null.
export function parseRetryAfter(header: string | null, now: number): number | null {
  if (header === null) return null;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  if (!HTTP_DATE_SHAPE.test(value)) return null;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

// attempt starts at 1; with Retry-After on 429/503 it takes precedence, and exceeding the cap gives up.
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

// Only connection errors that fail before the request is sent (a TypeError from fetch whose cause.code is in the allowlist).
export function isPreSendNetworkError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('cause' in err)) return false;
  const cause = err.cause;
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return false;
  return typeof cause.code === 'string' && PRE_SEND_ERROR_CODES.has(cause.code);
}
