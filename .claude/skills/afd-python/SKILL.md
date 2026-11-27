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

- **MCP exposure is opt-in.** `ExposeOptions()` defaults to `palette=True, agent=True, mcp=False, cli=False, apps=False`. An unexposed command is not listed, and `afd-call` returns `COMMAND_NOT_FOUND` for it. `server.execute(name, input)` still runs it, because it is the trusted host API. For app-to-app calls (`context.extra["interface"] == "apps"`), pass `call_grant` to `create_command_registry` or `create_server`: a call runs only when the command sets `expose.apps=True` and `call_grant(name, context)` returns `True`, else one fixed `CALL_NOT_GRANTED` before lookup and validation (`spec/command-metadata.md`, "App-to-app calls"); `create_direct_registry` refuses `interface="apps"`.
- **`input_schema`** is a Pydantic model or a JSON Schema dict. It is checked at decoration, and an unsupported keyword raises there. Input is validated against `input_schema`'s JSON Schema, then converted to the model.
- **`output_schema`** takes a Pydantic model only. It is exported as `returns` and surfaced as MCP `_meta.outputSchema`, and the command's own tool advertises the CommandResult envelope as its top-level `outputSchema`. Clients validate each result's `structuredContent` against it, so `data` must match; `create_server(advertise_output_schema=False)` drops it.
- **`examples`** are validated against the input schema at decoration time.
- **`requires`** is planning metadata, never enforced. **`category`** names the grouped tool; without it the group is the name's first kebab segment.
- **Names.** A name that isn't `domain-action` kebab-case still registers, with a `UserWarning` (as in TypeScript). `register` raises `ValueError`, as TypeScript does, for `afd-call`, `afd-batch`, `afd-pipe`, `afd-discover` and `afd-detail` always, for `afd-help`, `afd-docs` and `afd-schema` with `bootstrap=True`, and for `afd-context-list`, `afd-context-enter` and `afd-context-exit` with `contexts`; without those options the names are ordinary commands.
- **Planning metadata.** Both decorators accept `errors` and `execution_time` (`instant`, `fast`, `slow`, `long-running`), plus `handoff` and `handoff_protocol`; handoff tags are added automatically.
- **Extra tool `_meta` and advertised schemas.** Pass `tool_meta={...}` (validated at definition and registration against T2: reverse-DNS keys outside `dev.afd/` and MCP-reserved prefixes, or MCP Apps' `ui` object) and `advertised_input_schema={...}` (`type: "object"`, shown on tools, grouped `_meta.actions`, `afd-detail`, `afd-schema` and `afd-docs`, while calls still validate against `input_schema`).
- **Resources and Skills.** `create_server(..., resources=provider_or_entries, skills=SkillCatalog(...))` opts into MCP resources (`resources/list`, `resources/read`, `resources/templates/list`) and the `io.modelcontextprotocol/skills` extension (`skills/list`, `skills/get`, optional `directory_read=True` for `resources/directory/read`) on Streamable HTTP, SSE and stdio in both eras (`spec/mcp-resources.md`). `ResourceProvider.list` and `read` may accept a frozen `ResourceCaller(credentials=...)` parameter (legacy 0-arg `list()` / 1-arg `read(uri)` remain supported) so providers can filter listings and reads per verified caller under `auth`, returning `None` for unreadable URIs (`-32602` parity with absent URIs); modern-era `resources/list` and provider-backed `resources/read` emit `cacheScope: "private"` when a resource provider or static resource entries are configured and `auth` is set (or the request carries verified credentials), while skills-only servers and static `SkillCatalog` reads stay `"public"`. Without `resources` or `skills`, `resources` and `prompts` are omitted from capabilities. Use `skill_from_directory(path, dir)` to load a skill directory safely (escaping symlinks are refused); `pyyaml` is bundled in `afd[server]`.
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
- **Per-request context hook.** `create_server(context_hook=hook)` (sync or async `(request: ContextHookRequest, context: CommandContext) -> CommandContext | CommandError`) runs once per MCP `tools/call` before request-state unsealing, the confirmation gate and command lookup, on every route. Over HTTP/SSE, `request.http_request` is the Starlette `Request` (read only host-verified state such as `request.state`, never `_meta` or unverified headers); over stdio it is `None`. When `auth` is configured, `context.credentials` carries the verified `Credentials` and the default actor is `Actor(kind="agent", id=client_id, on_behalf_of=subject)`; the hook may map `actor` and cannot alter `credentials`. Return a `CommandError` to fail closed (only `code`, `message`, `suggestion` and `retryable` reach the caller); exceptions and invalid returns become `INTERNAL_ERROR`. Its snapshotted `actor` binds confirmation and approval-relay `requestState`, and its `extra` wins over declared `_meta` context fields.
- **MCP authorization (HTTP).** `create_server(..., auth=McpAuthOptions(resource=..., authorization_servers=[...], verifier=JwtVerifier(...), required_scopes=..., resolver=..., filter_tools_by_scope=...))` wraps `streamable_http_app`, `sse_app` and HTTP/SSE `run`/`run_async` in AFD's ASGI bearer layer (`spec/authorization.md`, M1–M8): serves RFC 9728 metadata publicly, strips `Authorization` before any handler, populates frozen redacted `context.credentials` branded for `is_verified_credentials(context.credentials)` until the request (or background MCP task) ends, enforces command `scopes`, `required_scopes` and `ScopeResolver` (pre-dispatch 403 and JSON-RPC batch 400 `-32600` on Streamable HTTP, post-routing `INSUFFICIENT_SCOPE` before confirmations, execution-time re-check on validated input, `filter_tools_by_scope` with `cacheScope: "private"` and byte-identical hidden commands, `tasks/*` scope checks, plus `server.admit` and `server.pre_dispatch_check` with `ScopeChallenge` for host HTTP layers), binds confirmation/task principals (M8), and fails closed (`UNAUTHORIZED`) on unadmitted transports (`stdio`, `server.execute()`, and `with server.trusted_transport():` remain unaffected). Use `jwks_key_source(...)` for JWKS keys and `create_introspection_verifier(...)` for opaque tokens.
- **In tests,** use `fixed_clock(...)` (epoch ms, an ISO string or a `datetime`) and `seeded_random("abc")`, both from `afd`. `seeded_random` gives the same sequence as TypeScript's `seededRandom`.
- **`SimpleRegistry` handlers** get the context only through a keyword-only parameter: `async def roll(sides=6, *, context)`.
- **Journal.** Add `create_journal_middleware(sink)` from `afd.server`, last in the middleware list. Use `MemoryJournalSink` or `FileJournalSink`, from `afd`. Replay with `replay_journal(fresh_server, parse_journal(text))`. Journal files are byte-compatible with TypeScript's ([spec/journal.md](../../../spec/journal.md)). A command declaring `secret=True` is never recorded unless the journal has `redact` (a `redact` whose second positional parameter has no default, or that has an `info` parameter, gets `JournalRedactInfo(secret=...)`; `None` outside the engine's chain, where nothing is recorded without `redact`; an engine of its own binds the declaration with `afd.core.open_dispatch`).
- **Output budgets** ([spec/output-budgets.md](../../../spec/output-budgets.md), B1–B8). Declare `output_budget=OutputBudget(default_bytes=..., max_bytes=...)` on `@server.command` / `define_command`; callers ask via `_meta["dev.afd/outputBudget"] = {"maxBytes": n}`, meta-tool `meta`, or `output_budget=` on `server.execute` / `DirectCallContext`. Handlers read `context.output_budget` and fit results structurally (never truncate JSON). Over-budget reads return `OUTPUT_BUDGET_EXCEEDED`, mutations keep their result with a `caution` warning, within-budget successes carry `metadata["dev.afd/outputBudget"]`, and the journal records and replays the effective budget. `tests/test_output_budget_vectors.py` loads `spec/vectors/output-budgets.json`.

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

`tool_strategy` is `"grouped"` (the default, as in every language), `"individual"`, `"lazy"` or `"hybrid"` ([spec/tool-strategies.md](../../../spec/tool-strategies.md)). The lists are TypeScript's:

- **Every strategy** lists the five meta-tools first (`afd-discover`, `afd-detail`, `afd-call`, `afd-batch`, `afd-pipe`), as every language does (#533). `grouped` is the default: one tool per group with `_meta.actions`, the bootstrap and context commands in the `bootstrap` group; `lazy` adds only the context tools. A command any strategy leaves unlisted is still callable by its own name, with its confirmation and approval rounds.
- **Bootstrap tools are opt-in.** `afd-help`, `afd-docs` and `afd-schema` are registered only with `create_server(..., bootstrap=True)`, as TypeScript's `bootstrap: true` (D5, #542); the meta-tools and context tools need no flag.
- **With `contexts`,** the context tools are registered before the bootstrap tools, so the `bootstrap` group lists them first; lazy and hybrid list them in every context.
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
- **A handler that returns something other than a `CommandResult`** gets `INVALID_COMMAND_RESULT` on every path (single call, batch item, pipeline step, stream); a dict with a boolean `success` is parsed as a result.
- **Pipelines are sequential.** `options.parallel` and `stream: true` steps fail with `UNSUPPORTED_OPTION` before any command runs.
- **Pipeline variables** follow [spec/pipeline-variables.md](../../../spec/pipeline-variables.md): `$prev`, `$first`, `$steps[N]`, `$steps.<alias>` and `$input`, each with an optional path. Other `$` strings are literals, `$$` escapes, and an unresolved reference is omitted from objects (`None` in lists).
- **Shared executors.** `execute_batch` and buffered `execute_stream` (`ExecutorOptions`, `StreamExecutorOptions`) are exported from `afd`, `afd.core` and `afd.server`, and exposed as `execute_batch()` / `execute_stream()` on `CommandRegistry`, `MCPServer`, `SimpleRegistry` and `MockServer`. Single commands share one executor (`afd.core.single_executor.execute_command`), and `DirectClient.pipe` delegates to core `execute_pipeline`.

Two vector suites hold Python to these rules: `tests/test_pipeline_vectors.py` and `tests/test_batch_controls_vectors.py`. Both read `spec/vectors`.

## Serving and clients

`server.run()` serves stdio. `server.run(transport="streamable-http", host="127.0.0.1", port=8000, stateless_http=True)` serves `/mcp`, and `server.streamable_http_app(**options)` returns the ASGI app for mounting. `run`, `run_async` and `streamable_http_app` accept `"stdio"`, `"sse"` (deprecated) and `"streamable-http"`, and pass options to the SDK.

- **Protocol eras.** Every transport serves MCP 2026-07-28 statelessly and 2025 clients that send `initialize`.
- **Contexts over MCP.** A 2026-07-28 request selects its context with `_meta["dev.afd/context"]`, and `afd-context-enter` there only validates the name (`persisted: false`). A 2025 client on a stateful transport keeps one stack per connection. On stateless 2025 HTTP, entering or exiting a context returns `SESSION_REQUIRED`.
- **Clients.** `create_client("http://127.0.0.1:8000/mcp")` picks the transport from the URL: `/sse` is SSE, `/message` is legacy HTTP, and anything else is Streamable HTTP with `protocol_mode="auto"`. `McpClient` has `call`, `batch` and `pipe`. Its `timeout` is in seconds; TypeScript's is in milliseconds.

## Confirmations and approvals

- **Confirmations.** `create_server(confirmations="enforce")` gates every command with `confirm_prompt` on MCP calls. The server sends an elicitation when the client supports it; otherwise it returns `CONFIRMATION_REQUIRED` until the call repeats with `confirm: True`. `"require-human"` accepts the elicitation only. Pass `confirmation_key` (32+ bytes) when several instances serve one URL. `server.execute()` and DirectClient calls are never gated.
- **Host-verified confirmation (`HumanRelay`).** Declare `confirmation_mode="host-verified"` on `CommandDefinition`, `define_command` or `@server.command` (refused alongside `task="optional" | "required"`), and pass `human_relay=` to `create_server` (`begin`, `resume`, optional `approved_context`, `input_digest`). Enforced on every MCP surface regardless of `confirmations="off"`, single-command MCP 2026-07-28 only (`afd-batch`, `afd-pipe`, 2025-era requests and no-relay servers fail with `CONFIRMATION_REQUIRED`; acknowledgements and form elicitation are never advertised or accepted). After `RelayApproved`, the server merges non-reserved `approved_context` fields into `context.extra` and attaches server-private off-object relay evidence that `create_approval_middleware` verifies in spec order (`command-mismatch` → `input-mismatch` → `actor-mismatch` → `credentials-mismatch`) and spends once as `relay:<decision_id>` (24h TTL regardless of `replay`), cleared before the handler runs.
- **Approval policy.** Declare `approval="required"`, `"not-required"`, or a function of the input and context, on `define_command` or `@server.command`.
- **Approval middleware.** Install `create_approval_middleware(secret=os.environ["AFD_APPROVAL_SECRET"])` from `afd.server`, after any middleware that sets `context.actor` and after any retry middleware or middleware that changes the input: one approval runs one handler, on the approved input. It decides from the policy of the command each call runs; `commands` is optional, and a policy given there also holds. Middleware that moves `next_fn` to a thread uses `asyncio.to_thread` or `contextvars.copy_context().run`, or a call on a context object that overlapping calls share is refused. A held input with no canonical form gets `APPROVAL_UNAVAILABLE` (`reason: "input-not-canonical"`) and nobody is asked; so does an input a policy function changes (`reason: "admission-mismatch"`). Install one approval middleware per engine: two that both gate a command's own policy each ask for it.
- **Without the middleware,** `create_server` and `create_direct_registry` refuse a command whose policy is not `"not-required"` with `APPROVAL_UNAVAILABLE` before the handler runs (#1886), batch items, pipeline steps and nested calls included. A policy function is not evaluated for that check. Serve a command without its policy where nothing should hold it.
- **The approval flow.** A held call returns `APPROVAL_REQUIRED`; on non-MCP calls `details.approvalToken` is included by default, while on MCP calls (`context.extra["interface"] == "mcp"`) it is omitted by default per Approvals rule 6 unless `include_token=True` is set. Once a human approves, trusted surface code retries the same call with `CommandContext(approval=token)`. The token never comes from tool arguments.
- **Asking over MCP.** `relay="mcp-elicitation"` asks the person behind an MCP client that declares form elicitation instead of returning a token; `afd-batch` and `afd-pipe` are asked about once, up front, and a pipeline whose gated step reads an earlier step runs nothing (`reason: "input-not-known"`). Leave it off where the agent's own code is the MCP client. The relay works through the server's MCP handler only; `route_tool_call` and `execute` never ask.
- **Tokens** are single-use by default (`replay="within-ttl"` to allow repeats) and expire after five minutes on the middleware's `clock`. They verify across TypeScript, Python and Rust servers that share the secret. See [spec/command-metadata.md](../../../spec/command-metadata.md), "Approvals".
- **Per process unless shared.** `confirmation_key` (≥ 32 bytes, validated and copied at creation; else a random key per server) and each single-use approval middleware's `nonce_store` (else memory) hold within one process. Behind several processes share both and pass `create_server(..., instances="multiple")`, which raises `ValueError` when an active default is missing (seeing middleware directly or inside `compose_middleware`); left out, HTTP serving (`streamable_http_app`, `sse_app`, `run` / `run_async` over HTTP) logs one warning per process to stderr, `instances="single"` silences it, and stdio logs nothing.

## DirectClient

`DirectClient(registry)` runs commands in process with `call`, `list_commands`, `has_command` and `pipe(steps, input=...)`. `pipe` uses the same variables as `afd-pipe`.

- **For agent-facing calls,** build the registry with `create_direct_registry(commands, middleware=[...])`. It is exposure-checked on the `agent` interface and validates through the server engine.
- **Client policy.** `DirectClientOptions(allow=..., middleware=[...])` (also keywords on `create_direct_client`) filters discovery and calls; only explicit `True` permits a name. The opaque policy follows nested calls that forward their context and cannot be widened by another registry call. Client middleware wraps each attempt outside registry middleware, within the deadline; approval retries get a fresh actor and observers see no approval tokens.
- **Approvals.** Approve through trusted `DirectClientOptions(on_approval_needed=...)`. Only an explicit `True` permits one private retry, and a caller's `approval` on `DirectCallContext` is ignored. Held results, observers and journals stay token-free.
- **Deadlines.** `DirectCallContext(timeout=ms)` sets one deadline that includes the decision wait.
- **`server.execute`** remains the trusted host API for out-of-band tokens.

## Handoff

- **Built-in handlers.** Call `register_builtin_handlers()` for WebSocket and SSE, then `connect_handoff(result.data, HandoffConnectionOptions(...))`. Guard with `afd.core.handoff.is_handoff`.
- **Credentials** go in an `Authorization: Bearer` header, never in the URL. `create_handoff()` returns camelCase keys (`sessionId`, `expiresAt`, `maxAttempts`, `backoffMs`).
- **Reconnect defaults.** `create_handoff()` includes allowed/3 attempts/1000 ms when no policy is supplied. The client inherits metadata or that shared fallback; explicit `ReconnectionOptions.max_attempts` and `backoff_ms` win, including zero. `None` means inherit.
- **Reconnects.** A reconnect (`create_reconnecting_handoff`, `ReconnectionOptions`) calls `reconnect_command` with `reconnect_args` plus `sessionId`. Declare the reconnect command's parameter as `sessionId`, as in TypeScript.
- **Install** with `pip install afd[client]`.

## CLI

- **`afd validate --surface [--strict] [--verbose]`** validates the agent-facing surface of a server (`--server`, or the saved connection). Its rules include `missing-output-schema`, `missing-context`, `unresolved-prerequisite`, `circular-prerequisite`, `missing-category`, `naming-convention` and `description-quality`. Without `--surface`, it checks the connection, and a mutation or destructive tool without an approval policy gets `MISSING_APPROVAL_POLICY` (an error with `--strict`).
- **`afd tools [--filter TEXT] [--detail TOOL_NAME]`** lists tools. `--detail` needs a tool name. The TypeScript `afd tools` has no `--detail`; it takes `--category`, `--format` and `--refresh`.
- **`afd call TOOL '{"json": "args"}'`** (or `key=value` pairs, as in TypeScript) calls over the saved connection. `-H "Name: value"` and `AFD_HEADERS` send headers on `connect`, `tools`, `call`, `validate`, `shell`, `batch` and `stream`; they are never saved, so a later command needs them again. With `--module file.py`, it loads the module's exported `registry` in process; then `--approve` or an interactive prompt authorizes one retry, and `--timeout ms` sets the deadline. Remote calls take neither.
- **`afd batch` and `afd stream`** take TypeScript's options (`batch -s/-t/-p/-f/-v`, `stream -t/-f/--no-progress`), but the server is `--server`: `batch`'s `-s` is `--stop-on-error`. `batch` exits 2 when some commands fail, and reports `OUTCOME_UNKNOWN` only when the server may have run commands. `stream` needs a server with `/stream/<command>` (the Python server has none) and exits 1 on an error chunk, 130 on Ctrl+C or SIGTERM.

## Testing

`afd.testing` holds the helpers (`afd[testing]`):

- **`test_command(handler, input)`** returns a `CommandTestResult`: `.result`, `.is_success`, `.execution_time_ms` and `.validation`. It calls `handler(input, ctx)` directly, so a decorated handler validates its input, but no middleware, exposure check, approval or metadata stamp runs. For those, use `await server.execute(name, input, context)`.
- **`create_test_context(overrides)`** gives `Actor(kind="test")` and a 5-second timeout. A `now` key stops the clock.
- **More helpers.** `test_command_multiple(handler, cases)` takes `input`, `expect_success` and `expect_error` per case and returns dicts with `passed`. `create_mock_command(name, fn)` wraps a plain function. The non-raising validators are `validate_result(result, ResultValidationOptions(...))`, `validate_error` and `validate_command_definition`.
- **Assertions:** `assert_success`, `assert_error`, `assert_has_suggestion`, `assert_retryable(result, expected=False)`, `assert_step_status(result, step_id, status)` and `assert_ai_result(result, min_confidence=..., require_sources=...)`.
- **Fixtures.** `mock_server`, `isolated_registry` and `command_context` live in `afd.testing.fixtures`. `afd` registers no pytest plugin, so import them, or list the module in `pytest_plugins`.
