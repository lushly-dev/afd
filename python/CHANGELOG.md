# Changelog

All notable changes to the Python `afd` package are documented here. The package is versioned independently of the npm packages and the other implementations, is published to [PyPI](https://pypi.org/project/afd/), and is released with tags of the form `python-vX.Y.Z`.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0, a minor release may break the API.

## [Unreleased]

Serves and speaks MCP 2026-07-28 (stateless, per-request `_meta`) next to the 2025 protocol.

### Breaking changes

- **`mcp>=2.3,<3`:** the `server` and `client` extras move to the MCP Python SDK 2.x. Its `mcp.server.fastmcp` module is gone, so code that reached into the server's SDK object (`server._create_mcp_server()`, `FastMCPTransport.mcp`) now gets an `mcp.server.mcpserver.MCPServer`. SDK result models use snake_case attributes (`is_error`, `input_schema`).
- **Transport options pass through `run()`:** `MCPServer.run()` and `run_async()` accept the SDK's transport options (`host`, `port`, `stateless_http`, `json_response`, `transport_security`, ...). Setting `mcp.settings` on the SDK object no longer works because the SDK removed it.
- **Contexts on MCP 2026-07-28 are request input:** a 2026-07-28 request selects its context with `_meta["dev.afd/context"]` on `tools/list` and `tools/call`; an unknown name is a `-32602` error. There is no session, so `afd-context-enter` and `afd-context-exit` validate but store nothing and return `persisted: false`. 2025 clients on a stateful transport keep one stack per connection; 2025 clients over stateless HTTP still get `SESSION_REQUIRED`.
- **Client transport default:** `McpClientConfig.transport` defaults to `None` and is inferred from the URL: `sse` for `/sse`, `http` for `/message`, and the new `streamable-http` otherwise. It was always `sse`. `afd connect` follows the same rule.
- **`MCP_PROTOCOL_VERSION`** is `2025-11-25`, the newest `initialize`-era revision, instead of `2024-11-05`; `initialize` in the testing server echoes a supported requested version.

### Added

- **`StreamableHttpTransport`** (`afd.transports`, `create_transport("streamable-http", url)`): MCP Streamable HTTP on the SDK's `mcp.Client`. It probes `server/discover`, uses 2026-07-28 when offered and falls back to `initialize`; `McpClientConfig.protocol_mode` (`"auto"`, `"legacy"`, `"modern"`) controls it. `McpClient.stream()` on a `/mcp` URL uses the sibling `/stream` path.
- **`server/discover`** carries `instructions` (new `create_server(instructions=...)`; a description of the meta-tools by default), and `tools/list` carries `ttlMs` and `cacheScope` (new `tools_list_ttl_ms`; 300000 by default, 0 when `contexts` are configured because clients cache `tools/list` without its `_meta`).
- **`MCPServer.streamable_http_app(**options)`** returns the ASGI app for mounting.
- **`MODERN_PROTOCOL_VERSION`** and **`LEGACY_PROTOCOL_VERSIONS`** constants.
- **MCP tool annotations:** a command with `mutation=True` lists `annotations` (`readOnlyHint: false`, `destructiveHint: false`), as `spec/command-metadata.md` specifies.
- **The testing MCP server is dual-era:** `server/discover`, `resultType`, `serverInfo`, cache fields and `-32022` for requests carrying 2026-07-28 `_meta`.
- **Core names at the root ([#348](https://github.com/lushly-dev/afd/issues/348)):** `afd` exports `CommandHandler`, `CommandRegistry`, `create_command_registry`, `WarningSeverity`, `CommandMiddleware` and `NextFn`. The middleware types now live in `afd.core.commands`; `afd.server` and `afd.server.middleware` re-export the same objects. The root `CommandDefinition`, `CommandContext` and `CommandParameter` are still the `afd.direct` dataclasses; build definitions for `create_command_registry()` with `afd.core.CommandDefinition`.
- **`ErrorCode`:** a `str` alias for `CommandError.code`. It is open: custom string codes remain valid next to `ErrorCodes`.
- **`TimeoutController` and `create_timeout_controller(timeout_ms=None)`:** a deadline that starts at creation, with `remaining_ms`, `is_expired` and `await controller.run(awaitable)`, which bounds the await by the time left (not the full budget) and raises `TimeoutError`. Caller cancellation propagates as `CancelledError`. With no timeout it never expires.
- **`create_progress_chunk_with_steps(progress, current_step, total_steps, ...)`:** a convenience over `create_progress_chunk`, as in TypeScript.
- **Actor, clock and random on `CommandContext` ([#400](https://github.com/lushly-dev/afd/issues/400)):** `afd.core.CommandContext` and `afd.direct.CommandContext` gain `actor`, `clock` and `random`, as in TypeScript (#271, #274). New names at `afd` and `afd.core`: `Actor` (`kind`: `human`, `agent`, `service`, `script` or `test`; optional `id`, `label`, `on_behalf_of`), `ActorKind`, `ACTOR_KINDS`, `is_actor`, `is_actor_kind`, `ContextDefaults`, `with_context_defaults`, `Clock`, `ManualClock`, `ClockInstant`, `RandomSource`, `system_clock`, `system_random`, `fixed_clock` (epoch ms, ISO string or `datetime`; `set` and `advance`) and `seeded_random`, which gives the same sequence as TypeScript's `seededRandom` for the same seed (mulberry32 over the FNV-1a hash of the seed's UTF-8 bytes).
  - The server gives every handler a clock and a random source (`create_server(clock=..., random=...)`, real ones by default) and MCP calls the actor `Actor(kind="agent")` (`create_server(actor=...)`); `server.execute()` adds no actor. Results stamp `metadata.actorKind` (the kind only, never the id), now a typed `ResultMetadata.actor_kind`, and `executionTimeMs` is read from the context clock.
  - `DirectClient` calls are `human` unless `DirectClientOptions.actor` or `DirectCallContext.actor` says otherwise; both also take `clock` and `random`.
  - `create_test_context()`, the `command_context` fixture and in-process scenario steps use `Actor(kind="test")`; `create_test_context({"now": ...})` stops the clock at `now`, and `InProcessExecutorConfig.context` sets a step context for handlers that accept a `context` keyword.
  - The telemetry middleware records `actor_kind` and, with the timing middleware, reads time from the context clock.
  - The core registry (`create_command_registry()`) now always passes the handler a context, filled with the real clock and random source.
- **Command name warnings:** `define_command` (so `MCPServer.command` and `register`) and the core registry, for a definition `define_command` has not already checked, emit a `UserWarning` for a name that breaks the `domain-action` kebab-case rule, as TypeScript's `defineCommand` does. The command still registers.
- **`AFDLinter(rule_severity_overrides=...)`:** sets a rule's severity to `"error"` or `"warning"`, or turns it `"off"`, through the same path every finding is emitted on, so `passed`, `error_count` and `warning_count` follow the override. Findings of an `"off"` rule are counted as suppressed with reason `severity-off`. An unknown rule id or severity raises `ValueError` (#268).

### Fixed

- **`SseTransport` on mcp 2.x:** server info and capabilities use the wire names, a dropped event stream is detected again, network errors from the SDK's `httpx2` client count as connection loss, and a tool call that never gets a response is bounded by the transport timeout.

### Deprecated

- **`SseTransport` and `HttpTransport`** (an AFD server's 2024-11-05 `/sse` and `/message` lane) are deprecated in favour of `StreamableHttpTransport`.

## [0.9.0] - 2026-10-11

Implements AFD contract `1.0-rc`.

### Breaking changes

- **MCP discovery and errors:** `afd-discover` and `afd-detail` are available in every tool strategy. Unknown and unexposed tool calls return the structured `COMMAND_NOT_FOUND` result with callable suggestions over FastMCP (#325).

- **Input validation follows the advertised JSON Schema:** raw dict schemas are accepted by command decorators and enforced before middleware, including unknown-key stripping, defaults, nullability, strict JSON primitive types and shared issue codes. Pydantic commands validate the same advertised schema before converting valid UUID and date strings. Unsupported keywords, format names and incompatible regex syntax fail registration with a schema location (#310).
- **Parallel batch failures** stop new starts and let commands already running finish normally; batch deadlines and caller cancellation still cancel outstanding commands (#330).
- **Batch and pipeline timeouts** accept finite nonnegative fractional numbers, and pipeline references use the specified 1,024 UTF-16-unit bound (#329, #283).

- **Wire format:** results use the cross-language format checked by `spec/wire/*.json`: camelCase keys, unset fields omitted rather than `null`, and MCP `isError: true` on failures. Parsing still accepts snake_case. Error `details` keys are camelCase (`expectedFields`, `missingFields`, …). The built-in command payloads (`afd-schema`, `afd-help`, `afd-docs`, `afd-context-list`, `afd-detail`) use the wire format too (#250, #251).
- **Pipeline variables** follow `spec/pipeline-variables.md`, as in every language. `$input` is the request's own `input` field and never the host or caller context; `$`-prefixed literals such as `$9.99` pass through; `$$` escapes; paths follow only own JSON keys and in-bounds indices; unresolved references are omitted; `$eq`/`$ne` compare structurally; nesting deeper than 64 is rejected with `VALIDATION_ERROR`. DirectClient `$alias` references become `$steps.alias` (#250).
- **Security:** pipeline and DirectClient `$ref` paths follow only dict keys and list indices, never attributes or `_`-prefixed names. Previously any MCP client could read server process globals and environment through `afd-pipe` (#232).
- **Security:** `afd-help`, `afd-docs`, `afd-schema`, `afd-detail` and `afd-call` only see MCP-exposed commands. `afd-call` on a command that is not exposed returns `COMMAND_NOT_FOUND` (#232).
- **Security:** handler exceptions are logged to the `afd.server` logger and returned as "An internal error occurred" unless the new `create_server(dev_mode=True)` is set. Invalid input returns `VALIDATION_ERROR` with structured details (#232).
- **Dependencies:** the extras depend on `mcp>=1.19,<2` directly instead of the unused `fastmcp`, drop the unused `httpx-sse`, and require `websockets>=14`. `afd[cli]` includes the client transports (#232).
- **Unsupported options fail instead of being ignored:** a pipeline with `parallel: true`, or a step with `stream: true`, fails that step with `UNSUPPORTED_OPTION` and skips every other step before any command runs. `stream: false` is still accepted. `BatchOptions` and `PipelineOptions` reject unknown fields (#225, #253).
- **Batches and pipelines** coerce every item to a `CommandResult` (`INVALID_COMMAND_RESULT` for a plain dict), reject built-in tools as steps, and cap size and parallelism (`max_batch_size=500`, `max_batch_parallelism=16`) (#251).
- **Batch and pipeline envelopes are checked as TypeScript checks them** (`spec/vectors/batch-controls.json`). Before anything runs, `afd-batch` and `afd-pipe` reject:
  - a blank command name;
  - `null` in place of an omitted optional field, such as `id`, `as` or `options` (a Python caller building the models may still pass `None`);
  - a string or number where a boolean belongs, and a string or boolean where a number belongs.

  A rejected batch returns a failed `BatchResult` with "Invalid batch request envelope", and a rejected pipeline returns one step at index -1 with `INVALID_PIPELINE_REQUEST`. Some malformed envelopes used to return a plain `CommandResult` ("Invalid batch request format") instead (#317).
- **Handoff:** the client sends the token as an `Authorization: Bearer` header instead of a query parameter. `ReconnectingHandoffConnection` passes the session to its reconnect command as `sessionId`, the wire name TypeScript uses, instead of `session_id`; the `ReconnectionOptions.session_id` attribute is unchanged, but a reconnect command that read `session_id` must read `sessionId` (#251, #253).
- **Retry middleware:** `create_retry_middleware()` backs off exponentially with a cap and jitter, like TypeScript, instead of linearly: retry `n` waits `min(max_delay, retry_delay * 2 ** (n - 1))` ms, randomized to between half and all of that. Invalid options (a negative or non-integer `max_retries`, a negative `retry_delay` or `max_delay`, an infinite `max_delay`) raise `ValueError`, as in TypeScript (#253).
- **Dispatch order:** the MCP server checks a call in the TypeScript order before any middleware runs: lookup, exposure, active context, then input validation. Logging, retry, rate-limit and telemetry middleware no longer see unknown commands or invalid input, and a rejected call no longer spends a rate-limit slot. Middleware receives the validated input (the schema's model instance), and a handler exception passes out through the middleware before it becomes `COMMAND_EXECUTION_ERROR`. An unknown command gets the "Did you mean" suggestion on `server.execute`, batch and pipeline steps, and `afd-call`, naming only commands the caller could call. `input=None` validates as `{}`, so a missing required field returns `VALIDATION_ERROR` instead of crashing the handler (#304).
- **Unknown and unexposed commands** follow `spec/error-codes.md` (D4). `INVALID_INTERFACE` is gone: in the core registry and the server, an interface other than `palette`, `mcp`, `agent` or `cli` exposes nothing and returns `COMMAND_NOT_EXPOSED` (`retryable: false`), and an empty interface is treated as no interface, as in TypeScript.

### Migration

- Read serialized result and built-in payload fields as camelCase; Python model attributes remain snake_case, and parsing still accepts snake_case. Omitted optional fields are absent from wire output.
- Declare `expose=ExposeOptions(mcp=True)` for commands intended for MCP, update reconnect handlers to read `sessionId`, and send handoff tokens in the `Authorization: Bearer` header.
- Make inputs conform to their advertised JSON Schema before dispatch. Remove unknown batch/pipeline option fields, omit unused optional envelope fields instead of sending `null`, and remove unsupported parallel/stream options. Catch `ValueError` for invalid retry options and review exponential backoff timing.
- Use pipeline `$input` only for request input, replace attribute/private-name references with explicit JSON keys, and check `success` when a successful result can contain `None`.
- Expect redacted handler errors by default; use `dev_mode=True` only when development diagnostics are needed. Handle `SESSION_REQUIRED` for context mutation on stateless HTTP, and supply positive finite DirectClient deadlines in milliseconds.
- Treat unknown or hidden MCP tools as `COMMAND_NOT_FOUND`; update callers that handled `INVALID_INTERFACE` to handle `COMMAND_NOT_EXPOSED`. Discover commands through `afd-discover`/`afd-detail` in every strategy. Allow already running parallel batch commands to complete after `stopOnError`, and use fractional batch/pipeline timeout values only within the finite nonnegative range.
- Install `afd[client]`, `afd[server]` or `afd[cli]` for optional integrations; base `afd` supports local DirectClient use without HTTP/MCP dependencies. The planned 0.10.0 server-defaults milestone is separate from this release.

### Stabilization

- Bind MCP contexts to trusted SDK transport sessions, cap stacks at 16, preserve independent discovery/execution, and return `SESSION_REQUIRED` for context mutation on stateless HTTP (#353).
- Enforce positive finite DirectClient deadlines in milliseconds; reject booleans as numbers and require JSON-shaped object/array inputs. Cancellation requests do not guarantee mutation rollback (#354).
- Recognize `success(None)` by its success discriminant and cap decoded SSE frames at 1 MiB by default (#354).
- Reconnect MCP clients after HTTP/SSE connection loss or idle SSE EOF, refresh discovery, cancel obsolete attempts and never replay uncertain in-flight calls (#354).
- Add real subprocess/socket protocol tests for individual/grouped/lazy strategies over SSE and Streamable HTTP. See [`spec/protocol-conformance.md`](../spec/protocol-conformance.md) for the shared acceptance index and coverage limits (#361).
- Consume the shared 34-case / 130-test validation fixture; use 24 batch, 25 pipeline, 51 reference and 27 condition cases. Unsupported schema syntax rejects registration, and issue comparisons preserve duplicates while allowing sibling ordering differences.

### Added

- `max_delay` (default 5000) and `jitter` (default `True`) keyword arguments for `create_retry_middleware()` (#253).
- `DirectClient`'s `PipelineStep` has a `stream` field, so dict and typed steps are checked the same way (#253).
- `AFD_META_TOOL_NAMES`, `AFD_BOOTSTRAP_COMMAND_NAMES`, `AFD_CONTEXT_COMMAND_NAMES`, `AFD_BUILTIN_TOOL_NAMES` and `is_afd_builtin_name`, exported from `afd` (`afd.core.builtin_names`), with the same names as the other languages (#292).
- The similarity helpers in `afd.core.similarity` (#279).
- CI: `python.yml` runs pytest on Python 3.10–3.12, bug-class ruff rules, `uv lock --check`, and a clean-venv install smoke test for each extra (#234).
- `afd.CONTRACT_VERSION`, the AFD contract version from `spec/VERSION` (now `1.0-rc`). `afd-help` returns it as `contractVersion` (#313).
- `ErrorCodes` holds the 42-code shared catalog of `spec/error-codes.md`, adding the routing, context, batch, pipeline and stream codes the engines already emit, such as `COMMAND_NOT_EXPOSED`, `UNKNOWN_TOOL`, `BATCH_TIMEOUT` and `STREAM_TIMEOUT`. `tests/test_error_codes.py` checks it against `spec/vectors/error-codes.json`.

### Changed

- The MCP server's `afd-batch` honors `parallelism`, `timeout` and `stopOnError`, and preserves result order. Pipelines enforce `timeout_ms` with `PIPELINE_TIMEOUT`, and an exception in a step becomes `COMMAND_EXECUTION_ERROR` (#225).
- A missing or mistyped MCP argument returns a structured `VALIDATION_ERROR`. `McpClient` keeps TypeScript failure details and all result fields, and posts to `/message`. Server telemetry goes to stderr (#250).
- Fuzzy "did you mean" matching and echoed unknown names follow TypeScript's `similarity.ts`, counting UTF-16 code units (an emoji is two). A name over 128 units gets no suggestions instead of being matched on a truncated prefix. Echoed names are cut at 128 units plus `…` and never split a surrogate pair. `afd-detail` uses the same matcher and suggestion text as TypeScript (up to three close matches) instead of `difflib` (#232, #279).
- `exec_command()` defaults to a 5-minute timeout. `afd connect` accepts only http(s) URLs or `mock` (#251).

### Fixed

- A base `pip install afd` imports again: MCP client exports load lazily, and `afd --help` no longer needs pytest (#232).
- There is a single `CommandError` class, so `failure(not_found_error(...))`, DirectClient error paths, and `afd-batch` timeout/`stopOnError` return results instead of raising `ValidationError`. Serialized output is unchanged (#232).
- The `scenario-evaluate` command honors its documented `concurrency` and `timeout` options and reports each scenario's file path (#234).
- **Security:** `scenario-create` and `scenario-evaluate` stay inside the project root (symlinks included), sanitize scenario names, and only read `*.scenario.yaml`/`*.scenario.yml` files (#251).
- Batches cancel in-flight siblings when they stop, and malformed pipeline conditions are rejected up front (#251).
- The handoff client reads WebSocket and SSE connections in the background, and `ReconnectingHandoffConnection` cleans up its tasks on `close()` (#251).
- `exec_command()` and the testing `CliWrapper` kill and reap child processes when the caller is cancelled. The rate limiter evicts expired windows and tracks at most `max_keys` keys. Blind excepts now log, and a crashing `SimpleRegistry` handler is `COMMAND_EXECUTION_ERROR` (#251).
- `afd validate --surface` validates a server's commands, not its tools, when the server does not list `afd-help`/`afd-schema` (for example a TypeScript server). Grouped tools are expanded from `_meta.actions`, lazy servers are enumerated with `afd-discover` and `afd-detail`, and AFD's built-in tools are skipped. The HTTP transport keeps `_meta` in `tools/list` (#292).
- **Security:** `afd-batch` and `afd-pipe` answered a command that is not MCP-exposed with `COMMAND_NOT_EXPOSED`, revealing that it exists; they now answer `COMMAND_NOT_FOUND`, exactly as for an unknown name. A tools/call for such a command no longer returns `COMMAND_NOT_IN_CONTEXT` when a context is active.
- `DirectClient`'s `UNKNOWN_TOOL` error has a `suggestion` (the closest match, or `list_command_names()`) and `retryable: false`, as in TypeScript and C++.
- The core registry's `COMMAND_NOT_IN_CONTEXT` suggestion names the command's contexts instead of the `afd-context-*` tools, which the core registry does not provide.
- A `when` condition treats a first operand that is not a reference (`"$$prev"`, `"text"`) as absent, as TypeScript does, so `{"$exists": "$$prev"}` is false. `tests/test_pipeline_vectors.py` and `tests/test_batch_controls_vectors.py` now load the shared `spec/vectors` files (#317).
- **Security:** the core registry (`create_command_registry`), the core pipeline (`execute_pipeline`) and `SimpleRegistry` no longer return exception text. A raising handler returns `COMMAND_EXECUTION_ERROR` with "An internal error occurred" and is logged, unless the new `dev_mode=True` is set. The shared helper is `afd.core.execution_failure` (#304).

## [0.8.0] - 2026-07-07

### Added
- `AFDLinter` calibration options: `exclude_story_test_files` (default on) skips story/test files for the UI-directory rules, and `rule_path_excludes` provides per-rule, separator-normalized path excludes (#193)
- `afd-no-direct-fetch` accuracy: comment-line matches and `fetch('data:...')` string-literal loads no longer flag; new line-scoped `afd-lint-disable: <reason>` inline suppression directive (reason required) (#193)
- `LintResult` suppression reporting: `suppressed_total`, `suppressed_by_rule`, `suppressed_by_reason`, and `suppressed_summary()` (#193)
- Dedicated linter test suite (`python/tests/test_linters.py`) (#193)

## [0.7.0] - 2026-04-03

### Added
- Python AFD functional parity for framework-agnostic, agent-visible features:
  - first-class command metadata for output schemas, prerequisites, contexts, validated examples, and explicit grouping categories
  - server tool strategies for `individual`, `grouped`, and `lazy` discovery, including `afd-call`, `afd-batch`, `afd-pipe`, `afd-discover`, and `afd-detail`
  - context bootstrap commands (`afd-context-list`, `afd-context-enter`, `afd-context-exit`) plus context-aware discovery and actionable stale-call errors
  - richer bootstrap surfaces in `afd-help`, `afd-docs`, and `afd-schema`, plus Python surface-validation support for missing output schemas and missing configured contexts

### Changed
- Documented the Python parity target as functional AFD parity across framework-agnostic capabilities and agent-visible behavior, with language-specific APIs allowed to differ when that better fits the host language
- Updated AFD skill guidance to keep parity decisions aligned across TypeScript, Python, and Rust implementations
- Clarified that Changesets cover released `@lushly-dev/*` npm packages, while Python-only work follows the separate PyPI release flow

## [0.6.0], [0.3.0] and [0.2.0]

These were released together with the repository-wide releases of the same period, and their notes are in the [changelog archive](../docs/changelog-archive.md): 0.6.0 under 0.6.0 (2026-03-13), 0.3.0 under 0.3.0 (2026-02-27, the Python–TypeScript parity work), and 0.2.0 under 0.2.0-beta (2026-02-20, the Python DirectClient and `pipe()`). There were no Python 0.4.0 or 0.5.0 releases.

## [0.1.2] - 2026-01-13

### Added

- **Automated PyPI Publishing** - GitHub Actions workflow with OIDC Trusted Publishing
  - No API tokens needed — uses GitHub OIDC for authentication
  - Triggers on `python-v*` tag push or GitHub Release
  - Version validation ensures tag matches `pyproject.toml`
  - Full test suite runs before publish

### Changed

- Workflow file: `.github/workflows/publish-python.yml`
- Requires GitHub Environment `pypi` for deployment protection

## [0.1.1] - 2026-01-13

### Added

- **`suggestions` field** - Added `suggestions: Optional[List[str]]` to `CommandResult` and `success()` helper
  - Enables helpful next-step hints for users (e.g., "Use lora.activate to enable this LoRA")
  - Discovered via Noisett dogfooding - their commands relied on this UX pattern

### Changed

- Published to PyPI: `pip install afd>=0.1.1`

[Unreleased]: https://github.com/lushly-dev/afd/compare/python-v0.9.0...main
[0.9.0]: https://github.com/lushly-dev/afd/compare/python-v0.8.0...python-v0.9.0
[0.8.0]: https://github.com/lushly-dev/afd/compare/python-v0.7.0...python-v0.8.0
[0.7.0]: https://github.com/lushly-dev/afd/compare/python-v0.6.0...python-v0.7.0
[0.6.0]: https://github.com/lushly-dev/afd/compare/python-v0.3.0...python-v0.6.0
[0.3.0]: https://github.com/lushly-dev/afd/compare/python-v0.2.0...python-v0.3.0
[0.2.0]: https://github.com/lushly-dev/afd/compare/python-v0.1.2...python-v0.2.0
[0.1.2]: https://github.com/lushly-dev/afd/tree/python-v0.1.2
