# @octen.ai/opencode-plugin

Octen tools for [OpenCode](https://opencode.ai): web search, news, companies and people, places, images, design references and page reading.

The plugin connects OpenCode to Octen's hosted MCP server. It implements no tools of its own, so new tools and parameters reach you without a plugin update.

## Install

Add the plugin to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@octen.ai/opencode-plugin"]
}
```

OpenCode installs it the next time it starts. The first time OpenCode loads any plugin it also installs its own plugin runtime, which took about three minutes in our test; later starts are not affected.

This works on OpenCode 1.x and 2.x. OpenCode 2.x reads the same entry, and its own config key is `plugins`; see [OpenCode 2.x](#opencode-2x) for what differs.

## Sign in

Use an API key or a browser sign-in. When both are present, the API key is used.

### API key

Create a key in the [API Platform](https://octen.ai/platform/api-keys) and put it in the environment OpenCode starts from:

```bash
export OCTEN_API_KEY=your-api-key
```

On OpenCode 2.x the plugin runs in a background service, which keeps the environment it started with. Set the key on the service so it does not depend on which shell started it, then restart the service:

```bash
opencode service set env OCTEN_API_KEY your-api-key
opencode service restart
```

### Browser sign-in

With no `OCTEN_API_KEY` set, run:

```bash
opencode mcp auth octen
```

OpenCode opens the Octen authorization page. Sign in and choose the API key that calls should be billed to; you need at least one key in your account. OpenCode stores the resulting tokens in `~/.local/share/opencode/mcp-auth.json` and refreshes them on its own.

- `opencode mcp auth list` shows whether you are signed in.
- `opencode mcp logout octen` signs you out.
- The sign-in needs a browser on the same machine. On a remote host or in CI, use an API key.

## Check that it works

```bash
opencode mcp list
```

should show `✓ octen connected`. On 1.x the model then has the Octen tools, each named `octen_` plus the tool's name: `octen_search`, `octen_news_search`, `octen_extract` and so on. The [MCP server page](https://docs.octen.ai/integrations/octen-mcp-server) describes every tool.

The plugin also adds one skill, `octen-search-guide`, which helps the model pick the right tool.

## Offer fewer tools

By default the model is offered every tool the server has. To offer only some, pass their names:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [["@octen.ai/opencode-plugin", { "tools": ["search", "extract"] }]]
}
```

Use the server's tool names, without the `octen_` prefix. A name the server does not know makes the connection fail, and `opencode mcp list` shows `✗ octen failed`.

The list becomes part of the server's address, and OpenCode keeps a browser sign-in per address. If you signed in through the browser, run `opencode mcp auth octen` again after changing `tools`.

## If you already configured Octen by hand

An `octen` entry under `mcp` in your own configuration is left as it is and used instead of the plugin's.

## OpenCode 2.x

OpenCode 2.x (npm `@opencode/cli`) runs plugins in a background service, so a few things differ from 1.x:

- **Config.** Use `"plugins": ["@octen.ai/opencode-plugin"]`. Options go in an object: `{ "package": "@octen.ai/opencode-plugin", "options": { "tools": ["search", "extract"] } }`. A 1.x `plugin` entry is also read.
- **API key.** The service reads `OCTEN_API_KEY` when it starts. An `export` reaches it only if that shell starts the service; a service that is already running does not see it. Use `opencode service set env` as shown in [API key](#api-key). OpenCode stores the value in `~/.config/opencode/service.json`, readable only by you. `opencode service unset env OCTEN_API_KEY` removes it.
- **Browser sign-in.** Without a key, run `opencode mcp auth octen`, as on 1.x.
- **Tools.** 2.x runs MCP tools in Code Mode: the model calls them inside its `execute` tool as `tools.octen.search(...)`, `tools.octen.news_search(...)` and so on, instead of as separate `octen_` tools.
- **Checking.** The service connects to MCP servers in the background, so right after it starts `opencode mcp list` can show no servers yet. Run it again after a few seconds.
- **Load errors.** If the plugin fails to load, for example on a misspelt option, the reason is in the service log, `~/.local/share/opencode/log/opencode.log`, under `failed to load plugin`.
- **Your own entry.** A hand-written server lives under `mcp.servers.octen`; the plugin leaves it as it is.

## Updating

OpenCode keeps the copy it installed. To move to a newer version, name it: `"@octen.ai/opencode-plugin@<version>"`.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| `opencode mcp list` shows `⚠ octen needs authentication` | No key is set and you are not signed in. Set `OCTEN_API_KEY` or run `opencode mcp auth octen`. |
| `opencode mcp list` shows `✗ octen failed` | Check the names in the `tools` option, and that the machine can reach `mcp.octen.ai`. |
| A tool returns `code=401 msg=Invalid API Key` | With `OCTEN_API_KEY` set, the key is wrong or was deleted. After a browser sign-in, the key you chose is no longer active: run `opencode mcp logout octen` and sign in again. |
| `opencode mcp list` shows no `octen` at all | The plugin did not load. OpenCode only writes the reason to its log: run `opencode mcp list --print-logs` and look for `failed to load plugin`. A misspelt option is the usual cause. |
| No `octen` and nothing in the log | On 1.x: your OpenCode version is outside the range in this package's `engines.opencode`; OpenCode then skips the plugin without a message. |
| On 2.x, `⚠ octen needs authentication` although you set `OCTEN_API_KEY` | The service was already running when you set the key. Use `opencode service set env` and restart the service; see [API key](#api-key). |

## How it works

When OpenCode loads its configuration, the plugin adds a remote MCP server named `octen` at `https://mcp.octen.ai/mcp`, with your API key as the `x-api-key` header if `OCTEN_API_KEY` is set, and adds its skill. On 1.x it adds the skills directory; on 2.x, which takes skills as content, it reads the bundled `SKILL.md`. That is all it does: it makes no requests of its own and writes no files.

The key then sits in OpenCode's resolved configuration, exactly as it does when you write the entry yourself with `{env:OCTEN_API_KEY}`. OpenCode 1.18.x prints that configuration as it is with `opencode debug config`, key included; 1.19.6 masks the headers. Do not paste that output anywhere if you use a key.

Tested with OpenCode 1.18.29, 1.19.6 and 2.4.1.

## Development

```bash
npm ci
npm run typecheck && npm test && npm run build
```

`test/host/run.py` drives a real OpenCode 1.x with the packed plugin: `OCTEN_API_KEY=<key> python3 test/host/run.py --opencode <path to opencode> --state <empty directory>`. `test/host/run_v2.py` does the same for OpenCode 2.x, with the same arguments. Both need the network, make billed searches, and are not part of `npm test`; their headers explain the rows and what each one needs.

**Releasing.** Bump `version` in `package.json`, add a `CHANGELOG.md` entry, run the host tests, and merge to `main`. Then push the tag `opencode-plugin-v<version>` on that commit: `release-opencode-plugin.yml` checks the tag against `package.json` and publishes. The first version is published by hand, as the repository README describes for the SDK, with `release-opencode-plugin.yml` as the trusted publisher's workflow.

## License

MIT
