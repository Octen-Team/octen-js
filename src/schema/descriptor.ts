import { OctenValidationError } from '../core/errors';

// Each endpoint's request / response is a constant descriptor tree, shared by type inference, unknown-field checks, and the OpenAPI comparison test.
export type ScalarDesc = {
  readonly t: 'string' | 'integer' | 'number' | 'boolean';
  readonly enum?: readonly string[];
  readonly required?: true;
  readonly nullable?: true;
};

export type ObjectDesc = {
  readonly t: 'object';
  readonly fields: { readonly [key: string]: Desc };
  readonly required?: true;
  readonly nullable?: true;
};

export type ArrayDesc = {
  readonly t: 'array';
  readonly items: Desc;
  readonly required?: true;
  readonly nullable?: true;
};

// Union structures discriminated by a tag field (currently only BusinessEntity in responses).
export type UnionDesc = {
  readonly t: 'union';
  readonly tag: string;
  readonly variants: { readonly [tagValue: string]: ObjectDesc };
  readonly required?: true;
  readonly nullable?: true;
};

export type Desc = ScalarDesc | ObjectDesc | ArrayDesc | UnionDesc;

export type InferMode = 'request' | 'response';

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type RequiredKeys<F> = { [K in keyof F]-?: F[K] extends { readonly required: true } ? K : never }[keyof F];
type OptionalKeys<F> = Exclude<keyof F, RequiredKeys<F>>;

// Requests: optional keys explicitly accept undefined (treated as not passed at runtime). Responses: every object level allows arbitrary extra keys.
type InferObject<D extends ObjectDesc, M extends InferMode> = Simplify<
  { [K in RequiredKeys<D['fields']>]: Infer<D['fields'][K], M> } & {
    [K in OptionalKeys<D['fields']>]?: Infer<D['fields'][K], M> | (M extends 'request' ? undefined : never);
  } & (M extends 'response' ? { [key: string]: unknown } : unknown)
>;

// Known variants only: a fallback variant has a string tag, which would break narrowing like `e.type === 'company'`.
// At runtime an unknown tag is still returned as is.
type InferUnion<D extends UnionDesc, M extends InferMode> = {
  [V in keyof D['variants']]: InferObject<D['variants'][V], M>;
}[keyof D['variants']];

type InferBase<D extends Desc, M extends InferMode> = D extends ScalarDesc
  ? D['t'] extends 'string'
    ? D extends { readonly enum: readonly (infer E)[] }
      ? E
      : string
    : D['t'] extends 'boolean'
      ? boolean
      : number
  : D extends ObjectDesc
    ? InferObject<D, M>
    : D extends ArrayDesc
      ? M extends 'request'
        ? readonly Infer<D['items'], M>[]
        : Infer<D['items'], M>[]
      : D extends UnionDesc
        ? InferUnion<D, M>
        : never;

/** TS type inferred from a descriptor; M defaults to 'request', use `InferResponse` for responses. */
export type Infer<D extends Desc, M extends InferMode = 'request'> = D extends { readonly nullable: true }
  ? InferBase<D, M> | null
  : InferBase<D, M>;

export type InferResponse<D extends Desc> = Infer<D, 'response'>;

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null) return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

function join(path: string | undefined, key: string): string {
  return path ? `${path}.${key}` : key;
}

function checkValue(desc: Desc, value: unknown, path: string): void {
  if (desc.t === 'object') {
    checkUnknownFields(desc, value, path);
  } else if (desc.t === 'array') {
    if (Array.isArray(value)) value.forEach((item, i) => checkValue(desc.items, item, `${path}[${i}]`));
  } else if (desc.t === 'union') {
    if (!isPlainObject(value)) return;
    const tagValue = value[desc.tag];
    // An unknown tag has no structure to compare against; leave it to the server
    if (typeof tagValue === 'string' && Object.hasOwn(desc.variants, tagValue)) {
      checkUnknownFields(desc.variants[tagValue] as ObjectDesc, value, path);
    }
  }
}

/** Rejects keys outside the descriptor at every level; keys whose value is undefined count as not passed. Checks key names only; value types are left to the server. */
export function checkUnknownFields(desc: ObjectDesc, value: unknown, path?: string): void {
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    const child = value[key];
    if (child === undefined) continue;
    const childPath = join(path, key);
    if (!Object.hasOwn(desc.fields, key)) {
      throw new OctenValidationError(childPath, `Unknown field "${childPath}".`);
    }
    checkValue(desc.fields[key] as Desc, child, childPath);
  }
}

/** Returns a copy with undefined-valued keys removed (recursing into plain objects and arrays); does not mutate the input. */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v: unknown) => stripUndefined(v)) as T;
  if (!isPlainObject(value)) return value;
  // fromEntries writes own properties, so a "__proto__" key does not change the prototype
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, stripUndefined(v)]),
  ) as T;
}
