import { OctenValidationError } from '../core/errors';
import { checkUnknownFields, isPlainObject, stripUndefined, type ObjectDesc } from '../schema/descriptor';

/** Checks query (required, non-blank), unknown keys and JSON-unsafe values; returns the body without undefined keys. */
export function prepareBody(desc: ObjectDesc, params: unknown): unknown {
  return prepareCheckedBody(desc, params, assertQuery);
}

/** Like prepareBody, with the endpoint's own check of required inputs in place of the query check. */
export function prepareCheckedBody(
  desc: ObjectDesc,
  params: unknown,
  checkRequired: (params: unknown) => void,
): unknown {
  checkRequired(params);
  checkUnknownFields(desc, params);
  assertJsonSafe(params, '');
  return stripUndefined(params);
}

function field(params: unknown, key: string): unknown {
  return typeof params === 'object' && params !== null ? (params as Record<string, unknown>)[key] : undefined;
}

function isNonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function assertQuery(params: unknown): void {
  if (!isNonBlank(field(params, 'query'))) {
    throw new OctenValidationError('query', 'query is required and must be a non-empty string.');
  }
}

/**
 * /image-search and /video-search: exactly one input of an allowed type (the descriptor's enum);
 * text needs data, an image exactly one of url or data.
 */
export function singleInputCheck(allowedTypes: readonly string[]): (params: unknown) => void {
  return (params) => assertSingleInput(params, allowedTypes);
}

function assertSingleInput(params: unknown, allowedTypes: readonly string[]): void {
  const inputs = field(params, 'inputs');
  if (!Array.isArray(inputs) || inputs.length !== 1) {
    throw new OctenValidationError('inputs', 'inputs is required and must be an array with exactly one input.');
  }
  const input: unknown = inputs[0];
  if (!isPlainObject(input)) throw new OctenValidationError('inputs[0]', 'inputs[0] must be an object.');
  const { type, url, data } = input;
  if (typeof type !== 'string' || !allowedTypes.includes(type)) {
    throw new OctenValidationError('inputs[0].type', `inputs[0].type must be one of: ${allowedTypes.join(', ')}.`);
  }
  if (type === 'text' && !isNonBlank(data)) {
    throw new OctenValidationError('inputs[0].data', 'A text input needs data: a non-empty query string.');
  }
  if (type === 'image') {
    const given = [url, data].filter((v) => v !== undefined);
    if (given.length !== 1 || typeof given[0] !== 'string' || given[0] === '') {
      throw new OctenValidationError(
        'inputs[0]',
        'An image input needs exactly one of url or data, as a non-empty string.',
      );
    }
  }
}

/** /design-search: a non-blank query, unless images.group_id is set (a group lookup). */
export function assertQueryOrGroup(params: unknown): void {
  const query = field(params, 'query');
  if (query !== undefined && typeof query !== 'string') {
    throw new OctenValidationError('query', 'query must be a string.');
  }
  if (isNonBlank(query) || isNonBlank(field(field(params, 'images'), 'group_id'))) return;
  throw new OctenValidationError('query', 'query is required unless images.group_id is set; both are missing or blank.');
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
