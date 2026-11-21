import { describe, expect, test } from 'vitest';
import { flattenSchema, loadSnapshot, type FlatObject, type OpenAPI } from './flatten';

const spec = loadSnapshot();

const withOneOfInRequest: OpenAPI = {
  components: {
    schemas: {
      X: {
        type: 'object',
        properties: { a: { oneOf: [{ type: 'string' }, { type: 'integer' }] } },
      },
    },
  },
};

function specWith(x: unknown): OpenAPI {
  return { components: { schemas: { X: x as Record<string, unknown> } } };
}

describe('flattenSchema', () => {
  test('flatten merges top-level and property-level allOf', () => {
    const f = flattenSchema(spec, '#/components/schemas/SearchRequest');
    expect(Object.keys(f.properties)).toContain('include_domains'); // from allOf WebSearchOptions
    expect(f.required).toContain('query');
    const b = flattenSchema(spec, '#/components/schemas/BroadSearchRequest');
    // FlatSchema is a union type, so narrow explicitly to an object here
    expect((b.properties.search_options as FlatObject).properties).toHaveProperty('count'); // allOf on a property
  });

  test('flatten rejects unknown keywords in requests', () => {
    expect(() => flattenSchema(withOneOfInRequest, '#/components/schemas/X')).toThrow(/oneOf/);
  });

  test.each(['anyOf', 'not', 'additionalProperties', 'const', 'patternProperties'])(
    'request rejects %s and names it',
    (kw) => {
      const s = specWith({ type: 'object', properties: { a: { type: 'string', [kw]: {} } } });
      expect(() => flattenSchema(s, '#/components/schemas/X')).toThrow(new RegExp(kw));
    },
  );

  test('response rejects oneOf outside the BusinessEntity allowlist', () => {
    const s: OpenAPI = {
      components: {
        schemas: {
          A: { type: 'object', properties: { type: { type: 'string' } } },
          X: {
            type: 'object',
            properties: {
              u: {
                oneOf: [{ $ref: '#/components/schemas/A' }],
                discriminator: { propertyName: 'type', mapping: { a: '#/components/schemas/A' } },
              },
            },
          },
        },
      },
    };
    expect(() => flattenSchema(s, '#/components/schemas/X', 'response')).toThrow(/oneOf/);
  });

  test('response accepts additionalProperties: true only on an object without properties (a free-form map)', () => {
    const free = specWith({ type: 'object', properties: { m: { type: 'object', additionalProperties: true } } });
    expect(flattenSchema(free, '#/components/schemas/X', 'response').properties.m).toEqual({
      type: 'object',
      nullable: false,
      properties: {},
      required: [],
    });
    const withProps = specWith({ type: 'object', properties: { a: { type: 'string' } }, additionalProperties: true });
    expect(() => flattenSchema(withProps, '#/components/schemas/X', 'response')).toThrow(/additionalProperties/);
    for (const value of [false, {}, { type: 'string' }]) {
      const s = specWith({ type: 'object', additionalProperties: value });
      expect(() => flattenSchema(s, '#/components/schemas/X', 'response')).toThrow(/additionalProperties/);
    }
    expect(() => flattenSchema(free, '#/components/schemas/X')).toThrow(/additionalProperties/);
  });

  test('response rejects anyOf', () => {
    expect(() =>
      flattenSchema(specWith({ type: 'object', properties: { a: { anyOf: [] } } }), '#/components/schemas/X', 'response'),
    ).toThrow(/anyOf/);
  });

  test('BusinessEntity oneOf + discriminator becomes a union in responses', () => {
    const f = flattenSchema(spec, '#/components/schemas/BusinessSearchResponse', 'response');
    const data = f.properties.data as FlatObject;
    const entities = data.properties.entities;
    expect(entities?.type).toBe('array');
    const items = entities?.type === 'array' ? entities.items : undefined;
    expect(items?.type).toBe('union');
    if (items?.type !== 'union') throw new Error('expected union');
    expect(items.tag).toBe('type');
    expect(Object.keys(items.variants).sort()).toEqual(['company', 'person']);
    expect(items.variants.company?.properties).toHaveProperty('key_people');
    expect(items.variants.person?.required).toContain('type');
  });

  test('BusinessEntity oneOf is rejected in request context', () => {
    expect(() => flattenSchema(spec, '#/components/schemas/BusinessSearchResponse')).toThrow(/oneOf/);
  });

  test('nullable is carried (OpenAPI 3.0 flag and 3.1 type array)', () => {
    const f = flattenSchema(spec, '#/components/schemas/SearchResponse', 'response');
    const meta = f.properties.meta as FlatObject;
    expect(meta.properties.warning).toMatchObject({ type: 'string', nullable: true });
    const t = flattenSchema(specWith({ type: 'object', properties: { a: { type: ['string', 'null'] } } }), '#/components/schemas/X');
    expect(t.properties.a).toMatchObject({ type: 'string', nullable: true });
  });

  test('required is merged across allOf members and siblings', () => {
    const s: OpenAPI = {
      components: {
        schemas: {
          A: { type: 'object', required: ['a'], properties: { a: { type: 'string' } } },
          X: { type: 'object', required: ['b'], properties: { b: { type: 'integer' } }, allOf: [{ $ref: '#/components/schemas/A' }] },
        },
      },
    };
    const f = flattenSchema(s, '#/components/schemas/X');
    expect(f.required.sort()).toEqual(['a', 'b']);
    expect(Object.keys(f.properties).sort()).toEqual(['a', 'b']);
  });

  test('conflicting property definitions across allOf are an error', () => {
    const s: OpenAPI = {
      components: {
        schemas: {
          A: { type: 'object', properties: { a: { type: 'string' } } },
          X: { type: 'object', properties: { a: { type: 'integer' } }, allOf: [{ $ref: '#/components/schemas/A' }] },
        },
      },
    };
    expect(() => flattenSchema(s, '#/components/schemas/X')).toThrow(/conflict/i);
  });

  test('enum values and basic types are kept; annotations ignored', () => {
    const f = flattenSchema(spec, '#/components/schemas/SearchRequest');
    expect(f.properties.time_range).toEqual({
      type: 'string',
      nullable: false,
      enum: ['day', 'week', 'month', 'year', 'd', 'w', 'm', 'y'],
    });
    expect(f.properties.count).toEqual({ type: 'integer', nullable: false });
    const lang = f.properties.language;
    expect(lang?.type === 'array' && lang.items).toMatchObject({ type: 'string' });
  });

  test('request objects without properties are rejected (free-form)', () => {
    expect(() =>
      flattenSchema(specWith({ type: 'object', properties: { a: { type: 'object' } } }), '#/components/schemas/X'),
    ).toThrow(/properties/);
  });

  test('missing $ref target and $ref cycles are errors', () => {
    expect(() => flattenSchema(specWith({ $ref: '#/components/schemas/Nope' }), '#/components/schemas/X')).toThrow(/Nope/);
    expect(() =>
      flattenSchema(
        specWith({ type: 'object', properties: { self: { $ref: '#/components/schemas/X' } } }),
        '#/components/schemas/X',
      ),
    ).toThrow(/cycle/i);
    const indirect: OpenAPI = {
      components: {
        schemas: {
          B: { type: 'object', properties: { c: { $ref: '#/components/schemas/B' } } },
          X: { type: 'object', properties: { b: { $ref: '#/components/schemas/B' } } },
        },
      },
    };
    expect(() => flattenSchema(indirect, '#/components/schemas/X')).toThrow(/cycle/i);
  });

  test('the same schema reused in sibling branches is not a cycle', () => {
    const s: OpenAPI = {
      components: {
        schemas: {
          B: { type: 'object', properties: { v: { type: 'string' } } },
          X: { type: 'object', properties: { a: { $ref: '#/components/schemas/B' }, b: { $ref: '#/components/schemas/B' } } },
        },
      },
    };
    expect(Object.keys(flattenSchema(s, '#/components/schemas/X').properties)).toEqual(['a', 'b']);
  });

  test('the endpoint schemas in the snapshot flatten in their context', () => {
    for (const name of [
      'Search',
      'BroadSearch',
      'NewsSearch',
      'BusinessSearch',
      'PulseSearch',
      'PlaceSearch',
      'ImageSearch',
      'VideoSearch',
      'DesignSearch',
    ]) {
      expect(() => flattenSchema(spec, `#/components/schemas/${name}Request`)).not.toThrow();
      expect(() => flattenSchema(spec, `#/components/schemas/${name}Response`, 'response')).not.toThrow();
    }
  });
});
