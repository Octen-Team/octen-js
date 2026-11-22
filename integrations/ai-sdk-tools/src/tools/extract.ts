import { OctenValidationError } from '@octen.ai/sdk';
import type { ExtractParams } from '@octen.ai/sdk';
import { jsonSchema, tool } from 'ai';
import type { Tool } from 'ai';
import { z } from 'zod';
import { asList, isRecord, nonEmpty, requestOptions, resolveClient, warningOf } from '../shared.js';
import type { OctenClientOptions } from '../shared.js';

export type ExtractInput = { urls: string[]; query?: string | null };
export type ModelClassification = { primary: string; secondary?: string };
export type ModelLink = { url: string; anchor_text?: string; is_external?: boolean };
export type ModelExtractResult = {
  url?: string;
  status?: string;
  error_message?: string;
  title?: string;
  full_content?: string;
  highlights?: string[];
  time_published?: string;
  time_last_crawled?: string;
  category?: ModelClassification;
  page_structure?: ModelClassification;
  cover_image?: string;
  images?: string[];
  videos?: string[];
  audio?: string[];
  links?: ModelLink[];
};
export type ExtractToolResult = { request_id: string; warning?: string; results: ModelExtractResult[] };

export type OctenExtractOptions = {
  description?: string;
  maxUrls?: number;
  mode?: 'standard' | 'advanced' | 'auto';
  format?: 'markdown' | 'text';
  maxAgeSeconds?: number;
  urlTimeout?: number;
  includeImages?: boolean;
  includeVideos?: boolean;
  includeAudio?: boolean;
  includeLinks?: { scope?: 'prefer_internal' | 'prefer_external'; maxLinks?: number };
} & OctenClientOptions;

// Limits from docs.octen.ai/api-reference/extract; the model's URL cap defaults lower to bound one call's cost.
const API_MAX_URLS = 20;
const DEFAULT_MAX_URLS = 5;
const MAX_URL_LENGTH = 2048;
const MAX_QUERY_LENGTH = 500;

const DESCRIPTION =
  "Read one or more web pages by URL and return their clean content. Without `query` each result carries the page's `full_content`; this is what you want in almost all cases. Only pass `query` when you need the passages about one specific topic: each result then returns ranked `highlights` instead of the full content, so the page body will be partial. Results also carry the page title, the publication and last crawl times when known, and a topical `category` and `page_structure` classification when detected.\n\n" +
  'Use this when you already have the URL(s). To find pages first, use a search tool.\n\n' +
  'Each URL succeeds or fails on its own: a page that could not be read comes back with status "failed" and an `error_message`, while the other URLs still return their content. Match results to your URLs by each item\'s `url`, not by position.';

type DeveloperParams = Omit<ExtractParams, 'urls' | 'query'>;

function invalid(field: string, message: string): never {
  throw new OctenValidationError(field, message);
}

function intIn(value: unknown, min: number, max: number, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    invalid(field, `${field} must be an integer from ${min} to ${max}, got ${String(value)}.`);
  }
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    invalid(field, `${field} must be one of ${allowed.join(', ')}, got ${String(value)}.`);
  }
  return value as T;
}

function bool(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') invalid(field, `${field} must be a boolean, got ${String(value)}.`);
  return value;
}

function links(value: unknown): DeveloperParams['include_links'] {
  if (value === undefined) return undefined;
  if (!isRecord(value)) invalid('includeLinks', 'includeLinks must be an object such as {} or { maxLinks: 50 }.');
  for (const key of Object.keys(value)) {
    if (key !== 'scope' && key !== 'maxLinks') {
      invalid(`includeLinks.${key}`, `includeLinks takes only scope and maxLinks, got ${key}.`);
    }
  }
  const out: NonNullable<DeveloperParams['include_links']> = {};
  const scope = oneOf(value['scope'], ['prefer_internal', 'prefer_external'], 'includeLinks.scope');
  const maxLinks = intIn(value['maxLinks'], 1, 1000, 'includeLinks.maxLinks');
  if (scope !== undefined) out.scope = scope;
  if (maxLinks !== undefined) out.max_links = maxLinks;
  return out;
}

// Validates the developer options once and maps them to the API's names; unset options are left out.
function developerParams(options: OctenExtractOptions): DeveloperParams {
  const entries: [keyof DeveloperParams, unknown][] = [
    ['mode', oneOf(options.mode, ['standard', 'advanced', 'auto'], 'mode')],
    ['format', oneOf(options.format, ['markdown', 'text'], 'format')],
    ['max_age_seconds', intIn(options.maxAgeSeconds, 300, 31_536_000, 'maxAgeSeconds')],
    ['timeout', intIn(options.urlTimeout, 1, 60, 'urlTimeout')],
    ['include_images', bool(options.includeImages, 'includeImages')],
    ['include_videos', bool(options.includeVideos, 'includeVideos')],
    ['include_audio', bool(options.includeAudio, 'includeAudio')],
    ['include_links', links(options.includeLinks)],
  ];
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined)) as DeveloperParams;
}

const URLS_DESCRIPTION = (maxUrls: number) =>
  `URLs of the pages to read, e.g. 'https://example.com/article'. 1 to ${maxUrls} per call, each at most 2048 characters.`;
const QUERY_DESCRIPTION =
  "Optional; leave it unset in the normal case, and each result returns the page's full content. Set it only to get ranked excerpts about one specific topic: each result then returns `highlights` and omits `full_content`. Max 500 characters.";

// JSON Schema lengths and the SDK's URL check count code points; zod 3.25 and 4.1 count UTF-16 units in .max.
const codePoints = (s: string) => [...s].length;

// The JSON schema is written out so its lengths keep their code-point meaning; zod only validates.
function inputSchema(maxUrls: number) {
  const validator = z.object({
    urls: z
      .array(z.string().min(1).refine((url) => codePoints(url) <= MAX_URL_LENGTH, 'Each URL must be at most 2048 characters.'))
      .min(1, 'Pass at least one URL.')
      .max(maxUrls, `Pass at most ${maxUrls} URLs per call; split a longer list into several calls.`),
    // Strict-mode providers send null for an optional field; execute drops it.
    query: z
      .string()
      .min(1)
      .refine((q) => codePoints(q) <= MAX_QUERY_LENGTH, 'query must be at most 500 characters.')
      .nullable()
      .optional(),
  });
  return jsonSchema<ExtractInput>(
    {
      type: 'object',
      properties: {
        urls: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: MAX_URL_LENGTH },
          minItems: 1,
          maxItems: maxUrls,
          description: URLS_DESCRIPTION(maxUrls),
        },
        query: { anyOf: [{ type: 'string', minLength: 1, maxLength: MAX_QUERY_LENGTH }, { type: 'null' }], description: QUERY_DESCRIPTION },
      },
      required: ['urls'],
      additionalProperties: false,
    },
    {
      validate: (value) => {
        const result = validator.safeParse(value);
        return result.success ? { success: true, value: result.data as ExtractInput } : { success: false, error: result.error };
      },
    },
  );
}

// The AI SDK validates the schema first; this repeats the count check for callers that run execute directly.
function checkUrls(urls: unknown, maxUrls: number): string[] {
  if (!Array.isArray(urls) || urls.length === 0) {
    invalid('urls', `No URLs given: pass 1 to ${maxUrls} URLs. No request was made.`);
  }
  if (urls.length > maxUrls) {
    invalid(
      'urls',
      `Too many URLs: got ${urls.length}, but this tool reads at most ${maxUrls} per call. No request was made; split them into several calls of at most ${maxUrls} URLs each.`,
    );
  }
  return [...(urls as string[])];
}

function classification(value: unknown): ModelClassification | undefined {
  if (!isRecord(value)) return undefined;
  const primary = nonEmpty(value['primary']);
  if (primary === undefined) return undefined;
  const secondary = nonEmpty(value['secondary']);
  return secondary === undefined ? { primary } : { primary, secondary };
}

function mediaUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((m) => {
    const url = isRecord(m) ? nonEmpty(m['url']) : undefined;
    return url === undefined ? [] : [url];
  });
}

function trimLinks(value: unknown): ModelLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((l) => {
    const url = isRecord(l) ? nonEmpty(l['url']) : undefined;
    if (url === undefined || !isRecord(l)) return [];
    const link: ModelLink = { url };
    const anchor = nonEmpty(l['anchor_text']);
    if (anchor !== undefined) link.anchor_text = anchor;
    if (typeof l['is_external'] === 'boolean') link.is_external = l['is_external'];
    return [link];
  });
}

const STRING_FIELDS = ['url', 'status', 'error_message', 'title', 'full_content', 'time_published', 'time_last_crawled'] as const;

// Media and links are present only when the developer turned them on; empty values are left out.
function trimResult(r: Record<string, unknown>): ModelExtractResult {
  const out: ModelExtractResult = {};
  for (const key of STRING_FIELDS) {
    const value = nonEmpty(r[key]);
    if (value !== undefined) out[key] = value;
  }
  const highlights = Array.isArray(r['highlights']) ? r['highlights'].filter((h): h is string => nonEmpty(h) !== undefined) : [];
  if (highlights.length > 0) out.highlights = highlights;
  const category = classification(r['category']);
  if (category !== undefined) out.category = category;
  const pageStructure = classification(r['page_structure']);
  if (pageStructure !== undefined) out.page_structure = pageStructure;
  const cover = isRecord(r['cover_image']) ? nonEmpty(r['cover_image']['url']) : undefined;
  if (cover !== undefined) out.cover_image = cover;
  for (const key of ['images', 'videos', 'audio'] as const) {
    const urls = mediaUrls(r[key]);
    if (urls.length > 0) out[key] = urls;
  }
  const pageLinks = trimLinks(r['links']);
  if (pageLinks.length > 0) out.links = pageLinks;
  return out;
}

const OPTION_KEYS = [
  'description',
  'maxUrls',
  'mode',
  'format',
  'maxAgeSeconds',
  'urlTimeout',
  'includeImages',
  'includeVideos',
  'includeAudio',
  'includeLinks',
  'client',
  'apiKey',
  'baseURL',
  'timeout',
  'maxRetries',
] as const;

// Reads each option once, so validation, the schema and the requests all see the same values.
function snapshot(options: OctenExtractOptions): OctenExtractOptions {
  const copy: Record<string, unknown> = {};
  for (const key of OPTION_KEYS) {
    const value = (options as Record<string, unknown>)[key];
    if (value !== undefined) copy[key] = value;
  }
  return copy as OctenExtractOptions;
}

export function octenExtract(given: OctenExtractOptions = {}): Tool<ExtractInput, ExtractToolResult> {
  const options = snapshot(given);
  const maxUrls = intIn(options.maxUrls, 1, API_MAX_URLS, 'maxUrls') ?? DEFAULT_MAX_URLS;
  const fixed = developerParams(options);
  // One client per tool, reused by every call; with no client timeout the SDK derives one from urlTimeout.
  const client = resolveClient(options);
  return tool({
    description: options.description ?? `${DESCRIPTION}\n\nPass at most ${maxUrls} URLs per call; split a longer list into several calls.`,
    inputSchema: inputSchema(maxUrls),
    execute: async (input: ExtractInput, { abortSignal }): Promise<ExtractToolResult> => {
      const urls = checkUrls(input.urls, maxUrls);
      const query = input.query ?? undefined;
      const params: ExtractParams = { urls, ...(query === undefined ? {} : { query }), ...fixed };
      const res = await client.extract.extract(params, requestOptions(abortSignal));
      return {
        request_id: res.request_id,
        ...warningOf(res),
        results: asList(res.data?.results, 'data.results')
          .filter(isRecord)
          .map(trimResult)
          .filter((r) => Object.keys(r).length > 0),
      };
    },
  });
}
