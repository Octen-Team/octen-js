import { isBrowser, readApiKeyFromEnv } from './core/env';
import { OctenValidationError } from './core/errors';
import { assertValidHeaders } from './core/headers';
import { HttpCore } from './core/http';
import { PlaceSearchResource } from './resources/placeSearch';
import { SearchResource } from './resources/search';

const DEFAULT_BASE_URL = 'https://api.octen.ai';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;

export type ClientOptions = {
  // 可选项显式传 undefined 等同没传，便于 exactOptionalPropertyTypes 下写 { apiKey: process.env.X }
  /** 缺省读环境变量 OCTEN_API_KEY */
  apiKey?: string | undefined;
  /** 默认 https://api.octen.ai */
  baseURL?: string | undefined;
  /** 毫秒，默认 30000；显式设置时对所有接口生效（含 broadSearch） */
  timeout?: number | undefined;
  /** 默认 3 */
  maxRetries?: number | undefined;
  defaultHeaders?: Record<string, string> | undefined;
  fetch?: typeof fetch | undefined;
  /** 浏览器里会暴露 API Key，必须显式确认 */
  dangerouslyAllowBrowser?: boolean | undefined;
};

function resolveApiKey(opts: ClientOptions): string {
  const key = opts.apiKey === undefined ? readApiKeyFromEnv() : opts.apiKey;
  if (typeof key !== 'string' || key.trim() === '') {
    throw new OctenValidationError(
      'apiKey',
      'An API key is required: pass `apiKey` or set the OCTEN_API_KEY environment variable.',
    );
  }
  try {
    new Headers().set('x-api-key', key);
  } catch {
    throw new OctenValidationError('apiKey', 'apiKey contains characters that are not valid in an HTTP header.');
  }
  return key;
}

function resolveBaseURL(value: string | undefined): string {
  const raw = value === undefined ? DEFAULT_BASE_URL : value;
  // 只接受 http(s)://host[:port][/path 前缀]；空白、query、hash 都会拼出坏 URL
  const wellFormed =
    typeof raw === 'string' && /^https?:\/\/[^\s/?#]+[^\s?#]*$/i.test(raw) && URL.canParse(raw);
  if (!wellFormed) {
    throw new OctenValidationError(
      'baseURL',
      'baseURL must be an absolute http(s) URL without whitespace, query or fragment.',
    );
  }
  return raw.replace(/\/+$/, '');
}

function resolveTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new OctenValidationError('timeout', 'timeout must be a finite number of milliseconds greater than 0.');
  }
  return value;
}

function resolveMaxRetries(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_RETRIES;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new OctenValidationError('maxRetries', 'maxRetries must be a non-negative integer.');
  }
  return value;
}

function resolveFetch(value: typeof fetch | undefined): typeof fetch {
  // 包一层让用户传入的 fetch 以 this === undefined 调用，避免 Workers/浏览器里 Illegal invocation
  if (value !== undefined) return (input, init) => value(input, init);
  if (typeof globalThis.fetch !== 'function') {
    throw new OctenValidationError('fetch', 'No global fetch is available; pass a `fetch` implementation.');
  }
  // 调用时才取全局 fetch，便于测试替换与运行时 polyfill
  return (input, init) => globalThis.fetch(input, init);
}

export default class Octen {
  readonly search: SearchResource;
  readonly placeSearch: PlaceSearchResource;

  constructor(opts: ClientOptions = {}) {
    if (isBrowser() && opts.dangerouslyAllowBrowser !== true) {
      throw new OctenValidationError(
        'dangerouslyAllowBrowser',
        'Octen looks like it is running in a browser, where the API key would be exposed to anyone who ' +
          'opens the page. Call the API from your server instead, or pass `dangerouslyAllowBrowser: true` ' +
          'if you accept that risk.',
      );
    }
    const apiKey = resolveApiKey(opts);
    const baseURL = resolveBaseURL(opts.baseURL);
    const timeoutMs = resolveTimeout(opts.timeout);
    const maxRetries = resolveMaxRetries(opts.maxRetries);
    assertValidHeaders(opts.defaultHeaders, 'headers');
    const defaultHeaders = { ...opts.defaultHeaders };
    const http = new HttpCore({
      apiKey,
      baseURL,
      timeoutMs,
      maxRetries,
      defaultHeaders,
      fetch: resolveFetch(opts.fetch),
    });
    this.search = new SearchResource(http, opts.timeout !== undefined);
    this.placeSearch = new PlaceSearchResource(http);
  }
}

export { Octen };
