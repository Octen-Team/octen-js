// Type-checked against each ai version in the matrix: the published d.ts is built against ai@7 types.
import { generateText, stepCountIs, streamText } from 'ai';
import { Octen, OctenAPIError, OctenError } from '@octen.ai/sdk';
import {
  octenBroadSearch,
  octenBusinessSearch,
  octenExtract,
  octenNewsSearch,
  octenPlaceSearch,
  octenPulseSearch,
  octenWebSearch,
  octenWebSearchPremier,
} from '@octen.ai/ai-sdk-tools';
import type { WebSearchToolResult } from '@octen.ai/ai-sdk-tools';

declare const model: Parameters<typeof generateText>[0]['model'];
const client = new Octen({ apiKey: 'test-key' });

export async function consume(): Promise<string> {
  const tools = {
    webSearch: octenWebSearch({ client }),
    webSearchPremier: octenWebSearchPremier({ client, defaults: { count: 3 } }),
    broadSearch: octenBroadSearch({ client }),
    newsSearch: octenNewsSearch({ client, defaults: { time_range: 'week' } }),
    businessSearch: octenBusinessSearch({ client }),
    placeSearch: octenPlaceSearch({ client }),
    pulseSearch: octenPulseSearch({ client }),
    extract: octenExtract({ client, maxUrls: 3, includeLinks: {} }),
  };
  const result = await generateText({ model, tools, stopWhen: stepCountIs(5), prompt: 'q' });
  for (const r of result.toolResults) {
    if (r.dynamic !== true && r.toolName === 'webSearch') {
      const out: WebSearchToolResult = r.output;
      console.log(out.request_id);
    }
  }
  // Same loop as the README's tool error example.
  for (const part of result.steps.flatMap((step) => step.content)) {
    if (part.type === 'tool-error' && part.error instanceof OctenError) {
      const api = part.error instanceof OctenAPIError ? ` (status ${part.error.status}, request ${part.error.requestId})` : '';
      console.error(`${part.toolName} failed: ${part.error.name}: ${part.error.message}${api}`);
    }
  }
  const stream = streamText({ model, tools: { webSearch: octenWebSearch({ client }) }, stopWhen: stepCountIs(5), prompt: 'q' });
  for await (const part of stream.fullStream) if (part.type === 'tool-error') console.log(part.error);
  return result.text;
}

// An unused @ts-expect-error is itself a type error, so these fail if the packed declarations stop rejecting the options.
export function optionTypes() {
  return [
    octenWebSearch(),
    octenWebSearch({}),
    octenWebSearch({ apiKey: 'k' }),
    // @ts-expect-error `client` cannot be combined with a client option such as `apiKey`.
    octenWebSearch({ client, apiKey: 'k' }),
    // @ts-expect-error `query` is chosen by the model, so it cannot be pinned through `defaults`.
    octenWebSearch({ defaults: { query: 'x' } }),
    octenExtract({ apiKey: 'k', mode: 'advanced', urlTimeout: 45 }),
    // @ts-expect-error Extract `mode` is standard, advanced or auto.
    octenExtract({ apiKey: 'k', mode: 'fast' }),
  ];
}
