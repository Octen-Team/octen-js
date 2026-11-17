import { OctenValidationError } from '../core/errors';
import { checkUnknownFields, isPlainObject, stripUndefined, type ObjectDesc } from '../schema/descriptor';

/** 校验 query（必填、去空白后非空）与未知字段，返回去掉 undefined 值的请求体。 */
export function prepareBody(desc: ObjectDesc, params: unknown): unknown {
  const query = typeof params === 'object' && params !== null ? (params as { query?: unknown }).query : undefined;
  if (typeof query !== 'string' || query.trim() === '') {
    throw new OctenValidationError('query', 'query is required and must be a non-empty string.');
  }
  checkUnknownFields(desc, params);
  assertJsonSafe(params, '');
  return stripUndefined(params);
}

// JSON.stringify would send NaN, ±Infinity and undefined (or missing) array items as null,
// silently changing the request; reject them with the same path format as checkUnknownFields.
function assertJsonSafe(value: unknown, path: string): void {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new OctenValidationError(path, `${path} must be a finite number, got ${String(value)}.`);
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const itemPath = `${path}[${i}]`;
      if (value[i] === undefined) {
        throw new OctenValidationError(itemPath, `${itemPath} is undefined; arrays cannot contain undefined items.`);
      }
      assertJsonSafe(value[i], itemPath);
    }
  } else if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) assertJsonSafe(child, path ? `${path}.${key}` : key);
  }
}
