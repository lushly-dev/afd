---
name: afd-python
description: >
  Writes AFD commands and MCP servers in Python with the afd package: @server.command
  metadata, wire format, tool strategies, batch limits, approvals and afd.testing. Use when
  adding a Python command or server or debugging Python AFD code; for a Botcore server, use
  build-mcp-servers.
---

# AFD Python

The `afd` package lives in `python/`; `python/pyproject.toml` holds its version and extras (`afd[server]`, `afd[client]`, `afd[cli]`, `afd[testing]`, `afd[all]`). The server runs on the `mcp` SDK 2.x `MCPServer` (`mcp.server.mcpserver`), not the standalone FastMCP package. TypeScript is the behavioral reference; Python's known gaps and intended differences are in [docs/language-parity.md](../../../docs/language-parity.md), and `python/README.md` is the API tour.

## Define a command

```python
from pydantic import BaseModel, Field
from afd import CommandResult, ExposeOptions, success
from afd.server import create_server


class DraftInput(BaseModel):
    title: str = Field(..., min_length=1)


class DraftOutput(BaseModel):
    id: str


server = create_server("docs", tool_strategy="lazy")


@server.command(
    name="doc-create",
    description="Create a draft document",
    category="docs",
    input_schema=DraftInput,
    output_schema=DraftOutput,
    mutation=True,
    requires=["workspace-open"],
    contexts=["editing"],
    examples=[{"title": "Basic draft", "input": {"title": "Q2 plan"}}],
    expose=ExposeOptions(mcp=True),
)
async def create_doc(input: DraftInput) -> CommandResult[DraftOutput]:
    return success(DraftOutput(id="doc-1"), reasoning="Created draft document")
```

- **MCP exposure is opt-in.** `ExposeOptions()` defaults to `palette=True, agent=True, mcp=False, cli=False`. An unexposed command is not listed, and `afd-call` returns `COMMAND_NOT_FOUND` for it. `server.execute(name, input)` still runs it, because it is the trusted host API.
- **`input_schema`** is a Pydantic model or a JSON Schema dict. It is checked at decoration, and an unsupported keyword raises there. Input is validated against the advertised JSON Schema, then converted to the model.
- **`output_schema`** takes a Pydantic model only. It is exported as `returns` and surfaced as MCP `_meta.outputSchema`.
- **`examples`** are validated against the input schema at decoration time.
- **`requires`** is planning metadata, never enforced. **`category`** names the grouped tool; without it the group is the name's first kebab segment.
- **Names.** A name that isn't `domain-action` kebab-case still registers, with a `UserWarning` (as in TypeScript). `register` raises `ValueError` for `afd-call`, `afd-batch`, `afd-pipe`, `afd-discover` and `afd-detail`. A command named `afd-help`, `afd-docs` or `afd-schema` silently shadows the bootstrap tool.
- **`@server.command` has no `handoff` or `handoff_protocol`.** For a handoff command, decorate with `define_command(...)` from `afd.server` and call `server.register(fn)`. Neither decorator takes `errors` or `execution_time`.
- **The handler gets `context`** when it declares a parameter named `context` or takes two or more parameters. Calling the decorated function directly validates its input but runs no middleware, exposure check or metadata stamping.

## Context: actor, clock, random, journal

```python
async def create_todo(input: CreateInput, context):
    created_at = context.clock.now()      # epoch ms; not time.time()
    token = context.random.next()         # [0, 1); not random.random()
    if context.actor and context.actor.kind == "agent":
        ...                               # human | agent | service | script | test
```

- **The server fills `clock` and `random`** (`create_server(clock=..., random=...)`). MCP calls get `Actor(kind="agent")`, `DirectClient` gets `human`, and the testing helpers get `test`. Results carry `metadata.actorKind`, never the id. Neither server takes a caller-declared actor from request `_meta`.
- **In tests,** use `fixed_clock(...)` (epoch ms, an ISO string or a `datetime`) and `seeded_random("abc")`, both from `afd`. `seeded_random` gives the same sequence as TypeScript's `seededRandom`.
- **`SimpleRegistry` handlers** get the context only through a keyword-only parameter: `async def roll(sides=6, *, context)`.
- **Journal.** Add `create_journal_middleware(sink)` from `afd.server`, last in the middleware list. Use `MemoryJournalSink` or `FileJournalSink`, from `afd`. Replay with `replay_journal(fresh_server, parse_journal(text))`. Journal files are byte-compatible with TypeScript's ([spec/journal.md](../../../spec/journal.md)).

## Wire format

Results follow [spec/wire](../../../spec/wire/README.md), the same JSON as the TypeScript server:

- **Keys are camelCase** (`undoCommand`, `executionTimeMs`). Python attributes stay snake_case, and parsing accepts both.
- **Unset fields are omitted,** never written as `null`.
- **Failures are sent with MCP `isError: true`.**
- **A missing or mistyped argument** returns `VALIDATION_ERROR` with `details.errors`, `details.expectedFields` and `details.missingFields` or `details.unexpectedFields`, plus a `suggestion`.
- **Metadata.** Every server result carries `metadata.executionTimeMs` and a per-call `metadata.traceId`.
- **Redaction.** A handler exception becomes `COMMAND_EXECUTION_ERROR`, "An internal error occurred", unless `create_server(dev_mode=True)`.
- **Built-in payloads** (`afd-schema`, `afd-help`, `afd-detail`, `create_handoff()`) follow the same rules.

Use `afd.core.wire.to_wire(result)` to produce the same JSON yourself.

## Tool strategies

`tool_strategy` is `"individual"` (Python's default; TypeScript and Rust default to `grouped`), `"grouped"`, `"lazy"` or `"hybrid"` ([spec/tool-strategies.md](../../../spec/tool-strategies.md)). Python's lists differ from TypeScript's:

- **Individual, grouped and lazy** list all five meta-tools first (`afd-discover`, `afd-detail`, `afd-batch`, `afd-pipe`, `afd-call`), plus `afd-help`, `afd-docs` and `afd-schema` as tools.
- **With `contexts`,** they also list `afd-context-list`, `afd-context-enter` and `afd-context-exit`. Lazy filters these bootstrap-category tools by the active context.
- **Grouped** sorts groups and actions by name and has no `_meta.actions`.
- **Out-of-context calls.** A context-scoped command is hidden from discovery outside its context and returns `COMMAND_NOT_IN_CONTEXT` when called.

Hybrid lists a few hot-path commands as their own tools and runs everything else through `afd-call`:

```python
server = create_server(
    "todo-app",
    tool_strategy="hybrid",
    first_class_tools=["todo-list", "todo-create", "todo-complete"],  # in this order
)
```

- **The list.** `afd-discover`, `afd-detail`, `afd-call`, `afd-batch`, `afd-pipe`, then the context tools when `contexts` are set, then the first-class tools in the order given. Each is the tool the individual strategy would list. No bootstrap tools are listed.
- **It never varies by context,** so `tools_list_ttl_ms` stays 300000 even with contexts. A first-class command called outside its context fails with `COMMAND_NOT_IN_CONTEXT`.
- **The set.** It takes 1 to 8 commands, each registered, MCP-exposed, not a built-in tool and not repeated. `first_class_tools` without `hybrid`, or `hybrid` without it, is an error.
- **When it is checked.** A bad entry raises `ValueError` naming it before the server answers its first request, so `@server.command` may follow `create_server`. A later `register` cannot unexpose a first-class command.
- **`afd-help`** reports `toolStrategy` on every strategy, and on hybrid also `firstClassTools` and `firstClass: true`.

## Batches and pipelines

`afd-call`, `afd-batch` and `afd-pipe` are listed by every strategy. The controls follow [spec/execution-controls.md](../../../spec/execution-controls.md):

- **Only commands may be items or steps.** An item or step naming `afd-batch`, `afd-pipe`, `afd-call`, `afd-discover` or `afd-detail`, or a malformed `when` condition, rejects the whole request before anything runs.
- **Batch limits.** A batch holds at most 500 commands, with `parallelism` at most 16 (`create_server(max_batch_size=..., max_batch_parallelism=...)`). A larger request returns `INVALID_BATCH_REQUEST`, and nothing runs.
- **`stopOnError`** stops scheduling: commands already running finish with their real results, and unstarted ones get `COMMAND_SKIPPED`.
- **A batch `timeout`** cancels and awaits commands still running. They and any unstarted ones get `BATCH_TIMEOUT`.
- **A handler that returns something other than a `CommandResult`** gives its item or step `INVALID_COMMAND_RESULT`.
- **Pipelines are sequential.** `options.parallel` and `stream: true` steps fail with `UNSUPPORTED_OPTION` before any command runs.
- **Pipeline variables** follow [spec/pipeline-variables.md](../../../spec/pipeline-variables.md): `$prev`, `$first`, `$steps[N]`, `$steps.<alias>` and `$input`, each with an optional path. Other `$` strings are literals, `$$` escapes, and an unresolved reference is omitted from objects (`None` in lists).

Two vector suites hold Python to these rules: `tests/test_pipeline_vectors.py` and `tests/test_batch_controls_vectors.py`. Both read `spec/vectors`.

## Serving and clients

`server.run()` serves stdio. `server.run(transport="streamable-http", host="127.0.0.1", port=8000, stateless_http=True)` serves `/mcp`, and `server.streamable_http_app(**options)` returns the ASGI app for mounting. `run`, `run_async` and `streamable_http_app` accept `"stdio"`, `"sse"` (deprecated) and `"streamable-http"`, and pass options to the SDK.

- **Protocol eras.** Every transport serves MCP 2026-07-28 statelessly and 2025 clients that send `initialize`.
- **Contexts over MCP.** A 2026-07-28 request selects its context with `_meta["dev.afd/context"]`, and `afd-context-enter` there only validates the name (`persisted: false`). A 2025 client on a stateful transport keeps one stack per connection. On stateless 2025 HTTP, entering or exiting a context returns `SESSION_REQUIRED`.
- **Clients.** `create_client("http://127.0.0.1:8000/mcp")` picks the transport from the URL: `/sse` is SSE, `/message` is legacy HTTP, and anything else is Streamable HTTP with `protocol_mode="auto"`. `McpClient` has `call`, `batch` and `pipe`. Its `timeout` is in seconds; TypeScript's is in milliseconds.

## Confirmations and approvals

- **Confirmations.** `create_server(confirmations="enforce")` gates every command with `confirm_prompt` on MCP calls. The server sends an elicitation when the client supports it; otherwise it returns `CONFIRMATION_REQUIRED` until the call repeats with `confirm: True`. `"require-human"` accepts the elicitation only. Pass `confirmation_key` (32+ bytes) when several instances serve one URL. `server.execute()` and DirectClient calls are never gated.
- **Approval policy.** Declare `approval="required"`, `"not-required"`, or a function of the input and context, on `define_command` or `@server.command`.
- **Approval middleware.** Install `create_approval_middleware(secret=os.environ["AFD_APPROVAL_SECRET"], commands=[...])` from `afd.server`, after any middleware that sets `context.actor`. It gates only the commands in `commands`, so pass the same decorated functions you register.
- **The approval flow.** A held call returns `APPROVAL_REQUIRED` with `details.approvalToken`. Once a human approves, trusted surface code retries the same call with `CommandContext(approval=token)`. The token never comes from tool arguments.
- **Tokens** are single-use by default (`replay="within-ttl"` to allow repeats) and expire after five minutes on the middleware's `clock`. They verify across TypeScript, Python and Rust servers that share the secret. See [spec/command-metadata.md](../../../spec/command-metadata.md), "Approvals".

## DirectClient

`DirectClient(registry)` runs commands in process with `call`, `list_commands`, `has_command` and `pipe(steps, input=...)`. `pipe` uses the same variables as `afd-pipe`.

- **For agent-facing calls,** build the registry with `create_direct_registry(commands, middleware=[...])`. It is exposure-checked on the `agent` interface and validates through the server engine.
- **Approvals.** Approve through trusted `DirectClientOptions(on_approval_needed=...)`. Only an explicit `True` permits one private retry, and a caller's `approval` on `DirectCallContext` is ignored. Held results, observers and journals stay token-free.
- **Deadlines.** `DirectCallContext(timeout=ms)` sets one deadline that includes the decision wait.
- **`server.execute`** remains the trusted host API for out-of-band tokens.

## Handoff

- **Built-in handlers.** Call `register_builtin_handlers()` for WebSocket and SSE, then `connect_handoff(result.data, HandoffConnectionOptions(...))`. Guard with `afd.core.handoff.is_handoff`.
- **Credentials** go in an `Authorization: Bearer` header, never in the URL. `create_handoff()` returns camelCase keys (`sessionId`, `expiresAt`, `maxAttempts`, `backoffMs`).
- **Reconnects.** A reconnect (`create_reconnecting_handoff`, `ReconnectionOptions`) calls `reconnect_command` with `reconnect_args` plus `sessionId`. Declare the reconnect command's parameter as `sessionId`, as in TypeScript.
- **Install** with `pip install afd[client]`.

## CLI

- **`afd validate --surface [--strict] [--verbose]`** validates the agent-facing surface of a server (`--server`, or the saved connection). Its rules include `missing-output-schema`, `missing-context`, `unresolved-prerequisite`, `circular-prerequisite`, `missing-category`, `naming-convention` and `description-quality`. Without `--surface`, it checks the connection, and a mutation or destructive tool without an approval policy gets `MISSING_APPROVAL_POLICY` (an error with `--strict`).
- **`afd tools [--filter TEXT] [--detail TOOL_NAME]`** lists tools. `--detail` needs a tool name. The TypeScript `afd tools` has no `--detail`; it takes `--category`, `--format` and `--refresh`.
- **`afd call TOOL '{"json": "args"}'`** calls over the saved connection. With `--module file.py`, it loads the module's exported `registry` in process; then `--approve` or an interactive prompt authorizes one retry, and `--timeout ms` sets the deadline. Remote calls take neither.

## Testing

`afd.testing` holds the helpers (`afd[testing]`):

- **`test_command(handler, input)`** returns a `CommandTestResult`: `.result`, `.is_success`, `.execution_time_ms` and `.validation`. It calls `handler(input, ctx)` directly, so a decorated handler validates its input, but no middleware, exposure check, approval or metadata stamp runs. For those, use `await server.execute(name, input, context)`.
- **`create_test_context(overrides)`** gives `Actor(kind="test")` and a 5-second timeout. A `now` key stops the clock.
- **More helpers.** `test_command_multiple(handler, cases)` takes `input`, `expect_success` and `expect_error` per case and returns dicts with `passed`. `create_mock_command(name, fn)` wraps a plain function. The non-raising validators are `validate_result(result, ResultValidationOptions(...))`, `validate_error` and `validate_command_definition`.
- **Assertions:** `assert_success`, `assert_error`, `assert_has_suggestion`, `assert_retryable(result, expected=False)`, `assert_step_status(result, step_id, status)` and `assert_ai_result(result, min_confidence=..., require_sources=...)`.
- **Fixtures.** `mock_server`, `isolated_registry` and `command_context` live in `afd.testing.fixtures`. `afd` registers no pytest plugin, so import them, or list the module in `pytest_plugins`.
