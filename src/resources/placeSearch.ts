import type { HttpCore, RequestOptions } from '../core/http';
import { PlaceSearchRequestDesc, type PlaceSearchParams, type PlaceSearchResponse } from '../schema/placeSearch';
import { prepareBody } from './request';

export class PlaceSearchResource {
  private readonly http: HttpCore;

  constructor(http: HttpCore) {
    this.http = http;
  }

  async search(params: PlaceSearchParams, options?: RequestOptions): Promise<PlaceSearchResponse> {
    return await this.http.post('/place-search', prepareBody(PlaceSearchRequestDesc, params), options);
  }
}
