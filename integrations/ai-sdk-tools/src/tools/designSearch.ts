import type { DesignSearchParams } from '@octen.ai/sdk';
import { jsonSchema, tool } from 'ai';
import type { Tool } from 'ai';
import { z } from 'zod';
import {
  bool,
  codePoints,
  defined,
  intIn,
  invalid,
  isNonBlank,
  compareRfc3339,
  isRfc3339,
  objectWith,
  oneOf,
  rejectUnknown,
  snapshot,
  stringList,
} from '../options.js';
import { asList, isRecord, nonEmpty, requestOptions, resolveClient, trimWebResults, warningOf } from '../shared.js';
import type { ModelWebResult, OctenClientOptions, TimeRange } from '../shared.js';

export type DesignSearchInput = { query?: string | null; group_id?: string | null };
export type ModelDesignGroup = {
  group_id?: string;
  type?: string;
  name?: string;
  position?: number;
  total?: number;
  master?: Record<string, unknown>;
};
export type ModelDesignImage = {
  type?: string;
  title?: string;
  description?: string;
  url?: string;
  thumbnail?: string;
  source_page?: string;
  width?: number;
  height?: number;
  group?: ModelDesignGroup;
  design_facts?: Record<string, unknown>;
  snippet?: { format?: string; code: string };
};
export type DesignSearchToolResult = { request_id: string; warning?: string; images: ModelDesignImage[]; results: ModelWebResult[] };

type TokenOption = { enable?: boolean; maxTokens?: number };
export type DesignLanguage =
  | 'ar' | 'de' | 'en' | 'es' | 'fr' | 'hi' | 'id' | 'it' | 'ja' | 'ko' | 'nl' | 'pl' | 'pt' | 'ru' | 'th' | 'tr' | 'vi' | 'zh';

export type OctenDesignSearchOptions = {
  description?: string;
  images?: { enable?: boolean; count?: number; designFacts?: boolean; snippet?: TokenOption };
  webSearch?: {
    enable?: boolean;
    count?: number;
    highlight?: TokenOption;
    fullContent?: TokenOption;
    includeDomains?: readonly string[];
    excludeDomains?: readonly string[];
    language?: readonly DesignLanguage[];
    timeBasis?: 'auto' | 'published' | 'crawled';
    timeRange?: TimeRange;
    startTime?: string;
    endTime?: string;
  };
} & OctenClientOptions;

// Limits from docs.octen.ai/api-reference/design-search.
const MAX_QUERY_LENGTH = 500;
// images.count default per the API reference; a group lookup returns at most this many images.
const API_IMAGE_COUNT = 5;
const LANGUAGES = ['ar', 'de', 'en', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'nl', 'pl', 'pt', 'ru', 'th', 'tr', 'vi', 'zh'] as const;

type ImagesParams = NonNullable<DesignSearchParams['images']>;
type WebParams = NonNullable<DesignSearchParams['web_search']>;

function tokens(value: unknown, field: string, maxTokens: number): { enable?: boolean; max_tokens?: number } | undefined {
  const o = objectWith(value, field, ['enable', 'maxTokens'], '{ enable: true, maxTokens: 1000 }');
  if (o === undefined) return undefined;
  return defined([
    ['enable', bool(o['enable'], `${field}.enable`)],
    ['max_tokens', intIn(o['maxTokens'], 100, maxTokens, `${field}.maxTokens`)],
  ]);
}

function dateTime(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !isRfc3339(value)) {
    invalid(field, `${field} must be an RFC 3339 date-time such as 2025-01-01T00:00:00Z, got ${String(value)}.`);
  }
  return value;
}

function languages(value: unknown): DesignLanguage[] | undefined {
  const list = stringList(value, 'webSearch.language', LANGUAGES.length);
  list?.forEach((code, i) => oneOf(code, LANGUAGES, `webSearch.language[${i}]`));
  return list as DesignLanguage[] | undefined;
}

const IMAGE_KEYS = ['enable', 'count', 'designFacts', 'snippet'];
const WEB_KEYS = [
  'enable',
  'count',
  'highlight',
  'fullContent',
  'includeDomains',
  'excludeDomains',
  'language',
  'timeBasis',
  'timeRange',
  'startTime',
  'endTime',
];

function imagesParams(value: unknown): ImagesParams | undefined {
  const o = objectWith(value, 'images', IMAGE_KEYS, '{ count: 10 }');
  if (o === undefined) return undefined;
  return defined<ImagesParams>([
    ['enable', bool(o['enable'], 'images.enable')],
    ['count', intIn(o['count'], 1, 100, 'images.count')],
    ['design_facts', bool(o['designFacts'], 'images.designFacts')],
    ['snippet', tokens(o['snippet'], 'images.snippet', 100_000)],
  ]);
}

function webParams(value: unknown): WebParams | undefined {
  const o = objectWith(value, 'webSearch', WEB_KEYS, '{ count: 3 }');
  if (o === undefined) return undefined;
  const start = dateTime(o['startTime'], 'webSearch.startTime');
  const end = dateTime(o['endTime'], 'webSearch.endTime');
  if (start !== undefined && end !== undefined && compareRfc3339(start, end) > 0) {
    invalid('webSearch.startTime', `webSearch.startTime (${start}) is after webSearch.endTime (${end}).`);
  }
  return defined<WebParams>([
    ['enable', bool(o['enable'], 'webSearch.enable')],
    ['count', intIn(o['count'], 1, 100, 'webSearch.count')],
    ['highlight', tokens(o['highlight'], 'webSearch.highlight', 20_000)],
    ['full_content', tokens(o['fullContent'], 'webSearch.fullContent', 100_000)],
    ['include_domains', stringList(o['includeDomains'], 'webSearch.includeDomains', 1200, 60)],
    ['exclude_domains', stringList(o['excludeDomains'], 'webSearch.excludeDomains', 1200, 60)],
    ['language', languages(o['language'])],
    ['time_basis', oneOf(o['timeBasis'], ['auto', 'published', 'crawled'], 'webSearch.timeBasis')],
    ['time_range', oneOf(o['timeRange'], ['day', 'week', 'month', 'year'], 'webSearch.timeRange')],
    ['start_time', start],
    ['end_time', end],
  ]);
}

// The default description drops what the developer turned off, so the model is not promised it.
function defaultDescription(images: ImagesParams | undefined, web: WebParams | undefined): string {
  if (images?.enable === false) {
    const excerpt = web?.highlight?.enable === false ? '' : ' and a query-relevant excerpt';
    return `Search for web pages on a design topic, such as articles and galleries about web, app or slide design. Returns ranked pages as \`results\`, with title, URL${excerpt}.`;
  }
  const values = images?.design_facts === false ? '' : ', each with its design values such as colors, fonts and font sizes';
  const code = images?.snippet?.enable === false ? '' : ', and reusable HTML code when the image has it';
  const parts = [
    `Search for design references: screenshots of web pages, page sections, app screens and slides that match the query${values}${code}.`,
  ];
  if (web?.enable !== false) parts.push('Web pages on the same query come back alongside as `results`.');
  parts.push(
    `An image from a web page or deck has a \`group\` with a \`group_id\`; to see more of that page or deck, call again with that \`group_id\` and no query: up to ${images?.count ?? API_IMAGE_COUNT} of its images come back, in group order.`,
    'Use this for web, app or slide design inspiration, not for general image search.',
  );
  return parts.join(' ');
}

const MISSING =
  'Pass `query` to search for design references, or `group_id` (the `group.group_id` of an earlier image result) to get the images of that web page or deck. Both are missing or blank. No request was made.';

const MISSING_QUERY = 'Pass `query`, the design topic to search for. No request was made.';

// With images off there is no group to look up, so only a query counts.
function inputProblem(input: { query?: unknown; group_id?: unknown }, groups: boolean): string | undefined {
  if (isNonBlank(input.query)) return undefined;
  if (!groups) return MISSING_QUERY;
  return isNonBlank(input.group_id) ? undefined : MISSING;
}

const QUERY_SCHEMA = { anyOf: [{ type: 'string', minLength: 1, maxLength: MAX_QUERY_LENGTH }, { type: 'null' }] };

// The JSON schema is written out so the model sees code-point lengths and the nullable fields; zod only validates.
function inputSchema(groups: boolean, groupCount: number) {
  const validator = z
    .object({
      // Strict-mode providers send null for an optional field; execute drops it.
      query: z
        .string()
        .refine((q) => codePoints(q) <= MAX_QUERY_LENGTH, 'query must be at most 500 characters.')
        .nullable()
        .optional(),
      group_id: z.string().nullable().optional(),
    })
    .superRefine((value, ctx) => {
      const problem = inputProblem(value, groups);
      if (problem !== undefined) ctx.addIssue({ code: 'custom', path: ['query'], message: problem });
    });
  const properties = groups
    ? {
        query: {
          ...QUERY_SCHEMA,
          description: "What to find, e.g. 'pricing section for a SaaS landing page'. Max 500 characters. Required unless `group_id` is set.",
        },
        group_id: {
          anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
          description:
            `Optional. The \`group.group_id\` of an image from an earlier result; returns up to ${groupCount} images of that web page or deck, in group order, instead of searching by query.`,
        },
      }
    : { query: { type: 'string', minLength: 1, maxLength: MAX_QUERY_LENGTH, description: "What to find, e.g. 'pricing page design'. Max 500 characters." } };
  return jsonSchema<DesignSearchInput>(
    { type: 'object', properties, ...(groups ? {} : { required: ['query'] }), additionalProperties: false },
    {
      validate: (value) => {
        const result = validator.safeParse(value);
        return result.success ? { success: true, value: result.data as DesignSearchInput } : { success: false, error: result.error };
      },
    },
  );
}

function strings<K extends string>(from: Record<string, unknown>, keys: readonly K[]): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const key of keys) {
    const value = nonEmpty(from[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function numbers<K extends string>(from: Record<string, unknown>, keys: readonly K[]): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  for (const key of keys) {
    const value = from[key];
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

const nonEmptyRecord = (value: unknown): value is Record<string, unknown> => isRecord(value) && Object.keys(value).length > 0;

function trimGroup(g: Record<string, unknown>): ModelDesignGroup {
  const out: ModelDesignGroup = { ...strings(g, ['group_id', 'type', 'name']), ...numbers(g, ['position', 'total']) };
  if (nonEmptyRecord(g['master'])) out.master = g['master'];
  return out;
}

// design_facts and group.master are free-form and kept as returned; snippet is present only with code.
function trimImage(r: Record<string, unknown>): ModelDesignImage {
  const out: ModelDesignImage = {
    ...strings(r, ['type', 'title', 'description', 'url', 'thumbnail', 'source_page']),
    ...numbers(r, ['width', 'height']),
  };
  const group = isRecord(r['group']) ? trimGroup(r['group']) : {};
  if (Object.keys(group).length > 0) out.group = group;
  if (nonEmptyRecord(r['design_facts'])) out.design_facts = r['design_facts'];
  const snippet = r['snippet'];
  const code = isRecord(snippet) ? nonEmpty(snippet['code']) : undefined;
  if (code !== undefined && isRecord(snippet)) {
    const format = nonEmpty(snippet['format']);
    out.snippet = format === undefined ? { code } : { format, code };
  }
  return out;
}

const OPTION_KEYS = ['description', 'images', 'webSearch', 'client', 'apiKey', 'baseURL', 'timeout', 'maxRetries'] as const;

export function octenDesignSearch(given: OctenDesignSearchOptions = {}): Tool<DesignSearchInput, DesignSearchToolResult> {
  rejectUnknown(given, OPTION_KEYS);
  const options = snapshot(given, OPTION_KEYS);
  const images = imagesParams(options.images);
  const web = webParams(options.webSearch);
  if (images?.enable === false && web?.enable === false) {
    invalid('images.enable', 'images.enable and webSearch.enable cannot both be false: the tool would return nothing.');
  }
  const groups = images?.enable !== false;
  // One client per tool, reused by every call.
  const client = resolveClient(options);
  return tool({
    description: options.description ?? defaultDescription(images, web),
    inputSchema: inputSchema(groups, images?.count ?? API_IMAGE_COUNT),
    execute: async (input: DesignSearchInput, { abortSignal }): Promise<DesignSearchToolResult> => {
      const problem = inputProblem(input, groups);
      if (problem !== undefined) invalid('query', problem);
      const groupId = groups && isNonBlank(input.group_id) ? input.group_id : undefined;
      const withGroup = groupId === undefined ? images : { ...images, group_id: groupId };
      const params: DesignSearchParams = defined([
        ['query', isNonBlank(input.query) ? input.query : undefined],
        ['images', withGroup],
        ['web_search', web],
      ]);
      const res = await client.designSearch.search(params, requestOptions(abortSignal));
      return {
        request_id: res.request_id,
        ...warningOf(res),
        images: asList(res.data?.images, 'data.images')
          .filter(isRecord)
          .map(trimImage)
          .filter((r) => Object.keys(r).length > 0),
        results: trimWebResults(res.data?.results, 'data.results'),
      };
    },
  });
}
