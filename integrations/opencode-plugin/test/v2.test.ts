import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseSkill, setupV2, type SkillInfo, type V2Context } from '../src/v2.js';

const SKILL_FILE = fileURLToPath(new URL('../skills/octen-search-guide/SKILL.md', import.meta.url));

// A stand-in for OpenCode 2.x's plugin context that records what the plugin asks for.
function fakeContext(options?: unknown, seed: { mcp?: Record<string, unknown>; skills?: SkillInfo[] } = {}) {
  const servers = new Map<string, unknown>(Object.entries(seed.mcp ?? {}));
  const skills = new Map<string, SkillInfo>((seed.skills ?? []).map((s) => [s.id, s]));
  const ctx: V2Context = {
    options,
    mcp: {
      transform: async (edit) => {
        edit({ get: (name) => servers.get(name), set: (name, config) => void servers.set(name, config) });
      },
    },
    skill: {
      transform: async (edit) => {
        edit({ get: (id) => skills.get(id), add: (skill) => void skills.set(skill.id, skill) });
      },
    },
  };
  return { ctx, servers, skills };
}

function tempSkill(text: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'octen-skill-')), 'SKILL.md');
  writeFileSync(file, text);
  return file;
}

describe('setupV2: MCP server', () => {
  it('registers the hosted server with the key as a header', async () => {
    const { ctx, servers } = fakeContext();
    await setupV2(ctx, { OCTEN_API_KEY: 'k1' }, SKILL_FILE);
    expect(servers.get('octen')).toEqual({
      type: 'remote',
      url: 'https://mcp.octen.ai/mcp',
      oauth: false,
      headers: { 'x-api-key': 'k1' },
    });
  });

  it('registers the server without a credential when no key is set, so OpenCode can sign in', async () => {
    const { ctx, servers } = fakeContext();
    await setupV2(ctx, {}, SKILL_FILE);
    expect(servers.get('octen')).toEqual({ type: 'remote', url: 'https://mcp.octen.ai/mcp' });
  });

  it('leaves an octen entry the user wrote as it is', async () => {
    const mine = { type: 'remote', url: 'https://mcp.octen.ai/mcp?tools=search' };
    const { ctx, servers } = fakeContext(undefined, { mcp: { octen: mine } });
    await setupV2(ctx, { OCTEN_API_KEY: 'k1' }, SKILL_FILE);
    expect(servers.get('octen')).toBe(mine);
  });

  it('passes the tools option into the server URL', async () => {
    const { ctx, servers } = fakeContext({ tools: ['search', 'extract'] });
    await setupV2(ctx, {}, SKILL_FILE);
    expect(servers.get('octen')).toEqual({ type: 'remote', url: 'https://mcp.octen.ai/mcp?tools=search,extract' });
  });

  it('fails on a misspelt option, before touching the config', async () => {
    const { ctx, servers, skills } = fakeContext({ tool: ['search'] });
    await expect(setupV2(ctx, {}, SKILL_FILE)).rejects.toThrow(/^@octen\.ai\/opencode-plugin: /);
    expect(servers.size).toBe(0);
    expect(skills.size).toBe(0);
  });
});

describe('setupV2: skill', () => {
  it('registers the bundled skill by its front-matter name, with its absolute path and body', async () => {
    const { ctx, skills } = fakeContext();
    await setupV2(ctx, {}, SKILL_FILE);
    const skill = skills.get('octen-search-guide');
    // OpenCode 2.0.0-2.0.3 named the field location; 2.0.4 and later name it path.
    expect(skill).toMatchObject({ id: 'octen-search-guide', name: 'octen-search-guide', path: SKILL_FILE, location: SKILL_FILE });
    expect(skill?.description).toMatch(/^Choose the right Octen tool for live web information\. /);
    expect(skill?.content.startsWith('# Octen search guide')).toBe(true);
    expect(skill?.content).not.toContain('description:');
  });

  it('does not add the skill again when one with that id exists', async () => {
    const existing: SkillInfo = { id: 'octen-search-guide', name: 'octen-search-guide', path: '/x/SKILL.md', location: '/x/SKILL.md', content: 'mine' };
    const { ctx, skills } = fakeContext(undefined, { skills: [existing] });
    await setupV2(ctx, {}, SKILL_FILE);
    expect(skills.get('octen-search-guide')).toBe(existing);
  });
});

describe('parseSkill', () => {
  it('joins a folded description into one line', () => {
    const file = tempSkill('---\nname: demo\ndescription: >-\n  first line\n  second line.\n---\n\n# Body\n');
    expect(parseSkill(file)).toEqual({ id: 'demo', name: 'demo', description: 'first line second line.', path: file, location: file, content: '# Body' });
  });

  it('reads plain and quoted values', () => {
    const file = tempSkill('---\nname: "demo"\ndescription: One line.\n---\nBody\n');
    expect(parseSkill(file)).toMatchObject({ name: 'demo', description: 'One line.', content: 'Body' });
  });

  // A Windows checkout can pack the skill with CRLF line endings.
  it('reads a file with CRLF line endings', () => {
    const file = tempSkill('---\r\nname: demo\r\ndescription: >-\r\n  first line\r\n  second line.\r\n---\r\n\r\n# Body\r\n');
    expect(parseSkill(file)).toEqual({ id: 'demo', name: 'demo', description: 'first line second line.', path: file, location: file, content: '# Body' });
  });

  it('rejects a file without front matter', () => {
    expect(() => parseSkill(tempSkill('# No front matter\n'))).toThrow(/^@octen\.ai\/opencode-plugin: .*front matter/);
  });

  it('rejects front matter without a name', () => {
    expect(() => parseSkill(tempSkill('---\ndescription: x\n---\nBody\n'))).toThrow(/^@octen\.ai\/opencode-plugin: .*name/);
  });
});
