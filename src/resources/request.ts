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
  // The spec documents url for image inputs only
  if (type === 'text' && url !== undefined) {
    throw new OctenValidationError('inputs[0].url', 'A text input takes data only; url is for image inputs.');
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

const EMBEDDING_MAX_INPUTS = 1000;

/** /embedding: 1 to 1000 strings, none empty or only whitespace (the server accepts and bills blank items). */
export function assertEmbeddingInput(params: unknown): void {
  const input = field(params, 'input');
  if (!Array.isArray(input) || input.length === 0 || input.length > EMBEDDING_MAX_INPUTS) {
    throw new OctenValidationError('input', `input is required and must be an array of 1 to ${EMBEDDING_MAX_INPUTS} strings.`);
  }
  input.forEach((item: unknown, i) => {
    if (!isNonBlank(item)) throw new OctenValidationError(`input[${i}]`, `input[${i}] must be a non-empty string.`);
  });
}

const VL_MAX_CONTENTS = 20;
const VL_MODALITIES = ['text', 'image', 'video'] as const;

/** /vl-embedding: a non-blank model (its value is left to the server) and 1 to 20 contents, each with exactly one
 * non-blank text, image or video, as the API reference says. */
export function assertVLEmbeddingInput(params: unknown): void {
  if (!isNonBlank(field(params, 'model'))) {
    throw new OctenValidationError('model', 'model is required and must be a non-empty string.');
  }
  const contents = field(field(params, 'input'), 'contents');
  if (!Array.isArray(contents) || contents.length === 0 || contents.length > VL_MAX_CONTENTS) {
    throw new OctenValidationError(
      'input.contents',
      `input.contents is required and must be an array of 1 to ${VL_MAX_CONTENTS} items.`,
    );
  }
  contents.forEach((item: unknown, i) => {
    const path = `input.contents[${i}]`;
    const set = isPlainObject(item) ? VL_MODALITIES.filter((k) => item[k] !== undefined) : [];
    if (set.length !== 1 || !isNonBlank(field(item, set[0] as string))) {
      throw new OctenValidationError(path, `${path} must set exactly one of text, image or video to a non-empty string.`);
    }
  });
}

const EXTRACT_MAX_URLS = 20;
const EXTRACT_MAX_URL_LENGTH = 2048;

/** /extract: 1 to 20 URLs, each a non-blank string of at most 2048 characters (code points). */
export function assertUrls(params: unknown): void {
  const urls = field(params, 'urls');
  if (!Array.isArray(urls) || urls.length === 0 || urls.length > EXTRACT_MAX_URLS) {
    throw new OctenValidationError('urls', `urls is required and must be an array of 1 to ${EXTRACT_MAX_URLS} URLs.`);
  }
  urls.forEach((url: unknown, i) => {
    if (!isNonBlank(url)) throw new OctenValidationError(`urls[${i}]`, `urls[${i}] must be a non-empty string.`);
    if ([...url].length > EXTRACT_MAX_URL_LENGTH) {
      throw new OctenValidationError(`urls[${i}]`, `urls[${i}] is longer than ${EXTRACT_MAX_URL_LENGTH} characters.`);
    }
  });
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
