import type { BroadSearchParams } from '@octen.ai/sdk';
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

export type BroadSearchInput = { query: string };
export type BroadSearchToolResult = {
  request_id: string;
  warning?: string;
  queries: string[];
  search_results: { query?: string; results: ModelWebResult[] }[];
};

const DESCRIPTION =
  'Search the web broadly for a multi-part or comparative question. Splits the question into sub-queries, searches them in parallel and returns results grouped per sub-query. Use it for comparisons, surveys and questions with several angles.';

// Broad takes its highlight option under search_options; count and max_queries use the API defaults.
const TOOL_DEFAULTS: Partial<BroadSearchParams> = { search_options: { highlight: { enable: true, max_tokens: 300 } } };
const MODEL_FIELDS = ['query'] as const satisfies readonly ModelField[];

export function octenBroadSearch(
  options: OctenToolOptions<BroadSearchParams, OctenClient> = {},
): Tool<BroadSearchInput, BroadSearchToolResult> {
  // One client per tool, reused by every call.
  const client = resolveClient(options);
  return tool({
    description: options.description ?? DESCRIPTION,
    inputSchema: modelSchema<BroadSearchInput>(MODEL_FIELDS, options.defaults),
    execute: async (input: BroadSearchInput, { abortSignal }): Promise<BroadSearchToolResult> => {
      const params = mergeParams<BroadSearchParams>(TOOL_DEFAULTS, options.defaults, input, MODEL_FIELDS);
      const res = await client.search.broadSearch(params, requestOptions(abortSignal));
      const queries = asList(res.data?.queries, 'data.queries').filter((q): q is string => nonEmpty(q) !== undefined);
      const groups = asList(res.data?.search_results, 'data.search_results').filter(isRecord);
      return {
        request_id: res.request_id,
        ...warningOf(res),
        queries,
        search_results: groups.map((group) => {
          const query = nonEmpty(group['query']);
          return {
            ...(query !== undefined ? { query } : {}),
            results: trimWebResults(group['results'], 'data.search_results[].results'),
          };
        }),
      };
    },
  });
}
