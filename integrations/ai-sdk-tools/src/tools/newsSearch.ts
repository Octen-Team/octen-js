import type { NewsSearchParams } from '@octen.ai/sdk';
import { tool } from 'ai';
import type { Tool } from 'ai';
import type { z } from 'zod';
import { mergeParams, modelSchema, nonEmpty, requestOptions, resolveClient, trimWebResults } from '../shared.js';
import type { ModelWebResult, OctenToolOptions } from '../shared.js';

export type NewsSearchInput = { query: string; time_range?: 'day' | 'week' | 'month' | 'year' };
export type NewsSearchToolResult = {
  request_id: string;
  results: ModelWebResult[];
  subjects: { name?: string; summary?: string; time_latest?: string; top_news?: { title?: string; url?: string } }[];
};

const DESCRIPTION =
  'Search recent news. Returns ranked articles with excerpts and publish time, plus storylines that group related coverage. Use it for current events and news monitoring.';

const TOOL_DEFAULTS: Partial<NewsSearchParams> = { count: 5, highlight: { enable: true, max_tokens: 300 } };
const MODEL_FIELDS = ['query', 'time_range'] as const;

type Subject = NewsSearchToolResult['subjects'][number];

// top_news is a single object on the wire, not an array; empty and null values are left out.
function trimSubject(s: { name?: unknown; summary?: unknown; time_latest?: unknown; top_news?: unknown }): Subject {
  const out: Subject = {};
  const name = nonEmpty(s.name);
  const summary = nonEmpty(s.summary);
  const timeLatest = nonEmpty(s.time_latest);
  if (name !== undefined) out.name = name;
  if (summary !== undefined) out.summary = summary;
  if (timeLatest !== undefined) out.time_latest = timeLatest;
  const top = (s.top_news ?? {}) as { title?: unknown; url?: unknown };
  const title = nonEmpty(top.title);
  const url = nonEmpty(top.url);
  if (title !== undefined || url !== undefined) {
    out.top_news = { ...(title !== undefined ? { title } : {}), ...(url !== undefined ? { url } : {}) };
  }
  return out;
}

export function octenNewsSearch(
  options: OctenToolOptions<NewsSearchParams> = {},
): Tool<NewsSearchInput, NewsSearchToolResult> {
  // One client per tool, reused by every call.
  const client = resolveClient(options);
  return tool({
    description: options.description ?? DESCRIPTION,
    // modelSchema is typed loosely, so the input type is stated once here.
    inputSchema: modelSchema({ query: true, time_range: true }, options.defaults) as unknown as z.ZodType<NewsSearchInput>,
    execute: async (input: NewsSearchInput, { abortSignal }): Promise<NewsSearchToolResult> => {
      const params = mergeParams<NewsSearchParams>(TOOL_DEFAULTS, options.defaults, input, MODEL_FIELDS);
      const res = await client.search.newsSearch(params, requestOptions(abortSignal));
      return {
        request_id: res.request_id,
        results: trimWebResults(res.data?.results),
        subjects: (res.data?.subjects ?? []).filter((s) => s != null).map(trimSubject),
      };
    },
  });
}
