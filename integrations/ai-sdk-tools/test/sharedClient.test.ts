import { OctenAbortError } from '@octen.ai/sdk';
import type { Octen } from '@octen.ai/sdk';
import { describe, expect, it } from 'vitest';
import { octenBroadSearch } from '../src/tools/broadSearch.js';
import { octenBusinessSearch } from '../src/tools/businessSearch.js';
import { octenNewsSearch } from '../src/tools/newsSearch.js';
import { octenPlaceSearch } from '../src/tools/placeSearch.js';
import { octenPulseSearch } from '../src/tools/pulseSearch.js';
import { octenWebSearch } from '../src/tools/webSearch.js';
import { clientFor, hangUntilAborted, jsonResponse, recordingFetch, run } from './helpers.js';
import broadFixture from './fixtures/broad-search.json';
import businessFixture from './fixtures/business-search.json';
import newsFixture from './fixtures/news-search.json';
import placeFixture from './fixtures/place-search.json';
import pulseFixture from './fixtures/pulse-search.json';
import searchFixture from './fixtures/search.json';

type Entry = {
  name: string;
  make: (client: Octen) => { execute?: unknown };
  input: unknown;
  path: string;
  // Production envelope recorded in test/fixtures, used as the reply.
  fixture: { request_id: string };
};

// Add one entry per tool.
const ENTRIES: Entry[] = [
  { name: 'web search', make: (client) => octenWebSearch({ client }), input: { query: 'q' }, path: '/search', fixture: searchFixture },
  { name: 'pulse search', make: (client) => octenPulseSearch({ client }), input: { query: 'q' }, path: '/pulse-search', fixture: pulseFixture },
  { name: 'broad search', make: (client) => octenBroadSearch({ client }), input: { query: 'q' }, path: '/broad-search', fixture: broadFixture },
  { name: 'news search', make: (client) => octenNewsSearch({ client }), input: { query: 'q' }, path: '/news-search', fixture: newsFixture },
  { name: 'business search', make: (client) => octenBusinessSearch({ client }), input: { query: 'q' }, path: '/business-search', fixture: businessFixture },
  { name: 'place search', make: (client) => octenPlaceSearch({ client }), input: { query: 'q' }, path: '/place-search', fixture: placeFixture },
];

const PAIRS = ENTRIES.flatMap((aborted) => ENTRIES.filter((other) => other !== aborted).map((other) => ({ aborted, other })));

describe('tools sharing one client', () => {
  it.each(PAIRS)('aborting $aborted.name in flight leaves a concurrent $other.name call resolving', async ({ aborted, other }) => {
    let enteredHang!: () => void;
    const entered = new Promise<void>((resolve) => {
      enteredHang = resolve;
    });
    const { fakeFetch } = recordingFetch(async (url, init) => {
      if (url.endsWith(aborted.path)) {
        const pending = hangUntilAborted(init);
        enteredHang();
        return await pending;
      }
      return jsonResponse(other.fixture);
    });
    const client = clientFor(fakeFetch);
    const controller = new AbortController();
    const abortedCall = run(aborted.make(client), aborted.input, controller.signal).catch((e: unknown) => e);
    const otherCall = run(other.make(client), other.input);
    // Abort only after the request is in flight, not before it is sent.
    await entered;
    controller.abort();
    expect(await abortedCall).toBeInstanceOf(OctenAbortError);
    expect(await otherCall).toMatchObject({ request_id: other.fixture.request_id });
  });
});
