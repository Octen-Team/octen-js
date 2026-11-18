// Loads the package through require, as a CommonJS consumer would, and builds a tool.
const { octenWebSearch } = require('@octen.ai/ai-sdk-tools');
const tool = octenWebSearch({ apiKey: 'k' });
if (typeof tool.execute !== 'function') throw new Error('octenWebSearch() returned no execute function');
console.log('cjs: loaded and built octenWebSearch');
