import type { HttpCore, RequestOptions } from '../core/http';
import { ImageSearchRequestDesc, type ImageSearchParams, type ImageSearchResponse } from '../schema/imageSearch';
import { prepareCheckedBody, singleInputCheck } from './request';

const checkInput = singleInputCheck(ImageSearchRequestDesc.fields.inputs.items.fields.type.enum);

export class ImageSearchResource {
  private readonly http: HttpCore;

  constructor(http: HttpCore) {
    this.http = http;
  }

  async search(params: ImageSearchParams, options?: RequestOptions): Promise<ImageSearchResponse> {
    const body = prepareCheckedBody(ImageSearchRequestDesc, params, checkInput);
    return await this.http.post('/image-search', body, options);
  }
}
