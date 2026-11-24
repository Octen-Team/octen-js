# Changelog

## 0.1.0

Initial release.

- Registers Octen's hosted MCP server with OpenCode as `octen`, so the model gets every tool the server offers, named `octen_<tool>`. The plugin implements no tools itself.
- Credentials: an API key from `OCTEN_API_KEY`, sent as `x-api-key`; without one, the server is registered with no credential and OpenCode's MCP sign-in applies (`opencode mcp auth octen`). An API key wins when both are present.
- Option `tools`: offer the model only the named tools.
- An `octen` entry in the user's own `mcp` configuration is left as it is.
- Ships one skill, `octen-search-guide`.
