import { Octen, OctenValidationError } from '@octen.ai/sdk';
import type { RequestOptions } from '@octen.ai/sdk';
import { z } from 'zod';

export type OctenToolOptions<P> = {
  client?: Octen;
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
  maxRetries?: number;
  description?: string;
  defaults?: Partial<Omit<P, 'query'>>;
};

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
      .enum(['day', 'week', 'month', 'year'])
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

// Lists come from the wire, so a non-array is treated as empty and null or non-object items are skipped.
export function trimWebResults(list: unknown): ModelWebResult[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item))
    .map(trimWebResult);
}
