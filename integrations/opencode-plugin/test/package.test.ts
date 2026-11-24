import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string): string => readFileSync(root + path, 'utf8');

type Manifest = {
  name: string;
  version: string;
  type: string;
  license: string;
  main: string;
  exports: Record<string, unknown>;
  files: string[];
  keywords: string[];
  engines: Record<string, string>;
  repository: unknown;
  dependencies?: unknown;
  peerDependencies?: unknown;
};
const pkg = JSON.parse(read('package.json')) as Manifest;

describe('package.json', () => {
  it('names the package and its version', () => {
    expect(pkg.name).toBe('@octen.ai/opencode-plugin');
    expect(pkg.version).toBe('0.1.0');
  });

  it('points OpenCode at the built entry', () => {
    expect(pkg.type).toBe('module');
    expect(pkg.exports['./server']).toBe('./dist/server.js');
    expect(pkg.main).toBe('./dist/server.js');
  });

  it('accepts the OpenCode versions it was tested on and stops below 2', () => {
    expect(pkg.engines['opencode']).toMatch(/^>=\d+\.\d+\.\d+ <2$/);
  });

  it('names its directory in the repository, as npm provenance requires', () => {
    expect(pkg.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/Octen-Team/octen-js.git',
      directory: 'integrations/opencode-plugin',
    });
  });

  it('has no runtime dependencies', () => {
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
  });

  it('ships the entry, the skill and the changelog', () => {
    expect(pkg.files).toEqual(expect.arrayContaining(['dist', 'skills', 'CHANGELOG.md']));
  });

  it('carries the keyword plugin searches use', () => {
    expect(pkg.keywords).toContain('opencode-plugin');
  });

  it('is MIT licensed', () => {
    expect(pkg.license).toBe('MIT');
    expect(read('LICENSE')).toMatch(/^MIT License/);
  });
});

describe('files that ship', () => {
  it('include the skill, with front matter', () => {
    expect(existsSync(root + 'skills/octen-search-guide/SKILL.md')).toBe(true);
    expect(read('skills/octen-search-guide/SKILL.md').startsWith('---\n')).toBe(true);
  });

  it('include a changelog entry for this version', () => {
    expect(read('CHANGELOG.md')).toContain(`## ${pkg.version}`);
  });
});

describe('skill', () => {
  const skill = read('skills/octen-search-guide/SKILL.md');

  it('has the front matter a skill needs', () => {
    expect(skill).toMatch(/^---\nname: octen-search-guide\ndescription: >-\n {2}\S/);
  });

  // The hosted server owns the roster, so the guide must not go stale when it changes.
  it('does not state how many tools there are', () => {
    expect(skill).not.toMatch(/\b(\d+|eight|nine|ten|eleven|twelve|thirteen)\s+(read-only\s+)?tools\b/i);
  });

  it('is guidance only: no commands to run against the API, no key, no plain-http link', () => {
    expect(skill).not.toContain('curl');
    expect(skill).not.toContain('OCTEN_API_KEY');
    expect(skill).not.toContain('http://');
  });
});

describe('source', () => {
  // The plugin only edits the config it is handed: no requests, no file writes, no output.
  it.each(['src/server.ts', 'src/mcp.ts'])('%s makes no request, writes no file and prints nothing', (path) => {
    const source = read(path);
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('console.');
    expect(source).not.toContain('node:fs');
  });
});
