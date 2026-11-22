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
// @ts-expect-error searchPremier takes no topic
void client.search.searchPremier({ query: 'q', topic: 'news' });
// @ts-expect-error image search takes inputs, not query
void client.imageSearch.search({ query: 'q' });
// @ts-expect-error video inputs are text only
void client.videoSearch.search({ inputs: [{ type: 'image', url: 'u' }] });
// @ts-expect-error design web_search has no safesearch
void client.designSearch.search({ query: 'q', web_search: { safesearch: 'off' } });
// @ts-expect-error extract takes urls as an array
void client.extract.extract({ urls: 'https://example.com' });
// @ts-expect-error extract mode enum
void client.extract.extract({ urls: ['u'], mode: 'turbo' });
// @ts-expect-error extract include_links has no max_link
void client.extract.extract({ urls: ['u'], include_links: { max_link: 3 } });
// @ts-expect-error unknown client option
void new Octen({ apiKey: 'k', retries: 2 });
