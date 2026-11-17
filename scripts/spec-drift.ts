import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { flattenSchema, type FlatSchema, type OpenAPI } from '../test/contract/flatten';

// 每周对比线上 OpenAPI 与 testdata/openapi.json：只看六个接口的请求和响应结构，经 flattenSchema 规范化后逐项比较。
// 有差异退出码 1，无法运行（下载失败、规范无法展开）退出码 2；从不改写快照（设计文档 §5.6）。
const LIVE_URL = process.env.SPEC_DRIFT_URL ?? 'https://docs.octen.ai/api-reference/openapi.json';
const SNAPSHOT_PATH =
  process.env.SPEC_DRIFT_SNAPSHOT ?? fileURLToPath(new URL('../testdata/openapi.json', import.meta.url));

const ENDPOINTS = ['/search', '/broad-search', '/news-search', '/business-search', '/pulse-search', '/place-search'];

type Raw = Record<string, unknown>;

function isRaw(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// 从 paths 取接口的请求 / 响应 schema 引用，规范里改了 schema 名也能跟上
function schemaRef(spec: OpenAPI, path: string, side: 'request' | 'response'): string {
  const paths = spec.paths;
  const op = isRaw(paths) && isRaw(paths[path]) ? (paths[path] as Raw).post : undefined;
  if (!isRaw(op)) throw new Error(`${path}: POST operation not found`);
  const holder =
    side === 'request' ? op.requestBody : isRaw(op.responses) ? op.responses['200'] : undefined;
  const content = isRaw(holder) ? holder.content : undefined;
  const json = isRaw(content) ? content['application/json'] : undefined;
  const schema = isRaw(json) ? json.schema : undefined;
  const ref = isRaw(schema) ? schema.$ref : undefined;
  if (typeof ref !== 'string') throw new Error(`${path}: ${side} schema is not a bare $ref`);
  return ref;
}

function diffFlat(a: FlatSchema | undefined, b: FlatSchema | undefined, where: string, out: string[]): void {
  if (a === undefined && b === undefined) return;
  if (a === undefined) return void out.push(`${where}: added in live spec (${b?.type})`);
  if (b === undefined) return void out.push(`${where}: removed from live spec (was ${a.type})`);
  if (a.type !== b.type) return void out.push(`${where}: type ${a.type} -> ${b.type}`);
  if (a.nullable !== b.nullable) out.push(`${where}: nullable ${a.nullable} -> ${b.nullable}`);

  if (a.type === 'object' && b.type === 'object') {
    const keys = [...new Set([...Object.keys(a.properties), ...Object.keys(b.properties)])].sort();
    for (const k of keys) diffFlat(a.properties[k], b.properties[k], `${where}.${k}`, out);
    if (a.required.join(',') !== b.required.join(',')) {
      out.push(`${where}: required [${a.required}] -> [${b.required}]`);
    }
  } else if (a.type === 'array' && b.type === 'array') {
    diffFlat(a.items, b.items, `${where}[]`, out);
  } else if (a.type === 'union' && b.type === 'union') {
    if (a.tag !== b.tag) out.push(`${where}: discriminator ${a.tag} -> ${b.tag}`);
    const tags = [...new Set([...Object.keys(a.variants), ...Object.keys(b.variants)])].sort();
    for (const t of tags) diffFlat(a.variants[t], b.variants[t], `${where}{${t}}`, out);
  } else if ('enum' in a || 'enum' in b) {
    const before = 'enum' in a ? a.enum : undefined;
    const after = 'enum' in b ? b.enum : undefined;
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      out.push(`${where}: enum ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    }
  }
}

function flattenAll(spec: OpenAPI): Map<string, FlatSchema> {
  const flat = new Map<string, FlatSchema>();
  for (const path of ENDPOINTS) {
    flat.set(`${path} request`, flattenSchema(spec, schemaRef(spec, path, 'request'), 'request'));
    flat.set(`${path} response`, flattenSchema(spec, schemaRef(spec, path, 'response'), 'response'));
  }
  return flat;
}

async function downloadLive(): Promise<OpenAPI> {
  const text = /^https?:\/\//i.test(LIVE_URL)
    ? await fetchText(LIVE_URL)
    : readFileSync(LIVE_URL, 'utf8');
  const parsed: unknown = JSON.parse(text);
  if (!isRaw(parsed)) throw new Error('live spec is not a JSON object');
  return parsed as OpenAPI;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000), redirect: 'follow' });
  if (!res.ok) throw new Error(`GET ${url} returned HTTP ${res.status}`);
  return await res.text();
}

async function main(): Promise<number> {
  let snapshot: Map<string, FlatSchema>;
  let live: Map<string, FlatSchema>;
  try {
    snapshot = flattenAll(JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as OpenAPI);
  } catch (err) {
    console.error(`cannot read the snapshot (${SNAPSHOT_PATH}): ${String(err)}`);
    return 2;
  }
  try {
    live = flattenAll(await downloadLive());
  } catch (err) {
    // 线上规范出现 flattenSchema 不认识的结构，同样需要人去看
    console.error(`cannot read the live spec (${LIVE_URL}): ${String(err)}`);
    return 2;
  }

  const differences: string[] = [];
  for (const [name, snap] of snapshot) {
    diffFlat(snap, live.get(name), name, differences);
  }
  if (differences.length === 0) {
    console.log(`No drift: ${snapshot.size} request/response schemas match the snapshot.`);
    return 0;
  }
  console.error(`Spec drift in ${differences.length} place(s) (snapshot -> live):`);
  for (const d of differences) console.error(`  ${d}`);
  console.error(
    'Review the change, update testdata/openapi.json by hand, then fix src/schema/*.ts or testdata/known_diffs.json.',
  );
  return 1;
}

// Exit 1 means drift, so an unexpected throw must not fall through to Node's default exit code 1.
try {
  process.exitCode = await main();
} catch (err) {
  console.error(`spec-drift failed unexpectedly: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exitCode = 2;
}
