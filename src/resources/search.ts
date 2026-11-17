import type { HttpCore, RequestOptions } from '../core/http';
import { BroadSearchRequestDesc, type BroadSearchParams, type BroadSearchResponse } from '../schema/broadSearch';
import { BusinessSearchRequestDesc, type BusinessSearchParams, type BusinessSearchResponse } from '../schema/businessSearch';
import { NewsSearchRequestDesc, type NewsSearchParams, type NewsSearchResponse } from '../schema/newsSearch';
import { PulseSearchRequestDesc, type PulseSearchParams, type PulseSearchResponse } from '../schema/pulseSearch';
import { SearchRequestDesc, type SearchParams, type SearchResponse } from '../schema/search';
import { prepareBody } from './request';

// broadSearch runs several searches in parallel, so the 30 s default is too short; precedence: per-call timeout > explicit client timeout > 120 s
const BROAD_SEARCH_TIMEOUT_MS = 120_000;

export class SearchResource {
  private readonly http: HttpCore;
  private readonly clientTimeoutExplicit: boolean;

  constructor(http: HttpCore, clientTimeoutExplicit = false) {
    this.http = http;
    this.clientTimeoutExplicit = clientTimeoutExplicit;
  }

  async search(params: SearchParams, options?: RequestOptions): Promise<SearchResponse> {
    return await this.http.post('/search', prepareBody(SearchRequestDesc, params), options);
  }

  async broadSearch(params: BroadSearchParams, options?: RequestOptions): Promise<BroadSearchResponse> {
    const body = prepareBody(BroadSearchRequestDesc, params);
    // If the client sets timeout explicitly, pass it through to HttpCore as is (it uses the client's value); otherwise add 120 s
    if (this.clientTimeoutExplicit && options?.timeout == null) {
      return await this.http.post('/broad-search', body, options);
    }
    return await this.http.post('/broad-search', body, {
      ...options,
      timeout: options?.timeout ?? BROAD_SEARCH_TIMEOUT_MS,
    });
  }

  async newsSearch(params: NewsSearchParams, options?: RequestOptions): Promise<NewsSearchResponse> {
    return await this.http.post('/news-search', prepareBody(NewsSearchRequestDesc, params), options);
  }

  async businessSearch(params: BusinessSearchParams, options?: RequestOptions): Promise<BusinessSearchResponse> {
    return await this.http.post('/business-search', prepareBody(BusinessSearchRequestDesc, params), options);
  }

  async pulseSearch(params: PulseSearchParams, options?: RequestOptions): Promise<PulseSearchResponse> {
    return await this.http.post('/pulse-search', prepareBody(PulseSearchRequestDesc, params), options);
  }
}
