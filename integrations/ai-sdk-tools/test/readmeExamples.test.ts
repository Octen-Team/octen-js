import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const readme = read('../README.md');
const examples = read('./types/readme-examples.ts');

const normalize = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

// Opening fences only: closing fences have no language tag, so they are skipped by tracking state.
function fences(markdown: string): { info: string; code: string }[] {
  const out: { info: string; code: string }[] = [];
  let open: { info: string; lines: string[] } | undefined;
  for (const line of markdown.split('\n')) {
    const fence = /^```(.*)$/.exec(line);
    if (open === undefined) {
      if (fence !== null) open = { info: (fence[1] ?? '').trim(), lines: [] };
    } else if (fence !== null) {
      out.push({ info: open.info, code: open.lines.join('\n') });
      open = undefined;
    } else {
      open.lines.push(line);
    }
  }
  return out;
}

const all = fences(readme);
const tsBlocks = all.filter((f) => f.info === 'ts');
const exampleFunctions = [...examples.matchAll(/^export async function \w+\(\): Promise<void> \{\n([\s\S]*?)^\}$/gm)].map(
  (m) => m[1] ?? '',
);

// The type test only compiles what is in readme-examples.ts, so each README block must match its example.
describe('README TypeScript examples', () => {
  it('has no TypeScript-like fence that the type test would miss', () => {
    const missed = all.filter((f) => /^(ts|tsx|typescript|mts|cts|js|jsx|javascript)\b/i.test(f.info) && f.info !== 'ts');
    expect(missed.map((f) => f.info)).toEqual([]);
  });

  it('has one example function per README block', () => {
    expect(tsBlocks.length).toBeGreaterThan(0);
    expect(exampleFunctions).toHaveLength(tsBlocks.length);
  });

  it.each(tsBlocks.map((block, i) => [i + 1, block.code] as const))('block %i matches its example function', (i, code) => {
    const lines = normalize(code);
    const importLines = lines.filter((line) => line.startsWith('import '));
    const body = lines.filter((line) => !line.startsWith('import '));
    expect(normalize(exampleFunctions[i - 1] ?? '')).toEqual(body);
    for (const line of importLines) {
      const [, names = '', mod = ''] = /^import \{ (.*) \} from '(.*)';$/.exec(line) ?? [];
      for (const name of names.split(',')) {
        expect(examples).toMatch(new RegExp(`import \\{[^}]*\\b${name.trim()}\\b[^}]*\\} from '${mod}';`));
      }
    }
  });
});
