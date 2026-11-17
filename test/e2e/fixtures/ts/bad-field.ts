// Must fail to compile: misspelled field name (cuont)
import Octen from '@octen.ai/sdk';

const client = new Octen({ apiKey: 'k' });
void client.search.search({ query: 'q', cuont: 1 });
