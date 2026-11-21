import { isBrowser, readApiKeyFromEnv } from './core/env';
import { OctenValidationError } from './core/errors';
import { normalizeHeaders } from './core/headers';
import { assertValidTimeout, HttpCore } from './core/http';
import { DesignSearchResource } from './resources/designSearch';
import { ImageSearchResource } from './resources/imageSearch';
import { PlaceSearchResource } from './resources/placeSearch';
import { SearchResource } from './resources/search';
import { VideoSearchResource } from './resources/videoSearch';

const DEFAULT_BASE_URL = 'https://api.octen.ai';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;

export type ClientOptions = {
  // An explicit undefined means "not set", so { apiKey: process.env.X } works under exactOptionalPropertyTypes.
  /** Defaults to the OCTEN_API_KEY environment variable. */
  apiKey?: string | undefined;
  /** Defaults to https://api.octen.ai. */
  baseURL?: string | undefined;
  /**
   * Milliseconds per attempt. Once set it applies to every endpoint, broadSearch included;
   * when unset: 30000, and 120000 for broadSearch.
   */
  timeout?: number | undefined;
  /** Retries after the first attempt; defaults to 3. */
  maxRetries?: number | undefined;
  /** Plain object of headers sent with every request; must not contain x-api-key (use apiKey). */
  defaultHeaders?: Record<string, string> | undefined;
  /** Defaults to the runtime's global fetch. */
  fetch?: typeof fetch | undefined;
  /** Required in a browser, where the API key would be exposed to anyone who opens the page. */
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
  // Only http(s)://host[:port][/path prefix]; whitespace, a query or a hash would corrupt joined URLs.
  const wellFormed =
    typeof raw === 'string' && /^https?:\/\/[^\s/?#]+[^\s?#]*$/i.test(raw) && URL.canParse(raw);
  if (!wellFormed) {
    throw new OctenValidationError(
      'baseURL',
      'baseURL must be an absolute http(s) URL without whitespace, query or fragment.',
    );
  }
  const parsed = new URL(raw);
  if (parsed.username !== '' || parsed.password !== '') {
    throw new OctenValidationError('baseURL', 'baseURL must not contain credentials (user:password@); use apiKey.');
  }
  return raw.replace(/\/+$/, '');
}

function resolveTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  assertValidTimeout(value);
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
  // Call the user's fetch without the client as `this`, avoiding "Illegal invocation" in Workers and browsers.
  if (value !== undefined) return (input, init) => value(input, init);
  if (typeof globalThis.fetch !== 'function') {
    throw new OctenValidationError('fetch', 'No global fetch is available; pass a `fetch` implementation.');
  }
  // Look up the global fetch per call so test stubs and late polyfills are picked up.
  return (input, init) => globalThis.fetch(input, init);
}

export default class Octen {
  readonly search: SearchResource;
  readonly placeSearch: PlaceSearchResource;
  readonly imageSearch: ImageSearchResource;
  /** Invite-only beta: without beta access the API rejects the call. */
  readonly videoSearch: VideoSearchResource;
  readonly designSearch: DesignSearchResource;

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
    const defaultHeaders = Object.fromEntries(normalizeHeaders(opts.defaultHeaders, 'defaultHeaders'));
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
    this.imageSearch = new ImageSearchResource(http);
    this.videoSearch = new VideoSearchResource(http);
    this.designSearch = new DesignSearchResource(http);
  }
}
