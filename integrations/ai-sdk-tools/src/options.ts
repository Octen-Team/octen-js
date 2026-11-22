import { OctenValidationError } from '@octen.ai/sdk';
import { isRecord } from './shared.js';

// Checks for the named developer options of Extract, Image Search and Design Search; each throws before any request.

export function invalid(field: string, message: string): never {
  throw new OctenValidationError(field, message);
}

export function intIn(value: unknown, min: number, max: number, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    invalid(field, `${field} must be an integer from ${min} to ${max}, got ${String(value)}.`);
  }
  return value;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    invalid(field, `${field} must be one of ${allowed.join(', ')}, got ${String(value)}.`);
  }
  return value as T;
}

export function bool(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') invalid(field, `${field} must be a boolean, got ${String(value)}.`);
  return value;
}

// JSON Schema lengths and the SDK's URL check count code points; zod 3.25 and 4.1 count UTF-16 units in .max.
export const codePoints = (s: string) => [...s].length;

export const isNonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

// A list of 1 to maxItems non-blank strings, each at most maxLength code points; returns a copy.
export function stringList(value: unknown, field: string, maxItems: number, maxLength?: number): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) {
    invalid(field, `${field} must be a list of 1 to ${maxItems} strings.`);
  }
  // An index loop, not map, so a hole in a sparse array is checked like any other item.
  const out: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const item: unknown = value[i];
    if (!isNonBlank(item)) invalid(`${field}[${i}]`, `${field}[${i}] must be a non-empty string.`);
    if (maxLength !== undefined && codePoints(item) > maxLength) {
      invalid(`${field}[${i}]`, `${field}[${i}] must be at most ${maxLength} characters.`);
    }
    out.push(item);
  }
  return out;
}

// Rejects keys outside `allowed`, so a misspelt or snake_case option is not silently dropped.
export function objectWith(value: unknown, field: string, allowed: readonly string[], example: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) invalid(field, `${field} must be an object such as ${example}.`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) invalid(`${field}.${key}`, `${field} takes only ${allowed.join(', ')}, got ${key}.`);
  }
  return value;
}

// Drops unset entries, so an option left out is not sent and the API default applies.
export function defined<T>(entries: [string, unknown][]): T {
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined)) as T;
}

// For tools that promise validation: a misspelt top-level option throws instead of being dropped by snapshot.
export function rejectUnknown(options: object, keys: readonly string[]): void {
  for (const key of Object.keys(options)) {
    if (!keys.includes(key)) invalid(key, `Unknown option ${key}; the options are ${keys.join(', ')}.`);
  }
}

const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/i;

// RFC 3339 date-time with each field in range, so 2025-02-30 or +24:00 fails before any request.
export function isRfc3339(value: string): boolean {
  const m = RFC3339.exec(value);
  if (m === null) return false;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const offsetOk = m[8] === undefined || (Number(m[9]) <= 23 && Number(m[10]) <= 59);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth && hour <= 23 && minute <= 59 && second <= 59 && offsetOk;
}

// Reads each option once, so validation, the schema and the requests all see the same values.
export function snapshot<T>(options: T, keys: readonly string[]): T {
  const copy: Record<string, unknown> = {};
  for (const key of keys) {
    const value = (options as Record<string, unknown>)[key];
    if (value !== undefined) copy[key] = value;
  }
  return copy as T;
}
