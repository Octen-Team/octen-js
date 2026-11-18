import { describe, expect, it } from 'vitest';
import {
  octenBroadSearch,
  octenBusinessSearch,
  octenNewsSearch,
  octenPlaceSearch,
  octenPulseSearch,
  octenWebSearch,
} from '../src/index.js';
import { clientFor, recordingFetch } from './helpers.js';

const FACTORIES = {
  octenWebSearch,
  octenBroadSearch,
  octenNewsSearch,
  octenBusinessSearch,
  octenPlaceSearch,
  octenPulseSearch,
};

describe('public entry point', () => {
  it('exports exactly the six factories at runtime', async () => {
    const mod = await import('../src/index.js');
    expect(Object.keys(mod).sort()).toEqual(Object.keys(FACTORIES).sort());
  });

  it.each(Object.entries(FACTORIES))('%s returns a tool with description, inputSchema and execute', (_name, factory) => {
    const { fakeFetch } = recordingFetch(() => new Response('{}'));
    const t = factory({ client: clientFor(fakeFetch) });
    expect(typeof t.description).toBe('string');
    expect(t.inputSchema).toBeDefined();
    expect(typeof t.execute).toBe('function');
  });
});
