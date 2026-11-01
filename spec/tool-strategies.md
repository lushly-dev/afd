# Tool strategies

How an AFD MCP server presents its commands as MCP tools: the four strategies (`individual`,
`grouped`, `lazy` and `hybrid`), the exact `tools/list` of each and its order, how tool calls are
routed, how contexts scope the list, which names are reserved, the cache hints, and what the
server tells the agent about the strategy. Which strategies each language serves is in
[Implementation status](#implementation-status).

The first three strategies are recorded as the implementations behave today. TypeScript is the
reference; where Python lists different tools, the difference is recorded as current, conforming
behavior until [#533](https://github.com/lushly-dev/afd/issues/533) decides it (see
[Current differences](#current-differences)). The [hybrid strategy](#hybrid) is new and normative.
In it, **MUST**, **MUST NOT**, **SHOULD** and **MAY** are used as in RFC 2119.

The [hybrid tool strategy proposal](../docs/features/active/hybrid-tool-strategy/hybrid-tool-strategy.proposal.md)
explains why the hybrid exists and records the owner's decisions it follows.

## Terms

| Term | Tools |
| --- | --- |
| Meta-tools | `afd-discover`, `afd-detail`, `afd-call`, `afd-batch`, `afd-pipe`. The tool router handles them itself, in every strategy. TypeScript's and Rust's definitions are [`meta-tools.json`](./meta-tools.json) |
| Context tools | `afd-context-list`, `afd-context-enter`, `afd-context-exit`. Registered as MCP-exposed commands (category `bootstrap`) when the server configures contexts |
| Bootstrap tools | `afd-help`, `afd-docs`, `afd-schema`. MCP-exposed commands (category `bootstrap`) where the server registers them |
| Command tool | The tool for one command, as the individual strategy lists it: `name`, `description`, `inputSchema` (with `confirm` where [Confirmations](./command-metadata.md#confirmations) adds it), `annotations`, the top-level `outputSchema` where the server advertises it, and `_meta` ([MCP tool fields](./command-metadata.md#mcp-tool-fields-mcp-2026-07-28-tool-surface)) |
| Grouped tool | One tool for a group of commands, taking `{ action, params }` |
| Exposed command | A command with `expose.mcp: true`. Only exposed commands are listed or callable over MCP ([D4](./error-codes.md#unknown-and-unexposed-commands-d4)) |

## Options and defaults

| | TypeScript (`createMcpServer`, `createMcpHandler`) | Python (`create_server`, `ServerConfig`) | Rust (`McpServer`, `server` feature) | C++ |
| --- | --- | --- | --- | --- |
| Strategy | `toolStrategy: 'individual' \| 'grouped' \| 'lazy' \| 'hybrid'` | `tool_strategy: Literal["individual", "grouped", "lazy", "hybrid"]` | `with_tool_strategy(ToolStrategy::Individual \| Grouped \| Lazy \| Hybrid)` | None (#341) |
| Default | `grouped` | `individual` | `Grouped` | — |
| Group name | `groupByFn` | `group_by` | `with_group_by` | — |
| Contexts | `contexts` | `contexts` | `with_contexts` | — |
| Bootstrap tools | `bootstrap: true` (default `false`) | Always registered | `register_bootstrap_commands` on the registry | — |
| `ttlMs` | `toolsListTtlMs` | `tools_list_ttl_ms` | `with_tools_list_ttl_ms` | — |
| Hybrid first-class set | `firstClassTools` | `first_class_tools` | `with_first_class_tools` | Planned |

The C++ todo backend's hand-rolled stdio loop lists one command tool per command; parity item D2
promotes it to `afd::mcp_stdio` ([#341](https://github.com/lushly-dev/afd/issues/341)).

## Tool lists

Each list is in this order. "Commands" means the exposed commands in registration order, filtered
by the active context where the strategy filters (see [Contexts](#contexts)). Context and bootstrap
tools are exposed commands, so they appear among the commands wherever the server registers them.

### `individual`

| Language | `tools/list` |
| --- | --- |
| TypeScript, Rust | `afd-batch`, `afd-pipe`, `afd-call`; then one command tool per command |
| Python | `afd-discover`, `afd-detail`, `afd-batch`, `afd-pipe`, `afd-call`; then one command tool per command |

### `grouped`

| Language | `tools/list` |
| --- | --- |
| TypeScript, Rust | `afd-batch`, `afd-pipe`, `afd-call`, `afd-detail`; then one grouped tool per group, in the order of each group's first command. By default, context and bootstrap tools fall in the `bootstrap` group |
| Python | `afd-discover`, `afd-detail`, `afd-batch`, `afd-pipe`, `afd-call`; then the bootstrap-category commands as command tools; then one grouped tool per remaining group, sorted by group name |

A command's group is `groupByFn`'s answer, else its `category`, else the first kebab-case segment of
its name, else `general`. Its action is its name without the first segment (`todo-create-batch` →
`create-batch`). In TypeScript and Rust a grouped tool's `_meta.actions` carries, for each action,
the command name, its input schema and the per-command `_meta` fields
([Reporting rules](./command-metadata.md#reporting-rules)); when the serialized per-action schemas
fit in 8,192 characters and contain no `$ref`, `params` also carries them as `anyOf` branches.
Python's grouped tool lists its actions sorted, with a generic `params` object and no
`_meta.actions`. Grouped tools carry no `annotations`.

### `lazy`

| Language | `tools/list` |
| --- | --- |
| TypeScript, Rust | `afd-discover`, `afd-detail`, `afd-batch`, `afd-pipe`, `afd-call`, and nothing else: no context or bootstrap tools, and not filtered by context |
| Python | `afd-discover`, `afd-detail`, `afd-batch`, `afd-pipe`, `afd-call`; then the bootstrap-category commands (the bootstrap tools and, with contexts, the context tools) in the active context |

### `hybrid`

Specified in [Hybrid](#h3-the-tool-list-and-its-order): the meta-tools, then the context tools when
contexts are configured, then the configured first-class command tools. TypeScript, Python and Rust serve it; see
[Implementation status](#implementation-status).

## Routing

The router handles a `tools/call` in this order, in every strategy and every language:

1. A meta-tool name runs that meta-tool, whether or not the strategy lists it.
2. Under `grouped`, a grouped tool name runs the command its `action` selects
   (`INVALID_GROUPED_CALL` without an action; in TypeScript and Rust, `AMBIGUOUS_ACTION` when more
   than one command matches).
3. Any other name is looked up as a command. An exposed command runs, so an agent can call a command
   that the strategy does not list (for example one found through `afd-discover` on a lazy server).
   An unknown or unexposed name answers `COMMAND_NOT_FOUND`, the same for both
   ([D4](./error-codes.md#unknown-and-unexposed-commands-d4)), with a suggestion ending "Use
   afd-discover to list all commands."
   ([Suggestions](./error-codes.md#suggestions-name-only-tools-the-host-provides)).

Every route runs the same exposure, context, confirmation, approval and validation checks as a
command's own tool.

## Contexts

With contexts configured, a command that declares `contexts` is available only while one of them
is active; with no active context, every command is available. On MCP 2026-07-28 the active context
is request input, `_meta["dev.afd/context"]`, and is never stored; a 2025 session keeps a context
stack ([protocol conformance](./protocol-conformance.md#acceptance-index)).

- **`individual` and `grouped`** list only the commands available in the active context.
- **`lazy`** in TypeScript and Rust lists the same five tools in every context; Python filters the
  bootstrap-category commands it lists.
- **`afd-discover` and `afd-detail`** report only the commands available in the active context.
- **Every strategy** answers a call to an exposed command outside the active context, by its own
  name or through a meta-tool, with `COMMAND_NOT_IN_CONTEXT` and the suggestion "Use
  afd-context-list to see available contexts, or afd-context-enter to switch."

## Reserved names

A command cannot take a name the server provides itself.

| Language | Refused at registration |
| --- | --- |
| TypeScript | The meta-tool names always; the bootstrap names with `bootstrap: true`; the context names with `contexts`. Duplicates are refused too (`command-names.ts`) |
| Python | The meta-tool names. A command named like a bootstrap tool shadows it ([language parity](../docs/language-parity.md#command-definition)) |
| Rust | The bootstrap and context names, by `register_bootstrap_commands` and `with_contexts` when a command already has one. A command named like a meta-tool is not refused, but the router handles the meta-tool first, so the command is unreachable |

## Cache hints and `listChanged`

| Field | `individual`, `grouped`, `lazy` | `hybrid` |
| --- | --- | --- |
| `ttlMs` on `tools/list` and `server/discover` | `toolsListTtlMs` when set; otherwise 300,000, or 0 when contexts are configured, because the list can vary by `_meta["dev.afd/context"]`, which clients leave out of their cache key | `toolsListTtlMs` when set; otherwise 300,000 whether or not contexts are configured ([H6](#h6-cache-hints-and-listchanged)) |
| `cacheScope` | `public` | `public` |
| `capabilities.tools.listChanged` | `false` | `false` ([H6](#h6-cache-hints-and-listchanged)) |

The `ttlMs` default under contexts applies to the lazy strategy too, although TypeScript's and
Rust's lazy lists do not vary by context. No AFD server sends `notifications/tools/list_changed`.

## `server/discover` instructions

Unless the server sets its own `instructions`, they are these sentences, joined by spaces:

1. "`<name>` is an AFD server. Every tool returns a CommandResult as JSON text: { success, data,
   error: { code, message, suggestion } }; follow error.suggestion to recover."
2. By strategy:
   - `lazy`: "Call afd-discover to find commands, afd-detail for a command schema, and afd-call to
     run one."
   - `grouped`: "Each tool groups related commands: pass { action, params }. afd-detail returns a
     command schema; afd-call runs any command by name."
   - `individual`: "Each command is its own tool; afd-call also runs any command by name."
   - `hybrid`: see [H8](#h8-what-afd-help-serverdiscover-and-afd-detail-report).
3. "Use afd-batch for several independent commands and afd-pipe to chain them."
4. With bootstrap tools (TypeScript with `bootstrap: true`; Rust when all three are registered and
   exposed; Python never adds it): "afd-help, afd-docs and afd-schema describe this server."
5. With contexts: "Commands are scoped by context (afd-context-list lists them). Send
   `_meta["dev.afd/context"]` with a context name on tools/list and tools/call to work in that
   context."

## Current differences

TypeScript and Python differ in which tools the individual, grouped and lazy strategies list. Both
are conforming until [#533](https://github.com/lushly-dev/afd/issues/533) decides the alignment;
Rust follows TypeScript.

| Difference | TypeScript, Rust | Python |
| --- | --- | --- |
| Meta-tools listed by `individual` | `afd-batch`, `afd-pipe`, `afd-call` | All five, `afd-discover` and `afd-detail` first |
| Meta-tools listed by `grouped` | `afd-batch`, `afd-pipe`, `afd-call`, `afd-detail` | All five, `afd-discover` and `afd-detail` first |
| Meta-tool order | Varies by strategy | Always `afd-discover`, `afd-detail`, `afd-batch`, `afd-pipe`, `afd-call` |
| `lazy` lists context and bootstrap tools | No | Yes, filtered by context |
| `grouped` order and shape | Groups in order of first command; `_meta.actions`; inlined schemas when small | Bootstrap commands as command tools first; groups and actions sorted by name; no `_meta.actions` |
| Meta-tool definitions | Equal [`meta-tools.json`](./meta-tools.json) | Python's own schemas |
| Default strategy | `grouped` | `individual` |

None of these affects the hybrid strategy, whose list and order are the same in every language.

## Hybrid

A few first-class command tools for a server's hot path, listed after the tools the lazy strategy
uses. The list stays fixed as the command set grows; commands outside the first-class set change
without the client reloading tools; and `afd-call`, `afd-batch` and `afd-pipe` reach every other
command.

### H1. The first-class set is a server option

A hybrid server MUST take its first-class set as an ordered list of command names, an option of the
server. It is not a field of the command definition: whether a command is on the hot path is the
deployer's choice, and the list's order and cap need one owner.

| Language | Option |
| --- | --- |
| TypeScript | `toolStrategy: 'hybrid'` with `firstClassTools: string[]`, on `createMcpServer` and `createMcpHandler` |
| Python | `tool_strategy="hybrid"` with `first_class_tools: list[str]`, on `create_server` and `ServerConfig` |
| Rust | `with_tool_strategy(ToolStrategy::Hybrid)` with `with_first_class_tools(...)`. `ToolStrategy` is `Copy`, so the variant carries no list. `McpServer` registers commands and contexts after the strategy is chosen, so it checks the set when it starts: `McpServer::validate`, called by `serve_stdio` and `try_streamable_http_service` (`streamable_http_service` panics), and by every request over another transport, which answers `-32603` with the message |
| C++ | `first_class_tools` on the `afd::mcp_stdio` options, once D2 lands |

A server MUST fail at construction when:

- the first-class set is given with any strategy other than `hybrid`;
- the strategy is `hybrid` and no first-class set is given;
- the strategy is `hybrid` and the first-class set is empty: that is the lazy strategy, and the
  server should be configured as such.

### H2. Validation at construction

A hybrid server MUST check its first-class set when it is constructed and refuse to start, with an
error whose message names the offending entry, when an entry:

| Entry | Why |
| --- | --- |
| Is not a registered command | A listed tool that cannot run breaks the list's contract |
| Names a command whose `expose.mcp` is not `true` | Listing it would reveal a private command ([D4](./error-codes.md#unknown-and-unexposed-commands-d4)) |
| Is a meta-tool name or a context tool name | Those tools are already listed |
| Appears more than once | Each tool is listed once; the error names the repeated entry |
| Is beyond the cap of 8 ([H5](#h5-a-cap-of-8)) | The error names the first entry beyond the cap |

Where the language's builder registers commands or contexts after the strategy is chosen (Rust's
`McpServer` builder and shared registry), the check MAY run when the server starts serving, but
MUST run before it answers any request.

A bootstrap tool (`afd-help`, `afd-docs`, `afd-schema`) MAY be first-class where the server
registers and exposes it.

The first-class set MUST NOT change while the server runs. A server whose command set can change at
runtime MUST re-check the set on each change, and MUST refuse a change that would remove or unexpose
a first-class command. Commands outside the set can be added or removed freely.

### H3. The tool list and its order

A hybrid `tools/list` MUST be, in this order:

1. `afd-discover`, `afd-detail`, `afd-call`, `afd-batch`, `afd-pipe`;
2. when contexts are configured, `afd-context-list`, `afd-context-enter`, `afd-context-exit`;
3. the first-class command tools, in the configured order.

Nothing else is listed. A bootstrap tool is listed only when it is first-class; otherwise
`afd-discover` reports it and `afd-call` runs it.

The fixed part comes first so that it is the same on every hybrid server and survives a change to
the first-class set: a client that caches its prompt by prefix reuses the whole fixed block, and a
change to the set invalidates only the tail.

Each first-class tool MUST equal the command tool the individual strategy would list for that
command on the same server: `name`, `description`, `inputSchema` (with `confirm` where
[Confirmations](./command-metadata.md#confirmations) adds it), `annotations`, the top-level
`outputSchema` where the server advertises it, and `_meta`. Each meta-tool and context tool MUST
equal the tool of the same name that the server lists under the lazy strategy, or under the
individual strategy for context tools; in TypeScript and Rust the meta-tools equal
[`meta-tools.json`](./meta-tools.json).

### H4. Contexts: a fixed list, scoped calls

A hybrid `tools/list` MUST NOT vary by the active context. A first-class command outside the active
context stays listed, and a call to it MUST answer `COMMAND_NOT_IN_CONTEXT` with the suggestion
"Use afd-context-list to see available contexts, or afd-context-enter to switch.", as a call
through `afd-call` does. `afd-discover` and `afd-detail` keep filtering by context.

This differs from the individual and grouped strategies on purpose: a list that depends only on the
server's configuration can be cached ([H6](#h6-cache-hints-and-listchanged)).

`afd validate` SHOULD warn when a first-class command declares `contexts`: it is listed everywhere
but callable only in its contexts.

### H5. A cap of 8

A hybrid server MUST refuse more than 8 first-class tools. The cap is a constant of this spec, not
an option: a deployment that wants more command tools listed wants the individual or grouped
strategy. With the 5 meta-tools and 3 context tools, a hybrid list holds at most 16 tools. Raising
the cap later is a minor contract change.

### H6. Cache hints and `listChanged`

| Field | Rule |
| --- | --- |
| `ttlMs` | `toolsListTtlMs` when set; otherwise 300,000, whether or not contexts are configured, because the list does not vary by context ([H4](#h4-contexts-a-fixed-list-scoped-calls)) |
| `cacheScope` | `public` |
| `server/discover` | The same hints as `tools/list` |
| `capabilities.tools.listChanged` | `false`. A hybrid server MUST NOT send `notifications/tools/list_changed`: its list cannot change while it runs ([H2](#h2-validation-at-construction)) |

Adding, removing or changing a command outside the first-class set changes what `afd-discover`,
`afd-detail` and `afd-call` see on the next call, and nothing in `tools/list`. A change to the
first-class set is a restart, which a client sees when its cached list expires.

### H7. Calls, confirmations, approvals and errors

A call through a first-class tool MUST behave exactly as the same call through the individual
strategy, and a call through a meta-tool exactly as under the lazy strategy.

| Concern | Rule |
| --- | --- |
| Exposure | Only exposed commands are first-class (H2), so D4 is unchanged: an unknown or private name answers `COMMAND_NOT_FOUND`, identically |
| Unlisted commands by name | A `tools/call` naming an exposed command that is not first-class MUST run it ([Routing](#routing)) |
| Contexts | `COMMAND_NOT_IN_CONTEXT`, with the suggestion above; both tools it names are listed when contexts are configured (H3) |
| Confirmations | First-class tools take the individual tools' `confirm` boolean, `afd-call` its `confirm` boolean, and `afd-batch` and `afd-pipe` the `confirm` array; elicitation as for every strategy |
| Approvals | A first-class tool is a call to a single command for [Asking the human over MCP](./command-metadata.md#asking-the-human-over-mcp); `afd-batch` and `afd-pipe` steps still fall back to `APPROVAL_REQUIRED` without asking |
| Unknown-command suggestion | Ends "Use afd-discover to list all commands.", which holds because `afd-discover` is always listed |
| Error codes | None new. Configuration mistakes are construction errors, not `CommandResult`s |

### H8. What `afd-help`, `server/discover` and `afd-detail` report

- **`afd-help`** reports, on every strategy, a top-level `toolStrategy`: `individual`, `grouped`,
  `lazy` or `hybrid`. On a hybrid server it also reports `firstClassTools`, the first-class names in
  list order, and each `commands` entry for a first-class command carries `firstClass: true`. Both
  are omitted on other strategies, and `firstClass` is omitted for other commands
  ([Reporting rules](./command-metadata.md#reporting-rules)). An `afd-help` that is not served by an
  MCP server (for example run in-process) omits all three, unless an in-process tool surface serves
  it (TypeScript's `createDirectToolSurface({ bootstrap: true })`), which reports its strategy as a
  server does.
- **`server/discover` instructions** for `hybrid` MUST say that the listed command tools are the
  common ones and that `afd-discover`, `afd-detail` and `afd-call` reach every other command. The
  default sentence is: "The command tools listed are the common ones. Call afd-discover to find
  others, afd-detail for a schema, and afd-call to run one."
- **`afd-discover` and `afd-detail`** do not change: whether a command is first-class is a property
  of the list, which the agent already has.

## Conformance

[`tool-strategies.json`](./tool-strategies.json) pins the hybrid strategy. It is written by hand
from this page, before any implementation served the strategy; each language's hybrid step adds
its loader. It covers only the hybrid strategy, because the other strategies' lists differ between
languages until [#533](https://github.com/lushly-dev/afd/issues/533) is decided.

It sits beside [`meta-tools.json`](./meta-tools.json) rather than in [`vectors/`](./vectors/README.md)
because `alfred parity` requires every file in `vectors/` to be loaded by all four languages. It
moves to `vectors/` in the pull request that makes the fourth language load it (C++, after parity
D2).

Build every server from the file's `commands` and `contexts`:

- Every command takes an object input with no required properties and succeeds with its input as
  data. `expose.mcp` is the only exposure that matters.
- `config.contexts: true` configures both contexts, which registers the three context tools.
  `config.bootstrap: true` registers `afd-help`, `afd-docs` and `afd-schema` (Python always does).
- `config.confirmations` is the confirmation mode; absent means `off`.
- `config.toolsListTtlMs` sets the `ttlMs` option; absent leaves the default.

For each entry in `servers`:

- **`lists`:** a modern-era (MCP 2026-07-28) `tools/list`, with `_meta["dev.afd/context"]` set to
  `context` when it is not `null`, returns exactly `tools`, in that order. Names only are compared;
  [H3](#h3-the-tool-list-and-its-order) also requires each first-class tool to equal the individual
  strategy's tool for the same command on the same server, which each language checks against its
  own individual list.
- **`ttlMs`:** the `ttlMs` of every `tools/list` result.
- **`calls`:** a modern-era `tools/call` of `tool` with `arguments` (absent means `{}`) and the
  context as above, from a client that declares no elicitation capability. The `CommandResult` has
  the expected `success`, and on failure the expected `error.code`. Suggestions are not compared.

Each entry in `constructionFailures` must fail when the server is built, or, where
[H2](#h2-validation-at-construction) allows it, before it answers its first request. When `entry`
is a string, the error message contains it. When `entry` is `null`, the fault is the combination of
options, and only the failure is checked.

The [protocol conformance](./protocol-conformance.md#acceptance-index) index names the tests that
exercise each strategy over a real transport. The 34-case todo conformance suite calls tools by
name, which every strategy serves, so it does not change.

## Implementation status

| Strategy | TypeScript | Python | Rust | C++ |
| --- | --- | --- | --- | --- |
| `individual` | Yes | Yes (the default) | Yes | Todo backend only (#341) |
| `grouped` | Yes (the default) | Yes, see [Current differences](#current-differences) | Yes (the default) | No (#341) |
| `lazy` | Yes | Yes, see [Current differences](#current-differences) | Yes | No (#341) |
| `hybrid` | Yes | Yes (`create_server(tool_strategy="hybrid", first_class_tools=[...])`) | Yes (`McpServer::with_tool_strategy(ToolStrategy::Hybrid)` and `with_first_class_tools`) | Planned |
| `afd-help` `toolStrategy`, `firstClassTools`, `firstClass` | Yes | Yes | Yes | Planned |
| Loads [`tool-strategies.json`](./tool-strategies.json) | Yes (`hybrid-tools.test.ts`) | Yes (`python/tests/test_hybrid_tool_strategy.py`) | Yes (`packages/rust/tests/server_hybrid.rs`) | Planned |

Progress is recorded in the [hybrid tool strategy status](../docs/features/active/hybrid-tool-strategy/STATUS.md).
