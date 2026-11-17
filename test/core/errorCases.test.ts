import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { OctenRateLimitError } from '../../src/core/errors';
import { judgeResponse } from '../../src/core/envelope';

type Case = {
  name: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  expect: {
    ok: boolean;
    class?: string;
    code?: number | null;
    message?: string;
    retryAfter?: number | null;
    requestId?: string | null;
  };
};

const cases = JSON.parse(
  readFileSync(new URL('../../testdata/error_cases.json', import.meta.url), 'utf8'),
) as Case[];

describe('shared error cases (testdata/error_cases.json)', () => {
  test('file is non-empty and names are unique', () => {
    expect(cases.length).toBeGreaterThan(30);
    expect(new Set(cases.map((c) => c.name)).size).toBe(cases.length);
  });

  test.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const result = judgeResponse(c.status, new Headers(c.headers), c.body);
    expect(result.ok).toBe(c.expect.ok);
    if (result.ok) {
      expect(typeof result.body).toBe('object');
      return;
    }
    const err = result.error;
    expect(err.constructor.name).toBe(c.expect.class);
    expect(err.status).toBe(c.status);
    if (c.expect.code !== undefined) expect(err.code).toBe(c.expect.code);
    if (c.expect.message !== undefined) expect(err.message).toBe(c.expect.message);
    if (c.expect.requestId !== undefined) expect(err.requestId).toBe(c.expect.requestId);
    if (c.expect.retryAfter !== undefined) {
      expect(err).toBeInstanceOf(OctenRateLimitError);
      expect((err as OctenRateLimitError).retryAfter).toBe(c.expect.retryAfter);
    }
  });
});
