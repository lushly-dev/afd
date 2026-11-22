---
"afd-python": minor
---

### Added

- **Per-request context hook** (`#800`): `create_server(context_hook=...)` (`ServerConfig.context_hook`, `afd.server.ContextHook`, `afd.server.ContextHookRequest`) runs once per MCP `tools/call` before the request-state boundary, confirmation gate and command lookup, on every route (individual, grouped, hybrid, `afd-call`, `afd-batch`, `afd-pipe`, `afd-discover`, `afd-detail`, unknown and unexposed tools). Sync or async, it receives `ContextHookRequest(tool, request_context)` (with `.http_request` for the Starlette `Request` over HTTP/SSE, `None` over stdio, and `.header(name)`) plus a base `CommandContext` with server defaults (no `_meta` context fields). Returning a `CommandError` or failed `CommandResult` refuses the call with `details` and `cause` stripped; raising an exception or returning an invalid value fails closed with `INTERNAL_ERROR`. Server invariants (`interface="mcp"`, `remote=True`, `active_context`, `trace_id`, defaults, DirectClient tokens cleared) hold after the hook, hook `extra` values win over declared `_meta` context fields (`spec/context-fields.md`), and the snapshotted actor at call start binds confirmation and approval-relay `requestState` alongside any SDK-verified access token (`spec/authorization.md`, M8; `#532`).
