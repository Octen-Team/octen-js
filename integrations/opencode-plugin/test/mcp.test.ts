import { describe, expect, it } from 'vitest';
import { applyConfig, buildEntry, parseOptions } from '../src/mcp.js';
import type { HostConfig } from '../src/mcp.js';

const URL = 'https://mcp.octen.ai/mcp';

describe('buildEntry', () => {
  it('sends the key as x-api-key and turns OAuth off', () => {
    expect(buildEntry({ OCTEN_API_KEY: 'k1' }, {})).toEqual({
      type: 'remote',
      url: URL,
      oauth: false,
      headers: { 'x-api-key': 'k1' },
    });
  });

  it('trims the key', () => {
    expect(buildEntry({ OCTEN_API_KEY: ' k1\n' }, {}).headers).toEqual({ 'x-api-key': 'k1' });
  });

  it.each([undefined, '', '   '])('leaves headers and oauth out when the key is %j', (key) => {
    expect(buildEntry({ OCTEN_API_KEY: key }, {})).toEqual({ type: 'remote', url: URL });
  });

  it('narrows the roster through the tools query, in the given order', () => {
    expect(buildEntry({}, { tools: ['search', 'extract'] }).url).toBe(`${URL}?tools=search,extract`);
  });
});

describe('parseOptions', () => {
  it('accepts no options', () => {
    expect(parseOptions(undefined)).toEqual({});
  });

  it('accepts an empty object', () => {
    expect(parseOptions({})).toEqual({});
  });

  it('accepts a tools list', () => {
    expect(parseOptions({ tools: ['news_search'] })).toEqual({ tools: ['news_search'] });
  });

  it.each([
    [{ tools: [] }],
    [{ tools: ['Search'] }],
    [{ tools: ['a b'] }],
    [{ tools: ['search', 7] }],
    [{ tools: 'search' }],
    [{ tool: ['search'] }],
    ['search'],
    [['search']],
    [null],
  ])('rejects %j', (raw) => {
    expect(() => parseOptions(raw)).toThrow(/^@octen\.ai\/opencode-plugin: /);
  });
});

describe('applyConfig', () => {
  const entry = buildEntry({ OCTEN_API_KEY: 'k1' }, {});

  it('adds the server and the skills directory to an empty config', () => {
    const cfg: HostConfig = {};
    applyConfig(cfg, entry, '/pkg/skills');
    expect(cfg).toEqual({ mcp: { octen: entry }, skills: { paths: ['/pkg/skills'] } });
  });

  it('keeps an octen entry the user wrote, and still adds the skills directory', () => {
    const mine = { type: 'remote', url: `${URL}?tools=search` };
    const cfg: HostConfig = { mcp: { octen: mine, other: { type: 'local' } } };
    applyConfig(cfg, entry, '/pkg/skills');
    expect(cfg.mcp?.['octen']).toBe(mine);
    expect(cfg.mcp?.['other']).toEqual({ type: 'local' });
    expect(cfg.skills).toEqual({ paths: ['/pkg/skills'] });
  });

  it('does not add the skills directory twice', () => {
    const cfg: HostConfig = { skills: { paths: ['/mine'] } };
    applyConfig(cfg, entry, '/pkg/skills');
    applyConfig(cfg, entry, '/pkg/skills');
    expect(cfg.skills?.paths).toEqual(['/mine', '/pkg/skills']);
  });
});
