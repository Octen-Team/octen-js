import { Octen } from '@octen.ai/sdk';
import { describe, expect, it } from 'vitest';
import {
  octenBroadSearch,
  octenBusinessSearch,
  octenExtract,
  octenNewsSearch,
  octenPlaceSearch,
  octenPulseSearch,
  octenWebSearch,
  octenWebSearchPremier,
} from '../src/index.js';
import { jsonResponse, run } from './helpers.js';

// Raw request bodies recorded from the 0.1.2 tools (with @octen.ai/sdk 0.1.0) before Web Search Premier was added.
const BASELINE = [
  {
    name: 'octenWebSearch',
    make: (client: Octen) => octenWebSearch({ client }),
    input: { query: 'q', time_range: 'week' },
    path: '/search',
    body: '{"count":5,"highlight":{"enable":true,"max_tokens":300},"query":"q","time_range":"week"}',
  },
  {
    name: 'octenBroadSearch',
    make: (client: Octen) => octenBroadSearch({ client }),
    input: { query: 'q' },
    path: '/broad-search',
    body: '{"search_options":{"highlight":{"enable":true,"max_tokens":300}},"query":"q"}',
  },
  {
    name: 'octenNewsSearch',
    make: (client: Octen) => octenNewsSearch({ client }),
    input: { query: 'q', time_range: 'day' },
    path: '/news-search',
    body: '{"count":5,"highlight":{"enable":true,"max_tokens":300},"query":"q","time_range":"day"}',
  },
  {
    name: 'octenBusinessSearch',
    make: (client: Octen) => octenBusinessSearch({ client }),
    input: { query: 'q' },
    path: '/business-search',
    body: '{"count":5,"highlight":{"enable":true,"max_tokens":300},"query":"q"}',
  },
  {
    name: 'octenPlaceSearch',
    make: (client: Octen) => octenPlaceSearch({ client }),
    input: { query: 'q' },
    path: '/place-search',
    body: '{"places":{"count":5},"query":"q"}',
  },
  {
    name: 'octenPulseSearch',
    make: (client: Octen) => octenPulseSearch({ client }),
    input: { query: 'q' },
    path: '/pulse-search',
    body: '{"count":5,"query":"q"}',
  },
  // Recorded from the 0.2.0 Web Search Premier commits before Extract was added.
  {
    name: 'octenWebSearchPremier',
    make: (client: Octen) => octenWebSearchPremier({ client }),
    input: { query: 'q', time_range: 'week' },
    path: '/search-premier',
    body: '{"count":5,"highlight":{"enable":true,"max_tokens":300},"query":"q","time_range":"week"}',
  },
  // Recorded from the 0.2.0 Extract tool before Image Search and Design Search were added.
  {
    name: 'octenExtract',
    make: (client: Octen) => octenExtract({ client }),
    input: { urls: ['https://example.com/a'], query: 'q' },
    path: '/extract',
    body: '{"urls":["https://example.com/a"],"query":"q"}',
  },
  {
    name: 'octenExtract with every option',
    make: (client: Octen) =>
      octenExtract({
        client,
        mode: 'advanced',
        format: 'text',
        maxAgeSeconds: 600,
        urlTimeout: 45,
        includeImages: true,
        includeVideos: false,
        includeAudio: true,
        includeLinks: { scope: 'prefer_external', maxLinks: 3 },
      }),
    input: { urls: ['https://example.com/a', 'https://example.com/b'] },
    path: '/extract',
    body: '{"urls":["https://example.com/a","https://example.com/b"],"mode":"advanced","format":"text","max_age_seconds":600,"timeout":45,"include_images":true,"include_videos":false,"include_audio":true,"include_links":{"scope":"prefer_external","max_links":3}}',
  },
];

describe('existing tools', () => {
  it.each(BASELINE)('$name sends the same request as before', async ({ make, input, path, body }) => {
    const sent: { path: string; body: unknown }[] = [];
    const fakeFetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      sent.push({ path: new URL(String(url)).pathname, body: init?.body });
      return jsonResponse({ request_id: 'r' });
    }) as typeof fetch;
    await run(make(new Octen({ apiKey: 'test-key', fetch: fakeFetch, maxRetries: 0 })), input);
    expect(sent).toEqual([{ path, body }]);
  });
});
