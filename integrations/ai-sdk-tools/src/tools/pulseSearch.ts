import type { PulseSearchParams } from '@octen.ai/sdk';
import { tool } from 'ai';
import type { Tool } from 'ai';
import type { z } from 'zod';
import { mergeParams, modelSchema, requestOptions, resolveClient, trimWebResults, warningOf } from '../shared.js';
import type { ModelWebResult, OctenToolOptions } from '../shared.js';

export type PulseSearchInput = { query: string };
export type PulseSearchToolResult = { request_id: string; warning?: string; results: ModelWebResult[] };

const DESCRIPTION =
  'Find the official page for a site, product or document, such as docs, help pages or a homepage. Returns the most likely URLs. Use it when the user wants a specific page rather than general information.';

const TOOL_DEFAULTS: Partial<PulseSearchParams> = { count: 5 };
const MODEL_FIELDS = ['query'] as const;

export function octenPulseSearch(
  options: OctenToolOptions<PulseSearchParams> = {},
): Tool<PulseSearchInput, PulseSearchToolResult> {
  // One client per tool, reused by every call.
  const client = resolveClient(options);
  return tool({
    description: options.description ?? DESCRIPTION,
    // modelSchema is typed loosely, so the input type is stated once here.
    inputSchema: modelSchema({ query: true }, options.defaults) as unknown as z.ZodType<PulseSearchInput>,
    execute: async (input: PulseSearchInput, { abortSignal }): Promise<PulseSearchToolResult> => {
      const params = mergeParams<PulseSearchParams>(TOOL_DEFAULTS, options.defaults, input, MODEL_FIELDS);
      const res = await client.search.pulseSearch(params, requestOptions(abortSignal));
      return { request_id: res.request_id, ...warningOf(res), results: trimWebResults(res.data?.results, 'data.results') };
    },
  });
}
