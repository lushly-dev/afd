# Migrating to MCP 2026-07-28

AFD servers and clients now speak MCP 2026-07-28, the stateless revision of the protocol, next to the 2025 protocol. Most applications need no code changes: command definitions, `CommandResult`s and the `/rpc`, `/batch` and `/stream` routes are unchanged. This note lists what does change, per language. The design and its decisions are in the [proposal](./proposal.md).

## What MCP 2026-07-28 changes

- **No handshake and no session.** Each request carries its protocol version and client capabilities in `_meta`; `server/discover` replaces `initialize` for clients that want to inspect a server first. Any server instance can answer any request.
- **Routing headers on HTTP.** Requests carry `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name`, so gateways can route without reading the body. Clients send them for you.
- **Contexts become request input.** AFD's `afd-context-enter` cannot remember anything between stateless requests. Select a context per request with `_meta["dev.afd/context"]` instead.

Every AFD server is dual-era: 2025 clients that send `initialize` keep working on the same endpoint or stdio connection.

## TypeScript

| You use | What to do |
| --- | --- |
| `createMcpServer({ transport: 'stdio' })` | Nothing. stdio serves both eras. |
| `createMcpServer({ transport: 'http' })` or `createMcpHandler()` | Point MCP clients at `/mcp`, for example `claude mcp add --transport http my-app http://localhost:3100/mcp`. `/sse` and `/message` still work, are deprecated, and are removed in 3.0. |
| `contexts` with HTTP clients | 2026-07-28 clients send `_meta["dev.afd/context"]`. `tools/list` defaults to `ttlMs: 0` when contexts are configured. |
| A command with an `output` schema | Its tool now advertises the CommandResult envelope as `outputSchema`, and clients validate `structuredContent` against it. Make the handler's `data` match the schema, or set `advertiseOutputSchema: false`. |
| `McpClient` with a `/sse` URL | Nothing yet; it keeps the deprecated `sse` transport. Switch to the `/mcp` URL to use `streamable-http`. |
| `McpClient` with another URL and no `transport` | It now uses `streamable-http` (it used `sse`, which could not connect to such a URL). `protocolMode: 'legacy'` forces the 2025 handshake. |
| The `afd` CLI | `connect`, `call --connect`, `shell` and `scenario run` infer the transport from the URL. Use `/mcp` URLs. |
| `@lushly-dev/afd-testing` mock servers | `initialize` without a version now answers `2025-11-25` instead of `2024-11-05`. |

## Python (`afd` 0.10)

| You use | What to do |
| --- | --- |
| `afd[server]` or `afd[client]` | They now require `mcp>=2.3,<3`. Code that reached into the SDK object (`server._create_mcp_server()`, `FastMCPTransport.mcp`) gets an `mcp.server.mcpserver.MCPServer`, whose result models use snake_case attributes. |
| `server.run("streamable-http")` with `mcp.settings` | Pass options to `run()` or `run_async()` instead: `server.run(transport="streamable-http", port=8000, stateless_http=True)`. `server.streamable_http_app(**options)` returns the ASGI app. |
| `contexts` | 2026-07-28 clients send `_meta["dev.afd/context"]`; an unknown name is a `-32602` error. |
| `McpClientConfig` without `transport` | The transport is inferred from the URL (`sse` for `/sse`, `http` for `/message`, `streamable-http` otherwise); it was always `sse`. |
| `MCP_PROTOCOL_VERSION` | It is `2025-11-25`, the newest `initialize`-era revision. `MODERN_PROTOCOL_VERSION` is `2026-07-28`. |

## Rust

The `afd` crate's new `server` feature serves a `CommandRegistry` over MCP (Streamable HTTP and stdio). It is opt-in and needs Rust 1.88; without it, nothing changes and the minimum stays 1.82. See the [crate README](../../../../packages/rust/README.md#features).

## C++

`afd-cpp` is unchanged. The todo backend's stdio loop (`packages/examples/todo/backends/cpp/src/mcp_stdio.cpp`) is dual-era and is the pattern to copy until the `afd::mcp_stdio` target lands (#341).

## What stays deprecated, and when it goes

| Feature | Status | Removal |
| --- | --- | --- |
| TypeScript `/sse` and `/message` routes, `Mcp-Session-Id`, `SessionStore` | Deprecated | `@lushly-dev/*` 3.0 |
| TypeScript client `sse` and `http` transports | Deprecated | 3.0 |
| Python `SseTransport` and `HttpTransport` | Deprecated | A later 0.x release |
| `SERVER_NOT_INITIALIZED` (`-32002`) constants | Deprecated | With the legacy lanes |

`initialize` support itself stays as long as the MCP SDKs keep their 2025 lanes.
