import type { SearchParams } from '@octen.ai/sdk';
import { tool } from 'ai';
import type { Tool } from 'ai';
import type { z } from 'zod';
import { mergeParams, modelSchema, requestOptions, resolveClient, trimWebResult } from '../shared.js';
import type { ModelWebResult, OctenToolOptions } from '../shared.js';

export type WebSearchInput = { query: string; time_range?: 'day' | 'week' | 'month' | 'year' };
export type WebSearchToolResult = { request_id: string; results: ModelWebResult[] };

const DESCRIPTION =
  'Search the web for current information. Returns ranked pages with title, URL, a query-relevant excerpt and publish time. Use it when the answer depends on recent events or on facts you are unsure about.';

const TOOL_DEFAULTS: Partial<SearchParams> = { count: 5, highlight: { enable: true, max_tokens: 300 } };
const MODEL_FIELDS = ['query', 'time_range'] as const;

export function octenWebSearch(options: OctenToolOptions<SearchParams> = {}): Tool<WebSearchInput, WebSearchToolResult> {
  // One client per tool, reused by every call.
  const client = resolveClient(options);
  return tool({
    description: options.description ?? DESCRIPTION,
    // modelSchema is typed loosely, so the input type is stated once here.
    inputSchema: modelSchema({ query: true, time_range: true }, options.defaults) as unknown as z.ZodType<WebSearchInput>,
    execute: async (input: WebSearchInput, { abortSignal }): Promise<WebSearchToolResult> => {
      const params = mergeParams<SearchParams>(TOOL_DEFAULTS, options.defaults, input, MODEL_FIELDS);
      const res = await client.search.search(params, requestOptions(abortSignal));
      return { request_id: res.request_id, results: (res.data?.results ?? []).map(trimWebResult) };
    },
  });
}
