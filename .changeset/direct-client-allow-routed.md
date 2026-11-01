---
"@lushly-dev/afd-server": patch
"@lushly-dev/afd-client": patch
"@lushly-dev/afd-core": patch
---

Enforce `DirectClient`'s `allow` on every command a routed tool runs (#577).

Before, `allow` checked only the tool name a call named. With a registry tool surface, a client that allowed `afd-call`, `afd-batch`, `afd-pipe` or a grouped tool could run every command the registry exposed, including commands `allow` refused by name, and `afd-discover` and `afd-detail` described commands the client could not call.

`createDirectRegistry`'s `execute` takes a new, optional `allow` call option beside `activeContext`: a trusted, in-process predicate over names. When it is set, the registry refuses the name called and every command the call runs that the predicate rejects (the `afd-call` target, each `afd-batch` item, each `afd-pipe` step, a grouped tool's action, and a command a handler runs by passing its own context to `execute`) with the same `COMMAND_NOT_ALLOWED` failure `DirectClient` gives. A grouped tool resolves its action among the permitted commands only, so a refused action reads as unknown (`COMMAND_NOT_FOUND`) and cannot make another ambiguous, and a group with no permitted action is refused as a whole. A throwing predicate denies. `afd-discover`, `afd-detail` and the bootstrap tools leave refused commands out, and `registry.listTools({ allow })` lists neither those commands nor the tool names the predicate rejects. The predicate travels on the call's context as an opaque token under a private symbol, so handlers cannot read or replace it and tool arguments cannot carry one. Without `allow`, nothing changes, and the MCP server is unchanged.

`DirectClient` passes its `allow` check as that call option on `call()`, on every `pipe()` step and on the approval retry, and to `registry.listTools`, so a grouped tool lists only the actions it permits. A client without `allow` passes nothing. `DirectExecuteOptions` gains `allow`.

Also fixed: `afd-context-list` sorted the host's contexts array in place; it now sorts a copy. `DirectTransport` answers `tools/list` from the registry's `listTools()` when it has a tool surface, so `McpClient` with `transport: 'direct'` lists the meta-tools and grouped tools it can call, and falls back to one tool per command otherwise.

`@lushly-dev/afd-core` adds the internal `./internal/direct-allow` subpath, which holds the one `COMMAND_NOT_ALLOWED` refusal both packages give. It is not public API.
