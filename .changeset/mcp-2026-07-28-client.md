---
"@lushly-dev/afd-client": minor
"@lushly-dev/afd-cli": minor
"@lushly-dev/afd-testing": minor
---

Talk MCP 2026-07-28 from the client, CLI and testing tools.

- `@lushly-dev/afd-client`: new `streamable-http` transport, built on the official MCP TypeScript SDK v2 client. It speaks MCP 2026-07-28 when the server offers it and falls back to the 2025 `initialize` handshake, so `McpClient` now talks to an AFD server's `/mcp` endpoint, the Python and Rust AFD servers, and any official MCP SDK server. It is the default for URLs that do not end in `/sse`; `protocolMode: 'auto' | 'legacy' | 'modern'` controls negotiation. `stream()` on a `/mcp` URL uses the sibling `/stream` path. The `sse` and `http` transports are deprecated and removed in 3.0.
- `@lushly-dev/afd-cli`: `--transport` accepts `streamable-http`, and `connect`, `call --connect`, `shell` and `scenario run` infer the transport from the URL (`sse` for `/sse`, `http` for `/message`, `streamable-http` otherwise) instead of defaulting to `sse` or `http`.
- `@lushly-dev/afd-testing`: the mock MCP servers are dual-era. `initialize` echoes a supported requested version (the newest legacy revision otherwise, instead of always `2024-11-05`), and requests carrying MCP 2026-07-28 `_meta` get `server/discover`, `resultType`, `serverInfo`, cache fields and `-32022` for unsupported versions.
