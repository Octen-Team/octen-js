// Type-checked against each ai version in the matrix: the published d.ts is built against ai@7 types.
import { generateText, stepCountIs, streamText } from 'ai';
import { Octen, OctenAPIError } from '@octen.ai/sdk';
import {
  octenBroadSearch,
  octenBusinessSearch,
  octenNewsSearch,
  octenPlaceSearch,
  octenPulseSearch,
  octenWebSearch,
} from '@octen.ai/ai-sdk-tools';
import type { WebSearchToolResult } from '@octen.ai/ai-sdk-tools';

declare const model: Parameters<typeof generateText>[0]['model'];
const client = new Octen({ apiKey: 'test-key' });

export async function consume(): Promise<string> {
  const tools = {
    webSearch: octenWebSearch({ client }),
    broadSearch: octenBroadSearch({ client }),
    newsSearch: octenNewsSearch({ client, defaults: { time_range: 'week' } }),
    businessSearch: octenBusinessSearch({ client }),
    placeSearch: octenPlaceSearch({ client }),
    pulseSearch: octenPulseSearch({ client }),
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
    if (part.type === 'tool-error' && part.error instanceof OctenAPIError) {
      console.error(`${part.toolName} failed: ${part.error.status} (request ${part.error.requestId})`);
    }
  }
  const stream = streamText({ model, tools: { webSearch: octenWebSearch({ client }) }, stopWhen: stepCountIs(5), prompt: 'q' });
  for await (const part of stream.fullStream) if (part.type === 'tool-error') console.log(part.error);
  return result.text;
}
