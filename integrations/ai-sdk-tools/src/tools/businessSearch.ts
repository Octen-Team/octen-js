import type { BusinessSearchParams } from '@octen.ai/sdk';
import { tool } from 'ai';
import type { Tool } from 'ai';
import {
  asList,
  isRecord,
  mergeParams,
  modelSchema,
  nonEmpty,
  requestOptions,
  resolveClient,
  trimWebResults,
  warningOf,
} from '../shared.js';
import type { ModelField, ModelWebResult, OctenClient, OctenToolOptions } from '../shared.js';

export type BusinessSearchInput = { query: string };
export type ModelCompany = { type: 'company'; name?: string; summary?: string; website?: string };
export type ModelPerson = { type: 'person'; name?: string; summary?: string; current_position?: string; linkedin_url?: string };
// Unknown types pass through with their real name, so narrowing on type alone is partial.
export type ModelEntity = ModelCompany | ModelPerson | { type: string; name?: string; summary?: string };
export type BusinessSearchToolResult = {
  request_id: string;
  warning?: string;
  entities: ModelEntity[];
  results: ModelWebResult[];
};

const DESCRIPTION =
  'Look up companies and people. Returns entity cards for companies or people with a summary and key identifiers, plus ranked sources. Use it for company research, people lookup and competitor comparison.';

const TOOL_DEFAULTS: Partial<BusinessSearchParams> = { count: 5, highlight: { enable: true, max_tokens: 300 } };
const MODEL_FIELDS = ['query'] as const satisfies readonly ModelField[];

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
function trimEntity(e: RawEntity): ModelEntity | undefined {
  if (typeof e['type'] !== 'string') return undefined;
  const base = { type: e['type'], ...pick(e, ['name', 'summary']) };
  if (e['type'] === 'company') {
    const identifiers = isRecord(e['identifiers']) ? e['identifiers'] : {};
    return { ...base, ...pick(identifiers, ['website']) } as ModelEntity;
  }
  if (e['type'] === 'person') return { ...base, ...pick(e, ['current_position', 'linkedin_url']) } as ModelEntity;
  return base;
}

export function octenBusinessSearch(
  options: OctenToolOptions<BusinessSearchParams, OctenClient> = {},
): Tool<BusinessSearchInput, BusinessSearchToolResult> {
  // One client per tool, reused by every call.
  const client = resolveClient(options);
  return tool({
    description: options.description ?? DESCRIPTION,
    inputSchema: modelSchema<BusinessSearchInput>(MODEL_FIELDS, options.defaults),
    execute: async (input: BusinessSearchInput, { abortSignal }): Promise<BusinessSearchToolResult> => {
      const params = mergeParams<BusinessSearchParams>(TOOL_DEFAULTS, options.defaults, input, MODEL_FIELDS);
      const res = await client.search.businessSearch(params, requestOptions(abortSignal));
      return {
        request_id: res.request_id,
        ...warningOf(res),
        entities: asList(res.data?.entities, 'data.entities')
          .filter(isRecord)
          .map(trimEntity)
          .filter((e): e is ModelEntity => e !== undefined),
        results: trimWebResults(res.data?.results, 'data.results'),
      };
    },
  });
}
