---
"@lushly-dev/afd-server": minor
"@lushly-dev/afd-cli": minor
---

Add the `hybrid` tool strategy ([`spec/tool-strategies.md`](https://github.com/lushly-dev/afd/blob/main/spec/tool-strategies.md#hybrid)).

`createMcpServer` and `createMcpHandler` take `toolStrategy: 'hybrid'` with `firstClassTools`, an ordered list of at most 8 commands. `tools/list` is the five meta-tools (`afd-discover`, `afd-detail`, `afd-call`, `afd-batch`, `afd-pipe`), then the `afd-context-*` tools when `contexts` are configured, then the first-class commands as individual tools. The list never varies by the active context, so `ttlMs` keeps its 300,000 default under `contexts`; a first-class command called outside its context answers `COMMAND_NOT_IN_CONTEXT`. Server creation throws, naming the entry, for an entry that is unregistered, not MCP-exposed, a meta-tool or context tool, repeated or beyond the cap, and for `firstClassTools` with any other strategy. Commands outside the set run by name and through `afd-call`, `afd-batch` and `afd-pipe`.

`afd-help` now reports `toolStrategy` on every strategy and, on hybrid servers, `firstClassTools` and `firstClass: true`. The server also exports `ToolStrategy` and `MAX_FIRST_CLASS_TOOLS`.

`afd validate --surface` completes a hybrid listing with `afd-discover` and `afd-detail`, and warns about a first-class command that declares `contexts`.
