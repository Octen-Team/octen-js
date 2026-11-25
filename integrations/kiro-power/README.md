# Octen power for Kiro

Octen tools for [Kiro](https://kiro.dev): web search, news, companies and people, places, images, design references and page reading.

The power connects Kiro to Octen's hosted MCP server and adds one skill, `octen-search-guide`, which helps the model pick the right tool. It implements no tools of its own, so new tools and parameters reach you without an update.

## Install

In the Kiro IDE 1.0.288 or later, open the Powers panel, choose **Add Custom Power**, then **Import power from a repository URL**, and enter:

```
https://github.com/Octen-Team/octen-js/tree/main/integrations/kiro-power
```

With the Kiro CLI, install from a local copy:

```bash
git clone --depth 1 https://github.com/Octen-Team/octen-js.git
kiro-cli powers install octen-js/integrations/kiro-power
```

Powers run on Kiro's V3 agent. Interactive chats use V3 by default, but headless runs (`--no-interactive`), Linux machines with an older glibc, and a V2 default you set yourself use V2; pass `--v3` where your system supports it. See [agent harness](https://kiro.dev/docs/cli/agent-harness/).

## Sign in

The power signs in through your browser; there is no API key to paste. Kiro names the server `power-octen-octen`. When Kiro reports that it requires OAuth, press Ctrl+Y in the Kiro CLI, or run:

```
/mcp auth power-octen-octen
```

Sign in and choose the API key that calls should be billed to; you need at least one key in your [account](https://octen.ai/platform/api-keys). To sign out, run `/mcp logout power-octen-octen`.

## What the model gets

Kiro activates the power when a request matches its keywords, such as search, news or extract, and loads its skill and tools when it needs them. Whether Kiro asks before it activates the power or calls a tool depends on your workspace trust and [permission settings](https://kiro.dev/docs/permissions/). The [MCP server page](https://docs.octen.ai/integrations/octen-mcp-server) describes every tool.

## Update or remove

To update in the Kiro IDE, choose **Check for updates** in the Powers panel, then **Install updates**. With the Kiro CLI, pull the latest copy (`git -C octen-js pull`) and install the power again. To remove it:

```bash
kiro-cli powers uninstall octen
```

## License

MIT
