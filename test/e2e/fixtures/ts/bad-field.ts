// 必须编译失败：字段名拼错（cuont）
import Octen from '@octen.ai/sdk';

const client = new Octen({ apiKey: 'k' });
void client.search.search({ query: 'q', cuont: 1 });
