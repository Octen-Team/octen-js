import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const readme = read('../README.md');
const examples = read('./types/readme-examples.ts');

const blocks = [...readme.matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1] ?? '');
const normalize = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

// The type test only compiles what is in readme-examples.ts, so every README line must be there.
describe('README TypeScript examples', () => {
  it('finds the blocks', () => {
    expect(blocks.length).toBeGreaterThan(0);
  });

  it.each(blocks.map((block, i) => [i + 1, block] as const))('block %i is compiled by test/types', (_i, block) => {
    const exampleLines = normalize(examples);
    const missing = normalize(block).filter((line) => {
      const imported = /^import \{ (.*) \} from '(.*)';$/.exec(line);
      if (imported === null) return !exampleLines.includes(line);
      const [, names = '', mod = ''] = imported;
      return names.split(',').some((name) => {
        const pattern = new RegExp(`import \\{[^}]*\\b${name.trim()}\\b[^}]*\\} from '${mod}';`);
        return !pattern.test(examples);
      });
    });
    expect(missing).toEqual([]);
  });
});
