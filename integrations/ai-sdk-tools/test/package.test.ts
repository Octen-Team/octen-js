import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TOOLS_VERSION } from '../src/version.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Record<string, any>;

describe('package metadata', () => {
  it('is named @octen.ai/ai-sdk-tools', () => {
    expect(pkg.name).toBe('@octen.ai/ai-sdk-tools');
  });

  it('keeps package.json version in step with TOOLS_VERSION', () => {
    expect(pkg.version).toBe(TOOLS_VERSION);
  });

  // Only versions that pass scripts/matrix.sh belong in this range.
  it('accepts ai 5, 6 and 7 as a peer', () => {
    expect(pkg.peerDependencies.ai).toBe('^5.0.0 || ^6.0.0 || ^7.0.0');
  });

  it('accepts zod 3.25.76+ and 4.1.8+ as a peer', () => {
    expect(pkg.peerDependencies.zod).toBe('^3.25.76 || ^4.1.8');
  });

  it('depends on the Octen SDK 0.1.x or 0.2.x', () => {
    expect(pkg.dependencies['@octen.ai/sdk']).toBe('^0.1.0 || ^0.2.0');
  });

  it('points repository at the package directory', () => {
    expect(pkg.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/Octen-Team/octen-js.git',
      directory: 'integrations/ai-sdk-tools',
    });
  });

  it('publishes only the intended files', () => {
    expect(pkg.files).toEqual(['dist', 'README.md', 'LICENSE', 'CHANGELOG.md']);
  });
});
