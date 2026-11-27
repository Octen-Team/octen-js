import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { flattenSchema, type FlatSchema, type OpenAPI } from '../test/contract/flatten';

// Weekly diff of the live OpenAPI against testdata/openapi.json: only the request and response schemas of the SDK's endpoints, normalized via flattenSchema and compared item by item.
// Exits 1 on any difference, 2 if it cannot run (download failure, spec cannot be flattened); never rewrites the snapshot.
const LIVE_URL = process.env.SPEC_DRIFT_URL ?? 'https://docs.octen.ai/api-reference/openapi.json';
const SNAPSHOT_PATH =
  process.env.SPEC_DRIFT_SNAPSHOT ?? fileURLToPath(new URL('../testdata/openapi.json', import.meta.url));

const ENDPOINTS = [
  '/search',
  '/broad-search',
  '/news-search',
  '/business-search',
  '/pulse-search',
  '/place-search',
  '/search-premier',
  '/image-search',
  '/video-search',
  '/design-search',
  '/extract',
  '/embedding',
  '/vl-embedding',
];

// flattenSchema drops minItems/maxItems; these arrays are checked locally (exactly one input, 1-20 URLs, 1-1000 texts,
// 1-20 VL contents), so compare their bounds too
const CARDINALITY = [
  ['/image-search', 'inputs'],
  ['/video-search', 'inputs'],
  ['/extract', 'urls'],
  ['/embedding', 'input'],
  ['/vl-embedding', 'input.contents'],
] as const;

// The spec states the urls limits (20 URLs, 2048 characters each) and the VL contents limit (at most 20 items) only in
// descriptions, so compare them verbatim
const LIMIT_TEXT = [
  ['/extract', 'urls'],
  ['/vl-embedding', 'input'],
] as const;

// Value bounds the SDK relies on: the per-URL length bounds it checks, and the timeout range and default its HTTP timeout derives from
const VALUE_BOUNDS = [
  ['/extract', 'urls', 'items', ['minLength', 'maxLength']],
  ['/extract', 'timeout', 'self', ['default', 'minimum', 'maximum']],
] as const;

type Raw = Record<string, unknown>;

function isRaw(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Take each endpoint's request / response schema ref from paths, so renamed schemas are still followed
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

type Bounds = { minItems: string; maxItems: string };

// A schema node plus every node it pulls in through $ref and allOf, as flattenSchema resolves them
function expand(spec: OpenAPI, node: unknown, stack: readonly string[] = []): Raw[] {
  if (!isRaw(node)) return [];
  const out: Raw[] = [node];
  if (typeof node.$ref === 'string') {
    const name = node.$ref.replace('#/components/schemas/', '');
    if (stack.includes(name)) throw new Error(`$ref cycle at ${[...stack, name].join(' -> ')}`);
    out.push(...expand(spec, spec.components?.schemas?.[name], [...stack, name]));
  }
  if (Array.isArray(node.allOf)) for (const member of node.allOf) out.push(...expand(spec, member, stack));
  return out;
}

// Every node defining a request property (dotted for nested objects), resolved through $ref and allOf
function propertyNodes(spec: OpenAPI, path: string, prop: string): Raw[] {
  let nodes = expand(spec, { $ref: schemaRef(spec, path, 'request') });
  for (const key of prop.split('.')) {
    const defs = nodes.map((n) => (isRaw(n.properties) ? n.properties[key] : undefined)).filter(isRaw);
    if (defs.length === 0) throw new Error(`${path}: request property "${prop}" not found`);
    nodes = defs.flatMap((d) => expand(spec, d));
  }
  return nodes;
}

// minItems / maxItems of a request property ("none" when absent)
function cardinality(spec: OpenAPI, path: string, prop: string): Bounds {
  const nodes = propertyNodes(spec, path, prop);
  const bound = (k: string) => {
    const values = [...new Set(nodes.map((n) => n[k]).filter((v) => typeof v === 'number'))];
    if (values.length > 1) throw new Error(`${path}: conflicting ${k} for "${prop}": ${values.join(', ')}`);
    return values.length === 1 ? String(values[0]) : 'none';
  };
  return { minItems: bound('minItems'), maxItems: bound('maxItems') };
}

function cardinalityAll(spec: OpenAPI): Map<string, Bounds> {
  return new Map(CARDINALITY.map(([path, prop]) => [`${path} request.${prop}`, cardinality(spec, path, prop)]));
}

// The description text(s) of a request property, joined; "none" when it has none
function limitText(spec: OpenAPI, path: string, prop: string): string {
  const texts = propertyNodes(spec, path, prop)
    .map((n) => n.description)
    .filter((d): d is string => typeof d === 'string');
  return texts.length === 0 ? 'none' : texts.join(' | ');
}

function limitTextAll(spec: OpenAPI): Map<string, string> {
  return new Map(LIMIT_TEXT.map(([path, prop]) => [`${path} request.${prop}`, limitText(spec, path, prop)]));
}

// Each listed keyword of a request property (or of its items) as JSON, "none" when absent; conflicting values cannot be compared
function valueBoundsAll(spec: OpenAPI): Map<string, string> {
  const out = new Map<string, string>();
  for (const [path, prop, on, keys] of VALUE_BOUNDS) {
    const own = propertyNodes(spec, path, prop);
    const nodes = on === 'items' ? own.flatMap((n) => expand(spec, n.items)) : own;
    if (on === 'items' && nodes.length === 0) throw new Error(`${path}: request property "${prop}" has no items`);
    for (const k of keys) {
      const values = [...new Set(nodes.map((n) => n[k]).filter((v) => v !== undefined).map((v) => JSON.stringify(v)))];
      if (values.length > 1) throw new Error(`${path}: conflicting ${k} for "${prop}": ${values.join(', ')}`);
      out.set(`${path} request.${prop}${on === 'items' ? '[]' : ''}.${k}`, values[0] ?? 'none');
    }
  }
  return out;
}

function diffCardinality(a: Bounds, b: Bounds, where: string, out: string[]): void {
  for (const k of ['minItems', 'maxItems'] as const) {
    if (a[k] !== b[k]) out.push(`${where}: ${k} ${a[k]} -> ${b[k]}`);
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
  let snapshotBounds: Map<string, Bounds>;
  let liveBounds: Map<string, Bounds>;
  let snapshotLimits: Map<string, string>;
  let liveLimits: Map<string, string>;
  let snapshotValues: Map<string, string>;
  let liveValues: Map<string, string>;
  try {
    const spec = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as OpenAPI;
    snapshot = flattenAll(spec);
    snapshotBounds = cardinalityAll(spec);
    snapshotLimits = limitTextAll(spec);
    snapshotValues = valueBoundsAll(spec);
  } catch (err) {
    console.error(`cannot read the snapshot (${SNAPSHOT_PATH}): ${String(err)}`);
    return 2;
  }
  try {
    const spec = await downloadLive();
    live = flattenAll(spec);
    liveBounds = cardinalityAll(spec);
    liveLimits = limitTextAll(spec);
    liveValues = valueBoundsAll(spec);
  } catch (err) {
    // A structure flattenSchema does not recognize in the live spec also needs a human look
    console.error(`cannot read the live spec (${LIVE_URL}): ${String(err)}`);
    return 2;
  }

  const differences: string[] = [];
  for (const [name, snap] of snapshot) {
    diffFlat(snap, live.get(name), name, differences);
  }
  for (const [name, bounds] of snapshotBounds) {
    diffCardinality(bounds, liveBounds.get(name) as Bounds, name, differences);
  }
  for (const [name, text] of snapshotLimits) {
    const after = liveLimits.get(name);
    if (text !== after) differences.push(`${name}: description ${JSON.stringify(text)} -> ${JSON.stringify(after)}`);
  }
  for (const [name, value] of snapshotValues) {
    const after = liveValues.get(name);
    if (value !== after) differences.push(`${name}: ${value} -> ${after}`);
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
