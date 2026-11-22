// Every TypeScript block in README.md, one function per block so names do not clash.
// test/readmeExamples.test.ts checks that the README and this file stay in step.

import { generateText, stepCountIs, streamText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import {
  octenBroadSearch,
  octenExtract,
  octenNewsSearch,
  octenPlaceSearch,
  octenWebSearch,
  octenWebSearchPremier,
} from '@octen.ai/ai-sdk-tools';
import { Octen, OctenAPIError, OctenError } from '@octen.ai/sdk';

export async function quickStart(): Promise<void> {
  const { text } = await generateText({
    model: anthropic('claude-opus-5-5'),
    tools: { webSearch: octenWebSearch() },
    stopWhen: stepCountIs(5),
    prompt: 'What changed in the latest Node.js LTS release? Cite your sources.',
  });
  console.log(text);
}

export async function premierSettings(): Promise<void> {
  // The model still only writes the query and may pick a time range; the rest is fixed here.
  const premier = octenWebSearchPremier({
    defaults: { count: 3, result_type: 'dynamic', include_domains: ['nature.com', 'science.org'] },
  });
}

export async function extractTool(): Promise<void> {
  // The model finds pages with web search, then reads up to three of them per call.
  const { text: summary } = await generateText({
    model: anthropic('claude-opus-5-5'),
    tools: {
      webSearch: octenWebSearch(),
      readPages: octenExtract({ maxUrls: 3, maxAgeSeconds: 3600, includeLinks: { maxLinks: 20 } }),
    },
    stopWhen: stepCountIs(8),
    prompt: 'Read the latest Node.js release announcement and list its three biggest changes.',
  });
  console.log(summary);
}

export async function optionsAndPrecedence(): Promise<void> {
  // Reuse one client for several tools. `client` cannot be combined with apiKey, baseURL, timeout or maxRetries.
  const client = new Octen({ apiKey: process.env.OCTEN_API_KEY, timeout: 20_000 });

  const tools = {
    webSearch: octenWebSearch({
      client,
      description: 'Search the web for documentation and release notes.',
      defaults: { count: 8, include_domains: ['nodejs.org', 'github.com'] },
    }),
    // The model can no longer choose a time range: it is pinned to one week.
    newsSearch: octenNewsSearch({ client, defaults: { time_range: 'week' } }),
    // Pin the search area so the model only has to write the query.
    placeSearch: octenPlaceSearch({
      client,
      defaults: { latitude: 35.6595, longitude: 139.7005, radius: 2000 },
    }),
  };

  // Without `client`, the tool builds its own client from these four options.
  const lowLevel = octenWebSearch({ apiKey: 'sk-...', baseURL: 'https://api.octen.ai', timeout: 15_000, maxRetries: 1 });
}

export async function topLevelMerge(): Promise<void> {
  // The tool's default is highlight: { enable: true, max_tokens: 300 }.
  // Your object replaces it entirely, so the request carries only the fields you set here.
  const longerHighlights = octenWebSearch({ defaults: { highlight: { enable: true, max_tokens: 600 } } });

  // The tool's default is places: { count: 5 }. Your object replaces it entirely, so the request carries no count.
  const withReviews = octenPlaceSearch({ defaults: { places: { max_reviews: 2 } } });

  // Broad Search takes its highlight option under search_options, which is replaced as a whole too.
  const broad = octenBroadSearch({
    defaults: { search_options: { count: 3, highlight: { enable: true, max_tokens: 300 } } },
  });
}

export async function describeError(): Promise<void> {
  // Use this wherever you catch an error that came out of a tool call.
  function describeError(err: unknown): string {
    if (err instanceof OctenAPIError) {
      return `Octen API error ${err.status} (request ${err.requestId}): ${err.message}`;
    }
    if (err instanceof OctenError) {
      return `${err.name}: ${err.message}`; // timeout, connection, abort or validation error
    }
    throw err;
  }
}

export async function cancellation(): Promise<void> {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20_000);

  try {
    await generateText({
      model: anthropic('claude-opus-5-5'),
      tools: { webSearch: octenWebSearch() },
      stopWhen: stepCountIs(5),
      abortSignal: controller.signal,
      prompt: 'Summarize this week in open-source AI.',
    });
  } catch (err) {
    // The rejection is the signal's AbortError, not the tool's OctenAbortError.
    if (err instanceof Error && err.name === 'AbortError') console.log('Cancelled.');
    else throw err;
  }
}

export async function streamCancellation(): Promise<void> {
  const streamController = new AbortController();

  const result = streamText({
    model: anthropic('claude-opus-5-5'),
    tools: { webSearch: octenWebSearch() },
    stopWhen: stepCountIs(5),
    abortSignal: streamController.signal,
    prompt: 'Summarize this week in open-source AI.',
  });
  for await (const chunk of result.textStream) process.stdout.write(chunk);
}

export async function toolErrors(): Promise<void> {
  const result = await generateText({
    model: anthropic('claude-opus-5-5'),
    tools: { webSearch: octenWebSearch() },
    stopWhen: stepCountIs(5),
    prompt: 'What changed in the latest Node.js LTS release?',
  });
  for (const part of result.steps.flatMap((step) => step.content)) {
    if (part.type === 'tool-error' && part.error instanceof OctenError) {
      const api = part.error instanceof OctenAPIError ? ` (status ${part.error.status}, request ${part.error.requestId})` : '';
      console.error(`${part.toolName} failed: ${part.error.name}: ${part.error.message}${api}`);
    }
  }
}

export async function noRetries(): Promise<void> {
  // No automatic retries: a rate limit or timeout surfaces as an error instead of a second billed request.
  const strict = octenWebSearch({ maxRetries: 0 });
}
