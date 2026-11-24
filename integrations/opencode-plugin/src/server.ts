import { fileURLToPath } from 'node:url';
import { applyConfig, buildEntry, parseOptions } from './mcp.js';
import type { HostConfig } from './mcp.js';

// Resolves to the package's skills directory from src/ and from dist/ alike.
const SKILLS_DIR = fileURLToPath(new URL('../skills', import.meta.url));

type Hooks = { config: (cfg: HostConfig) => Promise<void> };

async function server(_input: unknown, options?: unknown): Promise<Hooks> {
  const parsed = parseOptions(options);
  return {
    config: async (cfg) => {
      applyConfig(cfg, buildEntry(process.env, parsed), SKILLS_DIR);
    },
  };
}

export default { id: 'octen', server };
