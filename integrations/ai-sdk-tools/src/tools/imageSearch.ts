import type { ImageSearchParams } from '@octen.ai/sdk';
import { jsonSchema, tool } from 'ai';
import type { Tool } from 'ai';
import { z } from 'zod';
import { codePoints, defined, intIn, invalid, isNonBlank, oneOf, snapshot, stringList } from '../options.js';
import { asList, isRecord, nonEmpty, requestOptions, resolveClient, warningOf } from '../shared.js';
import type { OctenClientOptions } from '../shared.js';

export type ImageSearchInput = {
  query?: string | null;
  image_url?: string | null;
  include_domains?: string[] | null;
  exclude_domains?: string[] | null;
};
export type ModelImageResult = {
  title?: string;
  url?: string;
  source_page?: string;
  description?: string;
  width?: number;
  height?: number;
  thumbnail?: string;
};
export type ImageSearchToolResult = { request_id: string; warning?: string; results: ModelImageResult[] };

export type OctenImageSearchOptions = {
  description?: string;
  count?: number;
  safesearch?: 'off' | 'strict';
  includeDomains?: readonly string[];
  excludeDomains?: readonly string[];
} & OctenClientOptions;

// Limits from docs.octen.ai/api-reference/image-search.
const MAX_QUERY_LENGTH = 500;
const MAX_DOMAINS = 10;

// Wording follows the hosted Octen MCP image tool, without the inputs this tool does not take.
const DESCRIPTION =
  'Find images on the web by a text query or by a reference image. Returns ranked images, each with the image URL, the page that hosts it (`source_page`), a title, a text description, its size and a thumbnail URL. ' +
  'Pass exactly one of `query` (text describing the images) or `image_url` (a public image URL, to find visually similar images), never both. ' +
  'Use this when the user wants pictures, photos, diagrams, screenshots or other visual references, not for general text web search.';

const BOTH = 'Pass exactly one of `query` or `image_url`, not both: this search takes a single input. No request was made.';
const NEITHER =
  'Pass one of `query` (text describing the images) or `image_url` (a public http(s) URL of an image, to find similar images). No request was made.';
const NOT_HTTP =
  'image_url must be a public http(s) URL of an image; this tool does not take base64 or data: URIs. No request was made.';

const HTTP_URL = /^https?:\/\//i;

type DomainField = 'include_domains' | 'exclude_domains';
type DeveloperParams = Omit<ImageSearchParams, 'inputs'>;

function developerParams(options: OctenImageSearchOptions): DeveloperParams {
  return defined<DeveloperParams>([
    ['count', intIn(options.count, 1, 10, 'count')],
    ['safesearch', oneOf(options.safesearch, ['off', 'strict'], 'safesearch')],
    ['include_domains', stringList(options.includeDomains, 'includeDomains', MAX_DOMAINS)],
    ['exclude_domains', stringList(options.excludeDomains, 'excludeDomains', MAX_DOMAINS)],
  ]);
}

const DOMAIN_DESCRIPTIONS: Record<DomainField, string> = {
  include_domains: "Optional. Only return images whose source page is on these domains, e.g. ['unsplash.com']. Up to 10.",
  exclude_domains: 'Optional. Drop images whose source page is on these domains. Up to 10.',
};

// The rule the model must follow, shared by the AI SDK's input check and execute.
function inputProblem(input: { query?: unknown; image_url?: unknown }): { field: string; message: string } | undefined {
  const query = isNonBlank(input.query);
  const image = isNonBlank(input.image_url);
  if (query && image) return { field: 'image_url', message: BOTH };
  if (!query && !image) return { field: 'query', message: NEITHER };
  if (image && !HTTP_URL.test(String(input.image_url))) return { field: 'image_url', message: NOT_HTTP };
  return undefined;
}

// The JSON schema is written out so the model sees code-point lengths and the nullable fields; zod only validates.
function inputSchema(domainFields: readonly DomainField[]) {
  const domainList = z.array(z.string().min(1)).max(MAX_DOMAINS).nullable().optional();
  const shape: Record<string, z.ZodType> = {
    // Strict-mode providers send null for an optional field; execute drops it.
    query: z
      .string()
      .refine((q) => codePoints(q) <= MAX_QUERY_LENGTH, 'query must be at most 500 characters.')
      .nullable()
      .optional(),
    image_url: z.string().nullable().optional(),
  };
  for (const field of domainFields) shape[field] = domainList;
  const validator = z.object(shape).superRefine((value, ctx) => {
    const problem = inputProblem(value as { query?: unknown; image_url?: unknown });
    if (problem !== undefined) ctx.addIssue({ code: 'custom', path: [problem.field], message: problem.message });
  });
  const properties: Record<string, unknown> = {
    query: {
      anyOf: [{ type: 'string', minLength: 1, maxLength: MAX_QUERY_LENGTH }, { type: 'null' }],
      description: 'Text describing the images to find. Max 500 characters. Set exactly one of `query` or `image_url`.',
    },
    image_url: {
      anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
      description: 'A public http(s) URL of an image, to find visually similar images. Set exactly one of `query` or `image_url`.',
    },
  };
  for (const field of domainFields) {
    properties[field] = {
      anyOf: [{ type: 'array', items: { type: 'string', minLength: 1 }, maxItems: MAX_DOMAINS }, { type: 'null' }],
      description: DOMAIN_DESCRIPTIONS[field],
    };
  }
  return jsonSchema<ImageSearchInput>(
    { type: 'object', properties, additionalProperties: false },
    {
      validate: (value) => {
        const result = validator.safeParse(value);
        return result.success ? { success: true, value: result.data as ImageSearchInput } : { success: false, error: result.error };
      },
    },
  );
}

const STRING_FIELDS = ['title', 'url', 'source_page', 'description', 'thumbnail'] as const;
const NUMBER_FIELDS = ['width', 'height'] as const;

function trimImage(r: Record<string, unknown>): ModelImageResult {
  const out: ModelImageResult = {};
  for (const key of STRING_FIELDS) {
    const value = nonEmpty(r[key]);
    if (value !== undefined) out[key] = value;
  }
  for (const key of NUMBER_FIELDS) {
    const value = r[key];
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

const OPTION_KEYS = [
  'description',
  'count',
  'safesearch',
  'includeDomains',
  'excludeDomains',
  'client',
  'apiKey',
  'baseURL',
  'timeout',
  'maxRetries',
] as const;

export function octenImageSearch(given: OctenImageSearchOptions = {}): Tool<ImageSearchInput, ImageSearchToolResult> {
  const options = snapshot(given, OPTION_KEYS);
  const fixed = developerParams(options);
  // A domain list the developer set is pinned: the model does not see that filter.
  const modelDomains = (['include_domains', 'exclude_domains'] as const).filter((f) => fixed[f] === undefined);
  // One client per tool, reused by every call.
  const client = resolveClient(options);
  return tool({
    description: options.description ?? DESCRIPTION,
    inputSchema: inputSchema(modelDomains),
    execute: async (input: ImageSearchInput, { abortSignal }): Promise<ImageSearchToolResult> => {
      const problem = inputProblem(input);
      if (problem !== undefined) invalid(problem.field, problem.message);
      const inputs: ImageSearchParams['inputs'] = isNonBlank(input.query)
        ? [{ type: 'text', data: input.query }]
        : [{ type: 'image', url: String(input.image_url) }];
      const fromModel: Partial<Record<DomainField, string[]>> = {};
      for (const field of modelDomains) {
        const list = input[field];
        if (Array.isArray(list) && list.length > 0) fromModel[field] = [...list];
      }
      const params: ImageSearchParams = { inputs, ...fromModel, ...fixed };
      const res = await client.imageSearch.search(params, requestOptions(abortSignal));
      return {
        request_id: res.request_id,
        ...warningOf(res),
        results: asList(res.data?.results, 'data.results')
          .filter(isRecord)
          .map(trimImage)
          .filter((r) => Object.keys(r).length > 0),
      };
    },
  });
}
