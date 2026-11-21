import type { HttpCore, RequestOptions } from '../core/http';
import { ImageSearchRequestDesc, type ImageSearchParams, type ImageSearchResponse } from '../schema/imageSearch';
import { assertSingleInput, prepareCheckedBody } from './request';

export class ImageSearchResource {
  private readonly http: HttpCore;

  constructor(http: HttpCore) {
    this.http = http;
  }

  async search(params: ImageSearchParams, options?: RequestOptions): Promise<ImageSearchResponse> {
    const body = prepareCheckedBody(ImageSearchRequestDesc, params, assertSingleInput);
    return await this.http.post('/image-search', body, options);
  }
}
