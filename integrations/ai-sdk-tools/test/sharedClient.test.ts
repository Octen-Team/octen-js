import { OctenAbortError } from '@octen.ai/sdk';
import type { Octen } from '@octen.ai/sdk';
import { describe, expect, it } from 'vitest';
import { octenBroadSearch } from '../src/tools/broadSearch.js';
import { octenBusinessSearch } from '../src/tools/businessSearch.js';
import { octenNewsSearch } from '../src/tools/newsSearch.js';
import { octenPlaceSearch } from '../src/tools/placeSearch.js';
import { octenPulseSearch } from '../src/tools/pulseSearch.js';
import { octenWebSearch } from '../src/tools/webSearch.js';
import { octenWebSearchPremier } from '../src/tools/webSearchPremier.js';
import { clientFor, hangUntilAborted, jsonResponse, recordingFetch, run } from './helpers.js';
import broadFixture from './fixtures/broad-search.json';
import businessFixture from './fixtures/business-search.json';
import newsFixture from './fixtures/news-search.json';
import placeFixture from './fixtures/place-search.json';
import pulseFixture from './fixtures/pulse-search.json';
import searchFixture from './fixtures/search.json';
import premierFixture from './fixtures/search-premier.json';

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
  { name: 'web search premier', make: (client) => octenWebSearchPremier({ client }), input: { query: 'q' }, path: '/search-premier', fixture: premierFixture },
  { name: 'pulse search', make: (client) => octenPulseSearch({ client }), input: { query: 'q' }, path: '/pulse-search', fixture: pulseFixture },
  { name: 'broad search', make: (client) => octenBroadSearch({ client }), input: { query: 'q' }, path: '/broad-search', fixture: broadFixture },
  { name: 'news search', make: (client) => octenNewsSearch({ client }), input: { query: 'q' }, path: '/news-search', fixture: newsFixture },
  { name: 'business search', make: (client) => octenBusinessSearch({ client }), input: { query: 'q' }, path: '/business-search', fixture: businessFixture },
  { name: 'place search', make: (client) => octenPlaceSearch({ client }), input: { query: 'q' }, path: '/place-search', fixture: placeFixture },
];

const PAIRS = ENTRIES.flatMap((aborted) => ENTRIES.filter((other) => other !== aborted).map((other) => ({ aborted, other })));

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// The same tool on its own client: what the concurrent call must return in full.
async function soloResult(entry: Entry): Promise<unknown> {
  const { fakeFetch } = recordingFetch(() => jsonResponse(entry.fixture));
  return await run(entry.make(clientFor(fakeFetch)), entry.input);
}

describe('tools sharing one client', () => {
  it.each(PAIRS)('aborting $aborted.name in flight leaves a concurrent $other.name call resolving', async ({ aborted, other }) => {
    const abortedEntered = deferred();
    const otherEntered = deferred();
    const releaseOther = deferred();
    const { fakeFetch } = recordingFetch(async (url, init) => {
      if (url.endsWith(aborted.path)) {
        const pending = hangUntilAborted(init);
        abortedEntered.resolve();
        return await pending;
      }
      otherEntered.resolve();
      await releaseOther.promise;
      return jsonResponse(other.fixture);
    });
    const client = clientFor(fakeFetch);
    const controller = new AbortController();
    const abortedCall = run(aborted.make(client), aborted.input, controller.signal).catch((e: unknown) => e);
    let otherSettled = false;
    const otherCall = run(other.make(client), other.input).finally(() => {
      otherSettled = true;
    });
    // Both requests are in flight when the abort lands.
    await Promise.all([abortedEntered.promise, otherEntered.promise]);
    controller.abort();
    expect(await abortedCall).toBeInstanceOf(OctenAbortError);
    expect(otherSettled).toBe(false);
    releaseOther.resolve();
    expect(await otherCall).toEqual(await soloResult(other));
  });
});
