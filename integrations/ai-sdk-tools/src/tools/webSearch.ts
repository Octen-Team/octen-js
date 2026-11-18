import type { SearchParams } from '@octen.ai/sdk';
import { tool } from 'ai';
import type { Tool } from 'ai';
import { mergeParams, modelSchema, requestOptions, resolveClient, trimWebResults, warningOf } from '../shared.js';
import type { ModelField, ModelWebResult, OctenToolOptions, TimeRange } from '../shared.js';

export type WebSearchInput = { query: string; time_range?: TimeRange | null };
export type WebSearchToolResult = { request_id: string; warning?: string; results: ModelWebResult[] };

const DESCRIPTION =
  'Search the web for current information. Returns ranked pages with title, URL, a query-relevant excerpt and publish time. Use it when the answer depends on recent events or on facts you are unsure about.';

const TOOL_DEFAULTS: Partial<SearchParams> = { count: 5, highlight: { enable: true, max_tokens: 300 } };
const MODEL_FIELDS = ['query', 'time_range'] as const satisfies readonly ModelField[];

export function octenWebSearch(options: OctenToolOptions<SearchParams> = {}): Tool<WebSearchInput, WebSearchToolResult> {
  // One client per tool, reused by every call.
  const client = resolveClient(options);
  return tool({
    description: options.description ?? DESCRIPTION,
    inputSchema: modelSchema<WebSearchInput>(MODEL_FIELDS, options.defaults),
    execute: async (input: WebSearchInput, { abortSignal }): Promise<WebSearchToolResult> => {
      const params = mergeParams<SearchParams>(TOOL_DEFAULTS, options.defaults, input, MODEL_FIELDS);
      const res = await client.search.search(params, requestOptions(abortSignal));
      return { request_id: res.request_id, ...warningOf(res), results: trimWebResults(res.data?.results, 'data.results') };
    },
  });
}
