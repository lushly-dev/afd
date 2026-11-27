# Command metadata

The canonical fields of a command definition, their types and defaults, and where each one surfaces.
This page belongs to the core of the [contract registry](./registry.md). A field that a profile
acts on (`confirmPrompt` enforcement, `confirmationMode`, `task`, `scopes`, `outputBudget`,
`idempotency`, `expose.apps` and `contexts`) is enforced only by an implementation of that profile;
the sections after [Surfaces](#surfaces) name each one's page. `approval` is the core's: every
implementation holds a command whose policy is not `not-required` unless an approval step admitted
the call ([registry](./registry.md#the-core)). Which fields each language has today is tracked in the
[language parity matrix](../docs/language-parity.md#command-definition).

Names below are the wire (JSON) spelling. Code may use the language's own casing, such as
`confirm_prompt` in Python, Rust and C++, and C++ calls `requires` `prerequisites`. Anything
serialized uses the names below. Python and Rust spell the three trust fields `destructive`,
`confirm_prompt` and `undoable`, and hold `destructive` and `undoable` as optional booleans so that
an unset field stays distinguishable from an explicit `false`.

## Fields

| Field | Type | Default | Where it surfaces |
| --- | --- | --- | --- |
| `name` | string, `domain-action` kebab-case | Required | Every surface |
| `description` | string | Required | Every surface; afd-discover shortens it to its first sentence, at most 120 characters |
| `title` | string, a short human-readable label | None; nothing is derived from the name | The MCP tool `title` of the command's own tool, afd-detail, afd-help (full), `DirectRegistry.listCommands()`. Display text, so never in `_meta` ([Tool titles](#tool-titles)) |
| `category` | string | None; grouping falls back to the name's first segment | `_meta`, afd-detail, afd-discover, afd-help (full), afd-docs headings, grouped tool names, `afd tools` groups |
| Input schema | JSON Schema object (TypeScript: Zod `input`, or core `parameters`) | Required | Tool `inputSchema`, afd-detail, afd-schema, afd-docs parameter table. A command MAY add an advertised schema, shown on those surfaces while the registry validates with this one ([V1](./mcp-tools.md#v1-two-schemas-one-command)) |
| Output schema (`returns`) | JSON Schema of `CommandResult.data` | None | `_meta.outputSchema`, afd-detail `outputSchema` |
| `errors` | string[] of error codes | None | afd-detail |
| `version` | string | None | afd-detail; results carry it as `metadata.commandVersion` |
| `tags` | string[] | None | afd-detail, afd-help (full), afd-docs; afd-discover filters on it |
| `requires` | string[] of command names | None | `_meta`, afd-detail, afd-help (brief and full). Metadata only: not enforced at runtime. On an authorized server, only the commands that exist for the caller ([hidden commands](./authorization.md#hidden-commands)) |
| `mutation` | boolean | `false` | `_meta`, afd-detail, afd-discover (`includeMutation`), afd-help (full), afd-docs |
| `destructive` | boolean | `false` | `_meta`, afd-detail, afd-help (full), afd-docs, `DirectRegistry.listCommands()`, `afd tools`. `afd validate --execute` never calls it |
| `secret` | boolean | `false` | Not reported. The command takes or returns a secret (a password argument, an issued token): a journal never records a call to it unless the recorder also has `redact`, which removes the secret; a `filter` alone never admits it ([journal](./journal.md#entry)) |
| `confirmPrompt` | string | None; a frontend MAY show a generic prompt | afd-detail, afd-docs |
| `undoable` | boolean | `false` | `_meta`, afd-detail, afd-help (full), afd-docs, `DirectRegistry.listCommands()`, `afd tools` |
| `idempotency` | `natural` or `keyed` | None: nothing is claimed about repeating a call | `_meta`, afd-detail and afd-help (full), in TypeScript so far ([idempotency](./idempotency.md#what-a-command-declares)). `natural` sets the MCP annotation `idempotentHint: true`; `keyed` says a repeat is safe with an idempotency key. `afd validate --surface` notes a `mutation` that declares neither |
| `approval` | `required`, `not-required`, or a function of the validated input and context returning one of them | `not-required` | `_meta`, afd-detail, afd-docs, as `required`, `not-required` or `conditional` (a function). `afd validate` warns when a `mutation` or `destructive` command declares none. The approval middleware decides it; without an approval step that admits the call, a server engine refuses a command whose policy is not `not-required` with `APPROVAL_UNAVAILABLE`. See [Approvals](#approvals) |
| `executionTime` | `instant`, `fast`, `slow` or `long-running` | None | afd-detail |
| `handoff` | boolean | `false` | afd-detail; adds the `handoff` tag |
| `handoffProtocol` | `websocket`, `webrtc`, `sse`, `http-stream` or another string | None | afd-detail; adds the `handoff:<protocol>` tag |
| `expose` | `palette`, `agent`, `mcp`, `cli`, `apps` booleans | `palette` and `agent` true, `mcp`, `cli` and `apps` false, per flag | Not reported. It decides which surfaces list and run the command; afd-detail reports the result as `callable`. `apps` lets another app call the command under a host's grant ([App-to-app calls](#app-to-app-calls)) |
| `examples` | `{ title, input }[]` | None | `_meta`, afd-detail, afd-help (full). Each `input` must pass the input schema when the command is defined |
| `contexts` | string[] | None: the command is visible in every context | `_meta`, afd-detail. Calls, afd-discover, afd-detail, the context tools and the individual and grouped tools/list scope on it; the hybrid tools/list does not ([H4](./contexts.md#the-hybrid-strategy)) |
| `toolMeta` | object: `_meta` key to JSON value | None | Merged into the command tool's `_meta`, a grouped action entry and afd-detail (`toolMeta`). Keys follow the [key rule](./mcp-tools.md#t2-the-key-rule): reverse-DNS prefixed keys outside `dev.afd/`, or the MCP Apps key `ui`; anything else is refused at registration ([T1](./mcp-tools.md#t1-extra-entries-on-a-commands-tool)) |
| `scopes` | string[] of OAuth scope names | None: the command needs no scope of its own | `_meta`, afd-detail. Enforced only on authorized HTTP: the scopes a caller's token needs, beside the server's `requiredScopes`. A host `ScopeResolver` may decide each call instead ([Scopes](#scopes)) |
| `confirmationMode` | `host-verified` | None: the server's `confirmations` option applies | `_meta`, afd-detail. Only the host's `HumanRelay` may confirm the command over MCP ([Host-verified confirmation](./confirmations.md#host-verified-confirmation)) |
| `task` | `never`, `optional` or `required` | `never` | `_meta`, afd-detail. Whether an MCP call may run as a task ([Tasks](#tasks)). Refused at registration beside `confirmPrompt`, an `approval` other than `not-required`, or `confirmationMode` |
| `outputBudget` | `{ defaultBytes, maxBytes }`, positive integers, `defaultBytes ≤ maxBytes` | None: the result is not checked | `_meta["dev.afd/outputBudget"]`, afd-detail (`outputBudget`). Callers ask per call in `_meta["dev.afd/outputBudget"]`; an over-budget read becomes `OUTPUT_BUDGET_EXCEEDED`, a mutation keeps its result with a warning ([output budgets](./output-budgets.md)) |

`destructive`, `confirmPrompt` and `undoable` are declarations for frontends and agents. AFD does
not act on `destructive` or `undoable`: an undo mechanism belongs to the consumer. A server MAY
enforce `confirmPrompt` on its MCP surfaces, as [Confirmations](#confirmations) describes; it does
not by default. `approval` is the pre-execution gate: a call it requires is held before the handler
runs, and a server with no approval step refuses it, as [Approvals](#approvals) describes.

## Reporting rules

- **Unset is omitted.** A surface reports a field only when the command sets it, never as `null`.
  Consumers read an absent boolean as its default. An explicit `false` is reported as `false`.
- **Two exceptions:** afd-detail always reports `mutation`, and afd-discover reports it when
  `includeMutation` is set. Both use `false` when it is unset.
- **Empty command-metadata arrays are omitted:** from `_meta` (`requires`, `examples`, `contexts`,
  `scopes`), from afd-detail (those, `tags` and `errors`) and from afd-help (`requires`, and in its
  `full` format `tags` and `examples`).
- **`_meta` carries planning signals, not display text.** It has `destructive` and `undoable` but
  not `confirmPrompt`, which is for a frontend's confirmation dialog. Agents get it from afd-detail.
- **Grouped tools** (`toolStrategy: 'grouped'`) carry the per-command `_meta` fields on each entry
  of `_meta.actions`, not on the tool.
- **Extra entries** (`toolMeta`) sit beside the fields above on the same tool or action entry. The
  key rule keeps them from replacing any of them ([T2](./mcp-tools.md#t2-the-key-rule)).
- **First-class tools** (`toolStrategy: 'hybrid'`) are command tools: each carries `_meta`,
  `annotations` and `outputSchema` exactly as the individual strategy's tool for that command
  ([tool strategies, H3](./tool-strategies.md#h3-the-tool-list-and-its-order)).

## Surfaces

| Surface | Fields |
| --- | --- |
| tools/list `_meta` | `category`, `requires`, `mutation`, `destructive`, `undoable`, `approval`, `examples`, `outputSchema`, `contexts`, `scopes`, `confirmationMode`, `task`, `dev.afd/outputBudget` ([B1](./output-budgets.md#b1-the-declaration)), and the command's `toolMeta` entries |
| tools/list `title` | `title`, on a command's own tool (individual, and first-class under hybrid); the meta-tools carry fixed titles |
| afd-detail | `name`, `title`, `description`, `category`, `tags`, `mutation`, `executionTime`, `errors`, `inputSchema` (the advertised schema), `outputSchema`, `destructive`, `confirmPrompt`, `undoable`, `approval`, `handoff`, `handoffProtocol`, `version`, `callable`, `requires`, `examples`, `contexts`, `toolMeta`, `outputBudget`, `scopes`, `confirmationMode`, `task` |
| afd-discover | `name`, `description`, `category`, and `mutation` with `includeMutation` |
| afd-help | `name`, `description`, `requires`; the `full` format adds `title`, `category`, `tags`, `mutation`, `destructive`, `undoable`, `examples`. On a hybrid server, `firstClass: true` for a first-class command, in both formats; next to `commands`, the server's `toolStrategy` and, on a hybrid server, `firstClassTools` ([H8](./tool-strategies.md#h8-what-afd-help-serverdiscover-and-afd-detail-report)) |
| afd-docs | `category`, `name`, `description`, `tags`, `mutation`, `destructive`, `confirmPrompt`, `undoable`, `approval`, parameters |
| afd-schema | `name`, `description`, `inputSchema` |

## Confirmations

A server MAY enforce `confirmPrompt`. The rules are the `confirmations` profile's: [confirmations](./confirmations.md).

<a id="host-verified-confirmation"></a>Host-verified confirmation: [confirmations](./confirmations.md#host-verified-confirmation),
with <a id="the-pending-list"></a>[the pending list](./confirmations.md#the-pending-list).

## Approvals

Every implementation holds a command whose `approval` policy is not `not-required` unless an
approval step admitted the call, and refuses it with `APPROVAL_UNAVAILABLE` otherwise
([dispatch](./dispatch.md#middleware-approval-admission-and-exceptions), rule 9). The approval step
itself, asking a person and issuing tokens, is the `approvals` profile's: [approvals](./approvals.md).
The sections that were here are there:
<a id="private-in-process-approval-exchange"></a>[private in-process approval exchange](./approvals.md#private-in-process-approval-exchange),
<a id="asking-the-human-over-mcp"></a>[asking the human over MCP](./approvals.md#asking-the-human-over-mcp),
<a id="one-approval-up-front-for-afd-batch-and-afd-pipe"></a>[one approval up front](./approvals.md#one-approval-up-front-for-afd-batch-and-afd-pipe),
<a id="relay-evidence"></a>[relay evidence](./approvals.md#relay-evidence),
<a id="approval-evidence-from-an-approver-client"></a>[approval evidence from an approver client](./approvals.md#approval-evidence-from-an-approver-client),
<a id="the-approval-summary"></a>[the approval summary](./approvals.md#the-approval-summary) and
<a id="approval-display"></a>[approval display](./approvals.md#approval-display).

## Tasks

Whether a call to the command may run as an MCP task is the `tasks` profile's: [tasks](./tasks.md).

## Scopes

The OAuth scopes a call needs are the `authorization` profile's: [the command's `scopes` field](./authorization.md#the-commands-scopes-field).

## App-to-app calls

Calls from one app to another's command are the `app-calls` profile's: [app-to-app calls](./app-calls.md).

## Decisions on the tool surface (#466)

Phase 5 of the MCP 2026-07-28 plan deferred three items. The owner decided them on 2026-10-31:

1. **Tool `title`: adopted.** An optional `title` field (above), reported as described in
   [Tool titles](#tool-titles).
2. **A request-values argument on the meta-tools: adopted as one `meta` object.** `afd-call`,
   `afd-batch`, `afd-pipe`, `afd-discover` and `afd-detail` take an optional `meta` argument whose
   keys are `dev.afd/context` and the declared context fields' `_meta` keys
   ([`context-fields.md`](./context-fields.md#clients-that-cannot-set-_meta)), applied as if sent
   in `_meta`, for clients that cannot set `_meta`. Only `dev.afd/context` has an effect on
   `afd-discover` and `afd-detail`. A key sent both ways must agree, or the call fails with
   `VALIDATION_ERROR`. [`context-fields.md`](./context-fields.md#clients-that-cannot-set-_meta)
   gives the rules; TypeScript, Python and Rust implement it, and C++'s `afd::mcp_stdio` lifts
   `dev.afd/context` only (it reads no declared context fields from `_meta`).
3. **`x-mcp-header: "Afd-Command"` on `afd-call.command`: not adopted.** A server that declares it
   makes clients mirror the value into an `Mcp-Param-Afd-Command` header and rejects a call whose
   header is missing or differs, so a client without support could no longer use `afd-call`; client
   support has not been verified. Gateways already route every command tool by `Mcp-Name`; only
   calls through the meta-tools are opaque to them. The same answer covers declared context fields:
   they are read from `_meta` only, never mirrored into headers. Revisit when a gateway needs
   per-command routing through `afd-call` and the clients AFD supports mirror `x-mcp-header`.

## MCP tool fields (MCP 2026-07-28 tool surface)

An MCP tool for a command also carries standard MCP fields, derived from the metadata above. They
complement `_meta`, which stays unchanged, so clients that only read `_meta` see no difference.

### Annotations

MCP's annotation defaults differ from AFD's: MCP assumes a tool that is not read-only may be
destructive. AFD therefore reports an annotation only from a field the command sets, never from a
default:

| Command | `annotations` |
| --- | --- |
| `mutation: false` set explicitly | `readOnlyHint: true` |
| `mutation: true` | `readOnlyHint: false`, `destructiveHint: <destructive, false when unset>` |
| `mutation` unset | none (`destructive` alone is reported only in `_meta`) |

`openWorldHint` is not derived. `idempotentHint: true` is reported only for a command that
declares `idempotency: "natural"` ([idempotency, D2](./idempotency.md#what-a-command-declares)),
which no language implements yet, so today it is never reported. Annotations are hints for clients
and are never enforced. Grouped and meta-tools carry no annotations, because one tool covers several
commands; their per-command metadata stays in `_meta.actions`. The hybrid strategy's first-class
tools are command tools and carry annotations as individual tools do.

### Tool titles

A command's own tool (the individual strategy's, and a first-class tool under hybrid) carries the
command's `title` as the MCP tool `title`, a display label for clients. A command without `title`
gets none: the name is not turned into one, so adding the field changes no existing tool list. A
grouped tool has no title, as one tool covers several commands. The five meta-tools carry the fixed
titles in [`meta-tools.json`](./meta-tools.json), which every implementation lists.

`annotations.title` is not set: the tool's top-level `title` takes precedence in MCP.

### Structured results

- **`structuredContent`:** a `tools/call` result for a command carries the whole `CommandResult` as
  `structuredContent`, and the same JSON as text in `content[0]` for clients that only read text.
- **`outputSchema`:** a command with an output schema (`returns`), listed as its own tool
  (the individual strategy, or first-class in the hybrid strategy), advertises a top-level
  `outputSchema` that describes the `CommandResult`
  envelope ([`spec/schema/output-envelope.json`](./schema/output-envelope.json); full result schema
  in [`spec/schema/README.md`](./schema/README.md)), with `data` typed by the command's output
  schema and `error` typed with `code`, `message`, `suggestion` and `retryable`:

  ```json
  {
    "type": "object",
    "properties": {
      "success": { "type": "boolean" },
      "data": "<the command's output schema>",
      "error": {
        "type": "object",
        "properties": {
          "code": { "type": "string" },
          "message": { "type": "string" },
          "suggestion": { "type": "string" },
          "retryable": { "type": "boolean" }
        },
        "required": ["code", "message"]
      },
      "metadata": { "type": "object" }
    },
    "required": ["success"]
  }
  ```

  Clients validate `structuredContent` against it, so a handler whose `data` does not match its
  declared output schema fails on the client. To preserve local references, an output schema that
  starts a schema resource (a string `$id` that is not a bare fragment, the test of
  [`validation.md`](./validation.md#annotations)) keeps its `$id`, `$defs` and `definitions` inside
  `data`. Any other output schema moves `$defs` and `definitions` to the envelope's root, and each
  `"$ref": "#"` in it that named its root, outside a nested schema resource and in a schema
  position (not inside `const`, `enum`, `default` or `examples`), becomes
  `"#/properties/data"`, since `#` now names the envelope.
  [`vectors/output-schema.json`](./vectors/output-schema.json) holds the envelope each language
  builds. A server MAY switch the top-level
  `outputSchema` off; `_meta.outputSchema` (the schema of `data` alone) is always reported.

### Implementation status

Python's, Rust's and C++'s `mutation` is a plain boolean with no unset state, so they report
annotations only for `mutation: true` and never claim `readOnlyHint: true`. `destructiveHint`
follows `destructive`, `false` when it is unset.

<!-- generated:capabilities:spec.command-metadata.tool-fields:start -->
|  | TypeScript | Python | Rust | C++ |
| --- | --- | --- | --- | --- |
| Tool `title` | Yes | Yes | Yes | Yes (`title` on `CommandDefinition`; `afd::mcp_stdio` tool lists) |
| Annotations | Yes | Yes (`mutation: true` only, with `destructive`; [#1741](https://github.com/lushly-dev/afd/issues/1741)) | Yes (`mutation: true` only, with `destructive`, from `CommandRegistry::get_tool`; [#1741](https://github.com/lushly-dev/afd/issues/1741)) | Yes (`mutation: true` only, with `destructive`; [#1741](https://github.com/lushly-dev/afd/issues/1741)) |
| Confirmations | Yes (`confirmations`, `confirmationKey`; client `onElicitation`, CLI prompt) | Yes (`create_server(confirmations=..., confirmation_key=...)`; individual, grouped and meta-tools) | Yes (`McpServer::with_confirmations`, `with_confirmations_key`; individual, grouped and meta-tools) | Yes (`StdioServerOptions::confirmations` on `afd::mcp_stdio`: individual, grouped, `afd-call`, `afd-batch` and `afd-pipe` in both eras) |
| `structuredContent` | Yes | Yes (every tool result of every route, meta-tools, batch and pipeline included) | Yes (`McpServer`, every tool result of every route, meta-tools, batch and pipeline included) | Yes (`afd::mcp_stdio`, every tool result; the todo backend runs on it) |
| Top-level `outputSchema` | Yes (`advertiseOutputSchema`) | Yes, for commands with `returns` listed as their own tool, individual or first-class under hybrid (`create_server(advertise_output_schema=False)` opts out); the envelope does not require a property that accepts `null`, because Python's wire format omits model fields set to `None` | Yes, for commands with `returns` listed as their own tool, individual or first-class under hybrid (`McpServer::with_advertise_output_schema`) | Yes, for commands with `output_schema` (`StdioServerOptions::advertise_output_schema`) |
| `toolMeta` and the advertised schema ([`mcp-resources.md`](./mcp-resources.md)) | Yes (`toolMeta`, `advertisedInputSchema`) | Yes (`tool_meta`, `advertised_input_schema`; #1981) | Yes (`with_tool_meta`, `register_with_schemas`) | Yes (`CommandDefinition::tool_meta`, `advertised_input_schema`; #1983) |
| `outputBudget` and the check after the handler ([`output-budgets.md`](./output-budgets.md)) | Yes (`outputBudget`, #1989) | Yes ([#1990](https://github.com/lushly-dev/afd/issues/1990), #2186) | Yes (Umbel phase 2 step 0b) | Yes ([#1991](https://github.com/lushly-dev/afd/issues/1991), #2187) |
| Hybrid first-class tools: command tools with these fields, `confirm` and the single-command approval relay ([tool strategies](./tool-strategies.md#hybrid)) | Yes | Yes | Yes | Yes |
| `scopes` and its surfaces ([Scopes](./authorization.md#the-commands-scopes-field)) | Yes (#1050: `defineCommand({ scopes })`, in `_meta`, grouped `_meta.actions` and `afd-detail`; enforced with `auth`) | Yes ([#2155](https://github.com/lushly-dev/afd/issues/2155): `scopes` on `CommandDefinition`, `@define_command` and `@server.command`, checked at registration, in `_meta`, grouped `_meta.actions`, `afd-detail` and `afd-help`; enforced with `auth`) | Yes (Umbel phase 5 step 0b: `CommandDefinition::with_scopes`, checked at registration, in `_meta`, grouped `_meta.actions` and `afd-detail`; enforced with `server-auth`) | N/A: no HTTP server |
| Confirmation state bound to the principal ([#532](https://github.com/lushly-dev/afd/issues/532)) | Yes (Umbel phase 5 step 0c): confirmation and approval-relay state, the actor (`createContext`'s or the `actor` option) and `createContext`'s `credentials`, in the state's HMAC bind tag; `principalBinding` | Yes (step 0c, [#800](https://github.com/lushly-dev/afd/issues/800), [#2154](https://github.com/lushly-dev/afd/issues/2154)): the hook's actor (or server `actor`) and verified credentials (AFD `auth` or SDK token), through the SDK's `bind_principal`; a mismatch is `-32602` as tampering is | Yes (step 0c): the hook's actor and `CommandContext::credentials`, in the state's HMAC associated data; since step 0d the same state carries the form-mode approval relay's answers | Partial: `afd::mcp_stdio` signs `requestState` (HMAC) bound to command, input and actor; stdio carries no HTTP credentials |
| `confirmationMode: "host-verified"` and `HumanRelay` ([Host-verified confirmation](./confirmations.md#host-verified-confirmation)) | Yes ([#2263](https://github.com/lushly-dev/afd/issues/2263): `confirmationMode: 'host-verified'`, `createMcpServer({ humanRelay })`, `inputDigest`) | Yes ([#2264](https://github.com/lushly-dev/afd/issues/2264): `confirmation_mode="host-verified"`, `create_server(..., human_relay=...)`, `input_digest`) | Yes (Umbel phase 5 step 0d: `CommandDefinition::with_confirmation_mode(CommandConfirmationMode::HostVerified)`, `McpServer::with_human_relay`, `afd::input_digest`) | N/A: `afd::mcp_stdio` has no `HumanRelay` |
| `task`, `TaskStore` and the `tasks/*` handlers ([Tasks](./tasks.md)) | Yes ([#1971](https://github.com/lushly-dev/afd/issues/1971): `TaskSupport`, `TaskStore`, `InMemoryTaskStore` (32/owner, 256 total), `taskStore`/`taskOptions`, `CommandContext.reportProgress`, `McpClient({ tasks: true })`; `tasks.test.ts`, `tasks-client.test.ts`, todo `--suite tasks`) | Yes ([#1972](https://github.com/lushly-dev/afd/issues/1972): `TaskSupport`, `TaskStore`, `InMemoryTaskStore` (32/owner, 256 total), `task_store`/`task_options`, `CommandContext.report_progress`/`cancel`, `McpClient(McpClientConfig(tasks=True))`; `test_tasks.py`, `test_tasks_client.py`, todo `--suite tasks`) | Yes (Umbel phase 5 step 0e: `CommandDefinition::with_task(TaskSupport)`, `afd::server::tasks` (`TaskStore`, `InMemoryTaskStore` 32/owner, 256 total), `with_task_store`/`with_task_options`, `report_progress` and `cancellation`; `tests/server_tasks.rs`, todo `--suite tasks`) | N/A: not planned for C++ ([MCP Tasks proposal](../docs/features/complete/mcp-tasks/mcp-tasks.proposal.md)) |
<!-- generated:capabilities:spec.command-metadata.tool-fields:end -->

