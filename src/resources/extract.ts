import type { HttpCore, RequestOptions } from '../core/http';
import { ExtractRequestDesc, type ExtractParams, type ExtractResponse } from '../schema/extract';
import { assertUrls, prepareCheckedBody } from './request';

// The body's timeout bounds each URL on the server, not the whole call; the HTTP default adds headroom for the batch.
// The per-URL value is clamped like the server does (1-60 s, default 30), giving 91-150 s.
const DEFAULT_PER_URL_TIMEOUT_S = 30;
const HEADROOM_S = 90;

export function defaultExtractTimeoutMs(perUrlTimeout: unknown): number {
  const perUrl =
    typeof perUrlTimeout === 'number' && Number.isFinite(perUrlTimeout)
      ? Math.min(60, Math.max(1, perUrlTimeout))
      : DEFAULT_PER_URL_TIMEOUT_S;
  return (perUrl + HEADROOM_S) * 1000;
}

export class ExtractResource {
  private readonly http: HttpCore;
  private readonly clientTimeoutExplicit: boolean;

  constructor(http: HttpCore, clientTimeoutExplicit = false) {
    this.http = http;
    this.clientTimeoutExplicit = clientTimeoutExplicit;
  }

  /** Precedence for the HTTP timeout: per-call `timeout` option, explicit client timeout, then the derived default. */
  async extract(params: ExtractParams, options?: RequestOptions): Promise<ExtractResponse> {
    const body = prepareCheckedBody(ExtractRequestDesc, params, assertUrls);
    if (this.clientTimeoutExplicit && options?.timeout == null) {
      return await this.http.post('/extract', body, options);
    }
    return await this.http.post('/extract', body, {
      ...options,
      timeout: options?.timeout ?? defaultExtractTimeoutMs(params.timeout),
    });
  }
}
