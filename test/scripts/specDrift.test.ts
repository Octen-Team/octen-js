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

type Spec = { components: { schemas: Record<string, { properties: Record<string, { enum?: string[] }> }> } };

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
