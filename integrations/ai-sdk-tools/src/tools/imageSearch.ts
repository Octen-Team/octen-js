import { OctenAPIError, isOctenError } from '@octen.ai/sdk';
import type { ImageSearchParams } from '@octen.ai/sdk';
import { jsonSchema, tool } from 'ai';
import type { Tool } from 'ai';
import { z } from 'zod';
import { checkInput, codePoints, defined, intIn, isNonBlank, oneOf, rejectUnknown, snapshot, stringList } from '../options.js';
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
  'Pass exactly one of `query` (text describing the images) or `image_url` (a public https image URL with a domain name, not an IP address, to find visually similar images), never both. ' +
  'Use this when the user wants pictures, photos, diagrams, screenshots or other visual references, not for general text web search.';

const BOTH = 'Pass exactly one of `query` or `image_url`, not both: this search takes a single input. No request was made.';
const NEITHER =
  'Pass one of `query` (text describing the images) or `image_url` (a public https URL of an image, to find similar images). No request was made.';
const NOT_HTTP =
  'image_url must be a public https URL of an image with a domain name (no IP address); this tool does not take base64 or data: URIs. No request was made.';

// The API rejects these statuses for the image itself, so the model is told to try another image.
const IMAGE_ADVICE: Record<number, string> = {
  413: 'The image is too large for Image Search. Try a smaller image (at most 5 MB) or a different image URL.',
  415: 'The image format is not supported by Image Search. Try an image in JPEG, PNG, WEBP, BMP, TIFF, ICO, DIB, ICNS or SGI format, or a different image URL.',
};

// The API rejects a malformed % escape anywhere but the query (first ? up to the next #), which it keeps raw.
function withoutQuery(value: string): string {
  const hash = value.indexOf('#');
  const question = value.indexOf('?');
  if (question === -1 || (hash !== -1 && hash < question)) return value;
  return value.slice(0, question) + (hash === -1 ? '' : value.slice(hash));
}

// The API takes only https URLs whose host is a domain name, not an IP address. Parsing never throws out of here.
// The raw string is sent as given, so ASCII whitespace and controls are refused; other characters go to the parser.
function isHttpsUrl(value: string): boolean {
  if (/[\u0000-\u0020\u007f]/.test(value)) return false;
  // ASCII in the raw authority must be an RFC 3986 authority character (the parser reads a backslash as a slash);
  // non-ASCII is left to the parser, so internationalized hosts pass. Percent escapes must be well formed.
  const authority = /^https:\/\/([^/?#]*)/i.exec(value)?.[1] ?? '';
  if (authority === '' || /[\u0000-\u007f]/.test(authority.replace(/[A-Za-z0-9\-._~%!$&'()*+,;=:@[\]]/g, ''))) return false;
  if (/%(?![0-9A-Fa-f]{2})/.test(withoutQuery(value))) return false;
  // In the host the API takes an escape only for %25 or a non-ASCII byte, so %65 for "e" is refused.
  const at = authority.lastIndexOf('@') + 1;
  const host = authority.slice(at);
  if (/%(?!25|[89A-Fa-f][0-9A-Fa-f])/.test(host)) return false;
  // The WHATWG parser refuses %25 in a host, which the API accepts; it cannot be part of an IP, so parse a stand-in.
  const start = 'https://'.length + at;
  const parseable = value.slice(0, start) + host.replace(/%25/g, '25') + value.slice(start + host.length);
  try {
    const { protocol, hostname } = new URL(parseable);
    // The parser normalizes every IPv4 form to dotted decimal and wraps IPv6 in brackets.
    const ip = hostname.startsWith('[') || /^\d+\.\d+\.\d+\.\d+$/.test(hostname);
    return protocol === 'https:' && hostname !== '' && !ip;
  } catch {
    return false;
  }
}

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
  if (image && !isHttpsUrl(String(input.image_url))) return { field: 'image_url', message: NOT_HTTP };
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
      description:
        'A public https URL of an image with a domain name (no IP address), to find visually similar images. Set exactly one of `query` or `image_url`.',
    },
  };
  for (const field of domainFields) {
    properties[field] = {
      anyOf: [{ type: 'array', items: { type: 'string', minLength: 1 }, maxItems: MAX_DOMAINS }, { type: 'null' }],
      description: DOMAIN_DESCRIPTIONS[field],
    };
  }
  const schema = jsonSchema<ImageSearchInput>(
    { type: 'object', properties, additionalProperties: false },
    {
      validate: (value) => {
        const result = validator.safeParse(value);
        return result.success ? { success: true, value: result.data as ImageSearchInput } : { success: false, error: result.error };
      },
    },
  );
  return { schema, validator };
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

type APIErrorClass = new (init: ConstructorParameters<typeof OctenAPIError>[0] & { retryAfter: number | null }) => OctenAPIError;

// Transport errors can quote the request payload; an abort keeps its cause, which is the caller's own reason.
const TRANSPORT_MESSAGES: Record<string, string> = {
  OctenConnectionError: 'Connection error on an Image Search request by image URL.',
  OctenTimeoutError: 'Request timed out.',
};

// Keeps the class, status and request id; isOctenError also matches an error from a client of another SDK copy.
// On an image-URL call every API error drops the upstream text and body: they can hold a copy of a signed URL.
function imageError(err: unknown, byUrl: boolean): unknown {
  // A text-query call gets every error as the SDK raised it.
  if (!byUrl || !isOctenError(err)) return err;
  const transport = TRANSPORT_MESSAGES[err.name];
  if (transport !== undefined) return new ((err as Error).constructor as new (message: string) => Error)(transport);
  if (!('status' in err)) return err;
  const api = err as OctenAPIError & { retryAfter?: number | null };
  const { status, code, requestId } = api;
  const message = `${IMAGE_ADVICE[status] ?? 'Image Search failed.'} (HTTP ${status}, request ${requestId ?? 'unknown'})`;
  return new (api.constructor as APIErrorClass)({ status, code, requestId, body: null, message, retryAfter: api.retryAfter ?? null });
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
  rejectUnknown(given, OPTION_KEYS);
  const options = snapshot(given, OPTION_KEYS);
  const fixed = developerParams(options);
  // A domain list the developer set is pinned: the model does not see that filter.
  const modelDomains = (['include_domains', 'exclude_domains'] as const).filter((f) => fixed[f] === undefined);
  // One client per tool, reused by every call.
  const client = resolveClient(options);
  const { schema, validator } = inputSchema(modelDomains);
  return tool({
    description: options.description ?? DESCRIPTION,
    inputSchema: schema,
    execute: async (given: ImageSearchInput, { abortSignal }): Promise<ImageSearchToolResult> => {
      const input = checkInput<ImageSearchInput>(validator, given);
      const inputs: ImageSearchParams['inputs'] = isNonBlank(input.query)
        ? [{ type: 'text', data: input.query }]
        : [{ type: 'image', url: String(input.image_url) }];
      const fromModel: Partial<Record<DomainField, string[]>> = {};
      for (const field of modelDomains) {
        const list = input[field];
        if (Array.isArray(list) && list.length > 0) fromModel[field] = [...list];
      }
      const params: ImageSearchParams = { inputs, ...fromModel, ...fixed };
      const byUrl = inputs[0]?.type === 'image';
      const res = await client.imageSearch.search(params, requestOptions(abortSignal)).catch((err: unknown) => {
        throw imageError(err, byUrl);
      });
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
