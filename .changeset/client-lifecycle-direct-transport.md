---
'@lushly-dev/afd-client': minor
---

Fix McpClient connection lifecycle events, support `transport: 'direct'`, and document which servers McpClient can talk to.

- **`connected` fires after the tools list is loaded**, so `getTools()` is ready in the handler. A failed tools refresh no longer fails `connect()` (after `connected` had already fired); the list stays empty.
- Events are delivered to a snapshot of the handlers, so a handler that unsubscribes during delivery no longer makes the next one miss the event.
- **Less reconnect noise:** failed reconnect attempts no longer each emit `error` and flip the state to `error` and back. Each attempt emits `reconnecting`; when all fail, one `error` ("Max reconnection attempts reached", with the last failure as `cause`) is emitted. Transport errors during connecting are reported once, by `connect()`.
- **Backoff has a cap and jitter**: `reconnectDelay * 2^(n-1)` plus up to 100 ms of jitter, capped by the new `maxReconnectDelay` option (default 30 s), as in `createReconnectingHandoff()`.
- **`HttpTransport` detects connection loss**: after 3 consecutive requests that get no HTTP response it reports the connection as closed, so `autoReconnect` now works for the `http` transport.
- **`transport: 'direct'`** now works instead of throwing: pass `registry` (for example `createDirectRegistry(commands)`), no URL needed. `call()`, `batch()`, `pipe()` and `stream()` run in process (batches and pipelines through core's `executeBatch()`/`executePipeline()`, streams through `executeStream()`). `McpClientConfig.transport` is now typed `'sse' | 'http' | 'direct'` (`McpTransportType`); `'websocket'` and `'stdio'`, which always threw at connect time, are rejected by the type and by the constructor with an error naming the supported transports.
- The README and API docs now state that McpClient targets AFD servers: it does not implement the MCP Streamable HTTP transport or the legacy SSE `endpoint` event, so servers built on the official MCP SDK (which answer 406/400) need the official SDK client.
