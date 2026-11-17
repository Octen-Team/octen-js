import { OctenValidationError } from '../core/errors';
import { checkUnknownFields, stripUndefined, type ObjectDesc } from '../schema/descriptor';

/** 校验 query（必填、去空白后非空）与未知字段，返回去掉 undefined 值的请求体。 */
export function prepareBody(desc: ObjectDesc, params: unknown): unknown {
  const query = typeof params === 'object' && params !== null ? (params as { query?: unknown }).query : undefined;
  if (typeof query !== 'string' || query.trim() === '') {
    throw new OctenValidationError('query', 'query is required and must be a non-empty string.');
  }
  checkUnknownFields(desc, params);
  return stripUndefined(params);
}
