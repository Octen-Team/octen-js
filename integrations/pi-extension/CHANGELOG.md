# Changelog

## 0.1.0

Initial release.

- Registers Octen's hosted MCP server with Pi as `octen`, so the model can call every tool the server offers, named `mcp__octen__<tool>`. The extension implements no tools itself.
- Credentials: an API key from `OCTEN_API_KEY`, sent in an `Authorization` header; without one, the server is registered with no credential and Pi's MCP sign-in applies (`/mcp login octen`). An API key wins when both are present.
- Ships one skill, `octen-search-guide`.
- Needs Pi 0.99.0 or later, the first version where an extension can register an MCP server.
