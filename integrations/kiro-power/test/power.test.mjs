import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(root + path, 'utf8');
const plugin = JSON.parse(read('plugin.json'));
const mcp = JSON.parse(read('mcp.json'));

// Fields from the Agent Plugins 1.0.0 schema (additionalProperties: false); Kiro's create guide also requires
// version, description, author and keywords: https://kiro.dev/docs/powers/create/
test('plugin.json keeps to the Agent Plugins fields and has what Kiro requires', () => {
  const allowed = ['$schema', 'name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'extensions'];
  assert.deepEqual(Object.keys(plugin).filter((k) => !allowed.includes(k)), []);
  assert.equal(plugin.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.equal(plugin.name, 'octen');
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.ok(typeof plugin.description === 'string' && plugin.description.length > 0);
  assert.deepEqual(Object.keys(plugin.author).filter((k) => !['name', 'email', 'url'].includes(k)), []);
  assert.ok(Object.values(plugin.author).every((v) => typeof v === 'string'));
  assert.equal(typeof plugin.author.name, 'string');
  for (const k of ['homepage', 'repository', 'license']) assert.equal(typeof plugin[k], 'string');
  assert.ok(plugin.keywords.length > 0 && plugin.keywords.every((k) => typeof k === 'string' && k === k.toLowerCase()));
});

test('mcp.json declares only the hosted server, with no credential', () => {
  assert.deepEqual(mcp, {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
    mcpServers: { octen: { type: 'streamable-http', url: 'https://mcp.octen.ai/mcp' } },
  });
});

test('every skill has front matter naming its directory', () => {
  const skills = readdirSync(root + 'skills');
  assert.deepEqual(skills, ['octen-search-guide']);
  assert.match(read('skills/octen-search-guide/SKILL.md'), /^---\nname: octen-search-guide\ndescription: /);
});

// The guide is shared with the OpenCode, Pi and Devin packages; only the host-specific parts may differ.
for (const host of ['opencode-plugin', 'pi-extension', 'devin-plugin']) {
  test(`the search guide matches the ${host} copy outside host-specific text`, () => {
    const sections = (text) => {
      const [head, ...rest] = text.split('\n## ');
      return { head: head.split('\n\n').filter((p) => !/^In (Kiro|Devin|Pi|OpenCode)/.test(p)), rest };
    };
    const ours = sections(read('skills/octen-search-guide/SKILL.md'));
    const theirs = sections(readFileSync(`${root}../${host}/skills/octen-search-guide/SKILL.md`, 'utf8'));
    assert.deepEqual(ours.head, theirs.head);
    const failures = (s) => s.findIndex((x) => x.startsWith('When a call fails'));
    assert.deepEqual(ours.rest.filter((_, i) => i !== failures(ours.rest)), theirs.rest.filter((_, i) => i !== failures(theirs.rest)));
    const lastBullet = (s) => s[failures(s)].split('\n- ').at(-1);
    assert.equal(lastBullet(ours.rest), lastBullet(theirs.rest));
  });
}

test('the guide is written for Kiro', () => {
  const text = read('skills/octen-search-guide/SKILL.md');
  assert.match(text, /^In Kiro /m);
  assert.doesNotMatch(text, /opencode|\bPi\b|codemode|Devin|devin /i);
});

test('no Kiro-unknown manifest files', () => {
  for (const f of ['.devin-plugin', '.claude-plugin', '.mcp.json', 'POWER.md']) assert.ok(!existsSync(root + f), `${f} must not exist`);
});
