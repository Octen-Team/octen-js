// Workers and similar runtimes have no process; Deno 2 throws on process.env without --allow-env, so treat both as unset.
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
