// Every @ts-expect-error must really error; if one fails to, tsc fails with "unused directive".
import Octen from '@octen.ai/sdk';

const client = new Octen({ apiKey: 'k' });
// @ts-expect-error nested key typo
void client.search.search({ query: 'q', highlight: { enabled: true } });
// @ts-expect-error enum value that does not exist
void client.search.search({ query: 'q', time_range: 'decade' });
// @ts-expect-error query is required
void client.search.search({ count: 1 });
// @ts-expect-error pulse mode enum
void client.search.pulseSearch({ query: 'q', mode: 'turbo' });
// @ts-expect-error count must be a number
void client.search.newsSearch({ query: 'q', count: '1' });
// @ts-expect-error placeSearch lives on client.placeSearch, not client.search
void client.search.placeSearch({ query: 'q' });
// @ts-expect-error unknown client option
void new Octen({ apiKey: 'k', retries: 2 });
