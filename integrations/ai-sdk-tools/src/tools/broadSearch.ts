import type { BroadSearchParams } from '@octen.ai/sdk';
import { tool } from 'ai';
import type { Tool } from 'ai';
import type { z } from 'zod';
import { mergeParams, modelSchema, requestOptions, resolveClient, trimWebResult } from '../shared.js';
import type { ModelWebResult, OctenToolOptions } from '../shared.js';

export type BroadSearchInput = { query: string };
export type BroadSearchToolResult = {
  request_id: string;
  queries: string[];
  search_results: { query?: string; results: ModelWebResult[] }[];
};

const DESCRIPTION =
  'Search the web broadly for a multi-part or comparative question. Splits the question into sub-queries, searches them in parallel and returns results grouped per sub-query. Use it for comparisons, surveys and questions with several angles.';

// Broad takes its highlight option under search_options; count and max_queries use the API defaults.
const TOOL_DEFAULTS: Partial<BroadSearchParams> = { search_options: { highlight: { enable: true, max_tokens: 300 } } };
const MODEL_FIELDS = ['query'] as const;

export function octenBroadSearch(
  options: OctenToolOptions<BroadSearchParams> = {},
): Tool<BroadSearchInput, BroadSearchToolResult> {
  // One client per tool, reused by every call.
  const client = resolveClient(options);
  return tool({
    description: options.description ?? DESCRIPTION,
    // modelSchema is typed loosely, so the input type is stated once here.
    inputSchema: modelSchema({ query: true }, options.defaults) as unknown as z.ZodType<BroadSearchInput>,
    execute: async (input: BroadSearchInput, { abortSignal }): Promise<BroadSearchToolResult> => {
      const params = mergeParams<BroadSearchParams>(TOOL_DEFAULTS, options.defaults, input, MODEL_FIELDS);
      const res = await client.search.broadSearch(params, requestOptions(abortSignal));
      return {
        request_id: res.request_id,
        queries: res.data?.queries ?? [],
        search_results: (res.data?.search_results ?? []).map((group) => ({
          ...(group.query ? { query: group.query } : {}),
          results: (group.results ?? []).map(trimWebResult),
        })),
      };
    },
  });
}
