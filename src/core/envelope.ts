import {
  OctenAPIError,
  OctenAuthenticationError,
  OctenBadRequestError,
  OctenPermissionDeniedError,
  OctenRateLimitError,
  OctenServerError,
  type APIErrorInit,
} from './errors';
import { parseRetryAfter } from './retry';

export type Judgement =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: OctenAPIError };

const MESSAGE_KEYS = ['msg', 'message', 'detail', 'error'] as const;
const MESSAGE_RAW_LIMIT = 500;

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function tryParse(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

// 依次取 msg、message、detail、error；error 是对象时在里面递归找。
function findMessage(obj: Record<string, unknown>): string | null {
  for (const key of MESSAGE_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v !== '') return v;
    if (key === 'error' && isRecord(v)) {
      const nested = findMessage(v);
      if (nested !== null) return nested;
    }
  }
  return null;
}

function extractMessage(parsed: unknown, rawText: string, status: number): string {
  if (isRecord(parsed)) {
    const found = findMessage(parsed);
    if (found !== null) return found;
  }
  const raw = rawText.slice(0, MESSAGE_RAW_LIMIT);
  return raw !== '' ? raw : `HTTP ${status}`;
}

function extractCode(parsed: unknown): number | null {
  if (!isRecord(parsed)) return null;
  const code = parsed.code;
  return typeof code === 'number' && Number.isFinite(code) ? code : null;
}

function extractRequestId(headers: Headers, parsed: unknown): string | null {
  const fromHeader = headers.get('x-request-id');
  if (fromHeader !== null && fromHeader !== '') return fromHeader;
  if (isRecord(parsed) && typeof parsed.request_id === 'string' && parsed.request_id !== '') {
    return parsed.request_id;
  }
  return null;
}

function retryAfterSeconds(headers: Headers): number | null {
  const ms = parseRetryAfter(headers.get('retry-after'), Date.now());
  return ms === null ? null : Math.ceil(ms / 1000);
}

function buildError(status: number, headers: Headers, init: APIErrorInit): OctenAPIError {
  if (status === 401) return new OctenAuthenticationError(init);
  if (status === 403) return new OctenPermissionDeniedError(init);
  if (status === 400 || status === 422) return new OctenBadRequestError(init);
  if (status === 429) return new OctenRateLimitError({ ...init, retryAfter: retryAfterSeconds(headers) });
  if (status >= 500) return new OctenServerError(init);
  return new OctenAPIError(init);
}

// 2xx：响应体必须是非空 JSON 对象，且 code 不是非 0 数字；其余一律按状态码归类。
export function judgeResponse(status: number, headers: Headers, rawText: string): Judgement {
  const parsedResult = tryParse(rawText);
  const parsed = parsedResult.ok ? parsedResult.value : undefined;
  const failure = (): Judgement => ({
    ok: false,
    error: buildError(status, headers, {
      status,
      code: extractCode(parsed),
      message: extractMessage(parsed, rawText, status),
      requestId: extractRequestId(headers, parsed),
      body: parsedResult.ok ? parsed : rawText,
    }),
  });

  if (status < 200 || status >= 300) return failure();
  if (!isRecord(parsed) || Object.keys(parsed).length === 0) return failure();
  const code = parsed.code;
  if (typeof code === 'number' && code !== 0) return failure();
  return { ok: true, body: parsed };
}
