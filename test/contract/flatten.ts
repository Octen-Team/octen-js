import { readFileSync } from 'node:fs';

// Expand the OpenAPI structure into a flat tree holding only what the comparison needs. Test-only, not part of dist.
export type OpenAPI = { components?: { schemas?: Record<string, unknown> }; [key: string]: unknown };

/** request: only objects / arrays / scalars; response: also oneOf + discriminator from the allowlist. */
export type FlatContext = 'request' | 'response';

export type FlatScalar = {
  type: 'string' | 'integer' | 'number' | 'boolean';
  nullable: boolean;
  enum?: string[];
};
export type FlatObject = { type: 'object'; nullable: boolean; properties: Record<string, FlatSchema>; required: string[] };
export type FlatArray = { type: 'array'; nullable: boolean; items: FlatSchema };
export type FlatUnion = { type: 'union'; nullable: boolean; tag: string; variants: Record<string, FlatObject> };
export type FlatSchema = FlatScalar | FlatObject | FlatArray | FlatUnion;

// New union structures must be registered explicitly so the comparison test cannot silently accept a new oneOf in the spec
const RESPONSE_UNIONS = new Set(['BusinessEntity']);

const STRUCTURAL = new Set(['$ref', 'allOf', 'type', 'nullable', 'enum', 'properties', 'required', 'items']);
const UNION_KEYWORDS = new Set(['oneOf', 'discriminator']);
// Annotations and value-range constraints: not compared
const IGNORED = new Set([
  'description', 'example', 'examples', 'default', 'format', 'title', 'deprecated', 'externalDocs',
  'maxLength', 'minLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'maxItems', 'minItems', 'uniqueItems', 'pattern', 'multipleOf', 'readOnly', 'writeOnly',
]);
const SCALAR_TYPES = new Set(['string', 'integer', 'number', 'boolean']);
const REF_PREFIX = '#/components/schemas/';

type Raw = Record<string, unknown>;
// Raw definition of a sub-structure, with the $ref chain used to resolve it (for cycle detection)
type Def = { node: unknown; stack: readonly string[] };

// Intermediate form of a node after merging via $ref / allOf; properties are collected as raw definitions first and expanded at build time
type Merged = {
  type?: string;
  nullable: boolean;
  enum?: unknown[];
  properties?: Map<string, Def[]>;
  required: Set<string>;
  items?: Def[];
  union?: { name: string; node: Raw; stack: readonly string[] };
};

type Ctx = { spec: OpenAPI; context: FlatContext };

function fail(where: string, msg: string): never {
  throw new Error(`flattenSchema: ${msg} at ${where}`);
}

function isRaw(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function refName(ref: unknown, where: string): string {
  if (typeof ref !== 'string' || !ref.startsWith(REF_PREFIX)) fail(where, `unsupported $ref ${JSON.stringify(ref)}`);
  return ref.slice(REF_PREFIX.length);
}

function lookup(ctx: Ctx, name: string, where: string): unknown {
  const schemas = ctx.spec.components?.schemas ?? {};
  if (!Object.hasOwn(schemas, name)) fail(where, `$ref target "${name}" not found`);
  return schemas[name];
}

function sameJSON(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function merge(ctx: Ctx, node: unknown, where: string, stack: readonly string[], viaRef?: string): Merged {
  if (!isRaw(node)) fail(where, 'schema is not an object');
  for (const key of Object.keys(node)) {
    if (STRUCTURAL.has(key) || IGNORED.has(key) || key.startsWith('x-')) continue;
    if (UNION_KEYWORDS.has(key) && ctx.context === 'response' && viaRef !== undefined && RESPONSE_UNIONS.has(viaRef)) continue;
    fail(where, `unsupported keyword "${key}" in ${ctx.context} schema`);
  }
  if (node.discriminator !== undefined && node.oneOf === undefined) fail(where, '"discriminator" without "oneOf"');

  const parts: Merged[] = [];
  if (node.$ref !== undefined) {
    const name = refName(node.$ref, where);
    if (stack.includes(name)) fail(where, `$ref cycle ${[...stack, name].join(' -> ')}`);
    parts.push(merge(ctx, lookup(ctx, name, where), `${where}(${name})`, [...stack, name], name));
  }
  if (node.allOf !== undefined) {
    if (!Array.isArray(node.allOf)) fail(where, '"allOf" is not an array');
    node.allOf.forEach((m, i) => parts.push(merge(ctx, m, `${where}.allOf[${i}]`, stack)));
  }

  const own: Merged = { nullable: node.nullable === true, required: new Set() };
  if (node.type !== undefined) {
    let t = node.type;
    if (Array.isArray(t)) {
      // OpenAPI 3.1 form ["string", "null"]
      const nonNull = t.filter((x) => x !== 'null');
      if (nonNull.length !== 1 || nonNull.length === t.length) fail(where, `unsupported type ${JSON.stringify(t)}`);
      own.nullable = true;
      t = nonNull[0];
    }
    if (typeof t !== 'string') fail(where, `unsupported type ${JSON.stringify(t)}`);
    own.type = t;
  }
  if (node.enum !== undefined) {
    if (!Array.isArray(node.enum)) fail(where, '"enum" is not an array');
    own.enum = node.enum;
  }
  if (node.properties !== undefined) {
    if (!isRaw(node.properties)) fail(where, '"properties" is not an object');
    own.properties = new Map(Object.entries(node.properties).map(([k, v]) => [k, [{ node: v, stack }]]));
  }
  if (node.required !== undefined) {
    if (!Array.isArray(node.required) || !node.required.every((r) => typeof r === 'string')) {
      fail(where, '"required" is not a string array');
    }
    own.required = new Set(node.required as string[]);
  }
  if (node.items !== undefined) own.items = [{ node: node.items, stack }];
  if (node.oneOf !== undefined) own.union = { name: viaRef as string, node, stack };
  parts.push(own);

  return parts.reduce((acc, p) => combine(acc, p, where));
}

function combine(a: Merged, b: Merged, where: string): Merged {
  if (a.union || b.union) {
    const u = a.union ? a : b;
    const other = a.union ? b : a;
    if (other.type || other.properties || other.items || other.enum || other.required.size || other.union) {
      fail(where, 'cannot combine "oneOf" with other structure');
    }
    return { ...u, nullable: a.nullable || b.nullable };
  }
  if (a.type && b.type && a.type !== b.type) fail(where, `conflicting types "${a.type}" and "${b.type}"`);
  if (a.enum && b.enum && !sameJSON(a.enum, b.enum)) fail(where, 'conflicting enums');
  const out: Merged = {
    nullable: a.nullable || b.nullable,
    required: new Set([...a.required, ...b.required]),
  };
  const type = a.type ?? b.type;
  if (type !== undefined) out.type = type;
  const en = a.enum ?? b.enum;
  if (en !== undefined) out.enum = en;
  if (a.items || b.items) out.items = [...(a.items ?? []), ...(b.items ?? [])];
  if (a.properties || b.properties) {
    const props = new Map<string, Def[]>();
    for (const src of [a.properties, b.properties]) {
      for (const [k, defs] of src ?? []) props.set(k, [...(props.get(k) ?? []), ...defs]);
    }
    out.properties = props;
  }
  return out;
}

// When the same property / items appears in several allOf members, the expanded results must agree
function buildOne(ctx: Ctx, defs: readonly Def[], where: string): FlatSchema {
  const built = defs.map((d) => build(ctx, merge(ctx, d.node, where, d.stack), where));
  const first = built[0] as FlatSchema;
  if (built.some((b) => !sameJSON(b, first))) fail(where, 'conflicting definitions across allOf');
  return first;
}

function build(ctx: Ctx, m: Merged, where: string): FlatSchema {
  if (m.union) return buildUnion(ctx, m.union, m.nullable, where);
  const type = m.type ?? (m.properties ? 'object' : undefined);
  if (type === undefined) fail(where, 'missing "type"');

  if (type === 'object') {
    if (m.items || m.enum) fail(where, 'object with "items" or "enum"');
    if (!m.properties && ctx.context === 'request') fail(where, 'request object without "properties" (free-form)');
    const properties: Record<string, FlatSchema> = {};
    for (const [k, defs] of m.properties ?? []) {
      properties[k] = buildOne(ctx, defs, `${where}.${k}`);
    }
    for (const r of m.required) if (!Object.hasOwn(properties, r)) fail(where, `required "${r}" is not a property`);
    return { type: 'object', nullable: m.nullable, properties, required: [...m.required].sort() };
  }
  if (m.properties || m.required.size) fail(where, `"${type}" with "properties" or "required"`);
  if (type === 'array') {
    if (!m.items) fail(where, 'array without "items"');
    if (m.enum) fail(where, 'array with "enum"');
    return { type: 'array', nullable: m.nullable, items: buildOne(ctx, m.items, `${where}[]`) };
  }
  if (m.items) fail(where, `"${type}" with "items"`);
  if (!SCALAR_TYPES.has(type)) fail(where, `unsupported type "${type}"`);
  const out: FlatScalar = { type: type as FlatScalar['type'], nullable: m.nullable };
  if (m.enum) {
    if (type !== 'string' || !m.enum.every((e) => typeof e === 'string')) fail(where, 'only string enums are supported');
    out.enum = [...(m.enum as string[])];
  }
  return out;
}

function buildUnion(
  ctx: Ctx,
  u: { name: string; node: Raw; stack: readonly string[] },
  nullable: boolean,
  where: string,
): FlatUnion {
  const { oneOf, discriminator } = u.node;
  if (!Array.isArray(oneOf)) fail(where, '"oneOf" is not an array');
  if (!isRaw(discriminator) || typeof discriminator.propertyName !== 'string' || !isRaw(discriminator.mapping)) {
    fail(where, `"oneOf" in ${u.name} needs a discriminator with propertyName and mapping`);
  }
  const members = oneOf.map((m) => {
    if (!isRaw(m) || Object.keys(m).length !== 1) fail(where, '"oneOf" members must be bare $ref');
    return refName(m.$ref, where);
  });
  const tag = discriminator.propertyName;
  const mapping = Object.entries(discriminator.mapping).map(([k, v]) => [k, refName(v, where)] as const);
  const mapped = mapping.map(([, n]) => n);
  if (!sameJSON([...members].sort(), [...mapped].sort())) fail(where, 'discriminator mapping does not match "oneOf"');

  const variants: Record<string, FlatObject> = {};
  for (const [tagValue, name] of mapping) {
    const vWhere = `${where}{${tagValue}}`;
    const flat = buildOne(ctx, [{ node: { $ref: `${REF_PREFIX}${name}` }, stack: u.stack }], vWhere);
    if (flat.type !== 'object' || !Object.hasOwn(flat.properties, tag)) fail(vWhere, `variant lacks tag property "${tag}"`);
    variants[tagValue] = flat;
  }
  return { type: 'union', nullable, tag, variants };
}

/** Expand the object structure that `ref` (like `#/components/schemas/X`) points to. context defaults to 'request' (the strictest). */
export function flattenSchema(spec: OpenAPI, ref: string, context: FlatContext = 'request'): FlatObject {
  const ctx: Ctx = { spec, context };
  const name = refName(ref, ref);
  const flat = build(ctx, merge(ctx, lookup(ctx, name, name), name, [name], name), name);
  if (flat.type !== 'object') fail(name, 'root schema is not an object');
  return flat;
}

/** Read the testdata/openapi.json snapshot (via fs, so tsc does not infer literal types for the 500 KB JSON). */
export function loadSnapshot(): OpenAPI {
  return JSON.parse(readFileSync(new URL('../../testdata/openapi.json', import.meta.url), 'utf8')) as OpenAPI;
}
