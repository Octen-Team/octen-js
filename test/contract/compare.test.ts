import { describe, expect, test } from 'vitest';
import type { ObjectDesc } from '../../src/schema/descriptor';
import { compareRequest, compareResponse, loadKnownDiffs, parseKnownDiffs, type KnownDiff } from './compare';
import { flattenSchema, type OpenAPI } from './flatten';

const reqSpec: OpenAPI = {
  components: {
    schemas: {
      Opts: {
        type: 'object',
        properties: {
          count: { type: 'integer' },
          mode: { type: 'string', enum: ['a', 'b'] },
          tags: { type: 'array', items: { type: 'object', required: ['k'], properties: { k: { type: 'string' } } } },
        },
      },
      Req: {
        type: 'object',
        required: ['query'],
        properties: { query: { type: 'string' }, opts: { $ref: '#/components/schemas/Opts' } },
      },
    },
  },
};
const reqFlat = flattenSchema(reqSpec, '#/components/schemas/Req');

const goodReq = {
  t: 'object',
  fields: {
    query: { t: 'string', required: true },
    opts: {
      t: 'object',
      fields: {
        count: { t: 'integer' },
        mode: { t: 'string', enum: ['b', 'a'] },
        tags: { t: 'array', items: { t: 'object', fields: { k: { t: 'string', required: true } } } },
      },
    },
  },
} as const satisfies ObjectDesc;

// 在 goodReq 上做单点改动，便于断言每类差异
function mutate(f: (d: any) => void): ObjectDesc {
  const d = structuredClone(goodReq) as any;
  f(d);
  return d as ObjectDesc;
}

describe('compareRequest', () => {
  test('identical structure has no differences (enum order ignored)', () => {
    expect(compareRequest(goodReq, reqFlat, [], 'Req')).toEqual([]);
  });

  test('field in SDK but not in spec', () => {
    const d = mutate((x) => (x.fields.opts.fields.topic = { t: 'string' }));
    expect(compareRequest(d, reqFlat, [], 'Req')).toEqual([expect.stringContaining('Req.opts.topic')]);
  });

  test('field in spec but not in SDK', () => {
    const d = mutate((x) => delete x.fields.opts.fields.count);
    expect(compareRequest(d, reqFlat, [], 'Req')).toEqual([expect.stringContaining('Req.opts.count')]);
  });

  test('basic type mismatch', () => {
    const d = mutate((x) => (x.fields.opts.fields.count = { t: 'number' }));
    expect(compareRequest(d, reqFlat, [], 'Req')).toEqual([expect.stringMatching(/Req\.opts\.count.*type/)]);
  });

  test('enum mismatch', () => {
    const d = mutate((x) => (x.fields.opts.fields.mode.enum = ['a', 'c']));
    expect(compareRequest(d, reqFlat, [], 'Req')).toEqual([expect.stringMatching(/Req\.opts\.mode.*enum/)]);
    const noEnum = mutate((x) => delete x.fields.opts.fields.mode.enum);
    expect(compareRequest(noEnum, reqFlat, [], 'Req')).toEqual([expect.stringMatching(/Req\.opts\.mode.*enum/)]);
  });

  test('required mismatch, including inside array items', () => {
    const d = mutate((x) => delete x.fields.query.required);
    expect(compareRequest(d, reqFlat, [], 'Req')).toEqual([expect.stringMatching(/Req\.query.*required/)]);
    const d2 = mutate((x) => delete x.fields.opts.fields.tags.items.fields.k.required);
    expect(compareRequest(d2, reqFlat, [], 'Req')).toEqual([expect.stringMatching(/Req\.opts\.tags\[\]\.k.*required/)]);
  });

  test('nested field in array items missing from SDK', () => {
    const d = mutate((x) => (x.fields.opts.fields.tags.items.fields.v = { t: 'string' }));
    expect(compareRequest(d, reqFlat, [], 'Req')).toEqual([expect.stringContaining('Req.opts.tags[].v')]);
  });

  test('SDK-only field listed in known diffs is accepted', () => {
    const d = mutate((x) => (x.fields.opts.fields.max_reviews = { t: 'integer' }));
    const known: KnownDiff[] = [{ path: 'Req.opts.max_reviews', reason: 'documented elsewhere' }];
    expect(compareRequest(d, reqFlat, known, 'Req')).toEqual([]);
  });

  test('known diff for this root that no longer applies is reported', () => {
    const known: KnownDiff[] = [{ path: 'Req.opts.max_reviews', reason: 'documented elsewhere' }];
    expect(compareRequest(goodReq, reqFlat, known, 'Req')).toEqual([expect.stringMatching(/Req\.opts\.max_reviews.*known_diffs/)]);
    // 其他根的条目不归这次比较管
    expect(compareRequest(goodReq, reqFlat, [{ path: 'Other.x', reason: 'r' }], 'Req')).toEqual([]);
  });

  test('known diffs do not excuse fields missing from the SDK', () => {
    const d = mutate((x) => delete x.fields.opts.fields.count);
    const known: KnownDiff[] = [{ path: 'Req.opts.count', reason: 'r' }];
    expect(compareRequest(d, reqFlat, known, 'Req')).toContainEqual(expect.stringContaining('Req.opts.count'));
  });
});

const resSpec: OpenAPI = {
  components: {
    schemas: {
      Company: { type: 'object', required: ['type'], properties: { type: { type: 'string', enum: ['company'] }, name: { type: 'string' } } },
      Person: { type: 'object', required: ['type'], properties: { type: { type: 'string', enum: ['person'] }, title: { type: 'string' } } },
      BusinessEntity: {
        oneOf: [{ $ref: '#/components/schemas/Company' }, { $ref: '#/components/schemas/Person' }],
        discriminator: {
          propertyName: 'type',
          mapping: { company: '#/components/schemas/Company', person: '#/components/schemas/Person' },
        },
      },
      Res: {
        type: 'object',
        required: ['request_id'],
        properties: {
          request_id: { type: 'string' },
          data: {
            type: 'object',
            properties: {
              warning: { type: 'string', nullable: true },
              results: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' } } } },
              entities: { type: 'array', items: { $ref: '#/components/schemas/BusinessEntity' } },
            },
          },
        },
      },
    },
  },
};
const resFlat = flattenSchema(resSpec, '#/components/schemas/Res', 'response');

const goodRes = {
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
              company: { t: 'object', fields: { type: { t: 'string', enum: ['company'], required: true }, name: { t: 'string' } } },
              person: { t: 'object', fields: { type: { t: 'string', enum: ['person'], required: true }, title: { t: 'string' } } },
            },
          },
        },
      },
    },
  },
} as const satisfies ObjectDesc;

function mutateRes(f: (d: any) => void): ObjectDesc {
  const d = structuredClone(goodRes) as any;
  f(d);
  return d as ObjectDesc;
}

describe('compareResponse', () => {
  test('identical structure has no differences', () => {
    expect(compareResponse(goodRes, resFlat, [], 'Res')).toEqual([]);
  });

  test('field in spec but not in SDK, inside array items', () => {
    const d = mutateRes((x) => delete x.fields.data.fields.results.items.fields.title);
    expect(compareResponse(d, resFlat, [], 'Res')).toEqual([expect.stringContaining('Res.data.results[].title')]);
  });

  test('field in SDK but not in spec needs a known diff', () => {
    const d = mutateRes((x) => (x.fields.msg = { t: 'string' }));
    expect(compareResponse(d, resFlat, [], 'Res')).toEqual([expect.stringContaining('Res.msg')]);
    expect(compareResponse(d, resFlat, [{ path: 'Res.msg', reason: 'server returns it' }], 'Res')).toEqual([]);
  });

  test('nullability mismatch', () => {
    const d = mutateRes((x) => delete x.fields.data.fields.warning.nullable);
    expect(compareResponse(d, resFlat, [], 'Res')).toEqual([expect.stringMatching(/Res\.data\.warning.*null/)]);
  });

  test('union variants are compared field by field', () => {
    const d = mutateRes((x) => delete x.fields.data.fields.entities.items.variants.person.fields.title);
    expect(compareResponse(d, resFlat, [], 'Res')).toEqual([expect.stringContaining('Res.data.entities[]{person}.title')]);
    const d2 = mutateRes((x) => delete x.fields.data.fields.entities.items.variants.person);
    expect(compareResponse(d2, resFlat, [], 'Res')).toEqual([expect.stringContaining('Res.data.entities[]{person}')]);
  });

  test('structural kind mismatch is reported', () => {
    const d = mutateRes((x) => (x.fields.data.fields.results = { t: 'string' }));
    expect(compareResponse(d, resFlat, [], 'Res')).toEqual([expect.stringMatching(/Res\.data\.results/)]);
  });
});

describe('known_diffs.json', () => {
  test('snapshot file is valid and holds the two seeded entries', () => {
    const diffs = loadKnownDiffs();
    expect(diffs.map((d) => d.path).sort()).toEqual(['BroadSearchResponse.msg', 'PlaceSearchRequest.places.max_reviews']);
    for (const d of diffs) expect(d.reason.trim()).not.toBe('');
  });

  test('entries without a reason, with a bad path, or duplicated are rejected', () => {
    expect(() => parseKnownDiffs([{ path: 'A.b', reason: ' ' }])).toThrow(/reason/);
    expect(() => parseKnownDiffs([{ path: 'A.b' }])).toThrow(/reason/);
    expect(() => parseKnownDiffs([{ path: 'nodot', reason: 'r' }])).toThrow(/path/);
    expect(() => parseKnownDiffs([{ path: 'A.b', reason: 'r' }, { path: 'A.b', reason: 'r' }])).toThrow(/duplicate/i);
    expect(() => parseKnownDiffs({})).toThrow(/array/);
  });
});
