import type { HttpCore, RequestOptions } from '../core/http';
import { BroadSearchRequestDesc, type BroadSearchParams, type BroadSearchResponse } from '../schema/broadSearch';
import { BusinessSearchRequestDesc, type BusinessSearchParams, type BusinessSearchResponse } from '../schema/businessSearch';
import { NewsSearchRequestDesc, type NewsSearchParams, type NewsSearchResponse } from '../schema/newsSearch';
import { PulseSearchRequestDesc, type PulseSearchParams, type PulseSearchResponse } from '../schema/pulseSearch';
import { SearchRequestDesc, type SearchParams, type SearchResponse } from '../schema/search';
import { prepareBody } from './request';

// broadSearch 要并行跑多路搜索，默认 30 秒不够（设计文档 §5.5）；优先级：单次 timeout > 客户端显式 timeout > 120 秒
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
    // 客户端显式设了 timeout 就原样交给 HttpCore（它会用客户端的值），否则补上 120 秒
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
