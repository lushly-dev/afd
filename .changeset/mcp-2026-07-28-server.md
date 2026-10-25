---
"@lushly-dev/afd-server": minor
---

Serve MCP 2026-07-28 (stateless, per-request `_meta`) next to the 2025 protocol.

- New `POST /mcp` endpoint on `createMcpServer` and `createMcpHandler`, built on the official MCP TypeScript SDK v2 (`@modelcontextprotocol/server`). It answers `server/discover`, validates the `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` headers, adds `resultType`, `serverInfo` and cache hints, and serves 2025 clients that send `initialize` statelessly on the same path. AFD's Host, Origin, CORS and body-size checks still run first, and `createContext(req)` still reaches every command.
- stdio serves both eras on one connection: `server/discover` openings get 2026-07-28, `initialize` openings keep the 2025 protocol and the server's single context stack.
- Contexts on the stateless lane are request input: send `_meta["dev.afd/context"]` on `tools/list` and `tools/call`. There, `afd-context-enter` and `afd-context-exit` validate but do not store, and return `persisted: false`.
- New options `instructions` (returned by `server/discover`) and `toolsListTtlMs` (default 5 minutes, or 0 when `contexts` are configured).
- The `/sse` and `/message` routes (the 2024-11-05 HTTP+SSE transport) are deprecated and unchanged; they are removed in 3.0.
- The `@modelcontextprotocol/sdk` 1.x dependency is replaced by `@modelcontextprotocol/server` and `@modelcontextprotocol/node` 2.x.
