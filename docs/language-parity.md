# AFD Language Parity

What each AFD implementation provides, where they differ, and which differences are intended.

| Field | Value |
|---|---|
| Updated | 2026-09-27 |
| Reviewed at | `0777217` (`main`) |
| Implementations | TypeScript (reference), Python, Rust, C++ |
| Replaces | The export counts in the [Python](./features/active/python-parity/python-parity.plan.md) and [Rust](./features/active/rust-parity/rust-parity.plan.md) parity plans, which now link here |
| Plans | [Parity closure](./features/active/parity-closure/parity-closure.plan.md) closes the gaps listed here; [Versioning and release](./features/active/versioning/versioning.plan.md) covers each implementation's version and the contract version |
| Related | [`spec/wire`](../spec/wire/README.md), [`spec/pipeline-variables.md`](../spec/pipeline-variables.md), [`spec/command-metadata.md`](../spec/command-metadata.md), [`spec/vectors`](../spec/vectors/README.md), [C++ proposal](./features/proposed/cpp-support/proposal.md), [2026-09-23 quality review](./reviews/2026-09-23-quality-review.md) |

## What parity means

The `afd` skill defines parity as a **shared capability contract and agent-visible behavior**, not identical symbols. A language may rename helpers or reshape modules. It should not change what an agent sees.

The contract has three layers:

1. **Wire shapes.** `CommandResult`, errors, batch, pipeline and stream results serialize identically. `spec/wire` enforces this.
2. **Behavior.** Dispatch order, validation, exposure, batch/pipeline/stream semantics and error codes match. `spec/pipeline-variables.md`, `spec/vectors` and the todo conformance suite enforce parts of this.
3. **Surfaces.** An MCP server, meta-tools, clients and tooling. These depend on the host, and some languages leave them out on purpose.

**TypeScript is the behavioral reference:** `packages/server/src/execution.ts` for single commands, and `packages/core/src/command-execution.ts` and `pipeline-executor.ts` for batch, stream and pipeline.

## Implementations at a glance

| | TypeScript | Python | Rust | C++ |
|---|---|---|---|---|
| Package | 9 `@lushly-dev/*` packages | `afd` | `afd` crate | `afd-cpp` (`afd::afd`) |
| Version | 2.0.0 | 0.8.0 | 0.1.0 | 0.1.0, release candidate |
| Contract | 1.0-rc (`AFD_CONTRACT_VERSION`) | 1.0-rc (`afd.CONTRACT_VERSION`) | 1.0-rc (`afd::CONTRACT_VERSION`) | 1.0-rc (`afd::contract_version`) |
| Distribution | npm | PyPI | Git or path dependency; not on crates.io | CMake `FetchContent`, `find_package`, `add_subdirectory`; the `afd-cpp-v0.1.0` tag is not cut yet |
| Scope | Full stack: core, MCP server, MCP client, DirectClient, CLI, auth, testing, UI packages | Full stack in one package: core, FastMCP server, client, DirectClient, CLI, testing, platform and connectors | Core library, validating registry, batch and pipeline executors, bootstrap commands. No server or client | Core library, validating registry, middleware, `DirectClient`, batch, pipeline and stream executors. No server or client |
| Todo backend | stdio (SDK) | stdio (FastMCP) | Streamable HTTP (hand-rolled, axum) | stdio (hand-rolled) |
| CI | `ci.yml` (`pnpm check`) | `python.yml` | `rust.yml` | `cpp.yml` |
| Skill | `afd-typescript` | `afd-python` | `afd-rust` | `afd-cpp` |

## How parity is checked today

| Check | What it proves | TS | Python | Rust | C++ |
|---|---|---|---|---|---|
| `spec/wire` round-trip, 6 fixtures | Wire shapes | Yes (generator) | Yes | Yes | Yes |
| `spec/vectors/pipeline-variables.json`, 48 references and 27 conditions | Pipeline reference and `when` behavior | Generator only | **No** | **No** | Yes |
| Todo conformance, 34 cases (`conformance.yml`) | Domain results through MCP `tools/call` | Yes | Yes | Yes | Yes |
| `alfred parity` name budget (`alfred/tests/test_parity.py`) | Exported names | Reference | 97 missing (budget 97) | 9 missing (budget 9) | 73 missing (budget 73) |
| `alfred parity` contract version, `scripts/check-versions.mjs` | The contract constant equals `spec/VERSION` | Yes | Yes | Yes | Yes |

Limits of these checks:

- **The conformance suite tests the todo domain, not the AFD protocol.** Its 34 cases call todo commands and check result fields. They do not exercise:
  - meta-tools, bootstrap or discovery;
  - exposure;
  - the batch, pipeline or stream executors;
  - unknown-command handling.
- **Name parity is not behavioral parity.** Rust is 9 names short of TypeScript but has no MCP server and no stream executor. Python is 97 names short, but 61 of those exist and are just not exported (see [Name parity](#name-parity-alfred-parity)).
- **Only C++ consumes the behavior vectors.** A pipeline change in TypeScript, Python or Rust can drift unnoticed.

## Capability matrix

**Legend:**

- **Yes**: implemented and matches the reference.
- **Partial**: present, with a gap or divergence noted in the cell.
- **No**: absent and not declared intentional. This is a gap to close.
- **Deferred**: absent, and a plan says "later".
- **N/A**: absent by design (see [Intended differences](#intended-differences)).

### Wire contract

| Capability | TypeScript | Python | Rust | C++ |
|---|---|---|---|---|
| `CommandResult`, `CommandError`, metadata shapes (camelCase, unset omitted) | Yes | Yes | Yes | Yes |
| `Warning`, `Source`, `PlanStep`, `Alternative` | Yes | Yes | Yes | Yes |
| `ErrorCodes` catalog (22 codes) | Yes | Yes | Yes | Yes, plus 15 executor codes |
| `success` / `failure` / `error` constructors | Yes | Partial: `failure()` accepts only `warnings` and `metadata` | Partial: `FailureOptions` has no `alternatives` or `undo*` | Yes |
| `isSuccess` / `isFailure` test only `success` | Yes | Partial: `is_success` also requires `data` | Yes | Yes |

### Command definition

| Capability | TypeScript | Python | Rust | C++ |
|---|---|---|---|---|
| Core metadata: name, description, category, tags, version, mutation, requires, contexts, expose, handoff, examples, executionTime | Yes | Partial: the decorator has no `version`, `errors` or `execution_time`; `MCPServer.command` drops `handoff` | Yes | Yes (`requires` is `prerequisites`) |
| `destructive`, `confirmPrompt`, `undoable` ([`spec/command-metadata.md`](../spec/command-metadata.md)) | Yes: on core `CommandDefinition` and `defineCommand`; `_meta` has `destructive` and `undoable`, afd-detail all three | No | No | Yes |
| Kebab-case name rule | Warns in `defineCommand` | Partial: `validate_command_name` exists but nothing calls it | Yes, rejects at registration | Yes, rejects at registration |
| Duplicate and reserved names | Throws for meta-tools, and for bootstrap and context names when enabled | Partial: meta-tools only; a command named like a bootstrap tool silently shadows it | Partial: bootstrap names only | Yes: meta-tools (C++ has no bootstrap or context tools) |
| Input validated before the handler | Zod; unknown keys stripped | Yes: Pydantic, before middleware; `None` validates as `{}` | Partial: JSON Schema subset; undeclared keys pass through | Yes: JSON Schema subset; unsupported keywords fail registration |
| Examples validated at definition | Yes | Yes | No: stored only | Yes |
| Output schema advertised | Yes (`_meta.outputSchema`) | Yes | Partial: `returns` not surfaced by `afd-schema` | No: stored, never emitted |
| Command to MCP tool with `_meta` | Yes | Partial: no `category`, `destructive` or `undoable` in `_meta` | Partial: `command_to_mcp_tool`, no plural helper | Deferred |

### Single-command execution

| Capability | TypeScript | Python | Rust | C++ |
|---|---|---|---|---|
| Dispatch order: lookup, context, validation, middleware, handler, stamp, `onCommand` | Reference | Partial: matches through the stamp; no `onCommand` hook | Partial: no stamping or hooks | Yes |
| "Did you mean" on an unknown command | Yes | Yes | Yes (points to `afd-help`) | Yes |
| Exposure enforced | Yes: the remote engine holds only MCP-exposed commands | Yes | Yes | Yes, when `context.surface` is set |
| Active-context scoping | Yes: a stack per session, depth 16 | Partial: one process-global, unbounded stack | No: `contexts` is metadata only | Partial: `active_context` is supplied by the caller |
| Result metadata stamped (`executionTimeMs`, `commandVersion`, `traceId`) | Yes | Partial: no `commandVersion` | No | Yes |
| `onCommand` / `onError` hooks | Yes | No | No | Yes |
| A thrown error becomes a redacted `COMMAND_EXECUTION_ERROR` | Yes (`devMode` shows detail) | Yes (`dev_mode` shows detail in the server, `create_command_registry`, `execute_pipeline` and `SimpleRegistry`) | Yes: a panic in `execute`, a batch or a pipeline (`execution_failure`); there is no dev mode to show detail | Yes, when built with exceptions |
| Cancellation | `AbortSignal` | No signal; `timeout` declared but not enforced | Per-command timeout drops the future; no signal | Cooperative `CancellationToken` and deadline |

### Middleware

| Capability | TypeScript | Python | Rust | C++ |
|---|---|---|---|---|
| Middleware chain | Yes | Yes | Yes | Yes |
| `defaultMiddleware()`: trace ID, logging, timing | Yes | Yes | No | Yes |
| Retry, rate limit, telemetry | Yes | Yes | No | Deferred |
| Tracing (OpenTelemetry-shaped), `composeMiddleware` | Yes | Yes | No | No: not declared |
| Auth middleware | Yes (`packages/auth`) | No | No | N/A: built by the host |

### Batch, pipeline and stream

| Capability | TypeScript | Python | Rust | C++ |
|---|---|---|---|---|
| Batch executor with the reference defaults (`stopOnError` false, parallelism 1, whole-batch deadline) | Yes | Partial: only the private `MCPServer._execute_batch`; adds limits of 500 commands and parallelism 16 | Yes: `CommandRegistry::execute_batch`, no free function | Yes |
| Pipeline variables per `spec/pipeline-variables.md`: `$prev`, `$first`, `$steps`, `$input`, `$$`, the `__` guard, caps of 64 and 1024 | Yes | Yes (core) | Yes | Yes |
| `when` conditions | Yes | Yes | Yes | Yes (as validated JSON) |
| Pipeline aggregation (confidence, reasoning, warnings, sources, alternatives) | Yes | Yes | Yes | Yes (internal helpers) |
| One pipeline engine | Yes | No: core `execute_pipeline` and `DirectClient.pipe` differ in options and result shape | Yes | Yes |
| Stream chunk types, `consumeStream`, `collectStreamData` | Yes | Yes | Yes (`consume_stream` takes a synchronous iterator) | Yes |
| Stream executor | Yes (runs to completion, then chunks) | No | No | Yes (returns a vector) |
| Timeout controller, progress-with-steps helpers | Yes | No | Partial: `TimeoutController` tracks elapsed time only | N/A: `CancellationSource` covers the timeout controller |

### Handoff, telemetry and similarity

| Capability | TypeScript | Python | Rust | C++ |
|---|---|---|---|---|
| `HandoffResult`, `createHandoff`, default reconnect policy (3 attempts, 1000 ms) | Yes | Partial: `create_handoff` applies no default policy | Partial: `is_handoff_protocol` and `is_handoff_command` mean different things; `handoff:<p>` tags are ignored | Yes |
| Handoff client: WebSocket and SSE handlers, reconnect | Yes: reconnect falls back to the default policy | Partial: reconnect falls back to 5 attempts, not the default policy's 3 | No | No: not declared |
| `TelemetryEvent`, `TelemetrySink` | Yes | Partial: the core event serializes snake_case, and the middleware defines a second copy | Partial: `durationMs` is an integer | Deferred |
| Telemetry middleware | Yes | Yes | No | Deferred |
| `calculateSimilarity`, `findSimilarTools` (128 cap, 0.4 threshold) | Yes | Yes (not exported from `afd`) | Yes (counts chars, not UTF-16 units) | Yes |

### MCP server

| Capability | TypeScript | Python | Rust | C++ |
|---|---|---|---|---|
| MCP server in the library | Yes | Yes (FastMCP) | No: the todo backend hand-rolls one | Deferred: the todo backend hand-rolls stdio |
| MCP Streamable HTTP | **No**: custom `/sse` and `/message` routes, protocol `2024-11-05` | Yes, through `run_async` | Todo backend only | N/A: no HTTP by design |
| Tool strategies: individual, grouped, lazy | Yes (default grouped) | Partial: default individual; grouped has no `afd-detail` or per-action schemas | No | Deferred |
| Meta-tools: `afd-call`, `afd-batch`, `afd-pipe`, `afd-discover`, `afd-detail` | Yes | Yes | No | Deferred |
| Bootstrap: `afd-help`, `afd-docs`, `afd-schema` | Yes, opt-in | Partial: always registered and MCP-exposed | Yes (`register_bootstrap_commands`) | Deferred |
| Context tools: `afd-context-list`, `-enter`, `-exit` | Yes | Partial: backed by the global stack | No | No |
| HTTP hardening: Host/Origin checks, body cap | Yes | Not configured; left to FastMCP defaults (not verified) | Todo backend only | N/A |
| MCP JSON-RPC types and helpers | Yes | Partial: Pythonic names; no notification type or error-code constants | Yes | Deferred |

### Clients and tooling

| Capability | TypeScript | Python | Rust | C++ |
|---|---|---|---|---|
| MCP client: call, batch, pipe, stream | Yes | Partial: `auto_reconnect` is never used; `stream` only works against the TS server | No | No: not declared |
| In-process client (`DirectClient`) with `allow`, exposure, timeout, `pipe` | Yes | Partial: no exposure, `allow`, middleware or timeout | Partial: `execute` with an interface; no `pipe` or unknown-tool helper | Yes (see [defects](#defects-found-in-this-review)) |
| CLI | Yes | Partial: no `batch`, `stream` or `scenario` | N/A | N/A |
| Auth adapter | Yes | No | No | N/A: built by the host |
| Testing: JTBD scenarios, surface validation (13 rules), assertions | Yes | Yes | No | No |
| UI: view-state, adapters, local-db, React hooks | Yes | N/A | N/A | N/A |
| Platform utilities and connectors (exec, GitHub, package manager) | Yes (subpath exports) | Yes | Partial: types only | Deferred (connectors) |

## Intended differences

These gaps are appropriate. They follow the framework-agnostic rule, a language's idioms, or the C++ scope principle.

| Difference | Where | Why it is fine |
|---|---|---|
| UI packages (`view-state`, `adapters`, `local-db`) and auth React hooks | TypeScript only | The `afd` skill keeps React and browser integration in ecosystem layers, outside the core parity target. |
| No HTTP transport, engine adapters, auth or approval in the library | C++ | The C++ [scope principle](./features/proposed/cpp-support/proposal.md#scope-principle-host-agnostic): hosts build these on middleware, `CommandContext::extra`, `TaskRunner` and `Clock`. |
| Synchronous handlers and cooperative deadlines | C++ | Decision D4. A late finish still produces the reference `TIMEOUT` result and error codes; nothing is interrupted. |
| `CancellationSource` instead of a timeout controller | C++ | It is the C++ idiom for `AbortSignal` plus a deadline. |
| Renames: `requires` to `prerequisites`, `interface` to `surface` | C++ | `requires` is a C++20 keyword, and `<windows.h>` defines `interface`. |
| Renames: `success_with`, `failure_with`, `ResultOptions` | Rust | They stand in for TypeScript's option spreads. |
| Pythonic MCP names (`TextContent`, `ToolDefinition`, `mcp_request`) | Python | Same capability, different names. |
| Typed condition guards (`isEqCondition` and nine more) | Missing in Python and C++ | They are TypeScript discriminated-union artifacts. Pydantic models (Python) and validated JSON (C++) do the same job. |
| JSON Schema validation instead of Zod or Pydantic | Rust, C++ | Each language uses its own validator. The subsets still need a shared spec (see [Unintended gaps](#unintended-gaps)). |
| No CLI | Rust, C++ | One CLI serves every language, provided the language ships an MCP server the CLI can reach. |
| Platform utilities and connectors | Optional everywhere | These are ecosystem helpers, not the command contract. TypeScript removed them from the core barrel. |
| Rust-only extensions: batch `maxFailures`, per-command `timeout_ms` | Rust | Additive. They should be documented or proposed for the other languages. |

## Declared deferred

These gaps are planned. They are listed so the name budgets stay honest.

- **C++** (the [proposal scope table](./features/proposed/cpp-support/proposal.md#scope) and work plan PR 5a):
  - MCP JSON-RPC types and helpers, and perhaps an optional `afd::mcp_stdio` target;
  - the meta-tools and bootstrap commands;
  - retry, rate-limit and telemetry middleware, and the telemetry types;
  - connectors;
  - `CommandParameter`;
  - streamable-command metadata.
- **Rust** (the `afd-rust` skill's parity note): an MCP server, active-context scoping at execution time, and the server-side tool strategies.

**No plan mentions these gaps.** A decision is needed on each:

- **C++:** an MCP client, a CLI, a testing toolkit, a handoff client, and `composeMiddleware` or tracing middleware.
- **Rust:** a stream executor, built-in middleware, an MCP client and a testing toolkit.
- **Python:** an auth adapter.

## Unintended gaps

Ordered by how much an agent or a security boundary is affected.

### Priority 1: agent-visible behavior and safety

1. **Python dispatch order.** Fixed. The server runs lookup (with "did you mean"), exposure, active context and input validation before the middleware chain (`python/src/afd/server/factory.py`, `_prepare_command`). Middleware now sees only calls that reach a handler, with validated input. `input=None` validates as `{}`, so a missing required field returns `VALIDATION_ERROR` instead of crashing the handler.
2. **Exception text reaches callers.**
   - **Python:** fixed. The core registry, the core pipeline and `SimpleRegistry` return `COMMAND_EXECUTION_ERROR` with "An internal error occurred" and log the exception. Each takes a `dev_mode` flag, as the server does.
   - **Rust (fixed):** single `CommandRegistry::execute` did not catch panics; only batch and pipeline did. It now catches a panic in middleware or the handler, and returns the redacted error.
3. **Crash error code (fixed).** Rust returned `INTERNAL_ERROR` where the reference returns `COMMAND_EXECUTION_ERROR`, and its `error_codes` omitted that code. `execute`, batch and pipeline now return `COMMAND_EXECUTION_ERROR` through the exported `execution_failure`, and `error_codes` has the code.
4. **`is_success` in Python** returns false for `success(None)`. Rust had the same gap, and its `is_failure` returned false for `{success: false}` with no error; both Rust guards now test only `success` (fixed).
5. **The Python `DirectClient` has no boundary.** It has no exposure check, `allow` predicate, middleware or timeout. This is the in-process gap that Theme 4 of the 2026-09-23 review flagged; TypeScript and C++ have closed it.
6. **Python context state** is one process-global, unbounded stack, shared by every client. TypeScript keeps one per session, capped at 16.
7. **Python `SseDecoder` has no event-size cap.** TypeScript caps events at 1 MiB.
8. **Python defaults differ from TypeScript.**
   - The bootstrap tools are always registered and MCP-exposed; in TypeScript they are opt-in.
   - The default tool strategy is `individual`; in TypeScript it is `grouped`.

### Priority 2: shared executors and cross-language tests

9. **Wire `spec/vectors` into TypeScript, Python and Rust.** Only C++ consumes it today.
10. **Add a stream executor to Python and Rust,** and a public batch executor to Python. Collapse Python's two pipeline engines into one.
11. **Rust single-command engine:**
    - result metadata stamping;
    - active-context scoping;
    - `onCommand` and `onError` hooks;
    - the built-in middleware bundle.
12. **Validation divergences.** None of these has a spec, so a shared `spec/vectors/validation.json` would pin them.
    - **Rust** passes undeclared keys through; TypeScript strips them.
    - **Message text:** Rust uses `"Input validation failed for '<cmd>': …"`; TypeScript uses `"Input validation failed"`.
    - **String length:** TypeScript counts UTF-16 units; Python, Rust and C++ count code points. Rust also counts chars for name truncation and the reference cap.
    - **JSON Schema subsets differ.**
      - Rust has no `minItems` or `maxItems`: arrays reuse `minLength` and `maxLength`. It also has no `additionalProperties: false` and no combinators.
      - C++ rejects `pattern`, `format`, `const` and the combinators.
13. **Command metadata** ([`spec/command-metadata.md`](../spec/command-metadata.md) lists the fields).
    - Python's decorator lacks `version`, `errors`, `execution_time`, `destructive`, `confirm_prompt` and `undoable`.
    - Rust lacks `destructive`, `confirmPrompt` and `undoable`.
14. **Handoff.**
    - Python's `create_handoff` applies no default reconnect policy, and its handoff client falls back to 5 attempts where the default policy has 3.
    - Rust's guard helpers differ in meaning.
15. **Python MCP client:** `_attempt_reconnect` is never called, so `auto_reconnect=True` does nothing.
16. **C++ metadata cannot reach the wire.**
    - There is no command-to-MCP-tool conversion and no `to_json` for `CommandDefinition`.
    - The todo backend's `tools/list` sends no `_meta` or `outputSchema`.
    - Suggestions copied verbatim from TypeScript name `afd-discover` and `afd-context-*`, which C++ does not have.

### Priority 3: reference decisions that affect every language

17. **The TypeScript server does not speak MCP Streamable HTTP.** It advertises protocol `2024-11-05` over custom routes. The conformance runner reaches the Rust backend over Streamable HTTP, but the TypeScript client cannot.
18. **Unknown and unexposed commands get different codes depending on the entry point**, even within TypeScript:
    - an unexposed command over MCP gives `COMMAND_NOT_FOUND`;
    - the core registry and `createDirectRegistry` give `COMMAND_NOT_EXPOSED`;
    - `DirectClient` gives `UNKNOWN_TOOL`.

    Python, Rust and C++ each copied one of these. Decide per entry point, then write it into a spec.
19. **The TypeScript `ErrorCodes` catalog omits about 25 codes the engines emit,** for example `COMMAND_NOT_EXPOSED`, `BATCH_TIMEOUT` and `STREAM_TIMEOUT`. The other languages therefore add them ad hoc.
20. **The TypeScript `MockServer` runs on the core registry.** It has no Zod validation, did-you-mean, middleware or context scoping, so scenario tests run different semantics from production.

## Defects found in this review

| Defect | Location | Notes |
|---|---|---|
| With `timeout_ms` set, C++ `DirectClient::call` replaces the caller's cancellation token with a deadline-only source, so caller cancellation is lost | `packages/cpp/src/direct_client.cpp:112-116` | Batch (`batch_execution.cpp:315`) and pipeline chain the parent token, and so does TypeScript (`AbortSignal.any`). No test covers it. |
| Rust single `execute` lets a handler panic unwind to the caller | `packages/rust/src/commands.rs` (`CommandRegistry::execute`) | Fixed; Priority 1 item 2 |
| Python core registry, core pipeline and `SimpleRegistry` return exception text | See Priority 1 item 2 | Fixed |
| TypeScript core `executePipeline` returns a throwing executor's `error.message` unredacted | `packages/core/src/pipeline-executor.ts:289-297` | The server engine and core registry pass executors that never throw, so only a custom executor reaches it. Python's `execute_pipeline` redacts it. |
| Python `auto_reconnect` is dead code | `python/src/afd/client.py:437` | Priority 2 item 15 |

## Name parity (`alfred parity`)

Measured at `0777217`: TypeScript 186 exports, Python 179, Rust 225, C++ 158. The Rust row was re-measured after `execution_failure` was exported.

| Language | Missing | What the missing names are |
|---|---|---|
| Python | 97 | **61 exist but are not exported from `afd`:** the pipeline contract in `afd.core.pipeline` and `pipeline_variables` (38), similarity (4), `execution_failure`, `CommandHandler`, `CommandRegistry`, `create_command_registry`, `CommandMiddleware`, `WarningSeverity`, and 13 MCP names with Pythonic spellings. Re-exporting is blocked by collisions: `afd.PipelineStep`, `PipelineResult`, `CommandDefinition` and `CommandContext` are the `afd.direct` dataclasses, not the core types. **16 are real gaps:** the batch and stream executors and their options, the registry and executor options types (`create_command_registry` and `execute_pipeline` take a `dev_mode` keyword instead), the exposure helpers, the timeout controller, progress-with-steps, `DEFAULT_RECONNECT_POLICY`, and the MCP error-code constants and notification and list types. **20 are TypeScript typing artifacts:** the condition guards, `ErrorCode`, `McpId` and similar. |
| Rust | 9 | **Export artifacts:** `is_mcp_exposed` (`is_exposed_to(Mcp)`), `max_similarity_input_length` (at `afd::similarity`), `truncate_name` (private), `execute_batch` (a registry method). **A convenience:** `commands_to_mcp_tools`. **Real gaps:** `execute_stream` and `stream_executor_options`. **No dev mode:** `executor_options` and `command_registry_options`. |
| C++ | 73 | **Deferred (33):** 26 MCP types and helpers, 4 telemetry, `CommandParameter`, and the 2 streamable-command names. **By design (25):** 21 typed condition types and guards, the timeout controller (2), `json_schema` and `create_command_registry`. **Cheap to close (15):** `is_mcp_exposed`, `command_to_mcp_tool`, `commands_to_mcp_tools`, `is_pipeline_condition` over JSON, `is_batch_command`, `is_pipeline_step`, `get_nested_value`, `stream_executor_options` (an alias of `StreamOptions`), `create_progress_chunk_with_steps`, and the 6 aggregation helpers. |

The budgets in `alfred/tests/test_parity.py` equal these counts. Lower a budget in the same pull request that closes a gap.

## Documentation drift

**Updated:**

- The [Python](./features/active/python-parity/python-parity.plan.md) and [Rust](./features/active/rust-parity/rust-parity.plan.md) parity plans still showed their 2026-03-21 counts.
- The [C++ proposal](./features/proposed/cpp-support/proposal.md) still read "Phase 0 complete", with no success criterion checked.
- The [feature index](./features/README.md) listed C++ only as proposed.
- The root `README.md` said every language shares "the same AFD capability set", and listed Rust stream support.
- The `afd` skill's parity rule named three languages.
- The parity notes in the `afd-rust` and `afd-cpp` skills.
- The `afd-rust` skill showed the not-found message as `"Todo '123' not found"`, and its description said "building Rust MCP servers".
- The `afd-cpp` skill said to guard catch blocks with `__cpp_exceptions`. Library code uses `AFD_HAS_EXCEPTIONS`, which also checks MSVC's `_CPPUNWIND`.
- The C++ `README.md` said the library was "being built in phases", fetched the uncut `afd-cpp-v0.1.0` tag, and said CI ran every preset on Linux, macOS and Windows.
- The [C++ work plan](./features/proposed/cpp-support/work-plan.md) named the wire test `tests/wire_fixtures.cpp`, and did not record that `TaskRunner` shipped as `run_all` with `ThreadTaskRunner`.
- `site/index.html` listed three languages, showed `cargo add afd` for a crate that is not on crates.io, and used the old `@afd/*` package names, as did the root `README.md`.
- The todo `spec/README.md` said "TypeScript, Python, etc.". It and the todo `README.md` said only the TypeScript and Python suites check `commands.schema.json`; the C++ suite does too.

**Still open:**

- **Python `README.md` and the `afd-python` skill:**
  - No `@server.command` example sets `expose=ExposeOptions(mcp=True)`. MCP exposure is opt-in, so a copied server lists no user commands.
  - `README.md:58`: a handler with no `input_schema` receives the whole input dict as `title`.
  - `README.md:300-302`: `compose_middleware` takes varargs, and the timing option is `slow_threshold`, not `threshold_ms`.
  - `SKILL.md:528`: `server.run(port=…)` raises `TypeError`.

## Recommended next steps

1. **Fix the Priority 1 items and the C++ `DirectClient` defect.** They are small, local changes.
2. **Wire `spec/vectors/pipeline-variables.json` into the TypeScript, Python and Rust test suites.** Add vectors for validation (unknown keys, length units, messages) and for batch controls. The C++ work plan already recommends `batch-controls.json`.
3. **Write the unknown and unexposed error codes into a spec,** and add the emitted codes to the `ErrorCodes` catalog.
4. **Add an AFD-protocol conformance tier** that checks meta-tools, bootstrap, exposure, batch and pipeline over MCP. It should be optional per language, so Rust and C++ can join once they ship a server.
5. **Python export cleanup:** resolve the `afd.direct` name collisions, then re-export the pipeline, similarity and registry contract. This removes 61 names from the budget.
6. **Decide the undeclared gaps** listed under [Declared deferred](#declared-deferred), and record each decision here.

## Keeping this current

- Update the relevant row when a change adds, removes or changes a capability in any language. A change that closes a gap should also lower the `alfred` budget.
- Update the Version and Contract rows with each release and each contract change (see [`spec/CHANGELOG.md`](../spec/CHANGELOG.md)). `node scripts/check-versions.mjs`, which `pnpm check` runs, fails when they disagree with the manifests or the contract constants.
- Re-measure with `uv run --project alfred alfred parity --path .`. It exits 1 while any gap remains; `alfred/tests/test_parity.py` holds the budgets.
- When TypeScript gains a shared capability, add a row with **No** or **Deferred** for the other languages, rather than leaving it out.
