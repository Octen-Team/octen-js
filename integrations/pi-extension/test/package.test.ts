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
  files: string[];
  keywords: string[];
  pi: unknown;
  repository: unknown;
  dependencies?: unknown;
  peerDependencies?: unknown;
};
const pkg = JSON.parse(read('package.json')) as Manifest;

describe('package.json', () => {
  it('names the package and its version', () => {
    expect(pkg.name).toBe('@octen.ai/pi-extension');
    expect(pkg.version).toBe('0.1.0');
    expect(pkg.type).toBe('module');
  });

  it('declares the extension and the skills to Pi', () => {
    expect(pkg.pi).toEqual({ extensions: ['./src/index.ts'], skills: ['./skills'] });
  });

  it('carries the keyword the Pi package gallery lists by', () => {
    expect(pkg.keywords).toContain('pi-package');
  });

  it('names its directory in the repository, as npm provenance requires', () => {
    expect(pkg.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/Octen-Team/octen-js.git',
      directory: 'integrations/pi-extension',
    });
  });

  it('depends on nothing, not even the host packages', () => {
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
  });

  it('ships the source, the skill and the changelog', () => {
    expect(pkg.files).toEqual(expect.arrayContaining(['src', 'skills', 'CHANGELOG.md']));
  });

  it('is MIT licensed', () => {
    expect(pkg.license).toBe('MIT');
    expect(read('LICENSE')).toMatch(/^MIT License/);
  });
});

describe('files that ship', () => {
  it('include every path the pi manifest names', () => {
    expect(existsSync(root + 'src/index.ts')).toBe(true);
    expect(existsSync(root + 'skills/octen-search-guide/SKILL.md')).toBe(true);
    expect(read('skills/octen-search-guide/SKILL.md').startsWith('---\n')).toBe(true);
  });

  it('include a changelog entry for this version', () => {
    expect(read('CHANGELOG.md')).toContain(`## ${pkg.version}`);
  });
});

describe('source', () => {
  // Pi loads this file as it is, so it must not need anything installed next to it.
  it('imports nothing, makes no request and prints nothing', () => {
    const source = read('src/index.ts');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toContain('require(');
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('console.');
  });
});
