import { Octen, OctenValidationError } from '@octen.ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  octenBroadSearch,
  octenBusinessSearch,
  octenDesignSearch,
  octenExtract,
  octenImageSearch,
  octenNewsSearch,
  octenPlaceSearch,
  octenPulseSearch,
  octenWebSearch,
  octenWebSearchPremier,
} from '../src/index.js';
import { clientFor, recordingFetch } from './helpers.js';

const FACTORIES = {
  octenWebSearch,
  octenWebSearchPremier,
  octenBroadSearch,
  octenNewsSearch,
  octenBusinessSearch,
  octenPlaceSearch,
  octenPulseSearch,
  octenExtract,
  octenImageSearch,
  octenDesignSearch,
};

describe('public entry point', () => {
  it('exports exactly the ten factories at runtime', async () => {
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

// Misconfiguration must fail when the tool is built, not on the model's first call.
describe('factory-time validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(Object.entries(FACTORIES))('%s throws OctenValidationError for client plus apiKey', (_name, factory) => {
    const options = { client: new Octen({ apiKey: 'k' }), apiKey: 'k' } as unknown as Parameters<typeof factory>[0];
    let err: unknown;
    try {
      factory(options);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toBe('apiKey');
  });

  it.each(Object.entries(FACTORIES))('%s throws when no apiKey is passed and OCTEN_API_KEY is unset', (_name, factory) => {
    vi.stubEnv('OCTEN_API_KEY', '');
    let err: unknown;
    try {
      factory();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toBe('apiKey');
  });
});

