import type { SearchPremierParams } from '@octen.ai/sdk';
import { tool } from 'ai';
import type { Tool } from 'ai';
import { mergeParams, modelSchema, requestOptions, resolveClient, trimWebResults, warningOf } from '../shared.js';
import type { ModelField, ModelWebResult, OctenClient, OctenToolOptions, TimeRange } from '../shared.js';

export type WebSearchPremierInput = { query: string; time_range?: TimeRange | null };
export type WebSearchPremierToolResult = { request_id: string; warning?: string; results: ModelWebResult[] };

// Wording follows docs.octen.ai/capabilities/web-search-premier.
const DESCRIPTION =
  'Search the web with deeper retrieval and reranking, so the page that holds the answer ranks higher. Returns ranked pages with title, URL, a query-relevant excerpt and publish time. Use it for a specific fact, a niche document or a page that is hard to find; for low-latency lookups, prefer a standard web search.';

// Same as octenWebSearch: the endpoint takes the /search body and returns the /search response.
const TOOL_DEFAULTS: Partial<SearchPremierParams> = { count: 5, highlight: { enable: true, max_tokens: 300 } };
const MODEL_FIELDS = ['query', 'time_range'] as const satisfies readonly ModelField[];

export function octenWebSearchPremier(
  options: OctenToolOptions<SearchPremierParams, OctenClient> = {},
): Tool<WebSearchPremierInput, WebSearchPremierToolResult> {
  // One client per tool, reused by every call.
  const client = resolveClient(options);
  return tool({
    description: options.description ?? DESCRIPTION,
    inputSchema: modelSchema<WebSearchPremierInput>(MODEL_FIELDS, options.defaults),
    execute: async (input: WebSearchPremierInput, { abortSignal }): Promise<WebSearchPremierToolResult> => {
      const params = mergeParams<SearchPremierParams>(TOOL_DEFAULTS, options.defaults, input, MODEL_FIELDS);
      const res = await client.search.searchPremier(params, requestOptions(abortSignal));
      return { request_id: res.request_id, ...warningOf(res), results: trimWebResults(res.data?.results, 'data.results') };
    },
  });
}
