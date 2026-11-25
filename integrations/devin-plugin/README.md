# Octen plugin for Devin

Octen tools for [Devin](https://devin.ai): web search, news, companies and people, places, images, design references and page reading.

The plugin connects Devin to Octen's hosted MCP server and adds one skill, `octen-search-guide`, which helps the model pick the right tool. It implements no tools of its own, so new tools and parameters reach you without an update.

## Install

```bash
devin plugins install Octen-Team/octen-js#integrations/devin-plugin
```

## Sign in

The plugin signs in through your browser; there is no API key to paste. Run:

```bash
devin mcp login octen
```

Sign in and choose the API key that calls should be billed to; you need at least one key in your [account](https://octen.ai/platform/api-keys). If you skip this step, Devin opens the sign-in page the first time it uses an Octen tool. To sign out, run `devin mcp logout octen`.

Check the connection with:

```bash
devin mcp list
```

To use an API key instead of signing in, add the server yourself instead of installing this plugin, and export `OCTEN_API_KEY` in the shell you start Devin from:

```bash
devin mcp add -s user -H 'x-api-key: ${env:OCTEN_API_KEY}' octen https://mcp.octen.ai/mcp
```

## What the model gets

Devin lists the server's tools with `mcp_list_tools` and calls them with `mcp_call_tool`. The [MCP server page](https://docs.octen.ai/integrations/octen-mcp-server) describes every tool.

Devin asks before it calls an MCP tool. Non-interactive runs (`devin -p`) cannot ask and reject the call, so allow the Octen tools in `~/.config/devin/config.json` or a project's `.devin/config.json`:

```json
{
  "permissions": {
    "allow": ["mcp__octen__*"]
  }
}
```

## Update or remove

```bash
devin plugins update octen
devin plugins remove octen
```

## License

MIT
