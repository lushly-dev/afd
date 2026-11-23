---
"afd-python": minor
---

### Added

- **MCP authorization scope enforcement (M6):** command `scopes` metadata (`CommandDefinition`, `@define_command`, `@server.command`, `_meta.scopes`, `afd-detail`, `afd-help`), `required_scopes`, `ScopeResolver`, `ScopeChallenge`, `ScopeView`, `static_decision`, `request_decision`, `PreDispatch`, `PreDispatchCheck`, and `filter_tools_by_scope` on `McpAuthOptions`; pre-dispatch HTTP 403 and JSON-RPC batch 400 `-32600` refusal on Streamable HTTP, post-routing `INSUFFICIENT_SCOPE` before confirmations, execution-time resolver re-checks on validated input, filtered listings (`cacheScope: "private"`) with byte-identical hidden commands, `server.admit` and `server.pre_dispatch_check`, and `tasks/*` scope enforcement (#2155).
