import { readFileSync } from 'node:fs';
import { buildEntry, parseOptions, SERVER_NAME, type McpEntry } from './mcp.js';

const PREFIX = '@octen.ai/opencode-plugin: ';

// OpenCode 2.0.0-2.0.3 require location and disable the plugin without it; 2.0.4 and later read path.
export type SkillInfo = { id: string; name: string; description?: string; path: string; location: string; content: string };

// The slice of OpenCode 2.x's plugin context this plugin touches; typed locally to avoid a dependency.
export type V2Context = {
  options?: unknown;
  mcp: {
    transform(edit: (editor: { get(name: string): unknown; set(name: string, config: McpEntry): void }) => void): Promise<void>;
  };
  skill: {
    transform(edit: (editor: { get(id: string): unknown; add(skill: SkillInfo): void }) => void): Promise<void>;
  };
};

export async function setupV2(ctx: V2Context, env: { OCTEN_API_KEY?: string | undefined }, skillFile: string): Promise<void> {
  const entry = buildEntry(env, parseOptions(ctx.options));
  const skill = parseSkill(skillFile);
  await ctx.mcp.transform((editor) => {
    // An entry the user wrote wins as it is.
    if (editor.get(SERVER_NAME) === undefined) editor.set(SERVER_NAME, entry);
  });
  await ctx.skill.transform((editor) => {
    if (editor.get(skill.id) === undefined) editor.add(skill);
  });
}

// Reads the plain, quoted and folded (>-) values our SKILL.md uses; not a general YAML parser.
export function parseSkill(path: string): SkillInfo {
  const raw = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  const fence = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  if (fence === null) throw new Error(`${PREFIX}${path} has no front matter.`);
  const fields: Record<string, string> = {};
  const lines = (fence[1] ?? '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const field = /^([\w-]+):\s*(.*)$/.exec(lines[i] ?? '');
    if (field === null) continue;
    let value = (field[2] ?? '').trim();
    if (value === '>' || value === '>-') {
      const block: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1] ?? '')) block.push((lines[++i] ?? '').trim());
      value = block.join(' ');
    } else if (/^(["']).*\1$/.test(value)) {
      value = value.slice(1, -1);
    }
    fields[field[1] ?? ''] = value;
  }
  const name = fields['name'];
  if (name === undefined || name === '') throw new Error(`${PREFIX}${path} front matter has no name.`);
  const skill: SkillInfo = { id: name, name, path, location: path, content: raw.slice(fence[0].length).trim() };
  if (fields['description'] !== undefined) skill.description = fields['description'];
  return skill;
}
