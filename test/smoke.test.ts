import { describe, expect, it } from 'vitest';
import pkg from '../package.json';
import { VERSION } from '../src/index';

describe('package scaffold', () => {
  it('VERSION matches package.json version', () => {
    expect(VERSION).toBe(pkg.version);
  });

  it('exports provide import, require and types conditions', () => {
    const root = pkg.exports['.'];
    expect(root.import.default).toBe('./dist/index.js');
    expect(root.import.types).toBe('./dist/index.d.ts');
    expect(root.require.default).toBe('./dist/index.cjs');
    expect(root.require.types).toBe('./dist/index.d.cts');
  });

  it('has no runtime dependencies', () => {
    expect(pkg.dependencies).toEqual({});
  });
});
