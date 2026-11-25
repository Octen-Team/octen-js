import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(root + path, 'utf8');
const manifest = JSON.parse(read('.devin-plugin/plugin.json'));

// Manifest fields from Devin's plugin docs and the marketplace's third-party plugins; card rules from its adding-a-plugin guide.
test('manifest keeps to the known plugin fields', () => {
  const allowed = ['name', 'displayName', 'description', 'shortDescription', 'version', 'homepage', 'repository', 'license', 'logo', 'keywords', 'mcpServers'];
  assert.deepEqual(Object.keys(manifest).filter((k) => !allowed.includes(k)), []);
  assert.equal(manifest.name, 'octen');
  assert.equal(manifest.displayName, 'Octen');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
});

test('descriptions fit the marketplace card', () => {
  const { description, shortDescription } = manifest;
  assert.ok(description.length >= 60 && description.length <= 130, `description is ${description.length} characters`);
  assert.ok(!description.endsWith('.'));
  assert.doesNotMatch(description, /integration|MCP server/i);
  assert.ok(shortDescription.trim() !== '' && shortDescription.length <= 40);
});

test('logo is a PNG in the plugin directory', () => {
  assert.match(manifest.logo, /^[A-Za-z0-9_-]+\.png$/);
  const png = readFileSync(root + manifest.logo);
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

test('the server is the hosted endpoint and carries no credential', () => {
  assert.deepEqual(manifest.mcpServers, { octen: { url: 'https://mcp.octen.ai/mcp' } });
});

test('no other manifest or MCP file shadows .devin-plugin/plugin.json', () => {
  for (const shadow of ['plugin.json', 'mcp.json', '.mcp.json', '.claude-plugin']) {
    assert.ok(!existsSync(root + shadow), `${shadow} must not exist`);
  }
});

test('every skill has front matter naming its directory', () => {
  const skills = readdirSync(root + 'skills');
  assert.deepEqual(skills, ['octen-search-guide']);
  for (const name of skills) {
    const text = read(`skills/${name}/SKILL.md`);
    assert.match(text, new RegExp(`^---\\nname: ${name}\\ndescription: `));
  }
});

// The guide is shared with the OpenCode and Pi packages; only the host-specific parts may differ.
for (const host of ['opencode-plugin', 'pi-extension']) test(`the search guide matches the ${host} copy outside host-specific text`, () => {
  const sections = (text) => {
    const [head, ...rest] = text.split('\n## ');
    return { head: head.split('\n\n').filter((p) => !/^In (Devin|Pi|OpenCode)/.test(p)), rest };
  };
  const ours = sections(read('skills/octen-search-guide/SKILL.md'));
  const theirs = sections(readFileSync(`${root}../${host}/skills/octen-search-guide/SKILL.md`, 'utf8'));
  assert.deepEqual(ours.head, theirs.head);
  const failures = (s) => s.findIndex((x) => x.startsWith('When a call fails'));
  assert.deepEqual(ours.rest.filter((_, i) => i !== failures(ours.rest)), theirs.rest.filter((_, i) => i !== failures(theirs.rest)));
  const lastBullet = (s) => s[failures(s)].split('\n- ').at(-1);
  assert.equal(lastBullet(ours.rest), lastBullet(theirs.rest));
});

test('the guide tells Devin how to reach the tools and how to sign in', () => {
  const text = read('skills/octen-search-guide/SKILL.md');
  assert.match(text, /mcp_call_tool/);
  assert.match(text, /devin mcp login octen/);
  assert.doesNotMatch(text, /opencode|\bPi\b|codemode/i);
});
