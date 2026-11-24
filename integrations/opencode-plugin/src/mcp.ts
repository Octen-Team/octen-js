export const SERVER_NAME = 'octen';
export const MCP_URL = 'https://mcp.octen.ai/mcp';

const PREFIX = '@octen.ai/opencode-plugin: ';
// Tool names go into the URL as written; whether a name exists is the server's call.
const TOOL_NAME = /^[a-z][a-z_]*$/;

export type PluginOptions = { tools?: string[] };

export type McpEntry = {
  type: 'remote';
  url: string;
  oauth?: false;
  headers?: Record<string, string>;
};

// The slice of OpenCode's config this plugin touches.
export type HostConfig = {
  mcp?: Record<string, unknown>;
  skills?: { paths?: string[] };
};

export function parseOptions(raw: unknown): PluginOptions {
  if (raw === undefined) return {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${PREFIX}options must be an object such as { "tools": ["search", "extract"] }.`);
  }
  const unknown = Object.keys(raw).filter((key) => key !== 'tools');
  if (unknown.length > 0) {
    throw new Error(`${PREFIX}unknown option ${unknown.map((key) => `"${key}"`).join(', ')}. The only option is "tools".`);
  }
  const tools: unknown = (raw as { tools?: unknown }).tools;
  if (tools === undefined) return {};
  if (!Array.isArray(tools) || tools.length === 0 || !tools.every(isToolName)) {
    throw new Error(`${PREFIX}"tools" must be a non-empty list of tool names such as "search" or "news_search".`);
  }
  return { tools: [...tools] };
}

function isToolName(value: unknown): value is string {
  return typeof value === 'string' && TOOL_NAME.test(value);
}

export function buildEntry(env: { OCTEN_API_KEY?: string | undefined }, options: PluginOptions): McpEntry {
  const url = options.tools === undefined ? MCP_URL : `${MCP_URL}?tools=${options.tools.join(',')}`;
  const key = env.OCTEN_API_KEY?.trim() ?? '';
  // Without a key the entry carries no credential, so OpenCode's own MCP sign-in applies.
  if (key === '') return { type: 'remote', url };
  return { type: 'remote', url, oauth: false, headers: { 'x-api-key': key } };
}

export function applyConfig(cfg: HostConfig, entry: McpEntry, skillsDir: string): void {
  cfg.mcp ??= {};
  // An entry the user wrote wins as it is.
  if (cfg.mcp[SERVER_NAME] === undefined) cfg.mcp[SERVER_NAME] = entry;
  cfg.skills ??= {};
  cfg.skills.paths ??= [];
  if (!cfg.skills.paths.includes(skillsDir)) cfg.skills.paths.push(skillsDir);
}
