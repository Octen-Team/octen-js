# @octen.ai/pi-extension

Octen tools for the [Pi coding agent](https://pi.dev): web search, news, companies and people, places, images, design references and page reading.

The extension connects Pi to Octen's hosted MCP server. It implements no tools of its own, so new tools and parameters reach you without an update.

## Install

```bash
pi install npm:@octen.ai/pi-extension
```

## Sign in

Use an API key or a browser sign-in. When both are present, the API key is used.

### API key

Create a key in the [API Platform](https://octen.ai/platform/api-keys) and put it in the environment Pi starts from:

```bash
export OCTEN_API_KEY=your-api-key
```

### Browser sign-in

With no `OCTEN_API_KEY` set, start Pi and run:

```
/mcp login octen
```

or open `/mcp`, select octen and choose "Sign in". Pi opens the Octen authorization page. Sign in and choose the API key that calls should be billed to; you need at least one key in your account. Pi stores the resulting tokens in `~/.pi/agent/mcp-auth.json` and refreshes them on its own. To sign out, select octen in `/mcp`.

Sign in from inside a Pi session. The shell commands `pi mcp login` and `pi mcp list` do not load extensions, so they do not know about the server this extension registers.

## What the model gets

The Octen tools are named `mcp__octen__` plus the tool's name: `mcp__octen__search`, `mcp__octen__news_search`, `mcp__octen__extract` and so on. The [MCP server page](https://docs.octen.ai/integrations/octen-mcp-server) describes every tool.

Pi does not declare the tools of an MCP server to the model by default. The model finds and calls them from a `codemode` script when it needs them, which keeps the prompt short and costs one extra step the first time.

The extension also ships one skill, `octen-search-guide`, which helps the model pick the right tool.

## Declare the tools to the model directly

To have Pi declare the tools up front, define the server yourself in `~/.pi/agent/mcp.json`. An entry there takes precedence over the one this extension registers, and you can list just the tools you want in the URL:

```json
{
  "mcpServers": {
    "octen": {
      "url": "https://mcp.octen.ai/mcp?tools=search,extract",
      "headers": { "x-api-key": "${OCTEN_API_KEY}" },
      "exposure": "direct"
    }
  }
}
```

## Troubleshooting

| What you see | What to do |
| --- | --- |
| The model says it has no search tool | No key is set and you are not signed in. Set `OCTEN_API_KEY`, or open `/mcp` and sign in to octen. |
| A tool returns `code=401 msg=Invalid API Key` | With `OCTEN_API_KEY` set, the key is wrong or was deleted. After a browser sign-in, the key you chose is no longer active: sign out of octen in `/mcp` and sign in again. |
| `@octen.ai/pi-extension needs Pi 0.99.0 or later` | This Pi has no MCP support for extensions. Update Pi. |

## How it works

When Pi loads the extension, it registers an MCP server named `octen` at `https://mcp.octen.ai/mcp`, with your API key in an `Authorization` header if `OCTEN_API_KEY` is set. That is all it does: it makes no requests of its own and writes no files.

Tested with Pi 1.5.2 and 1.6.0.

## Development

```bash
npm ci
npm run typecheck && npm test
```

There is no build: Pi loads `src/index.ts` as shipped, so the file must not import anything.

`test/host/run.py` drives a real Pi with the packed extension: `OCTEN_API_KEY=<key> python3 test/host/run.py --pi <path to pi> --state <empty directory>`. It needs the network and is not part of `npm test`; its header explains the rows and what each one needs.

**Releasing.** Bump `version` in `package.json`, add a `CHANGELOG.md` entry, run the host tests, and merge to `main`. Then push the tag `pi-extension-v<version>` on that commit: `release-pi-extension.yml` checks the tag against `package.json` and publishes. The first version is published by hand, as the repository README describes for the SDK, with `release-pi-extension.yml` as the trusted publisher's workflow.

## License

MIT
