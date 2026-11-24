import { afterEach, expect, it, vi } from 'vitest';
import extension, { buildConfig, register } from '../src/index.js';

const URL = 'https://mcp.octen.ai/mcp';

afterEach(() => {
  vi.unstubAllEnvs();
});

function recorder() {
  const calls: unknown[][] = [];
  return { calls, pi: { registerMcpServer: (...args: unknown[]) => void calls.push(args) } };
}

it('registers the hosted server with the key as a bearer token', () => {
  const { calls, pi } = recorder();
  register(pi, { OCTEN_API_KEY: ' k1 ' });
  expect(calls).toEqual([['octen', { url: URL, headers: { Authorization: 'Bearer k1' } }]]);
});

it.each([undefined, '', '  '])('registers without headers when the key is %j', (key) => {
  const { calls, pi } = recorder();
  register(pi, { OCTEN_API_KEY: key });
  expect(calls).toEqual([['octen', { url: URL }]]);
});

it('leaves exposure to Pi', () => {
  expect(buildConfig({ OCTEN_API_KEY: 'k1' })).not.toHaveProperty('exposure');
  expect(buildConfig({})).toEqual({ url: URL });
});

it('names the Pi version it needs when the API is missing', () => {
  expect(() => register({}, {})).toThrow(/needs Pi 0\.99\.0 or later/);
});

it('reads the key from the process environment', () => {
  vi.stubEnv('OCTEN_API_KEY', 'k2');
  const { calls, pi } = recorder();
  extension(pi);
  expect(calls).toEqual([['octen', { url: URL, headers: { Authorization: 'Bearer k2' } }]]);
});

it('calls registerMcpServer as a method of the Pi object', () => {
  const pi = {
    servers: [] as string[],
    registerMcpServer(name: string) {
      this.servers.push(name);
    },
  };
  register(pi, {});
  expect(pi.servers).toEqual(['octen']);
});
