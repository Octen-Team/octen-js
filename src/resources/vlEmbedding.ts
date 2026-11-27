import type { HttpCore, RequestOptions } from '../core/http';
import { VLEmbeddingRequestDesc, type VLEmbeddingParams, type VLEmbeddingResponse } from '../schema/vlEmbedding';
import { assertVLEmbeddingInput, prepareCheckedBody } from './request';

export class VLEmbeddingResource {
  private readonly http: HttpCore;

  constructor(http: HttpCore) {
    this.http = http;
  }

  /**
   * Multimodal embeddings (POST /vl-embedding): one vector per content item, or a single fused vector with
   * `enable_fusion: true`. A large video can take longer than the default timeout; raise `timeout` for it.
   */
  async create(params: VLEmbeddingParams, options?: RequestOptions): Promise<VLEmbeddingResponse> {
    return await this.http.post('/vl-embedding', prepareCheckedBody(VLEmbeddingRequestDesc, params, assertVLEmbeddingInput), options);
  }
}
