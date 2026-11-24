export const SERVER_NAME = 'octen';
export const MCP_URL = 'https://mcp.octen.ai/mcp';

export type McpServerConfig = { url: string; headers?: Record<string, string> };

// The one Pi API this extension uses. Pi versions before 0.99.0 do not have it.
type Pi = { registerMcpServer?: unknown };
type Env = { OCTEN_API_KEY?: string | undefined };

export function buildConfig(env: Env): McpServerConfig {
  const key = env.OCTEN_API_KEY?.trim() ?? '';
  if (key === '') return { url: MCP_URL };
  // Pi offers its MCP sign-in only to servers without an Authorization header, so a key always wins.
  return { url: MCP_URL, headers: { Authorization: `Bearer ${key}` } };
}

export function register(pi: Pi, env: Env = process.env): void {
  if (typeof pi.registerMcpServer !== 'function') {
    throw new Error('@octen.ai/pi-extension needs Pi 0.99.0 or later: this Pi has no registerMcpServer().');
  }
  pi.registerMcpServer(SERVER_NAME, buildConfig(env));
}

export default function octen(pi: Pi): void {
  register(pi, process.env);
}
