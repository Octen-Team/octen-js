import { OctenValidationError } from './errors';
import { isPlainObject } from '../schema/descriptor';

/**
 * Validates caller headers (plain object of strings; names and values checked by the runtime's Headers)
 * and returns them normalised. x-api-key is refused so the apiKey option stays the only source of the key.
 */
export function normalizeHeaders(headers: unknown, field = 'headers'): Headers {
  const out = new Headers();
  if (headers === undefined) return out;
  if (!isPlainObject(headers)) {
    throw new OctenValidationError(field, `${field} must be a plain object of string values.`);
  }
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value !== 'string') {
      throw new OctenValidationError(field, `Header "${name}" must have a string value.`);
    }
    try {
      out.set(name, value);
    } catch {
      throw new OctenValidationError(field, `Header "${name}" has an invalid name or value.`);
    }
  }
  if (out.has('x-api-key')) {
    throw new OctenValidationError(field, `${field} cannot set x-api-key; pass the key with the apiKey option.`);
  }
  return out;
}
