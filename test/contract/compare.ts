import { readFileSync } from 'node:fs';
import type { Desc } from '../../src/schema/descriptor';
import type { FlatSchema } from './flatten';

// SDK 描述树与扁平化 OpenAPI 的对比（设计文档 §5.6「比较内容」）。路径格式：
// `<SchemaName>.a.b`，数组元素 `a[]`，联合变体 `a[]{company}`。
export type KnownDiff = { path: string; reason: string };

type Mode = 'request' | 'response';

const SCALARS = new Set<string>(['string', 'integer', 'number', 'boolean']);

function walk(mode: Mode, desc: Desc, flat: FlatSchema, path: string, known: Set<string>, used: Set<string>, out: string[]) {
  const sdkNullable = desc.nullable === true;
  if (sdkNullable !== flat.nullable) {
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
    // 响应只比字段名和可否为 null，标量的具体类型与枚举不比（§5.6）
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
  // 清单只许变短：规范补上了字段、或 SDK 删了字段，条目必须删除
  for (const d of mine) {
    if (!used.has(d.path)) out.push(`${d.path}: listed in known_diffs.json but not an SDK-only field; remove the entry`);
  }
  return out;
}

/** 请求：字段多 / 少、基本类型、枚举、必填、可否为 null，逐层含数组元素。SDK 多出的字段须登记在 knownDiffs。 */
export function compareRequest(desc: Desc, flat: FlatSchema, knownDiffs: readonly KnownDiff[], path: string): string[] {
  return compare('request', desc, flat, knownDiffs, path);
}

/** 响应：字段名（逐层含数组元素与联合变体）、可否为 null。SDK 多出的字段须登记在 knownDiffs，SDK 缺的一律报。 */
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
