// Compile-time checks for the public option and result types; tsconfig.types.json type-checks this file.
import { Octen } from '@octen.ai/sdk';
import {
  octenBusinessSearch,
  octenNewsSearch,
  octenPlaceSearch,
  octenWebSearch,
} from '@octen.ai/ai-sdk-tools';
import type {
  BusinessSearchToolResult,
  ModelCompany,
  ModelEntity,
  ModelPerson,
  TimeRange,
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
