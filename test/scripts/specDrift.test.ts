import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, test } from 'vitest';

// Runs scripts/spec-drift.ts against local files; exit codes: 0 no drift, 1 drift, 2 cannot run.
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SNAPSHOT = join(ROOT, 'testdata/openapi.json');
const TSX = join(ROOT, 'node_modules/.bin/tsx');
const dir = mkdtempSync(join(tmpdir(), 'octen-spec-drift-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Property = {
  enum?: string[];
  minItems?: number;
  maxItems?: number;
  items?: Record<string, unknown>;
  default?: number;
  minimum?: number;
  maximum?: number;
};
type Spec = { components: { schemas: Record<string, { properties: Record<string, Property> }> } };

function writeSpec(name: string, mutate: (s: Spec) => void): string {
  const spec = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as Spec;
  mutate(spec);
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(spec));
  return file;
}

function run(liveFile: string, nodeOptions = '') {
  const r = spawnSync(TSX, ['scripts/spec-drift.ts'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, SPEC_DRIFT_URL: liveFile, SPEC_DRIFT_SNAPSHOT: SNAPSHOT, NODE_OPTIONS: nodeOptions },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('scripts/spec-drift.ts', { timeout: 30_000 }, () => {
  test('an identical spec exits 0', () => {
    const r = run(SNAPSHOT);
    expect(r.out).toMatch(/No drift/);
    expect(r.status).toBe(0);
  });

  test('a changed enum exits 1 and names the place', () => {
    const live = writeSpec('enum.json', (s) => {
      s.components.schemas.PulseSearchRequest!.properties.mode!.enum = ['lite', 'standard', 'deep'];
    });
    const r = run(live);
    expect(r.out).toMatch(/\/pulse-search request\.mode: enum/);
    expect(r.status).toBe(1);
  });

  test('a removed property exits 1 and names the place', () => {
    const live = writeSpec('removed.json', (s) => {
      delete s.components.schemas.PlaceUserLocation!.properties.city;
    });
    const r = run(live);
    expect(r.out).toMatch(/\/place-search request\.user_location\.city: removed from live spec/);
    expect(r.status).toBe(1);
  });

  test.each([
    ['ImageSearchRequest', 'count', '/image-search request.count'],
    ['VideoSearchResult', 'cover_url', '/video-search response.data.results[].cover_url'],
    ['DesignImageOptions', 'group_id', '/design-search request.images.group_id'],
  ])('a property removed from %s.%s is reported as %s', (schema, prop, place) => {
    const live = writeSpec(`removed-${schema}.json`, (s) => {
      delete s.components.schemas[schema]!.properties[prop];
    });
    const r = run(live);
    expect(r.out).toContain(`${place}: removed from live spec`);
    expect(r.status).toBe(1);
  });

  // The SDK checks locally that inputs holds exactly one item, so a change in its bounds must not pass silently.
  test.each([
    ['ImageSearchRequest', 'maxItems', 2, '/image-search request.inputs: maxItems 1 -> 2'],
    ['ImageSearchRequest', 'minItems', 0, '/image-search request.inputs: minItems 1 -> 0'],
    ['VideoSearchRequest', 'maxItems', 3, '/video-search request.inputs: maxItems 1 -> 3'],
    ['VideoSearchRequest', 'minItems', 1, '/video-search request.inputs: minItems none -> 1'],
  ] as const)('%s inputs %s changed to %d exits 1', (schema, key, value, expected) => {
    const live = writeSpec(`cardinality-${schema}-${key}.json`, (s) => {
      s.components.schemas[schema]!.properties.inputs![key] = value;
    });
    const r = run(live);
    expect(r.out).toContain(expected);
    expect(r.status).toBe(1);
  });

  // The SDK checks the urls limits locally; the spec states them only in the description, so a change there is drift.
  test('a changed urls description of /extract exits 1', () => {
    const live = writeSpec('extract-urls-text.json', (s) => {
      const urls = s.components.schemas.ExtractRequest!.properties.urls as Property & { description: string };
      urls.description = urls.description.replace('Maximum URLs per request: 20.', 'Maximum URLs per request: 50.');
    });
    const r = run(live);
    expect(r.out).toMatch(/\/extract request\.urls: description ".*20\..*" -> ".*50\..*"/);
    expect(r.status).toBe(1);
  });

  test('urls bounds added to /extract exit 1', () => {
    const live = writeSpec('extract-urls-bounds.json', (s) => {
      s.components.schemas.ExtractRequest!.properties.urls!.maxItems = 20;
    });
    const r = run(live);
    expect(r.out).toContain('/extract request.urls: maxItems none -> 20');
    expect(r.status).toBe(1);
  });

  // The SDK checks each URL against 2048 characters, so an item length bound in the spec must not change silently
  test('a urls item maxLength added to /extract exits 1, with nothing else changed', () => {
    const live = writeSpec('extract-urls-item-maxlength.json', (s) => {
      const urls = s.components.schemas.ExtractRequest!.properties.urls!;
      urls.items = { ...urls.items, maxLength: 4096 };
    });
    const r = run(live);
    expect(r.out).toContain('/extract request.urls[].maxLength: none -> 4096');
    expect(r.out).toMatch(/Spec drift in 1 place/);
    expect(r.status).toBe(1);
  });

  // The SDK and the tools reject an empty URL, so an item minLength added upstream must not go unnoticed
  test('a urls item minLength added to /extract exits 1, with nothing else changed', () => {
    const live = writeSpec('extract-urls-item-minlength.json', (s) => {
      const urls = s.components.schemas.ExtractRequest!.properties.urls!;
      urls.items = { ...urls.items, minLength: 1 };
    });
    const r = run(live);
    expect(r.out).toContain('/extract request.urls[].minLength: none -> 1');
    expect(r.out).toMatch(/Spec drift in 1 place/);
    expect(r.status).toBe(1);
  });

  // The default HTTP timeout of extract derives from the per-URL timeout's default and range
  test.each([
    ['default', 45, '/extract request.timeout.default: 30 -> 45'],
    ['minimum', 5, '/extract request.timeout.minimum: 1 -> 5'],
    ['maximum', 120, '/extract request.timeout.maximum: 60 -> 120'],
  ] as const)('a changed /extract timeout %s exits 1', (key, value, expected) => {
    const live = writeSpec(`extract-timeout-${key}.json`, (s) => {
      s.components.schemas.ExtractRequest!.properties.timeout![key] = value;
    });
    const r = run(live);
    expect(r.out).toContain(expected);
    expect(r.out).toMatch(/Spec drift in 1 place/);
    expect(r.status).toBe(1);
  });

  test('a property removed from ExtractResult is reported', () => {
    const live = writeSpec('extract-result.json', (s) => {
      delete s.components.schemas.ExtractResult!.properties.resolved_mode;
    });
    const r = run(live);
    expect(r.out).toContain('/extract response.data.results[].resolved_mode: removed from live spec');
    expect(r.status).toBe(1);
  });

  // Moves ImageSearchRequest.inputs into its own schema behind a $ref (inside allOf, or direct), optionally changing maxItems
  function refInputs(name: string, maxItems?: number, direct = false): string {
    return writeSpec(name, (s) => {
      const schemas = s.components.schemas as Record<string, unknown> & typeof s.components.schemas;
      const inputs = { ...s.components.schemas.ImageSearchRequest!.properties.inputs! };
      if (maxItems !== undefined) inputs.maxItems = maxItems;
      schemas.ImageSearchInputs = inputs as never;
      const ref = { $ref: '#/components/schemas/ImageSearchInputs' };
      s.components.schemas.ImageSearchRequest!.properties.inputs = (direct ? ref : { allOf: [ref] }) as never;
    });
  }

  test('a direct $ref inputs property: same bounds are not drift, changed bounds are', () => {
    const same = run(refInputs('ref-direct-same.json', undefined, true));
    expect(same.out).toMatch(/No drift/);
    expect(same.status).toBe(0);
    const changed = run(refInputs('ref-direct-changed.json', 3, true));
    expect(changed.out).toContain('/image-search request.inputs: maxItems 1 -> 3');
    expect(changed.status).toBe(1);
  });

  test('a missing inputs property cannot be compared: exit 2', () => {
    // Also dropped from required, so flattenSchema accepts the schema and only the bounds lookup fails
    const live = writeSpec('inputs-missing.json', (s) => {
      const video = s.components.schemas.VideoSearchRequest! as { properties: Record<string, unknown>; required?: string[] };
      delete video.properties.inputs;
      video.required = (video.required ?? []).filter((k) => k !== 'inputs');
    });
    const r = run(live);
    expect(r.out).toContain('/video-search: request property "inputs" not found');
    expect(r.status).toBe(2);
  });

  test('a $ref cycle through inputs cannot be compared: exit 2', () => {
    const live = writeSpec('inputs-cycle.json', (s) => {
      const schemas = s.components.schemas as Record<string, unknown>;
      schemas.LoopA = { allOf: [{ $ref: '#/components/schemas/LoopB' }] };
      schemas.LoopB = { allOf: [{ $ref: '#/components/schemas/LoopA' }] };
      s.components.schemas.ImageSearchRequest!.properties.inputs = { $ref: '#/components/schemas/LoopA' } as never;
    });
    const r = run(live);
    expect(r.out).toMatch(/cycle/);
    expect(r.status).toBe(2);
  });

  test('a $ref-ed inputs array with the same bounds is not drift', () => {
    const r = run(refInputs('ref-same.json'));
    expect(r.out).toMatch(/No drift/);
    expect(r.status).toBe(0);
  });

  test('a $ref-ed inputs array with changed bounds is drift', () => {
    const r = run(refInputs('ref-changed.json', 4));
    expect(r.out).toContain('/image-search request.inputs: maxItems 1 -> 4');
    expect(r.status).toBe(1);
  });

  test('/search-premier is compared on its own: repointing it at another schema is drift', () => {
    type Post = { requestBody: { content: Record<string, { schema: { $ref: string } }> } };
    const live = writeSpec('premier.json', (s) => {
      const op = (s as unknown as { paths: Record<string, { post: Post }> }).paths['/search-premier']!.post;
      op.requestBody.content['application/json']!.schema.$ref = '#/components/schemas/PulseSearchRequest';
    });
    const r = run(live);
    expect(r.out).toMatch(/\/search-premier request\.mode: added in live spec/);
    expect(r.status).toBe(1);
  });

  test('garbage instead of JSON exits 2', () => {
    const live = join(dir, 'garbage.json');
    writeFileSync(live, '<html>not json</html>');
    const r = run(live);
    expect(r.out).toMatch(/cannot read the live spec/);
    expect(r.status).toBe(2);
  });

  // An unexpected throw outside main's own try blocks must not look like drift (exit 1).
  test('an unexpected error exits 2', () => {
    const preload = join(dir, 'throwing-log.mjs');
    writeFileSync(preload, "console.log = () => { throw new Error('injected failure'); };\n");
    const r = run(SNAPSHOT, `--import=${pathToFileURL(preload).href}`);
    expect(r.out).toMatch(/injected failure/);
    expect(r.status).toBe(2);
  });
});
