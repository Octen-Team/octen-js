// Compile-time checks for the public option and result types; tsconfig.types.json type-checks this file.
import { Octen } from '@octen.ai/sdk';
import {
  octenBusinessSearch,
  octenExtract,
  octenNewsSearch,
  octenPlaceSearch,
  octenWebSearch,
  octenWebSearchPremier,
} from '@octen.ai/ai-sdk-tools';
import type {
  BusinessSearchToolResult,
  ExtractInput,
  ExtractToolResult,
  ModelCompany,
  ModelEntity,
  ModelPerson,
  TimeRange,
  WebSearchPremierInput,
  WebSearchPremierToolResult,
} from '@octen.ai/ai-sdk-tools';

const client = new Octen({ apiKey: 'test-key' });

export function clientConflicts(): void {
  // @ts-expect-error client already carries its own apiKey
  octenWebSearch({ client, apiKey: 'k' });
  // @ts-expect-error client already carries its own baseURL
  octenNewsSearch({ client, baseURL: 'https://example.com' });
  // @ts-expect-error client already carries its own timeout
  octenPlaceSearch({ client, timeout: 1000 });
  // @ts-expect-error client already carries its own maxRetries
  octenBusinessSearch({ client, maxRetries: 0 });
  // @ts-expect-error query always comes from the model
  octenWebSearch({ defaults: { query: 'x' } });
}

export function validOptions(): void {
  octenWebSearch();
  octenWebSearch({ client, description: 'd', defaults: { count: 3 } });
  octenWebSearch({ apiKey: 'k', baseURL: 'https://example.com', timeout: 1000, maxRetries: 0 });
}

export function timeRange(): TimeRange[] {
  const all: TimeRange[] = ['day', 'week', 'month', 'year'];
  // @ts-expect-error only the four long spellings are accepted
  const short: TimeRange = 'w';
  return [...all, short];
}

// The README's narrowing advice for entities: compare type, then check for a type-specific key.
export function entityFields(out: BusinessSearchToolResult): string[] {
  const fields: string[] = [];
  for (const e of out.entities) {
    if (e.type === 'company' && 'website' in e) fields.push(e.website ?? '');
    if (e.type === 'person' && 'linkedin_url' in e) fields.push(e.linkedin_url ?? '');
    const company = e as ModelCompany;
    const person = e as ModelPerson;
    fields.push(company.website ?? '', person.current_position ?? '');
  }
  const unknown: ModelEntity = { type: 'fund', name: 'X' };
  return [...fields, unknown.type];
}

// Developer settings for Web Search Premier are typed as the SDK's SearchPremierParams, so mistakes fail to compile.
export function premierOptions(): WebSearchPremierToolResult['results'] {
  octenWebSearchPremier({ client, defaults: { count: 3, result_type: 'dynamic', full_content: { enable: true }, format: 'markdown' } });
  // @ts-expect-error client already carries its own apiKey
  octenWebSearchPremier({ client, apiKey: 'k' });
  // @ts-expect-error query always comes from the model
  octenWebSearchPremier({ defaults: { query: 'x' } });
  // @ts-expect-error result_type is standard or dynamic
  octenWebSearchPremier({ client, defaults: { result_type: 'deep' } });
  // @ts-expect-error topic is not a /search-premier request field
  octenWebSearchPremier({ client, defaults: { topic: 'news' } });
  const input: WebSearchPremierInput = { query: 'q', time_range: null };
  return input.query === '' ? [] : [{ title: 't', url: 'u' }];
}

// Extract takes its own named options instead of `defaults`, so a misspelt or out-of-type option fails to compile.
export function extractOptions(out: ExtractToolResult): string[] {
  octenExtract();
  octenExtract({ client, maxUrls: 10, mode: 'auto', format: 'text', maxAgeSeconds: 3600, urlTimeout: 45 });
  octenExtract({ apiKey: 'k', timeout: 120_000, includeImages: true, includeVideos: false, includeAudio: true });
  octenExtract({ client, includeLinks: {} });
  octenExtract({ client, includeLinks: { scope: 'prefer_external', maxLinks: 50 } });
  // @ts-expect-error client already carries its own timeout
  octenExtract({ client, timeout: 1000 });
  // @ts-expect-error mode is standard, advanced or auto
  octenExtract({ client, mode: 'fast' });
  // @ts-expect-error options use camelCase names
  octenExtract({ client, max_age_seconds: 600 });
  // @ts-expect-error includeLinks takes maxLinks, not max_links
  octenExtract({ client, includeLinks: { max_links: 3 } });
  // @ts-expect-error Extract has no defaults option
  octenExtract({ client, defaults: { mode: 'advanced' } });
  const input: ExtractInput = { urls: ['https://example.com/'], query: null };
  const urls = out.results.map((r) => (r.status === 'failed' ? `${r.url}: ${r.error_message}` : (r.full_content ?? '')));
  return [...input.urls, ...urls, ...(out.results[0]?.links?.map((l) => l.url) ?? [])];
}
