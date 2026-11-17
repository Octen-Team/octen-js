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

  test('readApiKeyFromEnv treats a throwing env accessor as absent', () => {
    vi.stubGlobal('process', {
      get env(): never {
        throw new Error('--allow-env required');
      },
    });
    expect(readApiKeyFromEnv()).toBeUndefined();
  });

  test('isBrowser needs both window and document on globalThis', () => {
    expect(isBrowser()).toBe(false);
    vi.stubGlobal('window', {});
    expect(isBrowser()).toBe(false);
    vi.stubGlobal('document', {});
    expect(isBrowser()).toBe(true);
  });
});
