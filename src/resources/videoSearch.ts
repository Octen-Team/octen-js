import type { HttpCore, RequestOptions } from '../core/http';
import { VideoSearchRequestDesc, type VideoSearchParams, type VideoSearchResponse } from '../schema/videoSearch';
import { prepareCheckedBody, singleInputCheck } from './request';

const checkInput = singleInputCheck(VideoSearchRequestDesc.fields.inputs.items.fields.type.enum);

export class VideoSearchResource {
  private readonly http: HttpCore;

  constructor(http: HttpCore) {
    this.http = http;
  }

  async search(params: VideoSearchParams, options?: RequestOptions): Promise<VideoSearchResponse> {
    const body = prepareCheckedBody(VideoSearchRequestDesc, params, checkInput);
    return await this.http.post('/video-search', body, options);
  }
}
