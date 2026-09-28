# Error codes

Every `CommandError.code` an AFD engine emits: what it means, whether it is retryable, and which
layer emits it. It also fixes how an engine answers a call to an unknown or unexposed command
(decision D4 of the [parity closure plan](../docs/features/active/parity-closure/parity-closure.plan.md)).
Which codes each language defines today is tracked in the
[language parity matrix](../docs/language-parity.md).

The codes fall into three groups:

- **The shared catalog.** Codes an agent can get from any implementation for the same situation.
  Every language defines all of them as constants, in the order of
  [`vectors/error-codes.json`](./vectors/error-codes.json), each constant's value being its name:
  TypeScript `ErrorCodes`, Python `ErrorCodes`, Rust `error_codes` and C++ `error_codes`. Each test
  suite checks its catalog against that file.
- **Transport-specific codes.** Codes that belong to one transport (the HTTP layer or an MCP
  client). They are listed here so that an agent can interpret them, but they are not in the shared
  catalog: a language without that transport has no use for them.
- **Package codes.** Codes of optional packages such as auth and view-state. They belong to those
  packages' own contracts.

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
| Middleware | `packages/server` `middleware.ts` | The built-in rate-limit and telemetry middleware |
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
| **DirectClient** | `UNKNOWN_TOOL`, `retryable: false`, always with a `suggestion` | `UNKNOWN_TOOL`, the same answer |

Rules:

1. **Remote callers cannot tell the two apart.** The code, message and suggestion for a private
   command are the ones an unknown name gets. TypeScript does this by giving the remote engine a
   command map that holds only the MCP-exposed commands.
2. **Lookup comes first.** An unknown command is `COMMAND_NOT_FOUND` whatever the interface. The
   exposure check, then the context check, then input validation follow.
3. **An empty interface is no interface.** An interface that names no surface (anything other than
   `palette`, `mcp`, `agent` or `cli`) exposes nothing, so the command is `COMMAND_NOT_EXPOSED`.
   Python's former `INVALID_INTERFACE` code is gone.
4. **Close matches never include a hidden command.** `COMMAND_NOT_FOUND` and `UNKNOWN_TOOL`
   suggestions offer at most three close matches from the names the caller can call, and never echo
   the requested name, which is untrusted.
5. **`UNKNOWN_TOOL` carries the structured `UnknownToolError` as its `data`** (`requested_tool`,
   `available_tools`, `suggestions`, `hint`). Its `suggestion` is the hint ("Did you mean 'x'?"),
   or, with no close match, where to find valid names: the client's `listCommandNames()`
   (`list_command_names()` in Python and C++).

All four implementations follow these rules, with one exception: a Python MCP server answers a
tools/call for a name it does not list with FastMCP's plain "Unknown tool" text rather than a
`COMMAND_NOT_FOUND` result ([#325](https://github.com/lushly-dev/afd/issues/325)). It still does not
reveal a private command. Rust has no MCP server or DirectClient yet; its todo example backend
answers `COMMAND_NOT_FOUND` for both cases.

### Suggestions name only tools the host provides

A suggestion names `afd-discover`, `afd-detail`, `afd-help` or `afd-context-*` only where the caller
can call that tool.

| Implementation | Unknown-command suggestion ends with | `COMMAND_NOT_IN_CONTEXT` suggestion |
| --- | --- | --- |
| TypeScript server | "Use afd-discover to list all commands." (the router serves `afd-discover` in every tool strategy) | "Use afd-context-list to see available contexts, or afd-context-enter to switch." (the server registers both when it has contexts) |
| TypeScript core registry | "Use 'afd tools' to see available commands" (the CLI) | Not emitted |
| Rust registry | "Use afd-help to list all commands." when the caller can call `afd-help`, otherwise "Check the command name against the available commands." | Not emitted yet (contexts are Wave 2) |
| C++ registry | As Rust | Names the contexts the command belongs to: "Switch to a context this command belongs to ('planning'), or call it with no active context." |
| Python server | As TypeScript. [#325](https://github.com/lushly-dev/afd/issues/325) tracks the tool strategies that do not serve `afd-discover` remotely | As TypeScript |
| Python core registry | "List available commands to see valid options" | As C++ |

## The shared catalog

42 codes. The first 22 are the original TypeScript `ErrorCodes`; the other 20 are the codes the
engines emitted without a constant.

### Validation

| Code | Meaning | Retryable | Layers |
| --- | --- | --- | --- |
| `VALIDATION_ERROR` | The input failed validation: the command's input schema, a meta-tool's arguments, a pipeline input nested deeper than 64 levels, or a bad stream timeout. Schema failures carry `details.errors`, `expectedFields`, `unexpectedFields` and `missingFields` | No | Server engine, router, core executors, DirectClient (`validateInputs`), application |
| `INVALID_INPUT` | The input is malformed in a way a schema does not describe. The client also maps JSON-RPC `-32602` to it | No | Application, client |
| `MISSING_REQUIRED_FIELD` | A required field is missing | No | Application |
| `INVALID_FORMAT` | A field has the wrong format | No | Application |

### Resources

| Code | Meaning | Retryable | Layers |
| --- | --- | --- | --- |
| `NOT_FOUND` | A resource the command needs does not exist (`notFoundError()`) | No | Application |
| `ALREADY_EXISTS` | The resource to create already exists | No | Application |
| `CONFLICT` | The change conflicts with the resource's current state | No | Application |

### Authorization

| Code | Meaning | Retryable | Layers |
| --- | --- | --- | --- |
| `UNAUTHORIZED` | The caller is not signed in | No | Application; the auth package's middleware |
| `FORBIDDEN` | The caller is signed in but not allowed | No | Application |
| `TOKEN_EXPIRED` | The caller's session expired; sign in or refresh first | No | Application; the auth package |

### Rate limiting

| Code | Meaning | Retryable | Layers |
| --- | --- | --- | --- |
| `RATE_LIMITED` | Too many requests in the window, or the rate limiter's client capacity is full. The suggestion says how long to wait when it is known | Yes | Middleware, application (`rateLimitError()`) |
| `QUOTA_EXCEEDED` | A quota is used up; waiting a moment does not help | No | Application |

### Network and service

| Code | Meaning | Retryable | Layers |
| --- | --- | --- | --- |
| `SERVICE_UNAVAILABLE` | A service the command depends on is down | Yes | Application |
| `TIMEOUT` | An operation ran out of time: a DirectClient call past `context.timeout`, a client request, a Rust registry call past `timeout_ms`, or `timeoutError()`. The command may still have run | Yes | DirectClient, client, core executors (Rust registry), application |
| `CONNECTION_ERROR` | The request could not reach the server, or failed on the way. It may have reached the server | Yes | Client |

### Internal

| Code | Meaning | Retryable | Layers |
| --- | --- | --- | --- |
| `INTERNAL_ERROR` | Something failed inside the engine or the command. `internalError()` and `wrapError()` set `retryable: true`; the pipeline's failure to resolve a step's references leaves it unset; the client maps JSON-RPC `-32603` to it as retryable | Varies | Core executors, client, application |
| `NOT_IMPLEMENTED` | The command or option exists but is not implemented | No | Application |
| `UNKNOWN_ERROR` | A thrown value that is not an `Error` (`wrapError()`) | Yes | Core executors |

### Commands

| Code | Meaning | Retryable | Layers |
| --- | --- | --- | --- |
| `COMMAND_NOT_FOUND` | No such command, or (remotely) one the caller may not see; see [D4](#unknown-and-unexposed-commands-d4). Also the `error` of an `afd-detail` entry with `found: false` | No | Core executors, server engine, router |
| `INVALID_COMMAND_ARGS` | The arguments do not fit the command, outside schema validation | No | Application |
| `COMMAND_CANCELLED` | The caller cancelled the command | No | Application; Python's batch executor |
| `COMMAND_EXECUTION_ERROR` | The handler threw (or panicked). Outside dev mode the message is "An internal error occurred" and carries no exception text | No | Core executors, server engine, DirectClient, batch, pipeline |

### Routing and access

| Code | Meaning | Retryable | Layers |
| --- | --- | --- | --- |
| `COMMAND_NOT_EXPOSED` | The command exists but is not exposed to the interface an in-process caller named; see [D4](#unknown-and-unexposed-commands-d4) | No | Core executors (registry), server engine (`createDirectRegistry`) |
| `COMMAND_NOT_IN_CONTEXT` | The command exists but is outside the active context | No | Server engine, router; the C++ and Python registries |
| `COMMAND_NOT_ALLOWED` | The DirectClient's `allow` predicate or list excludes the command | No | DirectClient |
| `UNKNOWN_TOOL` | The DirectClient's registry has no such command it can call; see [D4](#unknown-and-unexposed-commands-d4) | No | DirectClient |
| `AMBIGUOUS_ACTION` | A grouped tool's `action` matches more than one command in the group | No | Router |
| `INVALID_GROUPED_CALL` | A grouped tool was called without an `action` | No | Router |

### Contexts

| Code | Meaning | Retryable | Layers |
| --- | --- | --- | --- |
| `SESSION_REQUIRED` | `afd-context-enter` or `afd-context-exit` was called over HTTP without an MCP session to hold the context | No | Router (context tools) |
| `CONTEXT_NOT_FOUND` | `afd-context-enter` named a context the server does not configure | No | Router (context tools) |
| `CONTEXT_DEPTH_EXCEEDED` | The context stack is full (16 levels by default) | No | Router (context tools) |

### Batch and pipeline

| Code | Meaning | Retryable | Layers |
| --- | --- | --- | --- |
| `INVALID_BATCH_REQUEST` | The batch envelope is malformed or empty. No command ran | No | Core executors (batch), router |
| `BATCH_TIMEOUT` | The batch deadline passed: the command was aborted, or never started | Yes | Core executors (batch) |
| `COMMAND_SKIPPED` | `stopOnError` stopped the batch before this command started | No | Core executors (batch) |
| `INVALID_PIPELINE_REQUEST` | The pipeline envelope is malformed. No step ran | No | Core executors (pipeline), router |
| `PIPELINE_TIMEOUT` | The pipeline deadline passed: this step was aborted, or skipped | Yes | Core executors (pipeline) |
| `UNSUPPORTED_OPTION` | The request uses an option this engine does not implement: pipeline `parallel`, a step's `stream`, or, in a Rust build without the `native` feature, a timeout | No | Core executors (pipeline; Rust registry and batch) |

### Streaming

| Code | Meaning | Retryable | Layers |
| --- | --- | --- | --- |
| `STREAM_ABORTED` | The caller's signal aborted the stream | Yes | Core executors (stream) |
| `STREAM_TIMEOUT` | The stream deadline passed. The client uses the same code for its own stream timeout | Yes | Core executors (stream), client |
| `STREAM_ERROR` | The stream failed outside the command: the executor threw, the HTTP `/stream` route failed, or the client could not open or read the stream. The client's HTTP failure is retryable only for a 5xx status | Varies | Core executors (stream), HTTP layer, client |
| `STREAM_ENDED_UNEXPECTEDLY` | `consumeStream` saw the stream end without a complete or error chunk | Yes | Core executors (stream) |
| `COMMAND_FAILED` | A streamed command failed without an error of its own | No | Core executors (stream) |

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
| `HTTP_<status>` | The server answered with an HTTP error status | Yes for 5xx and 429 | TypeScript |
| `PARSE_ERROR` | JSON-RPC `-32700`, or a batch result the client could not parse | No | TypeScript |
| `INVALID_REQUEST` | JSON-RPC `-32600` | No | TypeScript |
| `METHOD_NOT_FOUND` | JSON-RPC `-32601` | No | TypeScript |
| `REQUEST_REJECTED` | JSON-RPC `-32000`: the server rejected the HTTP request (Host, Origin, Content-Type or size) | No | TypeScript |
| `SESSION_NOT_FOUND` | JSON-RPC `-32001`: the MCP session is unknown or expired; reconnect | Yes | TypeScript |
| `JSON_RPC_ERROR` | Any other JSON-RPC error code | No | TypeScript |
| `OUTCOME_UNKNOWN` | A batch or pipeline request got no result after it may have reached the server, so some commands may have run | No | TypeScript |
| `TOOL_ERROR` | The tool failed and its content is not a `CommandResult` | No | TypeScript, Python |
| `BATCH_ERROR`, `PIPELINE_ERROR` | `afd-batch` or `afd-pipe` failed and its content is not a result | No | TypeScript |
| `STREAM_CANCELLED` | The caller, `disconnect()` or the transport cancelled the stream | No | TypeScript |
| `STREAM_TRUNCATED` | The connection closed before a complete or error chunk. The command may have run | No | TypeScript |
| `STREAM_EVENT_TOO_LARGE` | An SSE event exceeded `maxStreamEventSize` | No | TypeScript |
| `TRANSPORT_ERROR`, `CLIENT_ERROR`, `INVALID_RESULT` | The transport failed, the client failed, or the server's result could not be parsed | No | Python |

### Middleware and telemetry

| Code | Meaning | Retryable | Implementations |
| --- | --- | --- | --- |
| `TELEMETRY_NO_RESULT` | The telemetry middleware's `next()` returned no result | No | TypeScript, Python |
| `UNHANDLED_ERROR` | Recorded on a telemetry event when the command threw. Never a result's code | — | TypeScript, Python |

## Other codes a result can carry

- **Pass-through codes.** `wrapError()` keeps a thrown error's own string `code`, so a result can
  carry a code this page does not list: the auth package's codes, or a Node system error such as
  `ENOENT`, whose message is replaced by a generic one naming the code.
- **Python-only:** `INVALID_COMMAND_RESULT` (retryable: no) when a batch or pipeline item returns
  something that is not a `CommandResult`. TypeScript does not check this at runtime.
- **Package codes:**
  - auth: `INVALID_CREDENTIALS`, `PROVIDER_ERROR`, `NETWORK_ERROR` and `REFRESH_FAILED` (the last
    two retryable), `SIGN_IN_REDIRECT`, `SIGN_IN_PENDING`;
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
