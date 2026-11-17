// Workers 等环境没有 process；Deno 2 未授权 --allow-env 时访问 process.env 会抛错，一律视为未设置。
export function readApiKeyFromEnv(): string | undefined {
  try {
    const value = globalThis.process?.env?.OCTEN_API_KEY;
    return value ? value : undefined;
  } catch {
    return undefined;
  }
}

export function isBrowser(): boolean {
  const g = globalThis as { window?: unknown; document?: unknown };
  return typeof g.window !== 'undefined' && typeof g.document !== 'undefined';
}
