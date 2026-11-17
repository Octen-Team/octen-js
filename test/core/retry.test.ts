import { describe, expect, test } from 'vitest';
import {
  RETRYABLE_STATUS,
  isPreSendNetworkError,
  isRetryableStatus,
  parseRetryAfter,
  retryDelayMs,
} from '../../src/core/retry';

describe('retry rules', () => {
  test('retryable statuses', () => {
    for (const s of [408, 429, 500, 502, 503, 504]) expect(isRetryableStatus(s)).toBe(true);
    for (const s of [400, 401, 403, 404, 422, 501]) expect(isRetryableStatus(s)).toBe(false);
  });

  test('RETRYABLE_STATUS holds exactly the retryable set', () => {
    expect([...RETRYABLE_STATUS].sort((a, b) => a - b)).toEqual([408, 429, 500, 502, 503, 504]);
  });

  test('backoff with jitter bounds', () => {
    expect(retryDelayMs(1, 500, null, () => 0)).toBe(1000);
    expect(retryDelayMs(3, 500, null, () => 1)).toBe(5000); // 4000 × 1.25
    expect(retryDelayMs(10, 500, null, () => 1)).toBe(60000); // cap
  });

  test('Retry-After only for 429 and 503', () => {
    expect(retryDelayMs(1, 429, 7000, () => 0)).toBe(7000);
    expect(retryDelayMs(1, 503, 7000, () => 0)).toBe(7000);
    expect(retryDelayMs(1, 502, 7000, () => 0)).toBe(1000);
  });

  test('Retry-After over 60s gives up', () => {
    expect(retryDelayMs(1, 429, 60001, () => 0)).toBe('give-up');
  });

  test('test_retry_after_zero_means_now', () => {
    expect(retryDelayMs(1, 429, 0, () => 0)).toBe(0);
  });

  test('parseRetryAfter seconds and http-date', () => {
    const now = Date.parse('2026-11-17T00:00:00Z');
    expect(parseRetryAfter('5', now)).toBe(5000);
    expect(parseRetryAfter('Tue, 17 Nov 2026 00:00:10 GMT', now)).toBe(10000);
    expect(parseRetryAfter('garbage', now)).toBeNull();
  });

  test('parseRetryAfter: past date is 0, null header is null', () => {
    const now = Date.parse('2026-11-17T00:00:00Z');
    expect(parseRetryAfter('Tue, 17 Nov 2026 00:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter('Mon, 16 Nov 2026 00:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter(null, now)).toBeNull();
  });

  test('parseRetryAfter: valid delta-seconds and trimmed whitespace', () => {
    const now = Date.parse('2026-11-17T00:00:00Z');
    expect(parseRetryAfter('5', now)).toBe(5000);
    expect(parseRetryAfter(' 5 ', now)).toBe(5000);
  });

  // V8's Date.parse leniently accepts these inputs as past dates (giving 0 = retry immediately); they must return null so callers fall back to backoff.
  test.each(['5.5', '-1', '+5', '1.', '3 4', '-5 ', '', '1e3'])(
    'parseRetryAfter: malformed %j returns null',
    (header) => {
      const now = Date.parse('2026-11-17T00:00:00Z');
      expect(parseRetryAfter(header, now)).toBeNull();
    },
  );

  test('pre-send network error whitelist', () => {
    const e = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: { code } });
    for (const c of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']) expect(isPreSendNetworkError(e(c))).toBe(true);
    for (const c of ['ECONNRESET', 'UND_ERR_SOCKET']) expect(isPreSendNetworkError(e(c))).toBe(false);
    expect(isPreSendNetworkError(new TypeError('fetch failed'))).toBe(false);
  });
});
