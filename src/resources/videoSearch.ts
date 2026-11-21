import type { HttpCore, RequestOptions } from '../core/http';
import { VideoSearchRequestDesc, type VideoSearchParams, type VideoSearchResponse } from '../schema/videoSearch';
import { assertSingleInput, prepareCheckedBody } from './request';

export class VideoSearchResource {
  private readonly http: HttpCore;

  constructor(http: HttpCore) {
    this.http = http;
  }

  async search(params: VideoSearchParams, options?: RequestOptions): Promise<VideoSearchResponse> {
    const body = prepareCheckedBody(VideoSearchRequestDesc, params, assertSingleInput);
    return await this.http.post('/video-search', body, options);
  }
}
