import Octen from './client';

export default Octen;
export { Octen };
export type { ClientOptions } from './client';
export {
  OctenAbortError,
  OctenAPIError,
  OctenAuthenticationError,
  OctenBadRequestError,
  OctenConnectionError,
  OctenError,
  OctenPermissionDeniedError,
  OctenRateLimitError,
  OctenServerError,
  OctenTimeoutError,
  OctenValidationError,
  isOctenError,
} from './core/errors';
export type { RequestOptions } from './core/http';
export type { BroadSearchParams, BroadSearchResponse } from './schema/broadSearch';
export type { BusinessSearchParams, BusinessSearchResponse } from './schema/businessSearch';
export type { DesignSearchParams, DesignSearchResponse } from './schema/designSearch';
export type { EmbeddingParams, EmbeddingResponse } from './schema/embedding';
export type { ExtractParams, ExtractResponse } from './schema/extract';
export type { ImageSearchParams, ImageSearchResponse } from './schema/imageSearch';
export type { NewsSearchParams, NewsSearchResponse } from './schema/newsSearch';
export type { PlaceSearchParams, PlaceSearchResponse } from './schema/placeSearch';
export type { PulseSearchParams, PulseSearchResponse } from './schema/pulseSearch';
export type {
  SearchParams,
  SearchPremierParams,
  SearchPremierResponse,
  SearchResponse,
} from './schema/search';
export type { VideoSearchParams, VideoSearchResponse } from './schema/videoSearch';
export type { VLEmbeddingParams, VLEmbeddingResponse } from './schema/vlEmbedding';
export { VERSION } from './version';
