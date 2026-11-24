import { fileURLToPath } from 'node:url';
import { applyConfig, buildEntry, parseOptions } from './mcp.js';
import type { HostConfig } from './mcp.js';
import { setupV2, type V2Context } from './v2.js';

// Resolves to the package's skills directory from src/ and from dist/ alike.
const SKILLS_DIR = fileURLToPath(new URL('../skills', import.meta.url));
const SKILL_FILE = fileURLToPath(new URL('../skills/octen-search-guide/SKILL.md', import.meta.url));

type Hooks = { config: (cfg: HostConfig) => Promise<void> };

async function server(_input: unknown, options?: unknown): Promise<Hooks> {
  const parsed = parseOptions(options);
  return {
    config: async (cfg) => {
      applyConfig(cfg, buildEntry(process.env, parsed), SKILLS_DIR);
    },
  };
}

// OpenCode 1.x calls server; 2.x calls setup.
async function setup(ctx: V2Context): Promise<void> {
  await setupV2(ctx, process.env, SKILL_FILE);
}

export default { id: 'octen', server, setup };
