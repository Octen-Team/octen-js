import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import plugin from '../src/server.js';
import type { HostConfig } from '../src/mcp.js';
import type { SkillInfo, V2Context } from '../src/v2.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

it('registers the hosted server through the config hook', async () => {
  vi.stubEnv('OCTEN_API_KEY', 'k1');
  const hooks = await plugin.server({}, undefined);
  const cfg: HostConfig = {};
  await hooks.config(cfg);
  expect(cfg.mcp).toEqual({
    octen: { type: 'remote', url: 'https://mcp.octen.ai/mcp', oauth: false, headers: { 'x-api-key': 'k1' } },
  });
});

it('reads the key when the hook runs, not when the plugin loads', async () => {
  vi.stubEnv('OCTEN_API_KEY', '');
  const hooks = await plugin.server({}, undefined);
  vi.stubEnv('OCTEN_API_KEY', 'k2');
  const cfg: HostConfig = {};
  await hooks.config(cfg);
  expect(cfg.mcp?.['octen']).toMatchObject({ headers: { 'x-api-key': 'k2' } });
});

it('passes the tools option into the server URL', async () => {
  vi.stubEnv('OCTEN_API_KEY', '');
  const hooks = await plugin.server({}, { tools: ['search', 'extract'] });
  const cfg: HostConfig = {};
  await hooks.config(cfg);
  expect(cfg.mcp).toEqual({ octen: { type: 'remote', url: 'https://mcp.octen.ai/mcp?tools=search,extract' } });
});

it('adds the skills directory that ships in the package', async () => {
  const hooks = await plugin.server({}, undefined);
  const cfg: HostConfig = {};
  await hooks.config(cfg);
  expect(cfg.skills?.paths).toHaveLength(1);
  const dir = cfg.skills?.paths?.[0] ?? '';
  expect(existsSync(join(dir, 'octen-search-guide', 'SKILL.md'))).toBe(true);
});

it('has the id OpenCode asks of a plugin loaded from a path', () => {
  expect(plugin.id).toBe('octen');
});

it('fails to load on a misspelt option', async () => {
  await expect(plugin.server({}, { tool: ['search'] })).rejects.toThrow(/^@octen\.ai\/opencode-plugin: /);
});

it('returns only the config hook', async () => {
  expect(Object.keys(await plugin.server({}, undefined))).toEqual(['config']);
});

// OpenCode 2.x loads the same default export and calls setup instead of server.
it('registers the server and the skill through the 2.x setup entry', async () => {
  vi.stubEnv('OCTEN_API_KEY', 'k3');
  const servers = new Map<string, unknown>();
  const skills = new Map<string, SkillInfo>();
  const ctx: V2Context = {
    options: { tools: ['search'] },
    mcp: { transform: async (edit) => edit({ get: (n) => servers.get(n), set: (n, c) => void servers.set(n, c) }) },
    skill: { transform: async (edit) => edit({ get: (id) => skills.get(id), add: (s) => void skills.set(s.id, s) }) },
  };
  await plugin.setup(ctx);
  expect(servers.get('octen')).toEqual({
    type: 'remote',
    url: 'https://mcp.octen.ai/mcp?tools=search',
    oauth: false,
    headers: { 'x-api-key': 'k3' },
  });
  expect(existsSync(skills.get('octen-search-guide')?.path ?? '')).toBe(true);
});
