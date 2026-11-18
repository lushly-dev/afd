# MCP integration: what an agent sees

How an AFD server presents commands over MCP, in every language. The rules are in
[`spec/tool-strategies.md`](../../../../spec/tool-strategies.md) (lists, routing, contexts),
[`spec/command-metadata.md`](../../../../spec/command-metadata.md) (`_meta`, confirmations,
approvals) and [`spec/protocol-conformance.md`](../../../../spec/protocol-conformance.md) (MCP eras).
Writing a TypeScript server (`createMcpServer`, `createMcpHandler`, transports, options): the
afd-typescript skill and `packages/server/README.md`.

## Exposure

Only commands with `expose: { mcp: true }` are listed or callable over MCP, on every path:
`tools/list`, the meta-tools, grouped tools and the HTTP routes. A private command answers
`COMMAND_NOT_FOUND`, the same as an unknown name, so an agent cannot learn it exists.

## Tool strategies

Every strategy lists the five meta-tools first: `afd-discover`, `afd-detail`, `afd-call`,
`afd-batch`, `afd-pipe` (#533). Then:

| Strategy | `tools/list` after the meta-tools |
|----------|----------------------------------|
| `grouped` (default) | One tool per group (`category`, else the first name segment) |
| `individual` | One tool per command |
| `lazy` | The context tools when contexts are set; agents run `afd-discover` → `afd-detail` → `afd-call` |
| `hybrid` | The context tools when contexts are set, then 1 to 8 `firstClassTools`; the list never varies by context |

TypeScript, Rust and C++ serve these lists; Python still serves the earlier ones until its #533
step lands (`spec/tool-strategies.md`, "Alignment"). Every strategy routes all five meta-tools, and
any exposed command by its own name, whether or not it is listed.

A grouped tool takes `{ action, params }` (`todo-create` is group `todo`, action `create`). Its
`_meta.actions` carries each action's command name, description, input schema and per-command
`_meta`. Small groups (at most 8,192 characters of schemas, no `$ref`) also inline the schemas
as `params.anyOf`, never at the top level, because some hosts reject top-level `anyOf`.

## Meta-tool behaviour

- An unknown name, by any route, is `COMMAND_NOT_FOUND`, suggesting at most three close matches the
  caller can call and ending "Use afd-discover to list all commands."
- Invalid `afd-call`, `afd-discover` or `afd-detail` arguments are `VALIDATION_ERROR` with
  `details.errors`; a `null` argument counts as omitted. Invalid `afd-batch` and `afd-pipe`
  envelopes are `INVALID_BATCH_REQUEST` and `INVALID_PIPELINE_REQUEST`.
- `afd-pipe` step inputs reference `$prev`, `$first`, `$steps[n]`, `$steps.alias` and `$input`,
  optionally with a path (`$prev.items[0].id`). An unresolved reference is omitted. See
  [`spec/pipeline-variables.md`](../../../../spec/pipeline-variables.md).

## Tool `_meta`

A command's tool (or its `_meta.actions` entry when grouped) reports the planning fields it sets:
`category`, `requires`, `mutation`, `destructive`, `undoable`, `approval`, `examples`, `contexts`
and `outputSchema`. Unset fields and empty arrays are omitted. `confirmPrompt` is display text, so
it is in `afd-detail`, not `_meta`.

## Bootstrap tools

| Tool | Input | Returns |
|------|-------|---------|
| `afd-help` | `{ filter?, format?: 'brief' \| 'full' }` | Commands by category; `filter` matches tags, category or name |
| `afd-docs` | `{ command? }` | Markdown documentation generated from the definitions |
| `afd-schema` | `{ format?: 'json' \| 'typescript' }` | Input JSON Schemas, or TypeScript input types too |

TypeScript registers them with `bootstrap: true`, Rust with `register_bootstrap_commands`, and
Python always. They describe only the exposed commands available in the active context.

## Contexts

A command that declares `contexts` is available only while one of them is active; with none
active, everything is. A call outside its context is `COMMAND_NOT_IN_CONTEXT`.

- **MCP 2026-07-28** has no session. The active context is request input,
  `_meta["dev.afd/context"]` on `tools/list` and `tools/call`; `afd-context-enter` and
  `afd-context-exit` validate the name, store nothing and return `persisted: false`.
- **2025 clients** keep a stack per connection (stdio `initialize`, or each `Mcp-Session-Id` on
  the deprecated `/message` lane); enter and exit without a session are `SESSION_REQUIRED`. A stack
  holds at most 16 contexts.

## TypeScript HTTP endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /mcp` | MCP Streamable HTTP: 2026-07-28 statelessly, and 2025 clients that send `initialize` |
| `POST /rpc` | Simple JSON-RPC for browser clients |
| `POST /batch` | Batch execution |
| `POST /stream/:name` | SSE chunks, produced after the handler finishes (not incremental) |
| `GET /health` | Health check |
| `GET /sse`, `POST /message` | Deprecated 2024-11-05 transport, removed in 3.0 |

Status codes, JSON-RPC error codes and sessions: "HTTP Endpoints" in `packages/server/README.md`.
