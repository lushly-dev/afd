---
"lushly-botcore": minor
---

### Changed

- **Managed host MCP server (`create_host_mcp_server`) now runs on `afd.server.create_server` (#2499):**
  - Exposes AFD's five standard meta-tools (`afd-discover`, `afd-detail`, `afd-call`, `afd-batch`, `afd-pipe`) in every `tools/list` alongside dual-era MCP (`2026-07-28` `server/discover` and `2025` `initialize`), unlocking AFD Skills (`io.modelcontextprotocol/skills`), resources, OAuth bearer `auth`, `context_hook`, `context_fields`, `middleware` and tool strategies via forwarded AFD options (`**afd_options`).
  - Applies host policy, execution profiles (`inspection`, `remote-caller`, `trusted-local`) and target path bounds as AFD middleware (`create_host_policy_middleware`) while still routing every admitted call through `host.execute`. Defaults `default_timeout_ms=None` so long-running host commands are not cut off unless a timeout is configured.
  - Maps `command_tools=False` (default) to AFD's `"lazy"` tool strategy and `command_tools=True` to `"individual"` (with `tool_strategy="grouped"` and `"hybrid"` also selectable). Under `"lazy"`, exposed commands are also callable directly by served name as in AFD's spec.
  - Keeps `{name}-start`, `{name}-call` and `{name}-docs` working as deprecated compatibility aliases (scheduled for retirement in a subsequent release) and preserves `{name}-run` when `raw_python=True` on `trusted-local` hosts. Replies carry AFD wire metadata (`metadata.traceId`, `metadata.executionTimeMs`, `metadata.actorKind`), `structuredContent` and `isError: true` on failures; calling an unregistered spelling returns a structured `COMMAND_NOT_FOUND` result instead of an SDK protocol error; commands colliding with `{name}-start|call|docs|run` or AFD meta-tool names are refused at construction.
  - Raises the optional `mcp` extra to `afd[server]>=0.13.0` and `mcp>=2.3,<3` (base installs remain `afd>=0.9.0`). Legacy `create_mcp_server` and `botcore.host_http` are unchanged.
