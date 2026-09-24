---
'@lushly-dev/afd-client': patch
---

`McpClient.stream()` now runs in the client's MCP session. Over HTTP and SSE it sends the `Mcp-Session-Id` that `initialize` returned, so `/stream/<command>` sees the session's active context (`afd-context-enter`) the way `call()` does. Before, streams carried no session and ran statelessly: a command hidden by the active context could still be streamed. If the server has expired the session (HTTP 404), the client starts a new session and retries the stream once, as it already did for other requests; without a session to renew, the server's structured failure is returned as the error chunk.

`HttpTransport` and `SseTransport` expose the session as a read-only `sessionId` and can start a new one with `renewSession()`. Both are optional members of the `Transport` interface, so custom transports keep compiling.
