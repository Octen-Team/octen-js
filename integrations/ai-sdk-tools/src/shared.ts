import { Octen, OctenValidationError } from '@octen.ai/sdk';
import type { RequestOptions } from '@octen.ai/sdk';
import { z } from 'zod';

export const TIME_RANGES = ['day', 'week', 'month', 'year'] as const;
export type TimeRange = (typeof TIME_RANGES)[number];

type ClientConfig = { apiKey?: string; baseURL?: string; timeout?: number; maxRetries?: number };

// A union so that passing client with any client option is a compile error; resolveClient checks it at runtime too.
export type OctenToolOptions<P> = {
  description?: string;
  defaults?: Partial<Omit<P, 'query'>>;
} & ({ client: Octen } & { [K in keyof ClientConfig]?: never } | { client?: undefined } & ClientConfig);

export type ModelWebResult = {
  title?: string;
  url?: string;
  highlight?: string;
  time_published?: string;
  full_content?: string;
};

export type ModelFieldSpec = { query: true; time_range?: true };

const CLIENT_KEYS = ['apiKey', 'baseURL', 'timeout', 'maxRetries'] as const;

export function resolveClient(options: OctenToolOptions<unknown>): Octen {
  if (options.client !== undefined) {
    for (const key of CLIENT_KEYS) {
      if (options[key] !== undefined) {
        throw new OctenValidationError(
          key,
          `Pass either \`client\` or \`${key}\`, not both: \`client\` already carries its own configuration.`,
        );
      }
    }
    return options.client;
  }
  // Undefined keys are left out so the SDK's own defaults and OCTEN_API_KEY lookup apply.
  const config: ConstructorParameters<typeof Octen>[0] = {};
  for (const key of CLIENT_KEYS) {
    if (options[key] !== undefined) Object.assign(config, { [key]: options[key] });
  }
  return new Octen(config);
}

// Precedence is tool default < developer default < model input (spec 4.2); the merge is shallow.
export function mergeParams<P>(
  toolDefaults: Partial<P>,
  devDefaults: Partial<P> | undefined,
  modelInput: Record<string, unknown>,
  modelFields: readonly string[],
): P {
  // An explicit undefined means "not set", so it must not overwrite a tool default.
  const dev: Record<string, unknown> = Object.fromEntries(
    Object.entries({ ...devDefaults }).filter(([key, value]) => value !== undefined && key !== 'query'),
  );
  // query comes only from the model; the filter above also drops one a JS caller put in defaults.
  const fromModel: Record<string, unknown> = {};
  for (const field of modelFields) {
    const value = modelInput[field];
    if (value === undefined || value === null) continue;
    // A field the developer pinned is not in the model schema, so a model value is never honored.
    if (field !== 'query' && dev[field] !== undefined) continue;
    fromModel[field] = value;
  }
  return { ...toolDefaults, ...dev, ...fromModel } as P;
}

export function modelSchema(
  fields: ModelFieldSpec,
  pinned: Partial<Record<string, unknown>> | undefined,
): z.ZodObject<z.ZodRawShape> {
  const shape: Record<string, z.ZodType> = {
    query: z.string().describe('The search query'),
  };
  if (fields.time_range === true && pinned?.['time_range'] === undefined) {
    shape['time_range'] = z
      .enum(TIME_RANGES)
      // Strict-mode providers send null for an optional field; mergeParams drops it.
      .nullable()
      .optional()
      .describe('Only return results from this recent window. Omit for no time filter.');
  }
  return z.object(shape);
}

export function requestOptions(abortSignal: AbortSignal | undefined): RequestOptions {
  return abortSignal === undefined ? {} : { signal: abortSignal };
}

export function trimWebResult(r: Partial<Record<keyof ModelWebResult, unknown>>): ModelWebResult {
  const out: ModelWebResult = {};
  const keys: (keyof ModelWebResult)[] = ['title', 'url', 'highlight', 'time_published', 'full_content'];
  for (const key of keys) {
    const value = r[key];
    // The API returns "" for fields that were not requested, e.g. full_content.
    if (typeof value === 'string' && value !== '') out[key] = value;
  }
  return out;
}

export function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A missing list means "nothing found"; any other non-array is a malformed reply and must not look empty.
export function asList(value: unknown, label: string): unknown[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value;
  throw new Error(`Expected ${label} in the Octen response to be an array, got ${typeof value}.`);
}

// Non-object items and items with no non-empty field are skipped, so the model never sees {}.
export function trimWebResults(list: unknown, label: string): ModelWebResult[] {
  return asList(list, label)
    .filter(isRecord)
    .map(trimWebResult)
    .filter((r) => Object.keys(r).length > 0);
}

// A non-empty warning tells the model the upstream was degraded, not that nothing matched.
export function warningOf(res: { meta?: { warning?: unknown } | null }): { warning?: string } {
  const warning = nonEmpty(res.meta?.warning);
  return warning === undefined ? {} : { warning };
}
