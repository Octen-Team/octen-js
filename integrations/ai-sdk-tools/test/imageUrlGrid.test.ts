import { Octen } from '@octen.ai/sdk';
import { describe, expect, it } from 'vitest';
import { octenImageSearch } from '../src/tools/imageSearch.js';
import { jsonResponse, recordingFetch, run } from './helpers.js';
// Each case records whether the API's URL rule accepts it; see the source line in the file.
import grid from './fixtures/image-url-cases.json';

// Accepted by the API's parser, refused here: none of these hosts is a valid DNS name, so no image can be fetched.
const REFUSED_LOCALLY = new Set([
  'https://ex"ample.com/a.png', // a double quote cannot appear in a DNS name
  'https://ex<ample.com/a.png', // an angle bracket cannot appear in a DNS name
  'https://ex>ample.com/a.png', // an angle bracket cannot appear in a DNS name
  'https://ex]ample.com/a.png', // a bracket outside an IPv6 literal cannot appear in a DNS name
  'https://ex\u00a0ample.com/a.png', // a no-break space cannot appear in a DNS name
]);

async function sends(url: string): Promise<boolean> {
  const rec = recordingFetch(() => jsonResponse({ request_id: 'r', data: { results: [] } }));
  const t = octenImageSearch({ client: new Octen({ apiKey: 'test-key', fetch: rec.fakeFetch, maxRetries: 0 }) });
  await run(t, { image_url: url }).catch(() => undefined);
  return rec.calls.length > 0;
}

describe('image_url against the API URL rule', () => {
  it('has the recorded grid', () => {
    expect(grid.source).toMatch(/^Go net\/url/);
    expect(grid.cases.length).toBe(505);
  });

  it.each(grid.cases.filter((c) => !c.server_accepts).map((c) => c.url))('refuses %j, which the API refuses', async (url) => {
    expect(await sends(url)).toBe(false);
  });

  it.each(grid.cases.filter((c) => c.server_accepts).map((c) => c.url))('handles %j, which the API accepts', async (url) => {
    expect(await sends(url)).toBe(!REFUSED_LOCALLY.has(url));
  });

  it('lists only cases the API accepts in REFUSED_LOCALLY', () => {
    const accepted = new Set(grid.cases.filter((c) => c.server_accepts).map((c) => c.url));
    expect([...REFUSED_LOCALLY].filter((u) => !accepted.has(u))).toEqual([]);
  });
});
