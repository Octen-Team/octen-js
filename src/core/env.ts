// Workers 等环境没有 process，先判断再读。
export function readApiKeyFromEnv(): string | undefined {
  const value = globalThis.process?.env?.OCTEN_API_KEY;
  return value ? value : undefined;
}

export function isBrowser(): boolean {
  const win = (globalThis as { window?: { document?: unknown } }).window;
  return typeof win !== 'undefined' && typeof win.document !== 'undefined';
}
