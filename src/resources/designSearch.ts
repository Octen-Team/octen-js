import type { HttpCore, RequestOptions } from '../core/http';
import { DesignSearchRequestDesc, type DesignSearchParams, type DesignSearchResponse } from '../schema/designSearch';
import { assertQueryOrGroup, prepareCheckedBody } from './request';

export class DesignSearchResource {
  private readonly http: HttpCore;

  constructor(http: HttpCore) {
    this.http = http;
  }

  async search(params: DesignSearchParams, options?: RequestOptions): Promise<DesignSearchResponse> {
    const body = prepareCheckedBody(DesignSearchRequestDesc, params, assertQueryOrGroup);
    return await this.http.post('/design-search', body, options);
  }
}
