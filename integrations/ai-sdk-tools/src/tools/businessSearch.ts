import type { BusinessSearchParams } from '@octen.ai/sdk';
import { tool } from 'ai';
import type { Tool } from 'ai';
import type { z } from 'zod';
import { mergeParams, modelSchema, nonEmpty, requestOptions, resolveClient, trimWebResults } from '../shared.js';
import type { ModelWebResult, OctenToolOptions } from '../shared.js';

export type BusinessSearchInput = { query: string };
export type ModelEntity =
  | { type: 'company'; name?: string; summary?: string; website?: string }
  | { type: 'person'; name?: string; summary?: string; current_position?: string; linkedin_url?: string }
  | { type: string; name?: string; summary?: string };
export type BusinessSearchToolResult = { request_id: string; entities: ModelEntity[]; results: ModelWebResult[] };

const DESCRIPTION =
  'Look up companies and people. Returns entity cards for companies or people with a summary and key identifiers, plus ranked sources. Use it for company research, people lookup and competitor comparison.';

const TOOL_DEFAULTS: Partial<BusinessSearchParams> = { count: 5, highlight: { enable: true, max_tokens: 300 } };
const MODEL_FIELDS = ['query'] as const;

type RawEntity = Record<string, unknown>;

// Only the listed keys are copied; empty, null and undefined values are left out.
function pick(source: RawEntity, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = nonEmpty(source[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

// Unknown entity types come back as is at runtime, so only type, name and summary are trusted.
function trimEntity(raw: unknown): ModelEntity | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const e = raw as RawEntity;
  if (typeof e['type'] !== 'string') return undefined;
  const base = { type: e['type'], ...pick(e, ['name', 'summary']) };
  if (e['type'] === 'company') {
    const identifiers = (e['identifiers'] ?? {}) as RawEntity;
    return { ...base, ...pick(identifiers, ['website']) } as ModelEntity;
  }
  if (e['type'] === 'person') return { ...base, ...pick(e, ['current_position', 'linkedin_url']) } as ModelEntity;
  return base;
}

export function octenBusinessSearch(
  options: OctenToolOptions<BusinessSearchParams> = {},
): Tool<BusinessSearchInput, BusinessSearchToolResult> {
  // One client per tool, reused by every call.
  const client = resolveClient(options);
  return tool({
    description: options.description ?? DESCRIPTION,
    // modelSchema is typed loosely, so the input type is stated once here.
    inputSchema: modelSchema({ query: true }, options.defaults) as unknown as z.ZodType<BusinessSearchInput>,
    execute: async (input: BusinessSearchInput, { abortSignal }): Promise<BusinessSearchToolResult> => {
      const params = mergeParams<BusinessSearchParams>(TOOL_DEFAULTS, options.defaults, input, MODEL_FIELDS);
      const res = await client.search.businessSearch(params, requestOptions(abortSignal));
      return {
        request_id: res.request_id,
        entities: (res.data?.entities ?? []).map(trimEntity).filter((e): e is ModelEntity => e !== undefined),
        results: trimWebResults(res.data?.results),
      };
    },
  });
}
