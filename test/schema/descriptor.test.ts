import { describe, expect, expectTypeOf, test } from 'vitest';
import { OctenValidationError } from '../../src/core/errors';
import {
  checkUnknownFields,
  stripUndefined,
  type Infer,
  type InferResponse,
  type ObjectDesc,
} from '../../src/schema/descriptor';

const D = {
  t: 'object',
  fields: {
    query: { t: 'string', required: true },
    count: { t: 'integer' },
    time_range: { t: 'string', enum: ['day', 'week'] },
    highlight: { t: 'object', fields: { enable: { t: 'boolean' } } },
    include_domains: { t: 'array', items: { t: 'string' } },
    filters: { t: 'array', items: { t: 'object', fields: { name: { t: 'string', required: true } } } },
    radius: { t: 'number', nullable: true },
  },
} as const satisfies ObjectDesc;

const R = {
  t: 'object',
  fields: {
    request_id: { t: 'string', required: true },
    data: {
      t: 'object',
      fields: {
        warning: { t: 'string', nullable: true },
        results: { t: 'array', items: { t: 'object', fields: { title: { t: 'string' } } } },
        entities: {
          t: 'array',
          items: {
            t: 'union',
            tag: 'type',
            variants: {
              company: {
                t: 'object',
                fields: { type: { t: 'string', enum: ['company'], required: true }, name: { t: 'string' } },
              },
              person: {
                t: 'object',
                fields: { type: { t: 'string', enum: ['person'], required: true }, title: { t: 'string' } },
              },
            },
          },
        },
      },
    },
  },
} as const satisfies ObjectDesc;

describe('checkUnknownFields', () => {
  test('unknown nested field rejected with path', () => {
    expect(() => checkUnknownFields(D, { query: 'q', highlight: { enabel: true } })).toThrow(/highlight\.enabel/);
  });

  test('test_undefined_values_are_omitted', () => {
    expect(() => checkUnknownFields(D, { query: 'q', count: undefined })).not.toThrow();
    expect(stripUndefined({ query: 'q', count: undefined })).toEqual({ query: 'q' });
  });

  test('throws OctenValidationError whose field is the dotted path', () => {
    let err: unknown;
    try {
      checkUnknownFields(D, { query: 'q', highlight: { enabel: true } });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(OctenValidationError);
    expect((err as OctenValidationError).field).toBe('highlight.enabel');
  });

  test('unknown top-level field rejected', () => {
    expect(() => checkUnknownFields(D, { query: 'q', topic: 'news' })).toThrow(
      expect.objectContaining({ field: 'topic' }),
    );
  });

  test('prefix path is prepended', () => {
    expect(() => checkUnknownFields(D, { bogus: 1 }, 'search_options')).toThrow(
      expect.objectContaining({ field: 'search_options.bogus' }),
    );
  });

  test('inherited Object.prototype names are not treated as known fields', () => {
    expect(() => checkUnknownFields(D, { query: 'q', constructor: 1 })).toThrow(
      expect.objectContaining({ field: 'constructor' }),
    );
    expect(() => checkUnknownFields(D, JSON.parse('{"query":"q","__proto__":{}}'))).toThrow(
      expect.objectContaining({ field: '__proto__' }),
    );
  });

  test('objects inside arrays are checked, path carries the index', () => {
    expect(() => checkUnknownFields(D, { query: 'q', filters: [{ name: 'a' }, { name: 'b', nmae: 'c' }] })).toThrow(
      expect.objectContaining({ field: 'filters[1].nmae' }),
    );
  });

  test('an undeclared key whose value is undefined counts as not passed', () => {
    expect(() => checkUnknownFields(D, { query: 'q', cuont: undefined })).not.toThrow();
    expect(() => checkUnknownFields(D, { query: 'q', highlight: { enabel: undefined } })).not.toThrow();
  });

  test('undefined nested values are ignored, valid input passes', () => {
    expect(() =>
      checkUnknownFields(D, {
        query: 'q',
        time_range: 'day',
        highlight: { enable: undefined },
        include_domains: ['a.com'],
        filters: [{ name: 'a' }],
        radius: null,
      }),
    ).not.toThrow();
  });

  test('non-object values are left to the server (no type checking here)', () => {
    expect(() => checkUnknownFields(D, { query: 'q', highlight: true })).not.toThrow();
    expect(() => checkUnknownFields(D, null)).not.toThrow();
  });

  test('union values are checked against the variant named by the tag', () => {
    const U = { t: 'object', fields: { e: R.fields.data.fields.entities } } as const satisfies ObjectDesc;
    expect(() => checkUnknownFields(U, { e: [{ type: 'company', name: 'x' }] })).not.toThrow();
    expect(() => checkUnknownFields(U, { e: [{ type: 'company', nmae: 'x' }] })).toThrow(
      expect.objectContaining({ field: 'e[0].nmae' }),
    );
    // 未知 tag 不在推导类型里，但运行时照常放行、原样保留
    expect(() => checkUnknownFields(U, { e: [{ type: 'robot', anything: 1 }] })).not.toThrow();
  });
});

describe('stripUndefined', () => {
  test('removes undefined keys recursively without mutating the input', () => {
    const input = { query: 'q', highlight: { enable: undefined, x: 1 }, list: [{ a: undefined, b: 2 }], n: null };
    expect(stripUndefined(input)).toEqual({ query: 'q', highlight: { x: 1 }, list: [{ b: 2 }], n: null });
    expect(Object.keys(stripUndefined(input).highlight)).toEqual(['x']);
    expect(input.highlight).toHaveProperty('enable');
  });

  test('leaves non-plain objects alone', () => {
    const d = new Date(0);
    expect(stripUndefined({ d }).d).toBe(d);
  });
});

describe('Infer', () => {
  test('request: required, optional (accepts undefined), enum literals, nullable', () => {
    type P = Infer<typeof D>;
    expectTypeOf<P>().toEqualTypeOf<{
      query: string;
      count?: number | undefined;
      time_range?: 'day' | 'week' | undefined;
      highlight?: { enable?: boolean | undefined } | undefined;
      include_domains?: readonly string[] | undefined;
      filters?: readonly { name: string }[] | undefined;
      radius?: number | null | undefined;
    }>();
    expectTypeOf({ query: 'q', count: undefined }).toExtend<P>();
    expectTypeOf<{ count: number }>().not.toExtend<P>();
    expectTypeOf<{ query: string; time_range: 'month' }>().not.toExtend<P>();
    // @ts-expect-error 对象字面量上的多余字段被拒
    const extra: P = { query: 'q', extra: 1 };
    void extra;
  });

  test('response: extra keys allowed at every object level, nullable, union of known variants', () => {
    type Res = InferResponse<typeof R>;
    expectTypeOf<Res['request_id']>().toEqualTypeOf<string>();
    expectTypeOf<Res>().toHaveProperty('data');
    expectTypeOf({ request_id: 'r', brand_new: 1 }).toExtend<Res>();
    type Data = NonNullable<Res['data']>;
    expectTypeOf<Data['warning']>().toEqualTypeOf<string | null | undefined>();
    expectTypeOf({ results: [{ title: 't', extra: true }] }).toExtend<Data>();
    type Entity = NonNullable<Data['entities']>[number];
    expectTypeOf({ type: 'company' as const, name: 'n', more: 1 }).toExtend<Entity>();
    expectTypeOf<{ name: string }>().not.toExtend<Entity>();
    // 推导出的联合只含已知变体：tag 恰好是已知字面量，没有 tag 为 string 的兜底变体
    expectTypeOf<Entity['type']>().toEqualTypeOf<'company' | 'person'>();
    expectTypeOf<string>().not.toExtend<Entity['type']>();
    expectTypeOf({ type: 'robot' as string, anything: 1 }).not.toExtend<Entity>();
  });

  test('response union narrows on the tag to the declared variant fields', () => {
    type Entity = NonNullable<NonNullable<InferResponse<typeof R>['data']>['entities']>[number];
    const narrow = (e: Entity) => {
      if (e.type === 'company') {
        expectTypeOf(e.name).toEqualTypeOf<string | undefined>();
        const n: string | undefined = e.name;
        return n;
      }
      expectTypeOf(e.type).toEqualTypeOf<'person'>();
      expectTypeOf(e.title).toEqualTypeOf<string | undefined>();
      const t: string | undefined = e.title;
      return t;
    };
    expect(narrow({ type: 'company', name: 'n' })).toBe('n');
    expect(narrow({ type: 'person', title: 'cto' })).toBe('cto');
  });
});
