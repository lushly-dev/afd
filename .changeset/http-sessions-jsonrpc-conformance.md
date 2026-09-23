---
'@lushly-dev/afd-server': patch
'@lushly-dev/afd-client': patch
---

Make HTTP context scoping per client, add a request-context hook, and make the HTTP transport conform to JSON-RPC.

Behavior changes in `@lushly-dev/afd-server`:

- **Context state is per session.** `afd-context-enter`/`exit` no longer change one process-wide stack shared by every HTTP client. When `contexts` are configured, `initialize` on `/message` returns an `Mcp-Session-Id` header; requests that repeat it share that session's stack. Requests without it are stateless: they see no active context, and enter/exit return `SESSION_REQUIRED`. An unknown or expired session ID gets HTTP 404 (JSON-RPC `-32001`). Sessions expire after `sessionIdleTimeoutMs` (default 30 minutes) and are capped by `maxSessions` (default 1000, least recently used evicted). stdio keeps a single stack. Stacks hold at most 16 contexts (`CONTEXT_DEPTH_EXCEEDED`), and re-entering the active context is a no-op.
- **JSON-RPC notifications get HTTP 202 with an empty body.** A `/message` or `/rpc` message with `"jsonrpc": "2.0"` and no `id` is never answered with a response object. `/message` does not execute such notifications; `/rpc` still runs the command. The simple `/rpc` format without `jsonrpc` is still always answered.
- **Protocol errors are JSON-RPC error objects** on `/message` and `/rpc`, instead of `{ success: false }` bodies: `-32700` (HTTP 400), `-32600` including batch arrays (HTTP 400), `-32601`, `-32602` and `-32603` (HTTP 200, with the request `id`), and `-32000` for Host/Origin/Content-Type/size rejections (original HTTP status). Recovery guidance is in `error.data.suggestion`. `/batch` and `/stream` keep AFD error bodies.
- **`GET /stream/<command>` is refused for `mutation: true` commands** with HTTP 405 (`Allow: POST`, code `METHOD_NOT_ALLOWED`), so link prefetchers cannot trigger writes. Use `POST /stream/<command>`.
- **`/sse` is bounded:** at most `maxSseConnections` (default 100) concurrent connections, then HTTP 503 with `Retry-After`; a `: ping` heartbeat every 25 seconds; closed connections are removed.
- New `createContext(req)` option: its result is merged into the `CommandContext` of every remotely executed command (`tools/call`, `afd-call`, batch items, pipeline steps, `/rpc`, `/batch`, `/stream`). `traceId`, `signal` and `interface` (now `'mcp'` for remote calls) cannot be overridden. `context.signal` now aborts when an HTTP client disconnects on every route, and stdio passes the MCP request's cancellation signal. Pipeline `$input` no longer exposes the execution context, so request values cannot be copied into step inputs. The rate-limit docs now key on a `createContext` value instead of `traceId` or an unset `userId`.
- `start()` logs the resolved transport to stderr, because `transport: 'auto'` picks stdio whenever stdin is not a TTY (Docker without `-t`, systemd, pm2, CI) and the HTTP port then never opens. The JSDoc now states the real defaults: `toolStrategy: 'grouped'` and `cors` following `devMode`.

`@lushly-dev/afd-client`: the HTTP and SSE transports repeat the `Mcp-Session-Id` returned by `initialize`, and when the server answers 404 for a forgotten session they start a new session and retry the request once.
