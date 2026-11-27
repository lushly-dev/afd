# Error codes

Every `CommandError.code` an AFD engine emits: what it means, whether it is retryable, and which
layer emits it. It also fixes how an engine answers a call to an unknown or unexposed command
(decision D4 of the [parity closure plan](../docs/features/complete/parity-closure/parity-closure.plan.md)).
Which codes each language defines today is tracked in the
[language parity matrix](../docs/language-parity.md).

The codes fall into four groups:

- **The core catalog (33 codes).** Codes every AFD core implementation shares (validation,
  resources, application auth, rate limiting, network/service, internal, commands, routing/access,
  and batch/pipeline).
- **Profile catalogs (20 codes).** Codes belonging to optional contract profiles (`contexts`,
  `streaming`, `confirmations`, `approvals`, `output-budgets`, `authorization`, `tasks`,
  `app-calls`, `idempotency`). Together with the core catalog, these form the 53-code shared catalog in
  [`vectors/error-codes.json`](./vectors/error-codes.json). Each entry carries
  `{ "code", "retryable", "profile" }`, where `retryable` is `true`, `false` or `"varies"` and
  `profile` is `"core"` or one of the profile names above. Every language defines all 53 constants
  in catalog order (`TypeScript` `ErrorCodes`, `Python` `ErrorCodes`, `Rust` `error_codes`, `C++`
  `error_codes`) together with their metadata (`ERROR_CODE_CATALOG` / `error_code_catalog`), and
  each language's test suite checks `code`, `retryable` and `profile` against that file.
- **Host-defined codes (`HOST_` prefix).** Codes defined by a host running on top of AFD, using the
  reserved `HOST_` prefix (see [Host-defined error codes](#host-defined-error-codes)).
- **Transport-specific and package codes.** Codes that belong to one transport (the HTTP layer or
  an MCP client) or an optional package such as auth or view-state. They are listed here so an
  agent can interpret them, but they are not in the shared catalog.

## Reading the tables

**Retryable** is the value the TypeScript reference sets on `CommandError.retryable`:

- **Yes:** the engine sets `retryable: true`. Every implementation sets it.
- **No:** the engine sets `retryable: false` or leaves it unset. A consumer reads an unset field as
  not retryable, so an implementation may set `false` where TypeScript leaves it unset.
- **Varies:** it depends on the emitting site, as the meaning column explains.

For the codes that applications emit rather than the engine, the column is the recommended value,
which the core helpers (`rateLimitError()`, `timeoutError()` and so on) use.

**Layers:**

| Layer | TypeScript | What it covers |
| --- | --- | --- |
| Core executors | `@lushly-dev/afd-core` | The core registry, `executeBatch`, `executePipeline`, `executeStream`, `consumeStream`, the error helpers and request validation |
| Server engine | `packages/server` `execution.ts`, `direct-registry.ts` | Single-command dispatch: lookup, exposure, context and input validation; `createDirectRegistry` |
| Router | `packages/server` `tool-router.ts`, `bootstrap/` | The meta-tools (`afd-call`, `afd-batch`, `afd-pipe`, `afd-discover`, `afd-detail`), grouped tools and the context tools |
| Middleware | `packages/server` `middleware.ts`, `approval.ts` | The built-in rate-limit, telemetry and approval middleware |
| HTTP layer | `packages/server` `http-handler.ts` | The legacy HTTP routes, `/sse` and `/stream` |
| Client | `packages/client` `McpClient` | Results the client builds for a failed request or stream |
| DirectClient | `packages/client` `DirectClient` | In-process calls with no transport |
| Application | — | Commands and host code, usually through the core helpers |

## Unknown and unexposed commands (D4)

An agent must not learn over the network that a private command exists, and an in-process caller
should be told why a call is refused. The answer depends on who is calling.

| Caller | Unknown command | Command registered but not exposed to the caller |
| --- | --- | --- |
| **Remote MCP:** tools/call, `afd-call`, `afd-batch`, `afd-pipe`, grouped tools, the HTTP routes | `COMMAND_NOT_FOUND` | `COMMAND_NOT_FOUND`, identical to an unknown command |
| **In-process registry called with an interface** (TypeScript `context.interface`, Python `context.extra["interface"]`, Rust `context.interface`, C++ `context.surface`) | `COMMAND_NOT_FOUND` | `COMMAND_NOT_EXPOSED`, `retryable: false` |
| **In-process registry called with no interface** | `COMMAND_NOT_FOUND` | Runs: a trusted in-process caller is not checked |
| **In-process registry called with the `apps` interface** (an app's call, made by a host) | `CALL_NOT_GRANTED` | `CALL_NOT_GRANTED`, identical, and so is an exposed command the caller is not granted ([App-to-app calls](./command-metadata.md#app-to-app-calls)) |
| **DirectClient** | `UNKNOWN_TOOL`, `retryable: false`, always with a `suggestion` | `UNKNOWN_TOOL`, the same answer |

Rules:

1. **Remote callers cannot tell the two apart.** The code, message and suggestion for a private
   command are the ones an unknown name gets. TypeScript does this by giving the remote engine a
   command map that holds only the MCP-exposed commands. The same holds for a command an
   authorized server's resolver hides from the caller
   ([hidden commands](./authorization.md#hidden-commands)): on every route it gets an unknown
   name's answer, byte for byte, whatever its input.
2. **Lookup comes first.** An unknown command is `COMMAND_NOT_FOUND` whatever the interface but
   `apps`, whose one refusal comes before lookup. A
   command hidden from an authorized caller is unknown at lookup. The exposure check, then the
   context check, then input validation follow.
3. **An empty interface is no interface.** An interface that names no surface (anything other than
   `palette`, `mcp`, `agent`, `cli` or `apps`) exposes nothing, so the command is
   `COMMAND_NOT_EXPOSED`.
   Python's former `INVALID_INTERFACE` code is gone.
4. **Close matches never include a hidden command.** `COMMAND_NOT_FOUND` and `UNKNOWN_TOOL`
   suggestions offer at most three close matches from the names the caller can call, and never echo
   the requested name, which is untrusted.
5. **`UNKNOWN_TOOL` carries the structured `UnknownToolError` as its `data`** (`requested_tool`,
   `available_tools`, `suggestions`, `hint`). Its `suggestion` is the hint ("Did you mean 'x'?"),
   or, with no close match, where to find valid names: the client's `listCommandNames()`
   (`list_command_names()` in Python and C++).

All four implementations follow these rules. A Python MCP server answers a tools/call for a name it
does not list with a `COMMAND_NOT_FOUND` result (formerly FastMCP's plain "Unknown tool" text,
fixed for [#325](https://github.com/lushly-dev/afd/issues/325)). Rust's MCP server (`server`
feature) answers `COMMAND_NOT_FOUND` for both cases in every tool strategy; its `DirectClient` calls
the registry with the `agent` interface, so it answers `COMMAND_NOT_FOUND` and
`COMMAND_NOT_EXPOSED` rather than `UNKNOWN_TOOL`.

### Suggestions name only tools the host provides

A suggestion names `afd-discover`, `afd-detail`, `afd-help` or `afd-context-*` only where the caller
can call that tool on this surface: it is registered or served, exposed to the caller's interface,
allowed in the active context, admitted by any `allow` list and visible under the server's
authorization. The error's `recovery` follows the same decision
([engine errors](./recovery.md#engine-errors)), so the prose and the structure never disagree.
"Check the command name against the available commands." is the unknown-command ending where the
caller can call neither discovery tool; "Switch to a context this command belongs to ('planning'), or
call it with no active context." is the `COMMAND_NOT_IN_CONTEXT` text where it cannot call
`afd-context-list`.

| Implementation | Unknown-command suggestion ends with | `COMMAND_NOT_IN_CONTEXT` suggestion |
| --- | --- | --- |
| TypeScript server | Over MCP, "Use afd-discover to list all commands." (the router serves `afd-discover` in every tool strategy). In process (`server.execute`), "Use afd-help to list all commands." when the caller can call `afd-help`, otherwise the "Check the command name" ending | "Use afd-context-list to see available contexts, or afd-context-enter to switch." when the caller can call `afd-context-list`, without the second clause when it cannot call `afd-context-enter`; otherwise the contexts text |
| TypeScript direct registry (`createDirectRegistry`) | As the TypeScript server over MCP with a tool surface (`tools: createDirectToolSurface()`), which serves `afd-discover`; otherwise as `server.execute` | As the TypeScript server, whether the context commands come from a tool surface or are registered as plain commands |
| TypeScript core registry | "Use 'afd tools' to see available commands" (the CLI) | Not emitted |
| Rust registry | "Use afd-help to list all commands." when the caller can call `afd-help`, otherwise the "Check the command name" ending; calls from the MCP server (`server` feature, which serves `afd-discover` in every strategy) end as TypeScript's over MCP | As TypeScript |
| C++ registry | As Rust, a DirectClient's `allow` list included | As Rust |
| Python server | As the TypeScript server over MCP. In process, `server.execute` also runs the meta-tools outside the `apps` interface, so it ends as over MCP unless an `allow` list refuses `afd-discover`; the `apps` interface, and such an `allow` list, end as TypeScript's `server.execute` | As TypeScript |
| Python core registry | "Use afd-help to list all commands." when the caller can call `afd-help`, otherwise "List available commands to see valid options" | As TypeScript |

A hybrid server ([tool strategies](./tool-strategies.md#hybrid)) always lists `afd-discover`, and
lists `afd-context-list` and `afd-context-enter` whenever it has contexts, so both server
suggestions above hold on it unchanged, including for a first-class tool called outside its
context. The hybrid strategy adds no error code: its configuration mistakes fail the server's
construction ([H2](./tool-strategies.md#h2-validation-at-construction)), so
[`vectors/error-codes.json`](./vectors/error-codes.json) does not change.

## The shared catalog

53 codes in [`vectors/error-codes.json`](./vectors/error-codes.json): **33 core codes** (`profile: "core"`)
and **20 profile codes** across nine optional profiles (`contexts`, `streaming`, `confirmations`,
`approvals`, `output-budgets`, `authorization`, `tasks`, `app-calls`, `idempotency`).

### Core catalog (`profile: "core"`)

#### Validation

| Code | Meaning | Retryable | Layers |
| --- | --- | --- | --- |
| `VALIDATION_ERROR` | The input failed validation: the command's input schema, a meta-tool's arguments, a pipeline input nested deeper than 64 levels or exceeding variable expansion limits, or a bad stream timeout. Schema failures carry `details.errors`, `expectedFields`, `unexpectedFields` and `missingFields` | No | Server engine, router, core executors, DirectClient (`validateInputs`), application |
| `INVALID_INPUT` | The input is malformed in a way a schema does not describe. The client also maps JSON-RPC `-32602` to it | No | Application, client |
| `MISSING_REQUIRED_FIELD` | A required field is missing | No | Application |
| `INVALID_FORMAT` | A field has the wrong format | No | Application |

#### Resources

| Code | Meaning | Retryable | Layers |
| --- | --- | --- | --- |
| `NOT_FOUND` | A resource the command needs does not exist (`notFoundError()`) | No | Application |
| `ALREADY_EXISTS` | The resource to create already exists | No | Application |
| `CONFLICT` | The change conflicts with the resource's current state | No | Application |

#### Authorization

| Code | Meaning | Retryable | Layers |
| --- | --- | --- | --- |
| `UNAUTHORIZED` | The caller is not signed in. Also a call to a command that runs only as a task on a server that cannot tell its HTTP callers apart ([Tasks](./command-metadata.md#tasks)): the suggestion says the server needs authorization or a hook that identifies callers | No | Application; the auth package's middleware; server engine (Tasks) |
| `FORBIDDEN` | The caller is signed in but not allowed | No | Application |
| `TOKEN_EXPIRED` | The caller's session expired; sign in or refresh first | No | Application; the auth package |

#### Rate limiting

| Code | Meaning | Retryable | Layers |
| --- | --- | --- | --- |
| `RATE_LIMITED` | Too many requests in the window, or the rate limiter's client capacity is full. The suggestion says how long to wait when it is known | Yes | Middleware, application (`rateLimitError()`) |
| `QUOTA_EXCEEDED` | A quota is used up; waiting a moment does not help | No | Application |

#### Network and service

| Code | Meaning | Retryable | Layers |
| --- | --- | --- | --- |
| `SERVICE_UNAVAILABLE` | A service the command depends on is down | Yes | Application |
| `TIMEOUT` | An operation ran out of time: a DirectClient or TypeScript server engine call past `context.timeout`, a client request, a Rust registry call past `timeout_ms`, or `timeoutError()`. The command may still have run | Yes | DirectClient, TypeScript server engine, client, core executors (Rust registry), application |
| `CONNECTION_ERROR` | The request could not reach the server, or failed on the way. It may have reached the server | Yes | Client |

#### Internal

| Code | Meaning | Retryable | Layers |
| --- | --- | --- | --- |
| `INTERNAL_ERROR` | Something failed inside the engine or the command. `internalError()` and TypeScript, Python, and C++ `wrapError()`/`wrap_error()` set `retryable: true`; Rust `wrap_error()` returns a generic message with `retryable: false` and drops the raw `Display` text; Rust's runtime `ServerInstances::Multiple` approval-state guard sets `retryable: false`; the pipeline's failure to resolve a step's references leaves it unset; the client maps JSON-RPC `-32603` to it as retryable; the Rust MCP server answers a panic in its own request handling (not a handler's, which is `COMMAND_EXECUTION_ERROR`) with a generic message and `retryable: true` | Varies | Core executors, client, application |
| `NOT_IMPLEMENTED` | The command or option exists but is not implemented | No | Application |
| `UNKNOWN_ERROR` | A thrown value that is not an `Error` (`wrapError()`) | Yes | Core executors |

#### Commands

| Code | Meaning | Retryable | Layers |
| --- | --- | --- | --- |
| `COMMAND_NOT_FOUND` | No such command, or (remotely) one the caller may not see; see [D4](#unknown-and-unexposed-commands-d4). Also the `error` of an `afd-detail` entry with `found: false` | No | Core executors, server engine, router |
| `INVALID_COMMAND_ARGS` | The arguments do not fit the command, outside schema validation | No | Application |
| `COMMAND_CANCELLED` | The caller cancelled the command, or cancelled batch/pipeline work before it started ([execution controls](./execution-controls.md#caller-cancellation)) | No | Application; TypeScript server engine; core executors (batch, pipeline) |
| `COMMAND_EXECUTION_ERROR` | The handler threw (or panicked). Outside dev mode the message is "An internal error occurred" and carries no exception text | No | Core executors, server engine, DirectClient, batch, pipeline |

#### Routing and access

| Code | Meaning | Retryable | Layers |
| --- | --- | --- | --- |
| `COMMAND_NOT_EXPOSED` | The command exists but is not exposed to the interface an in-process caller named; see [D4](#unknown-and-unexposed-commands-d4) | No | Core executors (registry), server engine (`createDirectRegistry`) |
| `COMMAND_NOT_ALLOWED` | The DirectClient's `allow` predicate or list excludes the command, or (TypeScript) the `allow` call option of `createDirectRegistry` excludes a command the call runs, including one reached through `afd-call`, `afd-batch`, `afd-pipe` or a grouped tool whose every action it excludes (a grouped tool resolves its action among the permitted commands, so an excluded action alone is `COMMAND_NOT_FOUND`) | No | DirectClient; server engine and router (`createDirectRegistry`) |
| `UNKNOWN_TOOL` | The DirectClient's registry has no such command it can call; see [D4](#unknown-and-unexposed-commands-d4) | No | DirectClient |
| `AMBIGUOUS_ACTION` | A grouped tool's `action` matches more than one command in the group | No | Router |
| `INVALID_GROUPED_CALL` | A grouped tool was called without an `action` | No | Router |

#### Batch and pipeline

| Code | Meaning | Retryable | Layers |
| --- | --- | --- | --- |
| `INVALID_BATCH_REQUEST` | The batch envelope is malformed or empty. No command ran | No | Core executors (batch), router |
| `BATCH_TIMEOUT` | The batch deadline passed: the command was aborted, or never started | Yes | Core executors (batch) |
| `COMMAND_SKIPPED` | `stopOnError` stopped the batch before this command started | No | Core executors (batch) |
| `INVALID_PIPELINE_REQUEST` | The pipeline envelope is malformed. No step ran | No | Core executors (pipeline), router |
| `PIPELINE_TIMEOUT` | The pipeline deadline passed: this step was aborted, or skipped | Yes | Core executors (pipeline) |
| `UNSUPPORTED_OPTION` | The request uses an option this engine does not implement: pipeline `parallel`, a step's `stream`, or, in a Rust build without the `native` feature, a timeout | No | Core executors (pipeline; Rust registry and batch) |

### Profile catalogs

Codes belonging to optional contract profiles. Each entry in `vectors/error-codes.json` names its
`profile`.

#### Contexts (`profile: "contexts"`)

| Code | Meaning | Retryable | Layers |
| --- | --- | --- | --- |
| `COMMAND_NOT_IN_CONTEXT` | The command exists but is outside the active context | No | Server engine, router; the C++ and Python registries |
| `SESSION_REQUIRED` | `afd-context-enter` or `afd-context-exit` was called over HTTP without an MCP session to hold the context | No | Router (context tools) |
| `CONTEXT_NOT_FOUND` | `afd-context-enter` named a context the server does not configure, or an in-process call's active context (TypeScript `activeContext`) named one the registry does not configure | No | Router (context tools); server engine (`createDirectRegistry`) |
| `CONTEXT_DEPTH_EXCEEDED` | The context stack is full (16 levels by default) | No | Router (context tools) |

#### Streaming (`profile: "streaming"`)

| Code | Meaning | Retryable | Layers |
| --- | --- | --- | --- |
| `STREAM_ABORTED` | The caller's signal aborted the stream | Yes | Core executors (stream) |
| `STREAM_TIMEOUT` | The stream deadline passed. The client uses the same code for its own stream timeout | Yes | Core executors (stream), client |
| `STREAM_ERROR` | The stream failed outside the command: the executor threw, the HTTP `/stream` route failed, or the client could not open or read the stream. The client's HTTP failure is retryable only for a 5xx status | Varies | Core executors (stream), HTTP layer, client |
| `STREAM_ENDED_UNEXPECTEDLY` | `consumeStream` saw the stream end without a complete or error chunk | Yes | Core executors (stream) |
| `COMMAND_FAILED` | A streamed command failed without an error of its own | No | Core executors (stream) |

#### Confirmations (`profile: "confirmations"`)

Emitted only by a server that enforces `confirmPrompt`; see
[Confirmations](./command-metadata.md#confirmations). No handler ran.

| Code | Meaning | Retryable | Layers |
| --- | --- | --- | --- |
| `CONFIRMATION_REQUIRED` | The command declares `confirmPrompt` and the call carried no confirmation the server accepts. The suggestion says how to confirm: repeat the call with `confirm: true`, or use a client that supports elicitation. Not retryable, except a host-verified command's refusal with `details.reason` `pending-list` ([the pending list](./command-metadata.md#the-pending-list)), which is retryable: the same call runs once the person decides | Varies | Server engine, router, HTTP layer |
| `CONFIRMATION_DECLINED` | The user declined or cancelled the confirmation. Do not retry without asking the user | No | Server engine, router |

#### Approvals (`profile: "approvals"`)

Emitted by the approval middleware (`APPROVAL_REQUIRED`) and by the server engine
(`APPROVAL_UNAVAILABLE`); see [Approvals](./command-metadata.md#approvals). No handler ran.

| Code | Meaning | Retryable | Layers |
| --- | --- | --- | --- |
| `APPROVAL_REQUIRED` | The command's approval policy requires a human's approval and the call carried no valid approval token. `details` holds `approvalToken` (unless the server delivers it elsewhere, the default on MCP), `expiresAt`, `summary` and, for a rejected token or a declined MCP approval, `reason`. An `afd-pipe` refused up front because a gated step's input comes from an earlier step has `reason: "input-not-known"`, `step` and `command` instead, and nothing ran: split the pipeline before that step. An `afd-batch` or `afd-pipe` with more than `limit` (20) gated steps has `reason: "too-many-approvals"` and `limit`, and nothing ran: split it. Retry the same call with the token once a human approved | No | Middleware |
| `APPROVAL_UNAVAILABLE` | The command declares an approval policy other than `not-required`, or the approval middleware's list gives it one, and no approval step admitted the call, so the server cannot ask a person. Nothing ran. `details.reason` is `no-approval-step`; `admission-mismatch` when an approval step ran but did not admit this dispatch (a retry or an input change after it, or during its decision); or `input-not-canonical`, the approval step's own answer when the call needs approval and its validated input has no canonical JSON form (a `bigint`, an integer a JavaScript number cannot hold exactly, a class instance), so no approval can be bound to it and the person is not asked; or, in TypeScript, `no-webcrypto`, when the approval step needs WebCrypto to sign or check a token and the platform has none (a browser page on an insecure origin). The suggestion says not to retry: for the first two the operator adds an approval step, removes the policy or reorders the middleware; for `input-not-canonical` the caller sends the input in a form canonical JSON accepts, or the operator changes a schema that produces such a value; for `no-webcrypto` the operator serves the app over HTTPS or from `localhost` | No | Server engine; approval middleware |

#### Output budgets (`profile: "output-budgets"`)

Emitted by the engine's check after the handler; see
[Output budgets](./output-budgets.md#b5-the-check-after-the-handler). The handler ran.

| Code | Meaning | Retryable | Layers |
| --- | --- | --- | --- |
| `OUTPUT_BUDGET_EXCEEDED` | A command's successful result was larger than the call's output budget. For a read, the result is replaced by this failure, with `details.limitBytes`, `actualBytes` and `maxBytes`; the suggestion says to narrow the request or ask for up to `maxBytes`. For a mutation, the result is kept and this is a warning's code instead, because the change was made | No | Server engine (the check after the handler), core executors (batch items, pipeline steps), DirectClient |

#### Authorization (`profile: "authorization"`)

Emitted by a server configured with [authorization](./authorization.md) for a call that carries
verified credentials; see [M6](./authorization.md#m6-scopes). No handler ran.

| Code | Meaning | Retryable | Layers |
| --- | --- | --- | --- |
| `INSUFFICIENT_SCOPE` | The caller's token lacks a scope the call needs, found after routing: a call the HTTP layer could not answer with a 403 before dispatch, such as one on the deprecated `/message` lane. `details.scopes` lists every missing scope; the suggestion says to obtain a token that grants them. A batch or pipeline fails as a whole before its first step. Where HTTP can answer, the same case is an HTTP 403 with `error="insufficient_scope"` instead, never a tool result | No (a new token) | Server engine, router, HTTP layer |

#### Tasks (`profile: "tasks"`)

Emitted by a server's task runner; see [Tasks](./command-metadata.md#tasks). The task completes
with this failure (`completed`, with `isError: true`).

| Code | Meaning | Retryable | Layers |
| --- | --- | --- | --- |
| `TASK_TOKEN_EXPIRED` | A task was still working when the token that started it expired (`credentials.expiresAt`), so it was stopped; it completes with this failure. A token that expired before the task could start stops it the same way, before its handler runs, and so does a handler that returned after `expiresAt` (its result is not delivered). Start it again with a new token. Retryable unless the command is a `mutation` whose handler started: it may have made its change, in part or in full, and the suggestion says to check its effect first | Varies | Server engine (the task runner) |

#### App calls (`profile: "app-calls"`)

Emitted by a registry for a call with the `apps` interface; see
[App-to-app calls](./command-metadata.md#app-to-app-calls). No handler ran.

| Code | Meaning | Retryable | Layers |
| --- | --- | --- | --- |
| `CALL_NOT_GRANTED` | An app's call to a command it may not call: the command does not exist, does not set `expose.apps`, or the host's `callGrant` does not grant it to the caller. One fixed message and suggestion for every case, before lookup and validation, so the caller cannot tell them apart | No | Core executors (registry), server engine (`createAppCallRegistry`) |

#### Idempotency keys (`profile: "idempotency"`)

Emitted by the engine's idempotency step ([idempotency](./idempotency.md#errors)) for a call that
carries a key to a `keyed` command, in place of running the handler. Every language defines the
three constants; TypeScript's engine sends them so far
([#2676](https://github.com/lushly-dev/afd/issues/2676) for the others).

| Code | Meaning | Retryable | Layers |
| --- | --- | --- | --- |
| `IDEMPOTENCY_KEY_REUSED` | The idempotency key is already held for a call with another input or declared context. `details.meta` names the `_meta` key | No | Server engine (the idempotency step) |
| `IDEMPOTENCY_IN_PROGRESS` | An earlier call with the same idempotency key and input is still running, within its lease | Yes | Server engine (the idempotency step) |
| `OUTCOME_UNKNOWN` | An earlier call with the same idempotency key and input started, and nobody can say whether it was applied: its handler returned `TIMEOUT` or threw, or its lease ran out unsettled. A client sends the same code for a lost answer ([MCP client](#mcp-client)) | No | Server engine (the idempotency step); TypeScript and Python clients |

## Host-defined error codes

The prefix `HOST_` (`HOST_ERROR_CODE_PREFIX` / `host_error_code_prefix`, recorded as `hostPrefix` in
[`vectors/error-codes.json`](./vectors/error-codes.json)) is **reserved for host-defined error
codes**.

- **AFD will never add a code starting with `HOST_`** to the core or profile catalogs.
- A host running on top of AFD (such as Umbel or Loam) **SHOULD** name new host-specific error
  codes `HOST_<HOST>_<NAME>` (for example `HOST_UMBEL_SPACE_NOT_READABLE`,
  `HOST_LOAM_WORKSPACE_LOCKED`), or `HOST_<NAME>` when scoped to a single host, so they can never
  collide with future AFD catalog additions.
- Host codes defined before this rule (such as Umbel's `SPACE_NOT_READABLE`, `TASK_LOST` and
  `PERSON_VERIFICATION_INSUFFICIENT`) stay in their host's own catalog and are grandfathered.
- Application-level command errors (such as the todo example's `NO_CHANGES`) should reuse a shared
  catalog code whenever one fits, and avoid the `HOST_` prefix.

## Specified, not yet in the catalog

Engine codes a `spec/` page defines before any language emits them. Each joins
[the shared catalog](#the-shared-catalog), with its constant in all four languages and its entry in
[`vectors/error-codes.json`](./vectors/error-codes.json), in the first pull request that implements
it ([Changing this page](#changing-this-page)). `OUTPUT_BUDGET_EXCEEDED` joined the catalog this way
in Umbel phase 2 step 0b, `INSUFFICIENT_SCOPE` in Umbel phase 5 step 0b and `TASK_TOKEN_EXPIRED` in
Umbel phase 5 step 0e, `APPROVAL_UNAVAILABLE` (declared approval policies held without the
approval middleware), and the `idempotency` profile's three codes with TypeScript's idempotency
keys ([#2675](https://github.com/lushly-dev/afd/issues/2675)), `OUTCOME_UNKNOWN` among them, which
had been a client's code only. The catalog stands at 53 codes, and none is waiting.

A refused token is not an error code: it is an HTTP 401 whose body names the existing
`UNAUTHORIZED`, with a rule code (`audience`, `expired`, `scopes-too-many` and so on) that is logged
and never sent ([authorization, M5](./authorization.md#m5-401-and-403)). `UNAUTHORIZED` is also the
server's answer when a request on an authorized server reaches the MCP service without verified
credentials (M1). Codes a host defines on top, such as Umbel's `SPACE_NOT_READABLE`, `TASK_LOST` or
`PERSON_VERIFICATION_INSUFFICIENT`, stay in the host's own catalog. The host-verified confirmation
mode and relay evidence add no code: they answer with `CONFIRMATION_REQUIRED`,
`CONFIRMATION_DECLINED`, `VALIDATION_ERROR` and `APPROVAL_REQUIRED` (with the new `details.reason`
`credentials-mismatch`), and a relay may answer with its own error. A relay's pending list answers
with `CONFIRMATION_REQUIRED`, `details.reason` `pending-list` and `retryable: true`.

## Transport-specific codes

Not in the shared catalog. An implementation with the transport uses these codes; one without it
does not define them.

### HTTP layer

| Code | Meaning | Retryable | Implementations |
| --- | --- | --- | --- |
| `METHOD_NOT_ALLOWED` | `GET /stream/<command>` for a mutation; use `POST`. Status 405 | No | TypeScript |
| `SSE_CAPACITY_REACHED` | Too many open SSE connections. Status 503 with `Retry-After` | No (retry after `Retry-After`) | TypeScript |
| `HTTP_<status>` | The HTTP layer rejected the request on a non-JSON-RPC route: Host or Origin not allowed (403), a bad or oversized body (400, 413, 415), an unknown session (404), or an internal failure (500). JSON-RPC routes answer with a JSON-RPC error instead | No | TypeScript |

### MCP client

| Code | Meaning | Retryable | Implementations |
| --- | --- | --- | --- |
| `NOT_CONNECTED` | `connect()` was not called, or the connection closed | No | TypeScript |
| `HTTP_<status>` | The server answered with an HTTP error status | Yes for 5xx and 429 | TypeScript, Python |
| `PARSE_ERROR` | JSON-RPC `-32700`, or a batch result the client could not parse | No | TypeScript |
| `INVALID_REQUEST` | JSON-RPC `-32600` | No | TypeScript |
| `METHOD_NOT_FOUND` | JSON-RPC `-32601` | No | TypeScript |
| `REQUEST_REJECTED` | JSON-RPC `-32000`: the server rejected the HTTP request (Host, Origin, Content-Type or size) | No | TypeScript |
| `SESSION_NOT_FOUND` | JSON-RPC `-32001`: the MCP session is unknown or expired; reconnect | Yes | TypeScript |
| `SESSION_LIMIT_REACHED` | HTTP 503 whose JSON-RPC `-32000` error carries `data.code: "SESSION_LIMIT_REACHED"`: the server refused `initialize` because its session store is full and the caller holds no session. Neither a bare `-32000` nor `-32002` is read as this | Yes (retry after `Retry-After`) | TypeScript |
| `MISSING_CLIENT_CAPABILITY` | JSON-RPC `-32021`: the server requires a client capability (such as `io.modelcontextprotocol/tasks`) the request did not declare | No | TypeScript, Python |
| `JSON_RPC_ERROR` | Any other JSON-RPC error code | No | TypeScript |
| `OUTCOME_UNKNOWN` | A call (not positively marked read-only), batch or pipeline request got no result after it may have reached the server, so the command or commands may have run. A server may send it too, for a command it stopped waiting for that may still run: Umbel does for a compiled-plugin call past its deadline. Also in the shared catalog, in the `idempotency` profile, as the idempotency step's code | No | TypeScript, Python (`call()`, `afd batch`); Umbel (server, compiled-plugin calls) |
| `TOOL_ERROR` | The tool failed and its content is not a `CommandResult` | No | TypeScript, Python |
| `BATCH_ERROR`, `PIPELINE_ERROR` | `afd-batch` or `afd-pipe` failed and its content is not a result | No | TypeScript |
| `STREAM_CANCELLED` | The caller, `disconnect()` or the transport cancelled the stream | No | TypeScript |
| `STREAM_TRUNCATED` | The connection closed before a complete or error chunk. The command may have run | No | TypeScript |
| `STREAM_EVENT_TOO_LARGE` | An SSE event exceeded `maxStreamEventSize` | No | TypeScript |
| `TRANSPORT_ERROR` | The transport or JSON-RPC call failed | Varies (Yes for read-only connection loss and `-32001`; No for definite refusals) | Python |
| `CLIENT_ERROR`, `INVALID_RESULT` | The client failed, or the server's result could not be parsed | No | Python |
| `INPUT_REQUIRED` | The server answered `input_required` and no elicitation handler was registered. `data.inputRequests` holds what the server asked for | No | TypeScript, Python (`streamable-http`) |

### Middleware and telemetry

| Code | Meaning | Retryable | Implementations |
| --- | --- | --- | --- |
| `JOURNAL_RESULT_UNSERIALIZABLE` | Recorded on a journal entry when copying the command's result to JSON failed (throwing getter, circular reference, `bigint`); the live return value is unaffected | No | TypeScript |
| `TELEMETRY_NO_RESULT` | The telemetry middleware's `next()` returned no result | No | TypeScript, Python |
| `UNHANDLED_ERROR` | Recorded on a telemetry event when the command threw. Never a result's code | — | TypeScript, Python |

## Other codes a result can carry

- **Pass-through codes.** `wrapError()` keeps a thrown error's own string `code`, so a result can
  carry a code this page does not list: the auth package's codes, or a Node system error such as
  `ENOENT`, whose message is replaced by a generic one naming the code.
- **Python-only:** `INVALID_COMMAND_RESULT` (retryable: no) when a handler or middleware returns
  something that is not a `CommandResult`, on every path (a single call, a batch item, a
  pipeline step and a stream) and in every host (the MCP server, the command registry and
  `DirectClient`). A dict with a boolean `success` is parsed as a result instead. TypeScript
  does not check this at runtime.
- **Package codes:**
  - auth: `INVALID_CREDENTIALS`, `PROVIDER_ERROR`, `NETWORK_ERROR` and `REFRESH_FAILED` (the last
    two retryable), `PASSKEY_CANCELLED` (the person dismissed the passkey ceremony, or it timed
    out) and `PASSKEY_UNSUPPORTED` (no WebAuthn, or no passkeys at the provider), neither
    retryable, `SIGN_IN_REDIRECT`, `SIGN_IN_PENDING`;
  - view-state: `VIEW_STATE_NOT_FOUND`, `VIEW_STATE_REPLACE_UNSUPPORTED`,
    `VIEW_STATE_UNDO_UNAVAILABLE`;
  - local-db: `HTTP_<status>`, `NOT_FOUND`, `CONFLICT`, `INVALID_PATH`, `INVALID_NAME`;
  - testing: `HANDLER_NOT_CONFIGURED` and the scenario commands' codes. The validators' codes
    (`MISSING_SUGGESTION` and so on) and `afd validate`'s codes are validation issues, not
    `CommandError` codes.

## Changing this page

A new engine code joins the shared catalog when more than one language emits it, or will once a
planned surface lands. In the same pull request:

1. Add it to the table above and to `vectors/error-codes.json`.
2. Add the constant in all four languages. Each suite's catalog test fails until it matches.
3. Record the change in [`CHANGELOG.md`](./CHANGELOG.md). A new code is a minor contract change.
