import { readFileSync } from 'node:fs';
import type { Desc } from '../../src/schema/descriptor';
import type { FlatSchema } from './flatten';

// Comparison of the SDK descriptor tree against the flattened OpenAPI. Path format:
// `<SchemaName>.a.b`, array elements `a[]`, union variants `a[]{company}`.
export type KnownDiff = { path: string; reason: string };

type Mode = 'request' | 'response';

const SCALARS = new Set<string>(['string', 'integer', 'number', 'boolean']);

function walk(mode: Mode, desc: Desc, flat: FlatSchema, path: string, known: Set<string>, used: Set<string>, out: string[]) {
  const sdkNullable = desc.nullable === true;
  // A known diff may only let the SDK accept null where the spec does not; the reverse is always reported
  if (sdkNullable && !flat.nullable && known.has(path)) used.add(path);
  else if (sdkNullable !== flat.nullable) {
    out.push(`${path}: nullable mismatch (sdk ${sdkNullable}, spec ${flat.nullable})`);
  }

  if (desc.t === 'object' && flat.type === 'object') {
    for (const [key, child] of Object.entries(desc.fields)) {
      const p = `${path}.${key}`;
      const specChild = flat.properties[key];
      if (specChild === undefined) {
        if (known.has(p)) used.add(p);
        else out.push(`${p}: in SDK but not in spec`);
        continue;
      }
      if (mode === 'request') {
        const sdkReq = child.required === true;
        const specReq = flat.required.includes(key);
        if (sdkReq !== specReq) out.push(`${p}: required mismatch (sdk ${sdkReq}, spec ${specReq})`);
      }
      walk(mode, child, specChild, p, known, used, out);
    }
    for (const key of Object.keys(flat.properties)) {
      if (!Object.hasOwn(desc.fields, key)) out.push(`${path}.${key}: in spec but not in SDK`);
    }
    return;
  }

  if (desc.t === 'array' && flat.type === 'array') {
    walk(mode, desc.items, flat.items, `${path}[]`, known, used, out);
    return;
  }

  if (desc.t === 'union' && flat.type === 'union') {
    if (desc.tag !== flat.tag) out.push(`${path}: union tag mismatch (sdk ${desc.tag}, spec ${flat.tag})`);
    for (const [v, variant] of Object.entries(desc.variants)) {
      const p = `${path}{${v}}`;
      const specVariant = flat.variants[v];
      if (specVariant === undefined) {
        if (known.has(p)) used.add(p);
        else out.push(`${p}: variant in SDK but not in spec`);
        continue;
      }
      walk(mode, variant, specVariant, p, known, used, out);
    }
    for (const v of Object.keys(flat.variants)) {
      if (!Object.hasOwn(desc.variants, v)) out.push(`${path}{${v}}: variant in spec but not in SDK`);
    }
    return;
  }

  if (SCALARS.has(desc.t) && SCALARS.has(flat.type)) {
    // Responses compare only field names and nullability, not scalar types or enums
    if (mode === 'response') return;
    if (desc.t !== flat.type) {
      out.push(`${path}: type mismatch (sdk ${desc.t}, spec ${flat.type})`);
      return;
    }
    const a = 'enum' in desc && desc.enum ? [...desc.enum].sort() : undefined;
    const b = 'enum' in flat && flat.enum ? [...flat.enum].sort() : undefined;
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      out.push(`${path}: enum mismatch (sdk ${JSON.stringify(a ?? null)}, spec ${JSON.stringify(b ?? null)})`);
    }
    return;
  }
  out.push(`${path}: type mismatch (sdk ${desc.t}, spec ${flat.type})`);
}

function compare(mode: Mode, desc: Desc, flat: FlatSchema, knownDiffs: readonly KnownDiff[], path: string): string[] {
  const mine = knownDiffs.filter((d) => d.path.startsWith(`${path}.`));
  const known = new Set(mine.map((d) => d.path));
  const used = new Set<string>();
  const out: string[] = [];
  walk(mode, desc, flat, path, known, used, out);
  // The list may only shrink: once the spec adds a field or the SDK drops one, the entry must be deleted
  for (const d of mine) {
    if (!used.has(d.path)) out.push(`${d.path}: listed in known_diffs.json but not an SDK-only field; remove the entry`);
  }
  return out;
}

/** Request: extra / missing fields, base type, enum, required, nullability, at every level including array elements. Extra SDK fields must be registered in knownDiffs. */
export function compareRequest(desc: Desc, flat: FlatSchema, knownDiffs: readonly KnownDiff[], path: string): string[] {
  return compare('request', desc, flat, knownDiffs, path);
}

/** Response: field names (at every level including array elements and union variants) and nullability. Extra SDK fields and SDK-only nullability must be registered in knownDiffs; fields the SDK lacks are always reported. */
export function compareResponse(desc: Desc, flat: FlatSchema, knownDiffs: readonly KnownDiff[], path: string): string[] {
  return compare('response', desc, flat, knownDiffs, path);
}

export function parseKnownDiffs(raw: unknown): KnownDiff[] {
  if (!Array.isArray(raw)) throw new Error('known_diffs: top level must be an array');
  const seen = new Set<string>();
  return raw.map((entry, i) => {
    const e = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    const { path, reason } = e;
    if (typeof path !== 'string' || !/^[A-Za-z0-9_]+\.\S+$/.test(path)) {
      throw new Error(`known_diffs[${i}]: path must look like "<SchemaName>.<dotted.path>"`);
    }
    if (typeof reason !== 'string' || reason.trim() === '') throw new Error(`known_diffs[${i}] (${path}): reason is required`);
    if (seen.has(path)) throw new Error(`known_diffs: duplicate path ${path}`);
    seen.add(path);
    return { path, reason };
  });
}

export function loadKnownDiffs(): KnownDiff[] {
  return parseKnownDiffs(JSON.parse(readFileSync(new URL('../../testdata/known_diffs.json', import.meta.url), 'utf8')));
}
