import type { HttpCore, RequestOptions } from '../core/http';
import { EmbeddingRequestDesc, type EmbeddingParams, type EmbeddingResponse } from '../schema/embedding';
import { assertEmbeddingInput, prepareCheckedBody } from './request';

export class EmbeddingResource {
  private readonly http: HttpCore;

  constructor(http: HttpCore) {
    this.http = http;
  }

  /** Text embeddings for 1 to 1000 strings (POST /embedding); `data.results[i].index` matches the input position. */
  async create(params: EmbeddingParams, options?: RequestOptions): Promise<EmbeddingResponse> {
    return await this.http.post('/embedding', prepareCheckedBody(EmbeddingRequestDesc, params, assertEmbeddingInput), options);
  }
}
