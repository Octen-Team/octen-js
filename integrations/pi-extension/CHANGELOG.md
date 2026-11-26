# Changelog

## 0.1.1

- The `octen-search-guide` skill now notes that grouped design lookups return at most 100 images, that `place_search` returns web pages only when web results are turned on, and that `business_search` filters apply to web results only, not to entity cards.
- First release published from GitHub Actions with npm provenance.

## 0.1.0

Initial release.

- Registers Octen's hosted MCP server with Pi as `octen`, so the model can call every tool the server offers, named `mcp__octen__<tool>`. The extension implements no tools itself.
- Credentials: an API key from `OCTEN_API_KEY`, sent in an `Authorization` header; without one, the server is registered with no credential and Pi's MCP sign-in applies (`/mcp login octen`). An API key wins when both are present.
- Ships one skill, `octen-search-guide`.
- Needs Pi 0.99.0 or later, the first version where an extension can register an MCP server.
