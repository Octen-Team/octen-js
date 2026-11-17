import { afterEach, describe, expect, test, vi } from 'vitest';
import { isBrowser, readApiKeyFromEnv } from '../../src/core/env';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('env helpers', () => {
  test('readApiKeyFromEnv reads OCTEN_API_KEY', () => {
    vi.stubEnv('OCTEN_API_KEY', 'sk-test');
    expect(readApiKeyFromEnv()).toBe('sk-test');
  });

  test('readApiKeyFromEnv treats unset and empty as undefined', () => {
    vi.stubEnv('OCTEN_API_KEY', '');
    expect(readApiKeyFromEnv()).toBeUndefined();
  });

  test('readApiKeyFromEnv is safe when process does not exist', () => {
    vi.stubGlobal('process', undefined);
    expect(readApiKeyFromEnv()).toBeUndefined();
  });

  test('isBrowser is false in Node and true when window.document exists', () => {
    expect(isBrowser()).toBe(false);
    vi.stubGlobal('window', { document: {} });
    expect(isBrowser()).toBe(true);
  });
});
