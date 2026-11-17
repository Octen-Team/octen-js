import { OctenValidationError } from '../core/errors';

// 每个接口的请求 / 响应写成一棵常量描述树：类型推导、未知字段检查、OpenAPI 对比测试共用（设计文档 §5.6）。
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

// 按 tag 字段区分的联合结构（目前只有响应里的 BusinessEntity）。
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

// 请求：可选键显式接受 undefined（运行时视为没传）。响应：每层对象都允许任意多余键。
type InferObject<D extends ObjectDesc, M extends InferMode> = Simplify<
  { [K in RequiredKeys<D['fields']>]: Infer<D['fields'][K], M> } & {
    [K in OptionalKeys<D['fields']>]?: Infer<D['fields'][K], M> | (M extends 'request' ? undefined : never);
  } & (M extends 'response' ? { [key: string]: unknown } : unknown)
>;

type InferUnion<D extends UnionDesc, M extends InferMode> =
  | { [V in keyof D['variants']]: InferObject<D['variants'][V], M> }[keyof D['variants']]
  | Simplify<{ [P in D['tag']]: string } & { [key: string]: unknown }>;

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

/** 从描述推导 TS 类型。M 默认 'request'；响应描述用 `InferResponse`（或 `Infer<D, 'response'>`）。 */
export type Infer<D extends Desc, M extends InferMode = 'request'> = D extends { readonly nullable: true }
  ? InferBase<D, M> | null
  : InferBase<D, M>;

export type InferResponse<D extends Desc> = Infer<D, 'response'>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
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
    // tag 未知时没有可对照的结构，交给服务端
    if (typeof tagValue === 'string' && Object.hasOwn(desc.variants, tagValue)) {
      checkUnknownFields(desc.variants[tagValue] as ObjectDesc, value, path);
    }
  }
}

/** 逐层拒绝描述外的键；值为 undefined 的键视为没传。只查键名，值的类型交给服务端。 */
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

/** 返回删除了 undefined 值键的副本（递归进普通对象和数组），不修改入参。 */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v: unknown) => stripUndefined(v)) as T;
  if (!isPlainObject(value)) return value;
  // fromEntries 按自有属性写入，键名为 "__proto__" 时不会改原型
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, stripUndefined(v)]),
  ) as T;
}
